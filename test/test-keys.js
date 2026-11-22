/*\
title: $:/plugins/rimir/outline/test/test-keys.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for selection, configurable keys and structural operations of the $outline widget.

\*/
"use strict";

describe("outline selection and keys", function() {

	var SEL = "$:/temp/rimir/outline/selection/",
		KEYS = {up: 38, down: 40, left: 37, right: 39, tab: 9, escape: 27, enter: 13};

	// Shortcut config (shadows of the plugin) copied into each test wiki
	function shortcutTiddlers() {
		return $tw.wiki.filterTiddlers("[all[shadows+tiddlers]prefix[$:/config/shortcuts/outline-]]").map(function(title) {
			return $tw.wiki.getTiddler(title).fields;
		});
	}

	function makeWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(shortcutTiddlers().concat(tiddlers || []));
		wiki.addIndexersToWiki();
		return wiki;
	}

	function findWidget(widget, type) {
		if(widget.parseTreeNode && widget.parseTreeNode.type === type) {
			return widget;
		}
		for(var i = 0; i < (widget.children || []).length; i++) {
			var found = findWidget(widget.children[i], type);
			if(found) {
				return found;
			}
		}
		return null;
	}

	function renderOutline(wiki, title) {
		var parser = wiki.parseText("text/vnd.tiddlywiki",
				"<$outline tiddler=\"" + title + "\"><$transclude $tiddler=\"" + title + "\" $mode=\"block\"/></$outline>",
				{parseAsInline: false}),
			root = wiki.makeWidget(parser, {document: $tw.fakeDocument}),
			container = $tw.fakeDocument.createElement("div");
		root.render(container, null);
		var r = {root: root, widget: findWidget(root, "outline"), wiki: wiki, title: title};
		// Re-render like the browser does after a change event
		r.refresh = function() {
			var changes = {};
			changes[title] = {modified: true};
			changes[SEL + title] = {modified: true};
			root.refresh(changes);
		};
		return r;
	}

	function key(r, keyCode, mods) {
		mods = mods || {};
		var ev = {
			keyCode: keyCode,
			key: mods.key,
			shiftKey: !!mods.shift, altKey: !!mods.alt, ctrlKey: !!mods.ctrl, metaKey: false,
			target: mods.target || r.widget.domNode,
			defaultPrevented: !!mods.defaultPrevented,
			prevented: false,
			stopped: false,
			preventDefault: function() { this.prevented = true; },
			stopPropagation: function() { this.stopped = true; }
		};
		r.widget.handleKeydown(ev);
		return ev;
	}

	function hasClass(el, cls) {
		return (el.attributes["class"] || "").split(" ").indexOf(cls) !== -1;
	}

	function selectedUnit(r) {
		var id = r.widget.selectedId;
		return id === -1 ? null : r.widget.units[id].unit;
	}

	function selectedSource(r) {
		var u = selectedUnit(r);
		return u ? r.widget.model.text.substring(u.start, u.end) : null;
	}

	function idOf(r, source) {
		var m = r.widget.model;
		for(var i = 0; i < m.units.length; i++) {
			if(m.text.substring(m.units[i].start, m.units[i].end) === source) {
				return i;
			}
		}
		return -1;
	}

	it("ships configurable default keys", function() {
		var wiki = makeWiki(),
			expected = {
				"outline-up": "Up", "outline-down": "Down", "outline-move-up": "alt-Up", "outline-move-down": "alt-Down",
				"outline-indent": "Tab", "outline-promote": "shift-Tab", "outline-edit": "Enter", "outline-menu": "shift-Enter",
				"outline-parent": "Left", "outline-child": "Right", "outline-up-deep": "ctrl-Up", "outline-down-deep": "ctrl-Down", "outline-edit-up": "ctrl-Up", "outline-edit-down": "ctrl-Down",
				"outline-open": "Enter", "outline-clear": "Escape", "outline-save": "ctrl-Enter",
				"outline-continue": "Enter", "outline-newline": "shift-Enter", "outline-cancel": "Escape",
				"outline-help": "shift-slash"
			};
		Object.keys(expected).forEach(function(name) {
			expect(name + "=" + wiki.getTiddlerText("$:/config/shortcuts/" + name)).toBe(name + "=" + expected[name]);
			expect($tw.wiki.getTiddlerText("$:/config/ShortcutInfo/" + name)).toBeTruthy();
		});
		var up = $tw.keyboardManager.parseKeyDescriptors("((outline-move-up))", {wiki: wiki});
		expect(up[0].keyCode).toBe(38);
		expect(up[0].altKey).toBe(true);
	});

	it("every shortcut is in exactly one key group, every group key is a shortcut", function() {
		var names = $tw.wiki.filterTiddlers("[all[shadows+tiddlers]removeprefix[$:/config/shortcuts/]prefix[outline-]]").sort(),
			grouped = [];
		$tw.wiki.getTiddlerList("$:/plugins/rimir/outline/key-groups").forEach(function(group) {
			expect($tw.wiki.getTiddler(group)).withContext(group).toBeTruthy();
			grouped = grouped.concat($tw.wiki.getTiddlerList(group));
		});
		expect(grouped.slice().sort()).toEqual(names);
	});

	it("? (any layout) and the help key toggle the key overview; Escape closes it before clearing", function() {
		var r = renderOutline(makeWiki([{title: "T", text: "* a\n* b"}]), "T"),
			HELP = "$:/temp/rimir/outline/help/T";
		// Nothing selected: the overview still opens
		var ev = key(r, 219, {shift: true, key: "?"});
		expect(ev.prevented).toBe(true);
		expect(r.wiki.getTiddlerText(HELP)).toBe("yes");
		key(r, 191, {shift: true, key: "?"});
		expect(r.wiki.tiddlerExists(HELP)).toBe(false);
		// The configured key (shift-slash), whatever character it types
		key(r, 191, {shift: true, key: "_"});
		expect(r.wiki.getTiddlerText(HELP)).toBe("yes");
		// Ctrl-? is not the typed character
		expect(key(r, 219, {ctrl: true, key: "?"}).prevented).toBe(false);
		r.widget.select(0);
		ev = key(r, KEYS.escape);
		expect(ev.prevented).toBe(true);
		expect(r.wiki.tiddlerExists(HELP)).toBe(false);
		expect(r.widget.selectedId).toBe(0);
		key(r, KEYS.escape);
		expect(r.widget.selectedId).toBe(-1);
	});

	it("the key overview shows every group and the current keys", function() {
		var html = $tw.wiki.renderTiddler("text/html", "$:/plugins/rimir/outline/ui/keys-table");
		$tw.wiki.getTiddlerList("$:/plugins/rimir/outline/key-groups").forEach(function(group) {
			expect(html).toContain($tw.wiki.getTiddler(group).fields.caption);
		});
		expect(html).toContain("<kbd>alt-Up</kbd>");
		expect(html).toContain("Select the parent unit");
		expect(html).not.toContain("Outline:");
		// Fixed block menu keys
		expect(html).toContain("<kbd>Home</kbd>");
		// A changed key shows at once
		$tw.wiki.addTiddler({title: "$:/config/shortcuts/outline-move-up", text: "ctrl-shift-K"});
		try {
			expect($tw.wiki.renderTiddler("text/html", "$:/plugins/rimir/outline/ui/keys-table")).toContain("<kbd>ctrl-shift-K</kbd>");
		} finally {
			$tw.wiki.deleteTiddler("$:/config/shortcuts/outline-move-up");
		}
	});

	it("the settings tab has a shortcut editor row for every outline key", function() {
		var html = $tw.wiki.renderTiddler("text/html", "$:/plugins/rimir/outline/settings");
		$tw.wiki.filterTiddlers("[all[shadows+tiddlers]removeprefix[$:/config/shortcuts/]prefix[outline-]]").forEach(function(name) {
			expect(html).withContext(name).toContain("<strong>" + name + "</strong>");
		});
	});

	it("select marks the unit and saves the selection", function() {
		var r = renderOutline(makeWiki([{title: "T", text: "* a\n* b"}]), "T");
		expect(r.widget.select(2)).toBe(true);
		expect(r.widget.selectedId).toBe(2);
		expect(hasClass(r.widget.units[2].domNodes[0], "rr-ol-selected")).toBe(true);
		var state = r.wiki.getTiddler(SEL + "T");
		expect(state.fields.start).toBe("4");
		expect(state.fields.index).toBe("2");
		r.widget.select(1);
		expect(hasClass(r.widget.units[2].domNodes[0], "rr-ol-selected")).toBe(false);
		expect(hasClass(r.widget.units[1].domNodes[0], "rr-ol-selected")).toBe(true);
	});

	it("arrows move in document order and skip units without DOM nodes", function() {
		var r = renderOutline(makeWiki([
			{title: "T", text: "* a\n\n<$list filter=\"x\">\n\n<$text text=\"t\"/>\n\n</$list>\n\npara"}
		]), "T");
		var listWidget = r.widget.units[2];
		expect(listWidget.unit.kind).toBe("widget");
		expect(listWidget.domNodes.length).toBe(0);
		// Down without a selection selects the first unit
		var ev = key(r, KEYS.down);
		expect(ev.prevented).toBe(true);
		expect(ev.stopped).toBe(true);
		expect(r.widget.selectedId).toBe(0);
		// Ctrl-Down: every unit, into the list
		key(r, KEYS.down, {ctrl: true});
		expect(r.widget.selectedId).toBe(1);
		key(r, KEYS.down);
		expect(selectedSource(r)).toBe("para");
		key(r, KEYS.down);
		expect(selectedSource(r)).toBe("para");
		key(r, KEYS.up, {ctrl: true});
		expect(r.widget.selectedId).toBe(1);
		r.widget.select(2);
		expect(r.widget.selectedId).toBe(1);
	});

	it("up/down treat a whole list as one block; ctrl-up/down step through its items", function() {
		var r = renderOutline(makeWiki([{title: "T", text: "! H\n\n* a\n** a1\n* b\n\npara\n\n# n\n\nend"}]), "T");
		function sel() { var u = selectedUnit(r); return u.kind === "list" ? "list:" + r.widget.model.text.substring(u.start, u.start + 1) : selectedSource(r); }
		r.widget.select(idOf(r, "! H"));
		key(r, KEYS.down);
		expect(sel()).toBe("list:*");
		// Down from the whole list: the block after it
		key(r, KEYS.down);
		expect(sel()).toBe("para");
		// Up from below: the whole list, then the block above it
		key(r, KEYS.up);
		expect(sel()).toBe("list:*");
		key(r, KEYS.up);
		expect(sel()).toBe("! H");
		// Inside a list: item by item; Down from the last item leaves the list
		r.widget.select(idOf(r, "* a"));
		key(r, KEYS.down);
		expect(sel()).toBe("** a1");
		key(r, KEYS.down);
		expect(sel()).toBe("* b");
		key(r, KEYS.up);
		expect(sel()).toBe("** a1");
		r.widget.select(idOf(r, "* b"));
		key(r, KEYS.down);
		expect(sel()).toBe("para");
		// From a list straight to the next list: selected as a whole when coming from below
		r.widget.select(idOf(r, "end"));
		key(r, KEYS.up);
		expect(sel()).toBe("list:#");
		key(r, KEYS.up);
		expect(sel()).toBe("para");
		// Ctrl-Up from below a list: its last item; Ctrl-Down from the list: its first item
		key(r, KEYS.up, {ctrl: true});
		expect(sel()).toBe("* b");
		r.widget.select(idOf(r, "! H"));
		key(r, KEYS.down);
		key(r, KEYS.down, {ctrl: true});
		expect(sel()).toBe("* a");
	});

	it("left/right select the parent and the first child", function() {
		var r = renderOutline(makeWiki([{title: "T", text: "! H\n\n* a\n** a1\n*** a1x\n* b\n\npara\n\n!! S\n\ns1"}]), "T");
		r.widget.select(idOf(r, "*** a1x"));
		expect(key(r, KEYS.left).prevented).toBe(true);
		expect(selectedSource(r)).toBe("** a1");
		key(r, KEYS.left);
		expect(selectedSource(r)).toBe("* a");
		// A top-level item: the whole list, then the heading
		key(r, KEYS.left);
		expect(selectedUnit(r).kind).toBe("list");
		key(r, KEYS.left);
		expect(selectedSource(r)).toBe("! H");
		// At the top: stays, still consumed
		expect(key(r, KEYS.left).prevented).toBe(true);
		expect(selectedSource(r)).toBe("! H");
		// Right mirrors Left: the list, its first item, then down the items
		key(r, KEYS.right);
		expect(selectedUnit(r).kind).toBe("list");
		key(r, KEYS.right);
		expect(selectedSource(r)).toBe("* a");
		key(r, KEYS.right);
		expect(selectedSource(r)).toBe("** a1");
		key(r, KEYS.right);
		expect(selectedSource(r)).toBe("*** a1x");
		key(r, KEYS.right);
		expect(selectedSource(r)).toBe("*** a1x");
		// A paragraph in a section: Left is the heading
		r.widget.select(idOf(r, "s1"));
		key(r, KEYS.left);
		expect(selectedSource(r)).toBe("!! S");
		key(r, KEYS.left);
		expect(selectedSource(r)).toBe("! H");
		// Nothing selected: not consumed
		r.widget.clearSelection();
		expect(key(r, KEYS.right).prevented).toBe(false);
	});

	it("enter edits the selected unit; on a transclusion it opens the target", function() {
		var r = renderOutline(makeWiki([{title: "T", text: "* a\n\n{{X}}"}, {title: "X", text: "x"}]), "T");
		r.widget.select(idOf(r, "* a"));
		expect(key(r, KEYS.enter).prevented).toBe(true);
		expect(r.widget.editor).not.toBe(null);
		expect(r.widget.editor.id).toBe(idOf(r, "* a"));
		r.widget.cancelEdit();
		var opened = [];
		r.widget.openTarget = function(t) { opened.push(t); return true; };
		r.widget.select(idOf(r, "{{X}}"));
		key(r, KEYS.enter);
		expect(opened).toEqual(["X"]);
		expect(r.widget.editor).toBe(null);
		// Shift-Enter: the block menu; its first entry edits the line
		key(r, KEYS.enter, {shift: true});
		expect(r.widget.menu).not.toBe(null);
		expect(r.widget.menu.entries[0].action).toBe("edit");
		key(r, KEYS.enter);
		expect(r.widget.menu).toBe(null);
		expect(r.widget.editor).not.toBe(null);
	});

	it("escape clears, events already handled are ignored", function() {
		var r = renderOutline(makeWiki([{title: "T", text: "* a\n* b"}]), "T");
		r.widget.select(1);
		var ev = key(r, KEYS.down, {defaultPrevented: true});
		expect(ev.stopped).toBe(false);
		expect(r.widget.selectedId).toBe(1);
		ev = key(r, KEYS.escape);
		expect(ev.prevented).toBe(true);
		expect(r.widget.selectedId).toBe(-1);
		expect(r.wiki.tiddlerExists(SEL + "T")).toBe(false);
		// Without a selection Escape and Tab pass through
		expect(key(r, KEYS.escape).prevented).toBe(false);
		expect(key(r, KEYS.tab).prevented).toBe(false);
	});

	it("selection follows moved unit", function() {
		var r = renderOutline(makeWiki([{title: "T", text: "* a\n* b"}]), "T");
		r.widget.select(idOf(r, "* b"));
		var ev = key(r, KEYS.up, {alt: true});
		expect(ev.prevented).toBe(true);
		expect(r.wiki.getTiddlerText("T")).toBe("* b\n* a");
		r.refresh();
		// The list and the moved item both start at 0: the item stays selected
		expect(selectedUnit(r).kind).toBe("item");
		expect(selectedSource(r)).toBe("* b");
		expect(hasClass(r.widget.units[r.widget.selectedId].domNodes[0], "rr-ol-selected")).toBe(true);
	});

	it("applyResult writes once and saves the selection", function() {
		var wiki = makeWiki([{title: "T", text: "* a\n** b", tags: "X", custom: "c"}]),
			r = renderOutline(wiki, "T"),
			writes = 0,
			addTiddler = wiki.addTiddler;
		r.widget.select(idOf(r, "** b"));
		wiki.addTiddler = function(t) {
			if(t.fields && t.fields.title === "T") {
				writes++;
			}
			return addTiddler.apply(this, arguments);
		};
		key(r, KEYS.tab, {shift: true});
		expect(writes).toBe(1);
		var t = wiki.getTiddler("T");
		expect(t.fields.text).toBe("* a\n* b");
		expect(t.fields.custom).toBe("c");
		expect(t.fields.tags).toEqual(["X"]);
		expect($tw.utils.isDate(t.fields.modified)).toBe(true);
		expect(wiki.getTiddler(SEL + "T").fields.start).toBe("4");
		r.refresh();
		expect(selectedSource(r)).toBe("* b");
	});

	it("indent carries the subtree, heading indent carries the section", function() {
		var r = renderOutline(makeWiki([{title: "T", text: "* a\n* b\n** b1"}]), "T");
		r.widget.select(idOf(r, "* b"));
		key(r, KEYS.tab);
		expect(r.wiki.getTiddlerText("T")).toBe("* a\n** b\n*** b1");
		var h = renderOutline(makeWiki([{title: "H", text: "! H\n\npara\n\n!! S\n\n! I"}]), "H");
		h.widget.select(0);
		key(h, KEYS.tab);
		expect(h.wiki.getTiddlerText("H")).toBe("!! H\n\npara\n\n!!! S\n\n! I");
		h.refresh();
		expect(selectedSource(h)).toBe("!! H");
	});

	it("edge no-op does not write but keeps the key", function() {
		var wiki = makeWiki([{title: "T", text: "* a\n* b"}]),
			r = renderOutline(wiki, "T"),
			before = wiki.getTiddler("T");
		r.widget.select(idOf(r, "* a"));
		expect(key(r, KEYS.up, {alt: true}).prevented).toBe(true);
		expect(key(r, KEYS.tab).prevented).toBe(true);
		expect(key(r, KEYS.tab, {shift: true}).prevented).toBe(true);
		expect(wiki.getTiddler("T")).toBe(before);
	});

	it("identical result text does not write but the frame follows", function() {
		var wiki = makeWiki([{title: "T", text: "* a\n* a"}]),
			r = renderOutline(wiki, "T"),
			before = wiki.getTiddler("T");
		r.widget.select(2);
		expect(key(r, KEYS.up, {alt: true}).prevented).toBe(true);
		expect(wiki.getTiddler("T")).toBe(before);
		expect(wiki.getTiddler(SEL + "T").fields.start).toBe("0");
		r.refresh();
		expect(selectedUnit(r).kind).toBe("item");
		expect(selectedUnit(r).start).toBe(0);
	});

	it("refuses (no write) an adapter result that changes the units", function() {
		var fmt = require("$:/plugins/rimir/outline/format-wikitext.js"),
			wiki = makeWiki([{title: "T", text: "* a\n* b\npara"}]),
			r = renderOutline(wiki, "T"),
			before = wiki.getTiddler("T");
		r.widget.select(idOf(r, "para"));
		spyOn(fmt, "move").and.returnValue({text: "para\n* a\n* b", select: 0});
		expect(key(r, KEYS.up, {alt: true}).prevented).toBe(true);
		expect(fmt.move).toHaveBeenCalled();
		expect(wiki.getTiddler("T")).toBe(before);
		spyOn(fmt, "indent").and.returnValue({text: "* a\n*** b\npara", select: 4});
		r.widget.select(idOf(r, "* b"));
		expect(key(r, KEYS.tab).prevented).toBe(true);
		expect(wiki.getTiddler("T")).toBe(before);
	});

	it("read-only allows selection only", function() {
		var wiki = makeWiki([{title: "T", text: "* a\n* b"}, {title: "$:/status/IsReadOnly", text: "yes"}]),
			r = renderOutline(wiki, "T"),
			before = wiki.getTiddler("T");
		r.widget.select(idOf(r, "* b"));
		// Tab is still consumed: it must not move the focus while a unit is selected
		expect(key(r, KEYS.tab).prevented).toBe(true);
		key(r, KEYS.up, {alt: true});
		key(r, KEYS.tab, {shift: true});
		expect(wiki.getTiddler("T")).toBe(before);
		key(r, KEYS.up);
		expect(selectedSource(r)).toBe("* a");
		key(r, KEYS.escape);
		expect(r.widget.selectedId).toBe(-1);
	});

	it("stale model does nothing and rebuilds", function() {
		var wiki = makeWiki([{title: "T", text: "* a\n* b"}]),
			r = renderOutline(wiki, "T");
		r.widget.select(idOf(r, "* b"));
		var domNode = r.widget.domNode;
		// Outside change that has not been rendered yet
		wiki.addTiddler({title: "T", text: "* a\n* b\n* c"});
		var changed = wiki.getTiddler("T");
		key(r, KEYS.up, {alt: true});
		expect(wiki.getTiddler("T")).toBe(changed);
		expect(r.widget.model.text).toBe("* a\n* b\n* c");
		expect(r.widget.units.length).toBe(4);
		expect(r.widget.domNode).toBe(domNode);
		expect(selectedSource(r)).toBe("* b");
	});

	it("keys pressed before the refresh after our own write still act (no refresh in between)", function() {
		var wiki = makeWiki([{title: "T", text: "* a\n* b\n* c\n* d"}]),
			r = renderOutline(wiki, "T");
		r.widget.select(idOf(r, "* a"));
		key(r, KEYS.down, {alt: true});
		expect(wiki.getTiddlerText("T")).toBe("* b\n* a\n* c\n* d");
		key(r, KEYS.down, {alt: true});
		expect(wiki.getTiddlerText("T")).toBe("* b\n* c\n* a\n* d");
		// Down right after a write steps from the moved unit in the new text
		key(r, KEYS.down);
		expect(selectedSource(r)).toBe("* d");
		key(r, KEYS.up, {alt: true});
		expect(wiki.getTiddlerText("T")).toBe("* b\n* c\n* d\n* a");
	});

	it("structural keys do nothing while this view has an open editor", function() {
		var wiki = makeWiki([{title: "T", text: "* a\n* b\n* c"}]),
			r = renderOutline(wiki, "T"),
			before = wiki.getTiddler("T");
		r.widget.startEdit(idOf(r, "* b"));
		expect(r.widget.editor).not.toBe(null);
		r.widget.select(idOf(r, "* c"));
		expect(key(r, KEYS.up, {alt: true}).prevented).toBe(true);
		expect(key(r, KEYS.tab).prevented).toBe(true);
		r.widget.select(idOf(r, "* a"));
		expect(key(r, KEYS.down, {alt: true}).prevented).toBe(true);
		expect(wiki.getTiddler("T")).toBe(before);
	});

	it("re-selects by start, else by clamped index", function() {
		var wiki = makeWiki([{title: "T", text: "* a\n* b\n* c"}]),
			r = renderOutline(wiki, "T");
		r.widget.select(idOf(r, "* c"));
		wiki.addTiddler({title: "T", text: "* a"});
		r.refresh();
		expect(selectedSource(r)).toBe("* a");
		wiki.addTiddler({title: "T", text: "para\n\n* x\n* y\n* z"});
		wiki.addTiddler({title: SEL + "T", start: "999", index: "2"});
		r.refresh();
		expect(selectedSource(r)).toBe("* x");
	});

	it("outline-open acts only on a transclusion unit", function() {
		var r = renderOutline(makeWiki([{title: "T", text: "* a\n\n{{X}}"}, {title: "X", text: "! x"}]), "T");
		r.widget.select(idOf(r, "* a"));
		expect(r.widget.openTransclusion()).toBe(false);
		r.widget.select(idOf(r, "{{X}}"));
		expect(key(r, KEYS.enter).prevented).toBe(true);
	});

	it("ignores keys from elements inside the container", function() {
		var r = renderOutline(makeWiki([{title: "T", text: "* a\n* b"}]), "T");
		r.widget.select(1);
		var input = $tw.fakeDocument.createElement("input");
		expect(key(r, KEYS.down, {target: input}).prevented).toBe(false);
		expect(r.widget.selectedId).toBe(1);
	});
});
