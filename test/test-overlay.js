/*\
title: $:/plugins/rimir/outline/test/test-overlay.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the transclusion overlay (outline-overlay.js): Shift-Enter opens the target's own outline over the unit,
Escape / sleep close it, the host ignores events from inside, re-renders keep it, nested overlays.

\*/
"use strict";

describe("outline overlay", function() {

	var SEL = "$:/temp/rimir/outline/selection/",
		KEYS = {enter: 13, escape: 27, down: 40};

	function pluginTiddlers() {
		return $tw.wiki.filterTiddlers("[all[shadows+tiddlers]prefix[$:/config/shortcuts/outline-]] " +
			"[[$:/plugins/rimir/outline/ui/editor]] [[$:/plugins/rimir/outline/ui/overlay]] [[$:/plugins/rimir/outline/ui/overlay-diagram]] [[$:/plugins/rimir/outline/ui/overlay-bar]] [[$:/plugins/rimir/outline/ui/diagram-tools]] " +
			"[all[shadows+tiddlers]tag[$:/tags/rimir/outline/BlockType]prefix[$:/plugins/rimir/outline/]] [[$:/tags/rimir/outline/BlockType]]").map(function(title) {
			return $tw.wiki.getTiddler(title).fields;
		});
	}

	function findWidgets(widget, type, out) {
		out = out || [];
		if(widget.parseTreeNode && widget.parseTreeNode.type === type) {
			out.push(widget);
		}
		$tw.utils.each(widget.children, function(child) { findWidgets(child, type, out); });
		return out;
	}

	function render(text, others) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(pluginTiddlers().concat([{title: "T", text: text}], others || []));
		wiki.addIndexersToWiki();
		var parser = wiki.parseText("text/vnd.tiddlywiki",
				"<$outline tiddler=\"T\"><$transclude $tiddler=\"T\" $mode=\"block\"/></$outline>", {parseAsInline: false}),
			root = wiki.makeWidget(parser, {document: $tw.fakeDocument}),
			container = $tw.fakeDocument.createElement("div");
		root.render(container, null);
		var r = {root: root, wiki: wiki, widget: findWidgets(root, "outline")[0]};
		r.widget.wake();
		r.idOf = function(w, source) {
			var m = w.model;
			for(var i = m.units.length - 1; i >= 0; i--) {
				if(m.text.substring(m.units[i].start, m.units[i].end) === source) { return i; }
			}
			throw new Error("no unit " + source);
		};
		r.refresh = function(titles) {
			var changes = {};
			$tw.utils.each(titles, function(t) { changes[t] = {modified: true}; });
			root.refresh(changes);
		};
		return r;
	}

	function key(w, keyCode, mods) {
		mods = mods || {};
		var ev = {keyCode: keyCode, shiftKey: !!mods.shift, altKey: false, ctrlKey: !!mods.ctrl, metaKey: false,
			target: w.domNode, defaultPrevented: false, prevented: false,
			preventDefault: function() { this.prevented = true; }, stopPropagation: function() {}};
		w.handleKeydown(ev);
		return ev;
	}

	function inner(w) {
		return w.overlay ? w.overlay.outline : null;
	}

	function hasClass(el, cls) {
		return (el.attributes && el.attributes["class"] || "").split(" ").indexOf(cls) !== -1;
	}

	var X = {title: "X", text: "* x1\n* x2"};

	it("shift-enter on a {{...}} line opens the target's awake outline in an overlay inside the host", function() {
		var r = render("p\n\n{{X}}", [X]);
		r.widget.select(r.idOf(r.widget, "{{X}}"));
		expect(key(r.widget, KEYS.enter, {shift: true}).prevented).toBe(true);
		var o = r.widget.overlay;
		expect(o).toBeTruthy();
		expect(hasClass(o.element, "rr-ol-overlay")).toBe(true);
		expect(o.element.parentNode).toBe(r.widget.domNode);
		expect(inner(r.widget).tiddlerTitle).toBe("X");
		expect(inner(r.widget).awake).toBe(true);
		// Its first unit is selected (the list, as when the tiddler is opened in the story)
		expect(inner(r.widget).selectedId).toBe(0);
	});

	it("ctrl-shift-enter opens the target in the story, no overlay", function() {
		var r = render("p\n\n{{X}}", [X]), events = [];
		spyOn(r.widget, "dispatchEvent").and.callFake(function(ev) { events.push(ev); });
		r.widget.select(r.idOf(r.widget, "{{X}}"));
		key(r.widget, KEYS.enter, {shift: true, ctrl: true});
		expect(r.widget.overlay).toBeFalsy();
		expect(events.length).toBe(1);
		expect(events[0].navigateTo).toBe("X");
	});

	it("a click inside the overlay leaves the host's selection alone and counts as the host's own", function() {
		var r = render("p\n\n{{X}}", [X]);
		var id = r.idOf(r.widget, "{{X}}");
		r.widget.select(id);
		r.widget.openOverlay(id, "X");
		var node = inner(r.widget).units[r.idOf(inner(r.widget), "* x2")].domNodes[0];
		r.widget.handleClick({target: node, shiftKey: false, ctrlKey: false, metaKey: false,
			preventDefault: function() {}, stopPropagation: function() {}});
		expect(r.widget.selectedId).toBe(id);
		expect(r.widget.ownsTarget(node)).toBe(true);
		expect(inner(r.widget).ownsTarget(node)).toBe(true);
		// The overlay's outline does not own the host's content
		expect(inner(r.widget).ownsTarget(r.widget.units[r.idOf(r.widget, "p")].domNodes[0])).toBe(false);
	});

	it("escape clears the overlay's selection first, then closes it; the host keeps its selection", function() {
		var r = render("p\n\n{{X}}", [X]);
		var id = r.idOf(r.widget, "{{X}}");
		r.widget.select(id);
		r.widget.openOverlay(id, "X");
		var o = inner(r.widget);
		key(o, KEYS.escape);
		expect(r.widget.overlay).toBeTruthy();
		expect(o.selectedId).toBe(-1);
		key(o, KEYS.escape);
		expect(r.widget.overlay).toBe(null);
		expect(r.widget.awake).toBe(true);
		expect(r.widget.selectedId).toBe(id);
		expect(r.wiki.tiddlerExists(SEL + "X")).toBe(false);
	});

	it("a write to the target from the overlay keeps the overlay over the re-rendered host", function() {
		var r = render("p\n\n{{X}}", [X]);
		var id = r.idOf(r.widget, "{{X}}");
		r.widget.select(id);
		r.widget.openOverlay(id, "X");
		var o = inner(r.widget), element = r.widget.overlay.element;
		r.wiki.addTiddler({title: "X", text: "* x1 changed\n* x2"});
		r.refresh(["X"]);
		expect(r.widget.overlay.outline).toBe(o);
		expect(element.parentNode).toBe(r.widget.domNode);
		// The overlay's own rendering follows the change (it is outside the host's widget tree)
		expect(o.domNode.textContent).toContain("x1 changed");
		expect(o.model.text).toBe("* x1 changed\n* x2");
	});

	it("the overlay closes when its unit is gone or the host sleeps", function() {
		var r = render("p\n\n{{X}}", [X]);
		var id = r.idOf(r.widget, "{{X}}");
		r.widget.select(id);
		r.widget.openOverlay(id, "X");
		r.wiki.addTiddler({title: "T", text: "p"});
		r.refresh(["T"]);
		expect(r.widget.overlay).toBe(null);
		var s = render("p\n\n{{X}}", [X]);
		id = s.idOf(s.widget, "{{X}}");
		s.widget.select(id);
		s.widget.openOverlay(id, "X");
		s.widget.sleep();
		expect(s.widget.overlay).toBe(null);
	});

	it("nested: a transclusion inside the overlay opens a further overlay; closing it keeps the first", function() {
		var r = render("p\n\n{{X}}", [{title: "X", text: "x\n\n{{Y}}"}, {title: "Y", text: "y"}]);
		var id = r.idOf(r.widget, "{{X}}");
		r.widget.select(id);
		r.widget.openOverlay(id, "X");
		var o = inner(r.widget);
		o.select(r.idOf(o, "{{Y}}"));
		key(o, KEYS.enter, {shift: true});
		expect(o.overlay && o.overlay.outline.tiddlerTitle).toBe("Y");
		var oy = o.overlay.outline;
		key(oy, KEYS.escape);
		key(oy, KEYS.escape);
		expect(o.overlay).toBe(null);
		expect(r.widget.overlay).toBeTruthy();
	});

	it("does not close while its editor is open; a forced close keeps the typed text", function() {
		var r = render("p\n\n{{X}}", [X]);
		var id = r.idOf(r.widget, "{{X}}");
		r.widget.select(id);
		r.widget.openOverlay(id, "X");
		var o = inner(r.widget);
		o.startEdit(r.idOf(o, "* x1"));
		r.wiki.addTiddler(new $tw.Tiddler(r.wiki.getTiddler("$:/temp/rimir/outline/edit/X"), {text: "typed"}));
		// The host sleeps (a click outside it), the x button: refused while editing
		expect(r.widget.sleep()).toBe(false);
		expect(r.widget.closeOverlay()).toBe(false);
		expect(r.widget.overlay).toBeTruthy();
		// Forced (its unit is gone): the edit buffer is kept, as for a re-rendered tiddler
		r.wiki.addTiddler({title: "T", text: "p"});
		r.refresh(["T"]);
		expect(r.widget.overlay).toBe(null);
		expect(r.wiki.getTiddlerText("$:/temp/rimir/outline/edit/X")).toBe("typed");
	});

	it("field and index transclusions open in the story, not in an overlay", function() {
		var r = render("{{X!!caption}}\n\n* a {{X##k}}\n* b", [{title: "X", text: "* x1", caption: "cap"}]), opened = [];
		r.widget.openTarget = function(t) { opened.push(t); };
		r.widget.select(r.idOf(r.widget, "{{X!!caption}}"));
		key(r.widget, KEYS.enter, {shift: true});
		r.widget.select(r.idOf(r.widget, "* a {{X##k}}"));
		key(r.widget, KEYS.enter, {shift: true});
		expect(r.widget.overlay).toBeFalsy();
		expect(opened).toEqual(["X", "X"]);
	});

	it("a copy event that reaches the host while the overlay has the focus copies the overlay's unit", function() {
		var r = render("p\n\n{{X}}", [X]);
		var id = r.idOf(r.widget, "{{X}}");
		r.widget.select(id);
		r.widget.openOverlay(id, "X");
		var o = inner(r.widget), data = {}, prevented = false;
		o.select(r.idOf(o, "* x2"));
		// (the fake DOM cannot render the clip's html)
		o.clipHtml = function() { return ""; };
		var before = $tw.fakeDocument.activeElement;
		$tw.fakeDocument.activeElement = o.domNode;
		try {
			r.widget.handleCopy({clipboardData: {setData: function(type, value) { data[type] = value; }},
				defaultPrevented: false, preventDefault: function() { prevented = true; this.defaultPrevented = true; }});
		} finally {
			$tw.fakeDocument.activeElement = before;
		}
		expect(prevented).toBe(true);
		expect(data["text/plain"]).toBe("* x2");
	});

	describe("diagrams", function() {
		var TYPE = {title: "TT", tags: "$:/tags/rimir/outline/BlockType", name: "diag", caption: "Diagram", badge: "x",
				behaviour: "typed", "content-type": "text/plain", contexts: "block item", inline: "transclude", docs: "https://example.org/docs"},
			EXAMPLES = [
				{title: "E1", tags: "$:/tags/rimir/outline/Snippet", "for": "diag", caption: "First example", text: "ex1"},
				{title: "E2", tags: "$:/tags/rimir/outline/Snippet", "for": "diag", caption: "Second example", text: "ex2"},
				{title: "E3", tags: "$:/tags/rimir/outline/Snippet", "for": "other", caption: "Not for diag", text: "ex3"}
			],
			G = {title: "G", type: "text/plain", text: "g1"},
			BUF = "$:/temp/rimir/outline/diagram/T";

		function opened(source) {
			var r = render(source, [TYPE, G].concat(EXAMPLES));
			r.widget.select(r.idOf(r.widget, source.split("\n")[0]));
			key(r.widget, KEYS.enter, {shift: true});
			return r;
		}

		it("shift-enter on a diagram opens its source and a live preview in the overlay", function() {
			var r = opened("* a {{G}}\n* b");
			var o = r.widget.overlay;
			expect(o && o.diagram).toBe(true);
			expect(r.widget.editor).toBe(null);
			expect(r.wiki.getTiddler(BUF).fields.type).toBe("text/plain");
			expect(r.wiki.getTiddlerText(BUF)).toBe("g1");
			expect(o.element.textContent).toContain("g1");
			// Typing changes the preview, not the diagram
			r.wiki.addTiddler(new $tw.Tiddler(r.wiki.getTiddler(BUF), {text: "g2"}));
			r.refresh([BUF]);
			expect(o.element.textContent).toContain("g2");
			expect(r.wiki.getTiddlerText("G")).toBe("g1");
		});

		it("examples of the type replace the source; the docs link of the type", function() {
			var r = opened("{{G}}\n\np"),
				o = r.widget.overlay,
				select = findWidgets(o.widget, "select")[0],
				options = findWidgets(select, "element").filter(function(w) { return w.parseTreeNode.tag === "option"; });
			expect(options.map(function(w) { return w.domNodes[0].textContent; })).toEqual(["Examples", "First example", "Second example"]);
			var link = findWidgets(o.widget, "element").filter(function(w) { return w.parseTreeNode.tag === "a"; })[0];
			expect(link.domNodes[0].getAttribute("href")).toBe("https://example.org/docs");
			expect(link.domNodes[0].getAttribute("target")).toBe("_blank");
			// Picking an example: the buffer (and so the preview) gets its source; the diagram is not written
			select.getSelectDomNode = function() { return {value: "E2"}; };
			select.handleChangeEvent({});
			expect(r.wiki.getTiddlerText(BUF)).toBe("ex2");
			expect(r.wiki.getTiddlerText("G")).toBe("g1");
			// The picker is back on "Examples"
			expect(r.wiki.tiddlerExists("$:/temp/rimir/outline/example/" + BUF)).toBe(false);
		});

		it("no examples, no docs: no picker, no link", function() {
			var r = render("{{G}}\n\np", [{title: "TT", tags: "$:/tags/rimir/outline/BlockType", name: "diag", caption: "Diagram",
				badge: "x", behaviour: "typed", "content-type": "text/plain"}, G]);
			r.widget.select(r.idOf(r.widget, "{{G}}"));
			key(r.widget, KEYS.enter, {shift: true});
			expect(findWidgets(r.widget.overlay.widget, "select").length).toBe(0);
			expect(r.widget.overlay.element.textContent).not.toContain("Docs");
		});

		it("save writes the diagram and closes; escape closes without writing", function() {
			var r = opened("{{G}}\n\np");
			r.wiki.addTiddler(new $tw.Tiddler(r.wiki.getTiddler(BUF), {text: "g2"}));
			r.widget.saveOverlay();
			expect(r.wiki.getTiddlerText("G")).toBe("g2");
			expect(r.widget.overlay).toBe(null);
			expect(r.wiki.tiddlerExists(BUF)).toBe(false);
			var s = opened("{{G}}\n\np");
			s.wiki.addTiddler(new $tw.Tiddler(s.wiki.getTiddler(BUF), {text: "zzz"}));
			s.widget.closeOverlay(true);
			expect(s.wiki.getTiddlerText("G")).toBe("g1");
			expect(s.wiki.tiddlerExists(BUF)).toBe(false);
		});

		it("a changed diagram source keeps the overlay open against a click outside or the host's sleep", function() {
			var r = opened("{{G}}\n\np");
			r.wiki.addTiddler(new $tw.Tiddler(r.wiki.getTiddler(BUF), {text: "g2"}));
			expect(r.widget.overlayBusy()).toBe(true);
			expect(r.widget.sleep()).toBe(false);
			r.widget.handleClick({target: r.widget.units[r.idOf(r.widget, "p")].domNodes[0], shiftKey: false, ctrlKey: false, metaKey: false,
				preventDefault: function() {}, stopPropagation: function() {}});
			expect(r.widget.overlay).toBeTruthy();
			// Unchanged: a click outside closes it
			var s = opened("{{G}}\n\np");
			s.widget.handleClick({target: s.widget.units[s.idOf(s.widget, "p")].domNodes[0], shiftKey: false, ctrlKey: false, metaKey: false,
				preventDefault: function() {}, stopPropagation: function() {}});
			expect(s.widget.overlay).toBe(null);
		});
	});
});
