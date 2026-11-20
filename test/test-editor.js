/*\
title: $:/plugins/rimir/outline/test/test-editor.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the in-place editor of the $outline widget (outline-editor.js): start, save, continue,
cancel, conflicts on outside changes, re-attach after re-render, editor keys and the transclusion jump.
Runs on the fake DOM (SimpleEngine). Typing is simulated by writing the buffer tiddler.

\*/
"use strict";

describe("outline editor", function() {

	var SEL = "$:/temp/rimir/outline/selection/",
		BUF = "$:/temp/rimir/outline/edit/",
		ON = "$:/state/rimir/outline/on/",
		EDITOR = "$:/plugins/rimir/outline/ui/editor",
		KEYS = {enter: 13, escape: 27};

	// Shortcut config and the editor template (shadows of the plugin) copied into each test wiki
	function pluginTiddlers() {
		return $tw.wiki.filterTiddlers("[all[shadows+tiddlers]prefix[$:/config/shortcuts/outline-]] [[" + EDITOR + "]]").map(function(title) {
			return $tw.wiki.getTiddler(title).fields;
		});
	}

	function makeWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(pluginTiddlers().concat(tiddlers || []));
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

	function render(text, others) {
		var wiki = makeWiki([{title: "T", text: text}].concat(others || []));
		var parser = wiki.parseText("text/vnd.tiddlywiki",
				"<$outline tiddler=\"T\"><$transclude $tiddler=\"T\" $mode=\"block\"/></$outline>",
				{parseAsInline: false}),
			root = wiki.makeWidget(parser, {document: $tw.fakeDocument}),
			container = $tw.fakeDocument.createElement("div");
		root.render(container, null);
		var r = {root: root, widget: findWidget(root, "outline"), wiki: wiki};
		r.refresh = function(extra) {
			var changes = {T: {modified: true}};
			changes[SEL + "T"] = {modified: true};
			changes[BUF + "T"] = {modified: true};
			$tw.utils.each(extra || [], function(t) { changes[t] = {modified: true}; });
			root.refresh(changes);
		};
		r.text = function() { return wiki.getTiddlerText("T"); };
		r.buffer = function() { return wiki.getTiddlerText(BUF + "T"); };
		r.type = function(value) { wiki.addTiddler(new $tw.Tiddler(wiki.getTiddler(BUF + "T"), {text: value})); };
		r.idOf = function(source) {
			var m = r.widget.model;
			for(var i = 0; i < m.units.length; i++) {
				if(m.text.substring(m.units[i].start, m.units[i].end) === source) {
					return i;
				}
			}
			throw new Error("no unit " + source);
		};
		return r;
	}

	function hasClass(el, cls) {
		return (el.attributes["class"] || "").split(" ").indexOf(cls) !== -1;
	}

	function siblings(node) {
		return node.parentNode.children;
	}

	function elements(node, out) {
		out = out || [];
		(node.children || []).forEach(function(child) {
			if(child.nodeType === 1) {
				out.push(child);
				elements(child, out);
			}
		});
		return out;
	}

	function editorKey(r, keyCode, mods) {
		mods = mods || {};
		var ev = {
			keyCode: keyCode,
			shiftKey: !!mods.shift, altKey: false, ctrlKey: !!mods.ctrl, metaKey: false,
			target: r.widget.editor.host,
			defaultPrevented: !!mods.defaultPrevented,
			prevented: false,
			preventDefault: function() { this.prevented = true; },
			stopPropagation: function() {}
		};
		r.widget.handleEditorKeydown(ev);
		return ev;
	}

	it("starts an edit next to the unit with the unit's own source", function() {
		var r = render("* a\n** a1\n* b");
		var id = r.idOf("* a"),
			li = r.widget.units[id].domNodes[0];
		expect(r.widget.startEdit(id)).toBe(true);
		var ed = r.widget.editor;
		expect(ed.id).toBe(id);
		expect(ed.isNew).toBe(false);
		expect(ed.origSource).toBe("* a");
		expect(ed.origStart).toBe(0);
		expect(ed.host.tag).toBe("li");
		expect(hasClass(ed.host, "rr-ol-editor-host")).toBe(true);
		var sib = siblings(li);
		expect(sib.indexOf(ed.host)).toBe(sib.indexOf(li) - 1);
		expect(hasClass(li, "rr-ol-editing")).toBe(true);
		expect(r.buffer()).toBe("* a");
		// The editor template rendered an edit widget for the buffer
		var textareas = elements(ed.host).filter(function(el) { return el.tag === "textarea"; });
		expect(textareas.length).toBe(1);
		expect(textareas[0].textContent).toBe("* a");
	});

	it("uses a div host for non-items", function() {
		var r = render("! H\n\npara");
		r.widget.startEdit(r.idOf("para"));
		expect(r.widget.editor.host.tag).toBe("div");
	});

	it("save writes only that range once and cleans up", function() {
		var r = render("* a\n** a1\n* b");
		var id = r.idOf("* b");
		r.widget.startEdit(id);
		r.type("* b changed");
		r.type("* B");
		expect(r.text()).toBe("* a\n** a1\n* b");
		expect(r.widget.saveEdit()).toBe(true);
		expect(r.text()).toBe("* a\n** a1\n* B");
		expect(r.wiki.tiddlerExists(BUF + "T")).toBe(false);
		expect(r.widget.editor).toBe(null);
		r.refresh();
		expect(elements(r.widget.domNode).filter(function(el) { return hasClass(el, "rr-ol-editor-host"); }).length).toBe(0);
		expect(elements(r.widget.domNode).filter(function(el) { return hasClass(el, "rr-ol-editing"); }).length).toBe(0);
		// Saved unit is selected
		expect(r.widget.units[r.widget.selectedId].unit.start).toBe(10);
	});

	it("typing does not write the tiddler", function() {
		var r = render("* a");
		var before = r.wiki.getTiddler("T");
		r.widget.startEdit(r.idOf("* a"));
		r.type("* abc");
		r.refresh();
		expect(r.wiki.getTiddler("T")).toBe(before);
	});

	it("cancel discards and leaves no trace", function() {
		var r = render("* a\n* b");
		var before = r.wiki.getTiddler("T"),
			li = r.widget.units[r.idOf("* a")].domNodes[0];
		r.widget.startEdit(r.idOf("* a"));
		r.type("* zzz");
		r.widget.cancelEdit();
		expect(r.wiki.getTiddler("T")).toBe(before);
		expect(r.wiki.tiddlerExists(BUF + "T")).toBe(false);
		expect(r.widget.editor).toBe(null);
		expect(hasClass(li, "rr-ol-editing")).toBe(false);
		expect(siblings(li).filter(function(el) { return hasClass(el, "rr-ol-editor-host"); }).length).toBe(0);
	});

	it("new unit after an item goes after its subtree, blank new unit writes nothing", function() {
		var r = render("* a\n** a1\n* b");
		var id = r.idOf("* a"),
			li = r.widget.units[id].domNodes[0];
		r.widget.startEdit(id, {isNew: true});
		var host = r.widget.editor.host;
		expect(host.tag).toBe("li");
		expect(siblings(li).indexOf(host)).toBe(siblings(li).indexOf(li) + 1);
		expect(hasClass(li, "rr-ol-editing")).toBe(false);
		expect(r.buffer()).toBe("");
		r.type("   ");
		var before = r.wiki.getTiddler("T");
		r.widget.saveEdit();
		expect(r.wiki.getTiddler("T")).toBe(before);
		expect(r.widget.editor).toBe(null);
		expect(r.wiki.tiddlerExists(BUF + "T")).toBe(false);
		r.widget.startEdit(id, {isNew: true});
		r.type("new");
		r.widget.saveEdit();
		expect(r.text()).toBe("* a\n** a1\n* new\n* b");
	});

	it("new unit after a heading is a paragraph directly under it", function() {
		var r = render("! H\n\n* x");
		var id = r.idOf("! H");
		r.widget.startEdit(id, {isNew: true});
		expect(r.widget.editor.host.tag).toBe("div");
		var h = r.widget.units[id].domNodes[0];
		expect(siblings(h).indexOf(r.widget.editor.host)).toBe(siblings(h).indexOf(h) + 1);
		r.type("p");
		r.widget.saveEdit();
		expect(r.text()).toBe("! H\n\np\n\n* x");
	});

	it("continue saves and opens a new unit after the saved one once rendered", function() {
		var r = render("* a\n* b");
		r.widget.startEdit(r.idOf("* a"));
		r.type("* A");
		r.widget.saveEdit({continue: true});
		expect(r.text()).toBe("* A\n* b");
		r.refresh();
		var ed = r.widget.editor;
		expect(ed).not.toBe(null);
		expect(ed.isNew).toBe(true);
		expect(r.widget.units[ed.id].unit.start).toBe(0);
		expect(r.buffer()).toBe("");
		r.type("mid");
		r.widget.saveEdit({continue: true});
		expect(r.text()).toBe("* A\n* mid\n* b");
		r.refresh();
		expect(r.widget.editor.isNew).toBe(true);
		expect(r.widget.units[r.widget.editor.id].unit.start).toBe(4);
		// Enter on an empty new unit ends the chain without writing
		r.widget.saveEdit({continue: true});
		expect(r.widget.editor).toBe(null);
		expect(r.text()).toBe("* A\n* mid\n* b");
	});

	it("keeps CRLF line ends", function() {
		var r = render("* a\r\n* b");
		r.widget.startEdit(r.idOf("* a"));
		r.type("* a\nx");
		r.widget.saveEdit();
		expect(r.text()).toBe("* a\r\nx\r\n* b");
	});

	it("outside change: save lands at the relocated unit", function() {
		var r = render("* a\n* bb");
		r.widget.startEdit(r.idOf("* bb"));
		r.type("* BB");
		r.wiki.addTiddler({title: "T", text: "* new first\n* a\n* bb"});
		r.widget.saveEdit();
		expect(r.text()).toBe("* new first\n* a\n* BB");
		expect(r.widget.editor).toBe(null);
	});

	it("ambiguous outside change shows a conflict and keeps the buffer", function() {
		var r = render("* a\n* bb");
		r.widget.startEdit(r.idOf("* bb"));
		r.type("* typed");
		r.wiki.addTiddler({title: "T", text: "* bb\n* bb"});
		expect(r.widget.saveEdit()).toBe(false);
		expect(r.text()).toBe("* bb\n* bb");
		expect(r.widget.editor).not.toBe(null);
		expect(r.buffer()).toBe("* typed");
		var notes = elements(r.widget.editor.host).filter(function(el) { return hasClass(el, "rr-ol-conflict"); });
		expect(notes.length).toBe(1);
		expect(notes[0].textContent).toBe("The tiddler changed underneath. Copy your text.");
	});

	it("re-attaches the editor next to the relocated unit after a re-render and keeps the buffer", function() {
		var r = render("* a\n* bb");
		r.widget.startEdit(r.idOf("* bb"));
		r.type("* typed");
		r.wiki.addTiddler({title: "T", text: "* new first\n* a\n* bb"});
		r.refresh();
		var ed = r.widget.editor,
			li = r.widget.units[r.idOf("* bb")].domNodes[0];
		expect(ed).not.toBe(null);
		expect(ed.id).toBe(r.idOf("* bb"));
		var sib = siblings(li);
		expect(sib.indexOf(ed.host)).toBe(sib.indexOf(li) - 1);
		expect(hasClass(li, "rr-ol-editing")).toBe(true);
		expect(r.buffer()).toBe("* typed");
		expect(elements(r.widget.domNode).filter(function(el) { return hasClass(el, "rr-ol-editor-host"); }).length).toBe(1);
		expect(elements(r.widget.domNode).filter(function(el) { return hasClass(el, "rr-ol-editing"); }).length).toBe(1);
	});

	it("read-only and units without DOM nodes cannot be edited", function() {
		var r = render("* a");
		r.wiki.addTiddler({title: "$:/status/IsReadOnly", text: "yes"});
		expect(r.widget.startEdit(r.idOf("* a"))).toBe(false);
		expect(r.widget.editor).toBe(null);
		r.wiki.deleteTiddler("$:/status/IsReadOnly");
		r.widget.units[0].domNodes = [];
		expect(r.widget.startEdit(0)).toBe(false);
	});

	it("shift-enter in select mode starts the edit of the selected unit", function() {
		var r = render("* a\n* b");
		r.widget.select(r.idOf("* b"));
		var ev = {keyCode: 13, shiftKey: true, altKey: false, ctrlKey: false, metaKey: false,
			target: r.widget.domNode, defaultPrevented: false, prevented: false,
			preventDefault: function() { this.prevented = true; }, stopPropagation: function() {}};
		r.widget.handleKeydown(ev);
		expect(ev.prevented).toBe(true);
		expect(r.widget.editor.id).toBe(r.idOf("* b"));
	});

	it("editor keys: save, continue, newline, cancel; consumed events are ignored", function() {
		var r = render("* a\n* b");
		r.widget.startEdit(r.idOf("* a"));
		expect(editorKey(r, KEYS.enter, {defaultPrevented: true}).prevented).toBe(false);
		expect(r.widget.editor.isNew).toBe(false);
		// shift-Enter: newline through the engine (fake DOM has no selection API: Playwright covers the engine), no save
		spyOn(r.widget, "insertNewline");
		expect(editorKey(r, KEYS.enter, {shift: true}).prevented).toBe(true);
		expect(r.widget.insertNewline).toHaveBeenCalled();
		expect(r.widget.editor.isNew).toBe(false);
		r.type("* A");
		expect(editorKey(r, KEYS.enter, {ctrl: true}).prevented).toBe(true);
		expect(r.text()).toBe("* A\n* b");
		expect(r.widget.editor).toBe(null);
		r.refresh();
		r.widget.startEdit(r.idOf("* b"));
		expect(editorKey(r, KEYS.escape).prevented).toBe(true);
		expect(r.widget.editor).toBe(null);
		r.widget.startEdit(r.idOf("* b"));
		r.type("* B");
		expect(editorKey(r, KEYS.enter).prevented).toBe(true);
		expect(r.text()).toBe("* A\n* B");
		r.refresh();
		expect(r.widget.editor.isNew).toBe(true);
	});

	it("enter is a plain newline in multi-line units", function() {
		var r = render("```\nx\n```\n\npara");
		r.widget.startEdit(r.idOf("```\nx\n```"));
		expect(editorKey(r, KEYS.enter).prevented).toBe(false);
		expect(editorKey(r, KEYS.enter, {shift: true}).prevented).toBe(false);
		expect(r.widget.editor).not.toBe(null);
	});

	it("opens a transclusion target in outline mode", function() {
		var r = render("* a\n\n{{X}}", [{title: "X", text: "! x"}]);
		var events = [];
		spyOn(r.widget, "dispatchEvent").and.callFake(function(ev) { events.push(ev); });
		r.widget.select(r.idOf("{{X}}"));
		var ev = {keyCode: 13, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
			target: r.widget.domNode, defaultPrevented: false, prevented: false,
			preventDefault: function() { this.prevented = true; }, stopPropagation: function() {}};
		r.widget.handleKeydown(ev);
		expect(ev.prevented).toBe(true);
		expect(r.wiki.getTiddlerText(ON + "X")).toBe("yes");
		expect(events.length).toBe(1);
		expect(events[0].type).toBe("tm-navigate");
		expect(events[0].navigateTo).toBe("X");
	});

	it("destroying the widget removes the editor but keeps the buffer", function() {
		var r = render("* a");
		r.widget.startEdit(r.idOf("* a"));
		r.type("* typed");
		var host = r.widget.editor.host;
		r.widget.destroy({removeDOMNodes: true});
		expect(r.widget.editor).toBe(null);
		expect(siblings(host).indexOf(host)).toBe(-1);
		expect(r.buffer()).toBe("* typed");
	});
});
