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
		EDITOR = "$:/plugins/rimir/outline/ui/editor",
		KEYS = {enter: 13, escape: 27};

	// Shortcut config and the editor template (shadows of the plugin) copied into each test wiki
	function pluginTiddlers() {
		return $tw.wiki.filterTiddlers("[all[shadows+tiddlers]prefix[$:/config/shortcuts/outline-]] [[" + EDITOR + "]] [[$:/plugins/rimir/outline/ui/overlay]] [[$:/plugins/rimir/outline/ui/overlay-diagram]] [[$:/plugins/rimir/outline/ui/overlay-bar]] [[$:/plugins/rimir/outline/ui/diagram-tools]] " +
			"[all[shadows+tiddlers]tag[$:/tags/rimir/outline/BlockType]prefix[$:/plugins/rimir/outline/]] [[$:/tags/rimir/outline/BlockType]]").map(function(title) {
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
		r.widget.wake();
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

	// A second <$outline> view of T in the same wiki
	function secondView(r) {
		var parser = r.wiki.parseText("text/vnd.tiddlywiki",
				"<$outline tiddler=\"T\"><$transclude $tiddler=\"T\" $mode=\"block\"/></$outline>",
				{parseAsInline: false}),
			root = r.wiki.makeWidget(parser, {document: $tw.fakeDocument}),
			container = $tw.fakeDocument.createElement("div");
		root.render(container, null);
		var widget = findWidget(root, "outline");
		widget.wake();
		return {root: root, widget: widget};
	}

	function notes(r) {
		return elements(r.widget.editor.host).filter(function(el) { return hasClass(el, "rr-ol-notice"); });
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
		// Items: the host is the first child of the li; only the li's own content is hidden, not its sub-items
		expect(ed.host.tag).toBe("div");
		expect(hasClass(ed.host, "rr-ol-editor-host")).toBe(true);
		expect(ed.host.parentNode).toBe(li);
		expect(li.children[0]).toBe(ed.host);
		expect(hasClass(li, "rr-ol-editing-own")).toBe(true);
		expect(hasClass(li, "rr-ol-editing")).toBe(false);
		expect(r.buffer()).toBe("a");
		// The editor template rendered an edit widget for the buffer
		var textareas = elements(ed.host).filter(function(el) { return el.tag === "textarea"; });
		expect(textareas.length).toBe(1);
		expect(textareas[0].textContent).toBe("a");
	});

	it("compact editor by default, full editor with toolbar when configured", function() {
		function editorOf(r) {
			r.widget.startEdit(r.idOf("* a"));
			var els = elements(r.widget.editor.host);
			return {
				textarea: els.filter(function(el) { return el.tag === "textarea"; })[0],
				toolbar: els.some(function(el) { return hasClass(el, "tc-editor-toolbar"); })
			};
		}
		var compact = editorOf(render("* a"));
		expect(hasClass(compact.textarea, "rr-ol-editor-compact")).toBe(true);
		expect(compact.toolbar).toBe(false);
		var full = editorOf(render("* a", [{title: "$:/config/rimir/outline/full-editor", text: "yes"}]));
		// The fake DOM renders no toolbar (the browser tests check it); the full editor's textarea class differs
		expect(hasClass(full.textarea, "tc-edit-texteditor")).toBe(true);
		expect(hasClass(full.textarea, "rr-ol-editor-compact")).toBe(false);
	});

	describe("double-click on another unit while editing", function() {

		function dbl(r, source) {
			r.widget.handleDblClick({target: r.widget.units[r.idOf(source)].domNodes[0], preventDefault: function() {}});
		}
		function edited(r) { return r.widget.model.text.substring(r.widget.units[r.widget.editor.id].unit.start, r.widget.units[r.widget.editor.id].unit.end); }

		it("saves the edited unit and edits the clicked one, after and before it", function() {
			var r = render("para\n\n* a\n* b\n\nend");
			r.widget.startEdit(r.idOf("* a"));
			r.type("A longer");
			dbl(r, "end");
			expect(r.text()).toBe("para\n\n* A longer\n* b\n\nend");
			expect(edited(r)).toBe("end");
			expect(r.buffer()).toBe("end");
			r.type("END");
			dbl(r, "para");
			expect(r.text()).toBe("para\n\n* A longer\n* b\n\nEND");
			expect(edited(r)).toBe("para");
		});

		it("a blanked unit is deleted, the clicked one is still found", function() {
			var r = render("* a\n* b\n* c");
			r.widget.startEdit(r.idOf("* a"));
			r.type("");
			dbl(r, "* c");
			expect(r.text()).toBe("* b\n* c");
			expect(edited(r)).toBe("* c");
		});

		it("a new unit is saved, then the clicked unit is edited", function() {
			var r = render("* a\n* b");
			r.widget.startEdit(r.idOf("* a"), {isNew: true});
			r.type("new");
			dbl(r, "* b");
			expect(r.text()).toBe("* a\n* new\n* b");
			expect(edited(r)).toBe("* b");
		});

		it("a refused save keeps the editor on its unit", function() {
			var r = render("* a\n** a1\n* b");
			r.widget.startEdit(r.idOf("* a"));
			r.type("");
			dbl(r, "* b");
			expect(r.text()).toBe("* a\n** a1\n* b");
			expect(edited(r)).toBe("* a");
			expect(notes(r).length).toBe(1);
		});
	});

	describe("ctrl-up/down move the editor", function() {

		function key(r, keyCode) { return editorKey(r, keyCode, {ctrl: true}); }
		function edited(r) { return r.widget.model.text.substring(r.widget.units[r.widget.editor.id].unit.start, r.widget.units[r.widget.editor.id].unit.end); }

		it("saves and edits the next and previous unit, sub-items included", function() {
			var r = render("* a\n** a1\n* b");
			r.widget.startEdit(r.idOf("* a"));
			r.type("A");
			var ev = key(r, 40);
			expect(ev.prevented).toBe(true);
			expect(r.text()).toBe("* A\n** a1\n* b");
			expect(edited(r)).toBe("** a1");
			expect(r.buffer()).toBe("a1");
			key(r, 40);
			expect(edited(r)).toBe("* b");
			key(r, 38);
			key(r, 38);
			expect(edited(r)).toBe("* A");
		});

		it("at the edges the editor stays on the unit", function() {
			var r = render("* a\n* b");
			r.widget.startEdit(r.idOf("* b"));
			key(r, 40);
			expect(edited(r)).toBe("* b");
		});

		it("unchanged edits write nothing", function() {
			var r = render("* a\n* b"),
				before = r.wiki.getTiddler("T").fields.modified;
			r.widget.startEdit(r.idOf("* a"));
			key(r, 40);
			expect(edited(r)).toBe("* b");
			expect(r.wiki.getTiddler("T").fields.modified).toBe(before);
		});

		it("a blanked unit is deleted; down edits the unit that took its place", function() {
			var r = render("* a\n* b\n* c");
			r.widget.startEdit(r.idOf("* b"));
			r.type("");
			key(r, 40);
			expect(r.text()).toBe("* a\n* c");
			expect(edited(r)).toBe("* c");
		});

		it("an empty new unit: up edits its anchor", function() {
			var r = render("* a\n* b");
			r.widget.startEdit(r.idOf("* a"), {isNew: true});
			key(r, 38);
			expect(r.text()).toBe("* a\n* b");
			expect(edited(r)).toBe("* a");
		});

		it("a refused save keeps the editor", function() {
			var r = render("* a\n** a1\n* b");
			r.widget.startEdit(r.idOf("* a"));
			r.type("");
			key(r, 40);
			expect(r.widget.editor).not.toBe(null);
			expect(r.text()).toBe("* a\n** a1\n* b");
		});
	});

	describe("tab/shift-tab while editing", function() {

		function tab(r, shift) { return editorKey(r, 9, {shift: !!shift}); }
		function edited(r) {
			var u = r.widget.units[r.widget.editor.id].unit;
			return r.widget.model.text.substring(u.start, u.end);
		}

		it("saves, indents the unit with its subtree and keeps editing it", function() {
			var r = render("* a\n* b\n** b1\n* c");
			r.widget.startEdit(r.idOf("* b"));
			r.type("B");
			expect(tab(r).prevented).toBe(true);
			expect(r.text()).toBe("* a\n** B\n*** b1\n* c");
			expect(r.widget.editor).not.toBe(null);
			expect(edited(r)).toBe("** B");
			expect(r.buffer()).toBe("B");
			tab(r, true);
			expect(r.text()).toBe("* a\n* B\n** b1\n* c");
			expect(edited(r)).toBe("* B");
		});

		it("alt-up/down save, move the unit with its subtree and keep editing it", function() {
			var r = render("* a\n* b\n** b1\n* c");
			r.widget.startEdit(r.idOf("* b"));
			r.type("B");
			var ev = {keyCode: 40, shiftKey: false, altKey: true, ctrlKey: false, metaKey: false,
				target: r.widget.editor.host, defaultPrevented: false, prevented: false,
				preventDefault: function() { this.prevented = true; }, stopPropagation: function() {}};
			r.widget.handleEditorKeydown(ev);
			expect(ev.prevented).toBe(true);
			expect(r.text()).toBe("* a\n* c\n* B\n** b1");
			expect(edited(r)).toBe("* B");
			expect(r.buffer()).toBe("B");
			ev.keyCode = 38; ev.prevented = false;
			r.widget.handleEditorKeydown(ev);
			r.widget.handleEditorKeydown(ev);
			expect(r.text()).toBe("* B\n** b1\n* a\n* c");
			expect(edited(r)).toBe("* B");
		});

		it("headings carry their section", function() {
			var r = render("! A\n\n! B\n\ntext");
			r.widget.startEdit(r.idOf("! B"));
			tab(r);
			expect(r.text()).toBe("! A\n\n!! B\n\ntext");
			expect(edited(r)).toBe("!! B");
		});

		it("no previous sibling: nothing changes, the editor stays", function() {
			var r = render("* a\n* b"),
				before = r.wiki.getTiddler("T");
			r.widget.startEdit(r.idOf("* a"));
			expect(tab(r).prevented).toBe(true);
			expect(r.wiki.getTiddler("T")).toBe(before);
			expect(edited(r)).toBe("* a");
		});

		it("empty text: consumed, nothing deleted", function() {
			var r = render("* a\n* b");
			r.widget.startEdit(r.idOf("* b"));
			r.type("");
			expect(tab(r).prevented).toBe(true);
			expect(r.text()).toBe("* a\n* b");
			expect(r.widget.editor).not.toBe(null);
		});

		it("a new unit with text is inserted, then indented", function() {
			var r = render("* a\n* b");
			r.widget.startEdit(r.idOf("* a"), {isNew: true});
			r.type("n");
			tab(r);
			expect(r.text()).toBe("* a\n** n\n* b");
			expect(edited(r)).toBe("** n");
		});
	});

	describe("block menu", function() {

		function press(r, keyCode, mods) {
			mods = mods || {};
			var ev = {keyCode: keyCode, shiftKey: !!mods.shift, altKey: !!mods.alt, ctrlKey: false, metaKey: false,
				target: r.widget.domNode, defaultPrevented: false, prevented: false,
				preventDefault: function() { this.prevented = true; }, stopPropagation: function() {}};
			r.widget.handleKeydown(ev);
			return ev;
		}
		function labels(r) {
			return r.widget.menu.entries.map(function(e) { return e.action + ":" + e.type; });
		}
		function choose(r, action, type) {
			var i = labels(r).indexOf(action + ":" + type);
			expect(i).not.toBe(-1);
			r.widget.setMenuActive(i);
			press(r, 13);
		}

		it("alt-enter opens it with insert and turn-into entries for the unit", function() {
			var r = render("para\n\n* a\n* b");
			r.widget.select(r.idOf("para"));
			expect(press(r, 13, {alt: true}).prevented).toBe(true);
			var inserts = ["insert:paragraph", "insert:heading1", "insert:heading2", "insert:heading3",
				"insert:bulleted", "insert:numbered", "insert:quote", "insert:quote-block", "insert:code"];
			expect(labels(r)).toEqual(inserts.concat(inserts, [
				"convert:heading1", "convert:heading2", "convert:heading3", "convert:bulleted", "convert:numbered",
				"convert:quote", "convert:quote-block", "convert:code", "externalize:undefined"]));
			expect(r.widget.menu.entries[9].group).toBe("group-insert-before");
			expect(r.widget.menu.entries[9].where).toBe("before");
			expect(hasClass(r.widget.menu.node, "rr-ol-menu")).toBe(true);
			// Escape closes, nothing written
			press(r, 27);
			expect(r.widget.menu).toBe(null);
			// A bullet: insert before/after it too, and it turns into every other type
			r.widget.select(r.idOf("* a"));
			press(r, 13, {alt: true});
			expect(labels(r)).toEqual(inserts.concat(inserts, ["convert:paragraph", "convert:heading1", "convert:heading2",
				"convert:heading3", "convert:numbered", "convert:quote", "convert:quote-block", "convert:code", "externalize:undefined"]));
		});

		it("follows the block type tiddlers: an untagged override drops the type from insert and turn into", function() {
			var r = render("para\n\nnext", [{title: "$:/plugins/rimir/outline/blocktypes/heading3", name: "heading3",
				caption: "Heading 3", behaviour: "heading", level: "3"}]);
			r.widget.select(r.idOf("para"));
			press(r, 13, {alt: true});
			expect(labels(r).filter(function(l) { return /heading3/.test(l); })).toEqual([]);
			expect(labels(r)).toContain("convert:heading2");
		});

		it("insert before the first bullet makes a new first bullet", function() {
			var r = render("* a\n* b");
			r.widget.select(r.idOf("* a"));
			press(r, 13, {alt: true});
			var i = r.widget.menu.entries.findIndex(function(e) { return e.where === "before" && e.type === "bulleted"; });
			r.widget.setMenuActive(i);
			press(r, 13);
			r.type("first");
			r.widget.saveEdit();
			expect(r.wiki.getTiddlerText("T")).toBe("* first\n* a\n* b");
		});

		it("alt-enter in an empty new editor offers every type; picking one changes what it creates, nothing is written", function() {
			var r = render("! H\n\npara");
			r.widget.select(r.idOf("! H"));
			r.widget.startEdit(r.idOf("! H"), {isNew: true});
			expect(r.widget.editor.kind).toBe("block");
			r.widget.editMenu();
			expect(r.widget.menu.entries.map(function(e) { return e.action + ":" + e.type; })).toEqual(["retype:paragraph",
				"retype:heading1", "retype:heading2", "retype:heading3", "retype:bulleted", "retype:numbered", "retype:quote",
				"retype:quote-block", "retype:code"]);
			choose(r, "retype", "heading2");
			expect(r.wiki.getTiddlerText("T")).toBe("! H\n\npara");
			expect(r.widget.editor.isNew).toBe(true);
			expect(r.widget.editor.blockType).toBe("heading2");
			r.type("x");
			r.widget.saveEdit();
			// A new heading at a heading goes after its section (as when inserted from the block menu)
			expect(r.wiki.getTiddlerText("T")).toBe("! H\n\npara\n\n!! x");
		});

		it("escape on the retype menu keeps the new editor as it was", function() {
			var r = render("para");
			r.widget.select(r.idOf("para"));
			r.widget.startEdit(r.idOf("para"), {isNew: true});
			r.widget.editMenu();
			press(r, 27);
			expect(r.widget.menu).toBe(null);
			expect(r.widget.editor.isNew).toBe(true);
			expect(r.widget.editor.blockType).toBe("");
		});

		it("a new block's editor has the type's caption as placeholder", function() {
			var r = render("para");
			r.widget.select(r.idOf("para"));
			press(r, 13, {alt: true});
			choose(r, "insert", "heading2");
			var w = r.widget.editor.widget;
			while(w.children && w.children.length) { w = w.children[0]; }
			expect(w.getVariable("outline-edit-placeholder")).toBe("Heading 2");
		});

		it("labels the types with their captions", function() {
			var r = render("para", [{title: "$:/plugins/rimir/outline/blocktypes/paragraph", tags: "$:/tags/rimir/outline/BlockType",
				name: "paragraph", caption: "Text", badge: "paragraph", behaviour: "paragraph"}]);
			r.widget.select(r.idOf("para"));
			press(r, 13, {alt: true});
			expect(r.widget.menu.node.textContent).toContain("Text");
			expect(r.widget.menu.node.textContent).toContain("Heading 1");
		});

		it("up/down move the active entry; another key closes the menu and acts as usual", function() {
			var r = render("para\n\nnext");
			r.widget.select(r.idOf("para"));
			press(r, 13, {alt: true});
			press(r, 40);
			press(r, 40);
			expect(r.widget.menu.active).toBe(2);
			press(r, 38);
			expect(r.widget.menu.active).toBe(1);
			press(r, 38);
			press(r, 38);
			expect(r.widget.menu.active).toBe(0);
			press(r, 9);
			expect(r.widget.menu).toBe(null);
		});

		it("insert opens an editor for the new block; saving inserts it of that type", function() {
			var r = render("para\n\n! H\n\ntext");
			r.widget.select(r.idOf("para"));
			press(r, 13, {alt: true});
			choose(r, "insert", "heading2");
			expect(r.widget.editor).not.toBe(null);
			expect(r.widget.editor.blockType).toBe("heading2");
			expect(r.wiki.getTiddler(BUF + "T").fields["outline-block-type"]).toBe("heading2");
			r.type("New");
			r.widget.saveEdit();
			expect(r.text()).toBe("para\n\n!! New\n\n! H\n\ntext");
			r.refresh();
			expect(r.widget.units[r.widget.selectedId].unit.kind).toBe("heading");
		});

		it("insert after a heading: a new heading goes after the section, its editor too", function() {
			var r = render("! H\n\ntext\n\n! I");
			r.widget.select(r.idOf("! H"));
			press(r, 13, {alt: true});
			choose(r, "insert", "heading1");
			var host = r.widget.editor.host,
				textP = r.widget.units[r.idOf("text")].domNodes[0];
			expect(siblings(textP).indexOf(host)).toBe(siblings(textP).indexOf(textP) + 1);
			r.type("G");
			r.widget.saveEdit();
			expect(r.text()).toBe("! H\n\ntext\n\n! G\n\n! I");
		});

		it("insert before: the new block goes right above the unit, its editor too", function() {
			var r = render("intro\n\n* a\n* b\n\n!! S\n\nx");
			function before(id, type) {
				r.widget.select(id);
				press(r, 13, {alt: true});
				var i = r.widget.menu.entries.findIndex(function(e) { return e.where === "before" && e.type === type; });
				r.widget.setMenuActive(i);
				press(r, 13);
			}
			before(r.idOf("* a\n* b"), "heading1");
			var listNode = r.widget.units[r.idOf("* a\n* b")].domNodes[0];
			expect(siblings(listNode).indexOf(r.widget.editor.host)).toBe(siblings(listNode).indexOf(listNode) - 1);
			// The unit stays visible
			expect(hasClass(listNode, "rr-ol-editing")).toBe(false);
			r.type("Top");
			r.widget.saveEdit();
			expect(r.text()).toBe("intro\n\n! Top\n\n* a\n* b\n\n!! S\n\nx");
			r.refresh();
			expect(r.widget.units[r.widget.selectedId].unit.kind).toBe("heading");
			// Before a lower heading, and before the first block
			before(r.idOf("!! S"), "heading1");
			r.type("Two");
			r.widget.saveEdit();
			expect(r.text()).toBe("intro\n\n! Top\n\n* a\n* b\n\n! Two\n\n!! S\n\nx");
			r.refresh();
			before(r.idOf("intro"), "paragraph");
			r.type("first");
			r.widget.saveEdit();
			expect(r.text()).toBe("first\n\nintro\n\n! Top\n\n* a\n* b\n\n! Two\n\n!! S\n\nx");
		});

		it("an empty tiddler: a hint, Enter writes a first paragraph, Alt-Enter offers the block types", function() {
			var r = render("");
			expect(r.widget.emptyHint).not.toBe(null);
			expect(press(r, 13).prevented).toBe(true);
			expect(r.widget.editor.where).toBe("end");
			r.type("hello");
			r.widget.saveEdit();
			expect(r.text()).toBe("hello");
			r.refresh();
			expect(r.widget.emptyHint).toBe(null);
			expect(r.widget.units[r.widget.selectedId].unit.kind).toBe("block");
			// Only whitespace and a comment: Alt-Enter offers inserts only, the block goes after the comment
			r.wiki.addTiddler(new $tw.Tiddler(r.wiki.getTiddler("T"), {text: "<!-- note -->\n\n"}));
			r.refresh();
			expect(r.widget.emptyHint).not.toBe(null);
			press(r, 13, {alt: true});
			expect(labels(r).every(function(l) { return l.indexOf("insert:") === 0; })).toBe(true);
			choose(r, "insert", "heading1");
			r.type("Title");
			r.widget.saveEdit();
			expect(r.text()).toBe("<!-- note -->\n\n! Title");
		});

		it("a new code block: Enter is a newline", function() {
			var r = render("para");
			r.widget.select(r.idOf("para"));
			press(r, 13, {alt: true});
			choose(r, "insert", "code");
			expect(r.widget.editor.multiline).toBe(true);
			r.type("a\nb");
			r.widget.saveEdit();
			expect(r.text()).toBe("para\n\n```\na\nb\n```");
		});

		it("turn into converts the unit and keeps it selected", function() {
			var r = render("para\n\nnext");
			r.widget.select(r.idOf("para"));
			press(r, 13, {alt: true});
			choose(r, "convert", "bulleted");
			expect(r.text()).toBe("* para\n\nnext");
			r.refresh();
			var sel = r.widget.units[r.widget.selectedId].unit;
			expect(sel.kind).toBe("item");
		});

		it("a bullet switches its list type with its siblings", function() {
			var r = render("* a\n* b\n** b1");
			r.widget.select(r.idOf("* b"));
			press(r, 13, {alt: true});
			choose(r, "convert", "numbered");
			expect(r.text()).toBe("# a\n# b\n#* b1");
		});

		it("not in read-only wikis", function() {
			var r = render("para", [{title: "$:/status/IsReadOnly", text: "yes"}]);
			r.widget.select(r.idOf("para"));
			expect(press(r, 13, {alt: true}).prevented).toBe(true);
			expect(r.widget.menu).toBe(null);
		});

		describe("diagrams: add to an item, edit in place", function() {
			var TYPE = {title: "TT", tags: "$:/tags/rimir/outline/BlockType", name: "diag", caption: "Diagram", badge: "x",
					behaviour: "typed", "content-type": "text/plain", contexts: "block item", inline: "transclude", starter: "s"},
				PILL = {title: "TP", tags: "$:/tags/rimir/outline/BlockType", name: "pill", caption: "Pill", badge: "pill",
					behaviour: "paragraph", contexts: "item", inline: "<<pill \"$content$\">>"};

			function menuOn(r, source) {
				r.widget.select(r.idOf(source));
				press(r, 13, {alt: true});
			}

			it("add to this item: the diagram is written on the first save, with its reference", function() {
				var r = render("* Build pipeline\n* b", [TYPE, PILL]);
				menuOn(r, "* Build pipeline");
				expect(labels(r)).toContain("add:diag");
				expect(labels(r)).toContain("add:pill");
				expect(labels(r)).not.toContain("insert:pill");
				choose(r, "add", "diag");
				expect(r.widget.editor.target.isNew).toBe(true);
				expect(r.wiki.getTiddlerText(BUF + "T")).toBe("s");
				expect(r.wiki.tiddlerExists("T/graphs/diag1")).toBe(false);
				r.type("graph");
				r.widget.saveEdit();
				var g = r.wiki.getTiddler("T/graphs/diag1");
				expect(g.fields.type).toBe("text/plain");
				expect(g.fields.text).toBe("graph");
				expect(r.wiki.getTiddlerText("T")).toBe("* Build pipeline {{T/graphs/diag1}}\n* b");
				expect(r.widget.editor).toBe(null);
				r.refresh();
				r.widget.undoStep(true);
				expect(r.wiki.getTiddlerText("T")).toBe("* Build pipeline\n* b");
				expect(r.wiki.tiddlerExists("T/graphs/diag1")).toBe(true);
			});

			it("a new block of a type with a starter text opens with it", function() {
				var r = render("para", [TYPE]);
				r.widget.select(r.idOf("para"));
				press(r, 13, {alt: true});
				choose(r, "insert", "diag");
				expect(r.wiki.getTiddlerText(BUF + "T")).toBe("s");
				r.widget.saveEdit();
				expect(r.wiki.getTiddlerText("T")).toBe("para\n\n$$$text/plain\ns\n$$$");
			});

			it("the code field of a new diagram and of a typed block has the type's examples and docs link", function() {
				var EX = {title: "E1", tags: "$:/tags/rimir/outline/Snippet", "for": "diag", caption: "First example", text: "ex1"},
					DOCS = $tw.utils.extend({}, TYPE, {docs: "https://example.org/docs"});
				function selects(w) {
					var out = [];
					(function walk(x) {
						if(x.parseTreeNode && x.parseTreeNode.type === "select") { out.push(x); }
						$tw.utils.each(x.children, walk);
					})(w);
					return out;
				}
				var r = render("* a\n* b", [DOCS, EX]);
				menuOn(r, "* a");
				choose(r, "add", "diag");
				expect(selects(r.widget.editor.widget).length).toBe(1);
				expect(r.widget.editor.host.textContent).toContain("Docs");
				r.widget.cancelEdit();
				var t = render("p\n\n$$$text/plain\nsrc\n$$$", [DOCS, EX]);
				t.widget.startEdit(t.idOf("$$$text/plain\nsrc\n$$$"));
				expect(selects(t.widget.editor.widget).length).toBe(1);
				t.widget.cancelEdit();
				// A paragraph's editor has none
				t.widget.startEdit(t.idOf("p"));
				expect(selects(t.widget.editor.widget).length).toBe(0);
			});

			it("escape before the first save leaves no trace", function() {
				var r = render("* a\n* b", [TYPE]);
				menuOn(r, "* a");
				choose(r, "add", "diag");
				r.type("graph");
				r.widget.cancelEdit();
				expect(r.widget.editor).toBe(null);
				expect(r.wiki.getTiddlerText("T")).toBe("* a\n* b");
				expect(r.wiki.tiddlerExists("T/graphs/diag1")).toBe(false);
			});

			it("names new tiddlers from the config templates, with the first free number", function() {
				var r = render("* a\n* b", [TYPE, {title: "T/graphs/diag1", text: "taken"}]);
				expect(r.widget.newTiddlerTitle("diagram", {type: "diag"})).toBe("T/graphs/diag2");
				expect(r.widget.newTiddlerTitle("externalize")).toBe("T/parts/part1");
				r.wiki.addTiddler({title: "$:/config/rimir/outline/name/diagram", text: "$host$/x/$type$-"});
				expect(r.widget.newTiddlerTitle("diagram", {type: "diag"})).toBe("T/x/diag-1");
			});

			it("a reference is {{title}}, or a transclude widget for a title that would break it", function() {
				var fmt = require("$:/plugins/rimir/outline/format-wikitext.js");
				expect(fmt.referenceTo("x", false)).toBe("{{x}}");
				expect(fmt.referenceTo("x", true)).toBe("{{x}}");
				expect(fmt.referenceTo("A|B/parts/part1", false)).toBe("<$transclude $tiddler=\"A|B/parts/part1\" $mode=\"block\"/>");
				expect(fmt.referenceTo("A{B}", true)).toBe("<$transclude $tiddler=\"A{B}\"/>");
				expect(fmt.referenceTo("a\"b!!c", true)).toBe("<$transclude $tiddler='a\"b!!c'/>");
				expect(fmt.referenceTo("a##b", true)).toBe("<$transclude $tiddler=\"a##b\"/>");
			});

			it("edit a transcluded diagram from the item's menu; escape changes nothing", function() {
				var r = render("* a {{G}}\n* b", [TYPE, {title: "G", type: "text/plain", text: "g"}]);
				menuOn(r, "* a {{G}}");
				var i = r.widget.menu.entries.findIndex(function(e) { return e.action === "edit-target" && e.title === "G"; });
				expect(i).not.toBe(-1);
				r.widget.setMenuActive(i);
				press(r, 13);
				// The diagram overlay (outline-overlay.js) with its source
				var DBUF = "$:/temp/rimir/outline/diagram/T";
				expect(r.widget.overlay.title).toBe("G");
				expect(r.wiki.getTiddlerText(DBUF)).toBe("g");
				r.wiki.addTiddler(new $tw.Tiddler(r.wiki.getTiddler(DBUF), {text: "h"}));
				r.widget.saveOverlay();
				expect(r.wiki.getTiddlerText("G")).toBe("h");
				expect(r.wiki.getTiddlerText("T")).toBe("* a {{G}}\n* b");
				r.refresh();
				r.widget.openOverlay(r.idOf("* a {{G}}"), "G");
				r.wiki.addTiddler(new $tw.Tiddler(r.wiki.getTiddler(DBUF), {text: "zzz"}));
				r.widget.closeOverlay(true);
				expect(r.wiki.getTiddlerText("G")).toBe("h");
			});

			it("enter edits a transclusion line, also a block-level {{...}}; shift-enter on a diagram opens its overlay", function() {
				var r = render("para\n\n{{W}}\n\n{{G}}", [TYPE, {title: "W", text: "w"}, {title: "G", type: "text/plain", text: "g"}]);
				r.widget.select(r.idOf("{{W}}"));
				press(r, 13);
				expect(r.widget.editor && !r.widget.editor.target).toBe(true);
				expect(r.wiki.getTiddlerText(BUF + "T")).toBe("{{W}}");
				r.widget.cancelEdit();
				r.widget.select(r.idOf("{{G}}"));
				press(r, 13, {shift: true});
				expect(r.widget.overlay && r.widget.overlay.diagram && r.widget.overlay.title).toBe("G");
				r.widget.closeOverlay(true);
				// No "Edit this line" entry any more
				press(r, 13, {alt: true});
				expect(r.widget.menu.entries.some(function(e) { return e.action === "edit"; })).toBe(false);
			});

			it("double-click on a diagram in an item opens its overlay; shift-enter on a block-level diagram too", function() {
				var r = render("* a {{G}}\n* b\n\n{{G}}\n\n{{W}}", [TYPE, {title: "G", type: "text/plain", text: "g"}, {title: "W", text: "w"}]);
				var node = r.widget.diagramTargets(r.idOf("* a {{G}}"))[0].node;
				r.widget.handleDblClick({target: node, preventDefault: function() {}});
				expect(r.widget.overlay && r.widget.overlay.title).toBe("G");
				r.widget.closeOverlay(true);
				r.widget.select(r.idOf("{{G}}"));
				press(r, 13, {shift: true});
				expect(r.widget.overlay && r.widget.overlay.title).toBe("G");
				r.widget.closeOverlay(true);
			});

			it("a click on a diagram in an item selects the item, it does not open the diagram tiddler", function() {
				var r = render("* a {{G}}\n* b", [TYPE, {title: "G", type: "text/plain", text: "g"}]),
					opened = [];
				r.widget.openTarget = function(title) { opened.push(title); };
				var node = r.widget.diagramTargets(r.idOf("* a {{G}}"))[0].node;
				r.widget.handleClick({target: node, ctrlKey: false, metaKey: false, preventDefault: function() {}, stopPropagation: function() {}});
				expect(opened).toEqual([]);
				expect(r.widget.selectedId).toBe(r.idOf("* a {{G}}"));
			});

			it("a double-click on a wikitext transclusion does not open the diagram editor", function() {
				var r = render("para\n\n{{W}}", [TYPE, {title: "W", text: "w"}]);
				// (the fake DOM cannot read the marker's attributes: the line itself, and the guard below)
				r.widget.handleDblClick({target: r.widget.units[r.idOf("{{W}}")].domNodes[0], preventDefault: function() {}});
				expect(r.widget.editor && r.widget.editor.target).toBeFalsy();
				expect(r.widget.startTargetEdit(r.idOf("{{W}}"), {title: "W"})).toBe(false);
			});

			it("externalize from the block menu: a new tiddler, the reference selected, one undo step", function() {
				var r = render("a\n\nb\n\nc");
				r.widget.select(r.idOf("b"));
				r.widget.selectRange(r.idOf("b"), r.idOf("c"));
				press(r, 13, {alt: true});
				var i = r.widget.menu.entries.findIndex(function(e) { return e.action === "externalize"; });
				expect(i).toBe(r.widget.menu.entries.length - 1);
				r.widget.setMenuActive(i);
				press(r, 13);
				expect(r.wiki.getTiddlerText("T")).toBe("a\n\n{{T/parts/part1}}");
				expect(r.wiki.getTiddler("T/parts/part1").fields.text).toBe("b\n\nc");
				r.refresh();
				expect(r.widget.units[r.widget.selectedId].unit.kind).toBe("transclusion");
				r.widget.undoStep(true);
				expect(r.wiki.getTiddlerText("T")).toBe("a\n\nb\n\nc");
				expect(r.wiki.tiddlerExists("T/parts/part1")).toBe(true);
			});

			it("no externalize entry for sub-items in the middle", function() {
				var r = render("* a\n** a1\n** a2\n* b");
				r.widget.select(r.idOf("** a2"));
				press(r, 13, {alt: true});
				expect(labels(r)).not.toContain("externalize:undefined");
				expect(r.widget.menu.entries.some(function(e) { return e.action === "externalize"; })).toBe(false);
			});

			it("a template type appends its template with the content to the item", function() {
				var r = render("* a\n* b", [PILL]);
				menuOn(r, "* a");
				choose(r, "add", "pill");
				r.type("x");
				r.widget.saveEdit();
				expect(r.wiki.getTiddlerText("T")).toBe("* a <<pill \"x\">>\n* b");
			});

			it("only save and escape act in the diagram editor", function() {
				var r = render("* a {{G}}\n* b", [TYPE, {title: "G", type: "text/plain", text: "g"}]);
				r.widget.startTargetEdit(r.idOf("* a {{G}}"), {title: "G"});
				var ev = {keyCode: 9, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, defaultPrevented: false,
					preventDefault: function() { this.defaultPrevented = true; }, stopPropagation: function() {}};
				r.widget.handleEditorKeydown(ev);
				expect(ev.defaultPrevented).toBe(false);
				expect(r.wiki.getTiddlerText("T")).toBe("* a {{G}}\n* b");
			});
		});
	});

	it("no selection frames while an editor is open", function() {
		var r = render("* a\n* b");
		r.widget.select(r.idOf("* a"));
		r.widget.startEdit(r.idOf("* a"), {isNew: true});
		expect(hasClass(r.widget.domNode, "rr-ol-is-editing")).toBe(true);
		r.widget.cancelEdit();
		expect(hasClass(r.widget.domNode, "rr-ol-is-editing")).toBe(false);
	});

	it("uses a div host before non-items and hides them", function() {
		var r = render("! H\n\npara");
		var id = r.idOf("para"),
			p = r.widget.units[id].domNodes[0];
		r.widget.startEdit(id);
		expect(r.widget.editor.host.tag).toBe("div");
		expect(siblings(p).indexOf(r.widget.editor.host)).toBe(siblings(p).indexOf(p) - 1);
		expect(hasClass(p, "rr-ol-editing")).toBe(true);
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
		expect(elements(r.widget.domNode).filter(function(el) { return hasClass(el, "rr-ol-editing") || hasClass(el, "rr-ol-editing-own"); }).length).toBe(0);
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
		expect(hasClass(li, "rr-ol-editing-own")).toBe(false);
		expect(elements(r.widget.domNode).filter(function(el) { return hasClass(el, "rr-ol-editor-host"); }).length).toBe(0);
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

	it("new item with only its marker typed writes nothing and closes", function() {
		var r = render("* a\n* b");
		r.widget.startEdit(r.idOf("* a"), {isNew: true});
		r.type("* ");
		var before = r.wiki.getTiddler("T");
		expect(r.widget.saveEdit()).toBe(true);
		expect(r.wiki.getTiddler("T")).toBe(before);
		expect(r.widget.editor).toBe(null);
		r.widget.startEdit(r.idOf("* a"), {isNew: true});
		r.type("* typed");
		r.widget.saveEdit();
		expect(r.text()).toBe("* a\n* typed\n* b");
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
		var r = render("p\r\n\r\n* b");
		r.widget.startEdit(r.idOf("p"));
		r.type("p\nx");
		r.widget.saveEdit();
		expect(r.text()).toBe("p\r\nx\r\n\r\n* b");
	});

	it("a line break typed in an item is saved as <br>: the list stays intact", function() {
		var r = render("* a\n* b\n** b1");
		r.widget.startEdit(r.idOf("* a"));
		r.type("a\nx");
		r.widget.saveEdit();
		expect(r.text()).toBe("* a<br>x\n* b\n** b1");
		r.refresh();
		r.widget.startEdit(r.idOf("* a<br>x"));
		expect(r.buffer()).toBe("a\nx");
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
		var found = elements(r.widget.editor.host).filter(function(el) { return hasClass(el, "rr-ol-conflict"); });
		expect(found.length).toBe(1);
		expect(found[0].textContent).toBe("The tiddler changed underneath. Copy your text.");
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
		expect(ed.host.parentNode).toBe(li);
		expect(li.children[0]).toBe(ed.host);
		expect(hasClass(li, "rr-ol-editing-own")).toBe(true);
		expect(r.buffer()).toBe("* typed");
		expect(elements(r.widget.domNode).filter(function(el) { return hasClass(el, "rr-ol-editor-host"); }).length).toBe(1);
		expect(elements(r.widget.domNode).filter(function(el) { return hasClass(el, "rr-ol-editing-own"); }).length).toBe(1);
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

	it("enter in select mode starts the edit of the selected unit", function() {
		var r = render("* a\n* b");
		r.widget.select(r.idOf("* b"));
		var ev = {keyCode: 13, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
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

	it("enter right after a move (before the refresh) edits the moved unit", function() {
		var r = render("* a\n* b\n* c");
		r.widget.select(r.idOf("* a"));
		var ev = {keyCode: 40, shiftKey: false, altKey: true, ctrlKey: false, metaKey: false,
			target: r.widget.domNode, defaultPrevented: false, prevented: false,
			preventDefault: function() { this.prevented = true; }, stopPropagation: function() {}};
		r.widget.handleKeydown(ev);
		expect(r.text()).toBe("* b\n* a\n* c");
		expect(r.widget.editSelected()).toBe(true);
		expect(r.widget.editor).not.toBe(null);
		expect(r.buffer()).toBe("a");
		expect(r.widget.editor.origStart).toBe(4);
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
		var ev = {keyCode: 13, shiftKey: true, altKey: false, ctrlKey: true, metaKey: false,
			target: r.widget.domNode, defaultPrevented: false, prevented: false,
			preventDefault: function() { this.prevented = true; }, stopPropagation: function() {}};
		r.widget.handleKeydown(ev);
		expect(ev.prevented).toBe(true);
		// The target opens awake, its first unit selected
		expect(r.wiki.getTiddler(SEL + "X").fields.start).toBe("0");
		expect(events.length).toBe(1);
		expect(events[0].type).toBe("tm-navigate");
		expect(events[0].navigateTo).toBe("X");
		// An existing selection there is kept
		r.wiki.addTiddler({title: SEL + "X", start: "4", index: "1", kind: "block"});
		r.widget.openTarget("X");
		expect(r.wiki.getTiddler(SEL + "X").fields.start).toBe("4");
	});

	it("destroying the widget removes the editor; an unchanged buffer is discarded", function() {
		var r = render("* a");
		r.widget.startEdit(r.idOf("* a"));
		var host = r.widget.editor.host;
		r.widget.destroy({removeDOMNodes: true});
		expect(r.widget.editor).toBe(null);
		expect(siblings(host).indexOf(host)).toBe(-1);
		expect(r.wiki.tiddlerExists(BUF + "T")).toBe(false);
		// An item, a heading: unchanged while the field shows what it opened with (without the marker)
		["* a\n* b", "! H"].forEach(function(t) {
			var u = render(t);
			u.widget.startEdit(0);
			expect(u.widget.editChanged()).toBe(false);
			u.type("x");
			expect(u.widget.editChanged()).toBe(true);
			u.widget.cancelEdit();
		});
		// A blank new unit is unchanged too
		var n = render("* a");
		n.widget.startEdit(n.idOf("* a"), {isNew: true});
		n.type("  ");
		n.widget.destroy({removeDOMNodes: true});
		expect(n.wiki.tiddlerExists(BUF + "T")).toBe(false);
	});

	it("destroying the widget keeps a changed buffer; a new widget reopens it at the unit", function() {
		var r = render("* a\n* b\n* c");
		r.widget.startEdit(r.idOf("* b"));
		r.type("* typed");
		r.widget.destroy({removeDOMNodes: true});
		expect(r.widget.editor).toBe(null);
		var buf = r.wiki.getTiddler(BUF + "T");
		expect(buf.fields.text).toBe("* typed");
		expect(buf.fields["outline-orig-source"]).toBe("* b");
		expect(buf.fields["outline-orig-start"]).toBe("4");
		expect(buf.fields["outline-unit-kind"]).toBe("item");
		expect(buf.fields["outline-is-new"]).toBe("no");
		// The re-rendered view (e.g. after a page template refresh) reopens the editor at the same unit
		var v = secondView(r), ed = v.widget.editor,
			li = v.widget.units[1 + 1].domNodes[0];
		expect(ed).not.toBe(null);
		expect(v.widget.model.text.substring(v.widget.units[ed.id].unit.start, v.widget.units[ed.id].unit.end)).toBe("* b");
		expect(ed.host.parentNode).toBe(li);
		expect(hasClass(li, "rr-ol-editing-own")).toBe(true);
		expect(r.buffer()).toBe("* typed");
		expect(v.widget.ownsBuffer()).toBe(true);
		expect(v.widget.saveEdit()).toBe(true);
		expect(r.text()).toBe("* a\n* typed\n* c");
		expect(r.wiki.tiddlerExists(BUF + "T")).toBe(false);
	});

	it("a kept buffer of a new unit reopens after its anchor; escape discards it", function() {
		var r = render("* a\n** a1\n* b");
		r.widget.startEdit(r.idOf("* a"), {isNew: true});
		r.type("new");
		r.widget.destroy({removeDOMNodes: true});
		expect(r.wiki.getTiddler(BUF + "T").fields["outline-is-new"]).toBe("yes");
		var v = secondView(r), ed = v.widget.editor;
		expect(ed.isNew).toBe(true);
		expect(ed.host.tag).toBe("li");
		var li = v.widget.units[0 + 1].domNodes[0];
		expect(siblings(li).indexOf(ed.host)).toBe(siblings(li).indexOf(li) + 1);
		expect(v.widget.cancelEdit()).toBe(true);
		expect(r.wiki.tiddlerExists(BUF + "T")).toBe(false);
		var w = secondView(r);
		expect(w.widget.editor).toBe(null);
	});

	it("a kept buffer whose unit is gone reopens with the conflict notice", function() {
		var r = render("* a\n* b");
		r.widget.startEdit(r.idOf("* b"));
		r.type("* typed");
		r.widget.destroy({removeDOMNodes: true});
		r.wiki.addTiddler({title: "T", text: "* a\n* x"});
		var v = secondView(r), ed = v.widget.editor;
		expect(ed).not.toBe(null);
		expect(ed.id).toBe(-1);
		var found = elements(ed.host).filter(function(el) { return hasClass(el, "rr-ol-conflict"); });
		expect(found.length).toBe(1);
		expect(r.buffer()).toBe("* typed");
		expect(v.widget.saveEdit()).toBe(false);
		expect(r.text()).toBe("* a\n* x");
	});

	it("a kept buffer is not reopened while another view owns the editor, nor in read-only wikis", function() {
		var r = render("* a\n* b");
		r.widget.startEdit(r.idOf("* b"));
		r.type("* typed");
		var v = secondView(r);
		expect(v.widget.editor).toBe(null);
		r.widget.destroy({removeDOMNodes: true});
		r.wiki.addTiddler({title: "$:/status/IsReadOnly", text: "yes"});
		expect(secondView(r).widget.editor).toBe(null);
		expect(r.buffer()).toBe("* typed");
	});

	it("two views: the second view cannot take over or touch the owner's buffer", function() {
		var r = render("* a\n* b"),
			b = secondView(r);
		r.widget.startEdit(r.idOf("* a"));
		r.type("* A typed");
		var focused = 0;
		spyOn(r.widget, "focusEditor").and.callFake(function() { focused++; });
		expect(b.widget.startEdit(1 + 1)).toBe(false);
		expect(b.widget.editor).toBe(null);
		expect(focused).toBe(1);
		expect(r.buffer()).toBe("* A typed");
		// Save/cancel/destroy in the other view leave the owner's buffer alone
		expect(b.widget.cancelEdit()).toBe(false);
		expect(b.widget.saveEdit()).toBe(false);
		b.widget.destroy({removeDOMNodes: true});
		expect(r.buffer()).toBe("* A typed");
		r.widget.saveEdit();
		expect(r.text()).toBe("* A typed\n* b");
		// Released: the other view may edit now
		var c = secondView(r);
		expect(c.widget.startEdit(c.widget.units.length - 1)).toBe(true);
	});

	it("relocation needs the same own source: edited * b, outside change to * bb is a conflict", function() {
		var r = render("* a\n* b");
		r.widget.startEdit(r.idOf("* b"));
		r.type("* B");
		r.wiki.addTiddler({title: "T", text: "* a\n* bb"});
		expect(r.widget.saveEdit()).toBe(false);
		expect(r.text()).toBe("* a\n* bb");
		expect(elements(r.widget.editor.host).filter(function(el) { return hasClass(el, "rr-ol-conflict"); }).length).toBe(1);
		expect(r.buffer()).toBe("* B");
	});

	it("relocation ignores the source occurring inside another unit (* a vs ** a1)", function() {
		var r = render("* a\n** a1\n* c");
		r.widget.startEdit(r.idOf("* a"));
		r.type("* A");
		r.wiki.addTiddler({title: "T", text: "* x\n* a\n** a1\n* c"});
		expect(r.widget.saveEdit()).toBe(true);
		expect(r.text()).toBe("* x\n* A\n** a1\n* c");
	});

	it("blank save deletes a unit without children", function() {
		var r = render("* a\n* b\n* c");
		r.widget.startEdit(r.idOf("* b"));
		r.type("  ");
		expect(r.widget.saveEdit()).toBe(true);
		expect(r.text()).toBe("* a\n* c");
		var p = render("p1\n\np2\n\np3");
		p.widget.startEdit(p.idOf("p2"));
		p.type("");
		p.widget.saveEdit();
		expect(p.text()).toBe("p1\n\np3");
	});

	it("blank save of a unit with children writes nothing and keeps the editor", function() {
		var r = render("* a\n** a1\n* b");
		r.widget.startEdit(r.idOf("* a"));
		r.type("");
		expect(r.widget.saveEdit()).toBe(false);
		expect(r.text()).toBe("* a\n** a1\n* b");
		expect(r.widget.editor).not.toBe(null);
		var n = notes(r);
		expect(n.length).toBe(1);
		expect(n[0].textContent).toBe("Remove or move its children first.");
	});

	it("blank new unit closes without a conflict even after an ambiguous outside change", function() {
		var r = render("* a\n* b");
		r.widget.startEdit(r.idOf("* a"), {isNew: true});
		r.wiki.addTiddler({title: "T", text: "* a\n* a"});
		expect(r.widget.saveEdit()).toBe(true);
		expect(r.widget.editor).toBe(null);
		expect(r.text()).toBe("* a\n* a");
	});

	it("save re-checks read-only", function() {
		var r = render("* a");
		r.widget.startEdit(r.idOf("* a"));
		r.type("* A");
		r.wiki.addTiddler({title: "$:/status/IsReadOnly", text: "yes"});
		expect(r.widget.saveEdit()).toBe(false);
		expect(r.text()).toBe("* a");
		expect(r.widget.editor).not.toBe(null);
		expect(r.buffer()).toBe("* A");
	});
});
