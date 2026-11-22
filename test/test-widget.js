/*\
title: $:/plugins/rimir/outline/test/test-widget.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the $outline widget (rendering, unit -> DOM mapping, stamps, markers) and the body routing filter.

\*/
"use strict";

var model = require("$:/plugins/rimir/outline/model.js"),
	fixtures = require("$:/plugins/rimir/outline/test/fixtures.js");

describe("outline widget", function() {

	var BODY_FILTER = "$:/plugins/rimir/outline/ui/body-filter",
		BODY = "$:/plugins/rimir/outline/ui/body";

	function makeWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		wiki.addIndexersToWiki();
		return wiki;
	}

	function render(wiki, text) {
		var parser = wiki.parseText("text/vnd.tiddlywiki", text, {parseAsInline: false}),
			root = wiki.makeWidget(parser, {document: $tw.fakeDocument}),
			container = $tw.fakeDocument.createElement("div");
		root.render(container, null);
		return {root: root, container: container};
	}

	function renderOutline(wiki, title) {
		var r = render(wiki, "<$outline tiddler=\"" + title + "\"><$transclude $tiddler=\"" + title + "\" $mode=\"block\"/></$outline>");
		r.widget = findWidget(r.root, "outline");
		return r;
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

	// All element nodes below `node`, depth first
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

	function stamped(container) {
		return elements(container).filter(function(el) {
			return el.attributes["data-ol-id"] !== undefined;
		});
	}

	function outlineRoot(container) {
		return elements(container).filter(function(el) {
			return (el.attributes["class"] || "").split(" ").indexOf("rr-ol") !== -1;
		})[0];
	}

	function stripOutline(html) {
		return html
			.replace(/<span class="rr-ol-tmark"[^>]*>.*?<\/span>/g, "")
			.replace(/ data-ol-[a-z]+="[^"]*"/g, "")
			.replace(/ tabindex="0"/g, "");
	}

	it("stamps units", function() {
		var wiki = makeWiki([
			{title: "T", text: "! H\n\n* a\n** b\n\n{{X}}"},
			{title: "X", text: "* inner"}
		]);
		var r = renderOutline(wiki, "T"),
			els = stamped(r.container),
			kinds = els.map(function(el) { return el.getAttribute("data-ol-kind") + ":" + el.tag; });
		expect(kinds).toEqual(["heading:h1", "list:ul", "item:li", "item:li", "transclusion:ul"]);
		// No element from X's own text is stamped as an item
		els.forEach(function(el) {
			if(el.getAttribute("data-ol-kind") === "item") {
				expect(el.textContent.indexOf("inner")).toBe(-1);
			}
		});
		var m = r.widget.model;
		expect(r.widget.units.length).toBe(m.units.length);
		r.widget.units.forEach(function(entry, i) {
			expect(entry.unit).toBe(m.units[i]);
			expect(entry.domNodes.length).toBeGreaterThan(0);
			entry.domNodes.forEach(function(el) {
				expect(el.getAttribute("data-ol-id")).toBe(String(i));
				expect(el.getAttribute("data-ol-start")).toBe(String(entry.unit.start));
			});
		});
		var trans = r.widget.units[4];
		expect(trans.unit.kind).toBe("transclusion");
		var marks = elements(trans.domNodes[0]).filter(function(el) {
			return el.attributes["class"] === "rr-ol-tmark";
		});
		expect(marks.length).toBe(1);
		expect(marks[0].attributes.title).toBe("X");
		// A <span> directly in a <ul> is invalid HTML: the marker goes into the first item
		expect(marks[0].parentNode.tag).toBe("li");
		expect(marks[0].parentNode.parentNode).toBe(trans.domNodes[0]);
		expect(outlineRoot(r.container).getAttribute("tabindex")).toBe("0");
	});

	it("same html as normal", function() {
		Object.keys(fixtures.NOTES).forEach(function(name) {
			var wiki = makeWiki([
				{title: "T", text: fixtures.NOTES[name]},
				{title: "Some Tiddler", text: "* from some tiddler\n\npara"},
				{title: "Task 1", tags: "Task"}
			]);
			var plain = render(wiki, "<$transclude $tiddler=\"T\" $mode=\"block\"/>\n"),
				outlined = renderOutline(wiki, "T");
			expect(name + ":" + stripOutline(outlineRoot(outlined.container).innerHTML))
				.toBe(name + ":" + plain.container.innerHTML);
		});
	});

	it("maps every corpus unit to DOM nodes", function() {
		Object.keys(fixtures.NOTES).forEach(function(name) {
			var wiki = makeWiki([
				{title: "T", text: fixtures.NOTES[name]},
				{title: "Some Tiddler", text: "* from some tiddler\n\npara"},
				{title: "Task 1", tags: "Task"}
			]);
			var r = renderOutline(wiki, "T");
			expect(r.widget.units.length).toBe(r.widget.model.units.length);
			r.widget.units.forEach(function(entry) {
				var u = entry.unit;
				if(u.kind === "transclusion" || u.kind === "widget") {
					return; // may render no element (missing template, undefined macro, text-only output)
				}
				expect(name + ":" + u.kind + ":" + u.start + ":" + (entry.domNodes.length > 0))
					.toBe(name + ":" + u.kind + ":" + u.start + ":" + true);
			});
		});
	});

	it("stamps blocks, containers and widgets in the blocks note", function() {
		var wiki = makeWiki([
			{title: "T", text: fixtures.NOTES.blocks + "\n@@.x\nstyled\n@@\n\n$$$text/plain\nplain\n$$$\n"},
			{title: "Some Tiddler", text: "para"},
			{title: "Some Template", text: "<div>tpl</div>"},
			{title: "Task 1", tags: "Task"}
		]);
		var r = renderOutline(wiki, "T"),
			kinds = r.widget.units.map(function(e) {
				return e.unit.kind + ":" + e.domNodes.map(function(n) { return n.tag; }).join(",");
			});
		// @@ styled block and $$$ typed block are DOM-less widgets, mapped to their top-level elements
		expect(kinds).toEqual([
			"heading:h1",
			"block:pre",
			"block:table",
			"transclusion:p",
			"transclusion:p",
			"widget:",
			"widget:",
			"block:p",
			"block:p",
			"block:pre"
		]);
		// Each unit has DOM nodes except the undefined macro call and the $list whose template renders text only
		r.widget.units.forEach(function(e) {
			if(e.unit.kind !== "widget") {
				expect(e.unit.kind + ":" + e.unit.start + ":" + (e.domNodes.length > 0)).toBe(e.unit.kind + ":" + e.unit.start + ":true");
			}
		});
	});

	it("maps a skipped-level item to its real li, not the synthetic one", function() {
		var wiki = makeWiki([{title: "T", text: fixtures.NOTES.mixedLevels}]),
			r = renderOutline(wiki, "T"),
			m = r.widget.model,
			c = r.widget.units.filter(function(e) {
				return e.unit.kind === "item" && m.text.substring(e.unit.start, e.unit.end) === "*** c";
			})[0];
		expect(c.domNodes.length).toBe(1);
		expect(c.domNodes[0].children[0].nodeType).toBe(3);
		expect(c.domNodes[0].textContent).toBe("c");
		// Every item maps to an li that is stamped with its own id only once
		var ids = stamped(r.container).map(function(el) { return el.attributes["data-ol-id"]; });
		expect(ids.length).toBe($tw.utils.pushTop([], ids).length);
	});

	it("does not descend into a same-tiddler transclusion of a field (its positions refer to the field text)", function() {
		var host = "* a <$transclude $tiddler=\"T\" $field=\"caption\" $mode=\"block\"/>\n* b",
			k = host.indexOf("* b"),
			caption = new Array(k - 1).join("x") + "\n\n* c",
			wiki = makeWiki([{title: "T", text: host, caption: caption}]),
			r = renderOutline(wiki, "T"),
			m = r.widget.model;
		expect(caption.indexOf("* c")).toBe(k);
		var b = r.widget.units.filter(function(e) { return m.text.substring(e.unit.start, e.unit.end) === "* b"; })[0];
		expect(b.domNodes.length).toBe(1);
		expect(b.domNodes[0].textContent).toBe("b");
	});

	it("renders empty tiddler", function() {
		var wiki = makeWiki([{title: "T", text: ""}]);
		var r;
		expect(function() { r = renderOutline(wiki, "T"); }).not.toThrow();
		expect(r.widget.units.length).toBe(0);
		var wiki2 = makeWiki([{title: "P", text: fixtures.NOTES.pragmaOnly}]),
			r2 = renderOutline(wiki2, "P");
		expect(r2.widget.units.length).toBe(0);
		var r3 = renderOutline(makeWiki([]), "Missing");
		expect(r3.widget.units.length).toBe(0);
	});

	it("refresh remaps", function() {
		var wiki = makeWiki([{title: "T", text: "* a\n* b"}]);
		var r = renderOutline(wiki, "T");
		expect(r.widget.units.length).toBe(3);
		wiki.addTiddler({title: "T", text: "! New\n\n* x\n** y\n** z\n\nend"});
		r.root.refresh({"T": {modified: true}});
		var m = model.buildModel(wiki, wiki.getTiddlerText("T"), "T");
		expect(r.widget.model.text).toBe(m.text);
		expect(r.widget.units.map(function(e) { return e.unit.kind + ":" + e.unit.start; }))
			.toEqual(m.units.map(function(u) { return u.kind + ":" + u.start; }));
		var els = stamped(r.container);
		expect(els.map(function(el) { return el.getAttribute("data-ol-kind"); }))
			.toEqual(["heading", "list", "item", "item", "item", "block"]);
	});

	it("refresh re-adds a transclusion marker once", function() {
		var wiki = makeWiki([
			{title: "T", text: "{{X}}\n\npara"},
			{title: "X", text: "x one"}
		]);
		var r = renderOutline(wiki, "T");
		wiki.addTiddler({title: "Other", text: "unrelated"});
		r.root.refresh({"Other": {modified: true}});
		wiki.addTiddler({title: "X", text: "x two"});
		r.root.refresh({"X": {modified: true}});
		var marks = elements(r.container).filter(function(el) {
			return el.attributes["class"] === "rr-ol-tmark";
		});
		expect(marks.length).toBe(1);
		expect(r.widget.units[0].domNodes[0].textContent.indexOf("x two")).not.toBe(-1);
	});

	it("puts the marker into the first cell of a transcluded table", function() {
		var wiki = makeWiki([
			{title: "T", text: "{{X}}"},
			{title: "X", text: "|a|b|\n|c|d|"}
		]);
		var r = renderOutline(wiki, "T"),
			marks = elements(r.container).filter(function(el) {
				return el.attributes["class"] === "rr-ol-tmark";
			});
		expect(r.widget.units[0].domNodes[0].tag).toBe("table");
		expect(marks.length).toBe(1);
		expect(marks[0].parentNode.tag).toBe("td");
	});

	it("renders the marker html once per widget", function() {
		var wiki = makeWiki([
			{title: "T", text: "{{X}}\n\n{{Y}}"},
			{title: "X", text: "x"},
			{title: "Y", text: "y"}
		]);
		spyOn(wiki, "renderTiddler").and.callThrough();
		var r = renderOutline(wiki, "T");
		wiki.addTiddler({title: "X", text: "x two"});
		r.root.refresh({"X": {modified: true}});
		wiki.addTiddler({title: "T", text: "{{X}}\n\n{{Y}}\n\npara"});
		r.root.refresh({"T": {modified: true}});
		var markerRenders = wiki.renderTiddler.calls.allArgs().filter(function(args) {
			return args[1] === "$:/plugins/rimir/outline/ui/transclusion-marker";
		});
		expect(markerRenders.length).toBe(1);
		expect(elements(r.container).filter(function(el) {
			return el.attributes["class"] === "rr-ol-tmark";
		}).length).toBe(2);
	});

	it("code blocks of a widget override (\\widget $codeblock) are units too", function() {
		var wiki = makeWiki([{title: "T", text: "para\n\n```\none\n```\n\n* a\n\n```\ntwo\n```\n\nend"}]),
			r = render(wiki, "\\widget $codeblock(code, language)\n<div class=\"kk-cap\">cap</div><div class=\"kk-code\"><$genesis $type=\"$codeblock\" $remappable=\"no\" code=<<code>> language=<<language>>/></div>\n\\end\n" +
				"<$outline tiddler=\"T\"><$transclude $tiddler=\"T\" $mode=\"block\"/></$outline>"),
			w = findWidget(r.root, "outline"),
			codes = w.model.units.filter(function(u) { return u.tag === "codeblock"; });
		expect(codes.length).toBe(2);
		codes.forEach(function(u, i) {
			var nodes = w.units[u.id].domNodes;
			expect(nodes.length).toBe(2);
			expect(nodes[0].getAttribute("class")).toContain("kk-cap");
			expect(nodes[1].getAttribute("data-ol-id")).toBe(String(u.id));
			expect(w.isSelectable(u.id)).toBe(true);
			expect(nodes[1].textContent).toContain(i === 0 ? "one" : "two");
		});
		// The units after them still map
		expect(w.units.every(function(m) { return m.domNodes.length > 0; })).toBe(true);
	});

	describe("toolbar button", function() {

		var BUTTON = "$:/plugins/rimir/outline/ui/toolbar-button";

		function renderButton(wiki, title) {
			return render(wiki, "<$let currentTiddler=\"" + title + "\" tv-config-toolbar-icons=\"yes\"><$transclude $tiddler=\"" + BUTTON + "\"/></$let>");
		}

		function buttonWiki(tiddlers) {
			return makeWiki([
				$tw.wiki.getTiddler(BUTTON).fields,
				$tw.wiki.getTiddler("$:/plugins/rimir/outline/ui/toolbar-icon").fields
			].concat(tiddlers));
		}

		it("shows for wikitext non-drafts and toggles the state", function() {
			var wiki = buttonWiki([{title: "A", text: "x"}]),
				r = renderButton(wiki, "A"),
				button = findWidget(r.root, "button");
			expect(button).not.toBe(null);
			expect(button.getAttribute("tooltip")).toContain("outline mode");
			button.invokeActions(button, {});
			expect(wiki.getTiddlerText("$:/state/rimir/outline/on/A")).toBe("yes");
			r.root.refresh({"$:/state/rimir/outline/on/A": {modified: true}});
			button = findWidget(r.root, "button");
			expect(button.getAttribute("class")).toContain("tc-selected");
			button.invokeActions(button, {});
			expect(wiki.getTiddlerText("$:/state/rimir/outline/on/A")).toBe("no");
		});

		it("switching outline mode off discards a kept edit buffer, switching on does not", function() {
			var BUF = "$:/temp/rimir/outline/edit/A",
				wiki = buttonWiki([{title: "A", text: "x"}, {title: BUF, text: "typed"}]),
				r = renderButton(wiki, "A"),
				button = findWidget(r.root, "button");
			button.invokeActions(button, {});
			expect(wiki.getTiddlerText("$:/state/rimir/outline/on/A")).toBe("yes");
			expect(wiki.getTiddlerText(BUF)).toBe("typed");
			r.root.refresh({"$:/state/rimir/outline/on/A": {modified: true}});
			button = findWidget(r.root, "button");
			button.invokeActions(button, {});
			expect(wiki.getTiddlerText("$:/state/rimir/outline/on/A")).toBe("no");
			expect(wiki.tiddlerExists(BUF)).toBe(false);
		});

		it("is hidden for other types and drafts", function() {
			var wiki = buttonWiki([
				{title: "M", text: "x", type: "text/x-markdown"},
				{title: "D", text: "x", "draft.of": "A"}
			]);
			expect(findWidget(renderButton(wiki, "M").root, "button")).toBe(null);
			expect(findWidget(renderButton(wiki, "D").root, "button")).toBe(null);
		});

		it("is hidden for system tiddlers and code-body or hide-body tiddlers", function() {
			var wiki = buttonWiki([
				{title: "$:/S", text: "x"},
				{title: "C", text: "x", "code-body": "yes"},
				{title: "H", text: "x", "hide-body": "yes"},
				{title: "N", text: "x", "code-body": "no", "hide-body": "no"}
			]);
			expect(findWidget(renderButton(wiki, "$:/S").root, "button")).toBe(null);
			expect(findWidget(renderButton(wiki, "C").root, "button")).toBe(null);
			expect(findWidget(renderButton(wiki, "H").root, "button")).toBe(null);
			expect(findWidget(renderButton(wiki, "N").root, "button")).not.toBe(null);
		});
	});

	describe("body filter", function() {

		function bodyFor(wiki, title) {
			return wiki.filterTiddlers(
				"[<currentTiddler>] :cascade[all[shadows+tiddlers]tag[$:/tags/ViewTemplateBodyFilter]!is[draft]get[text]] :and[!is[blank]else[$:/core/ui/ViewTemplate/body/default]]",
				$tw.rootWidget.makeFakeWidgetWithVariables({currentTiddler: title})
			)[0];
		}

		function cascadeWiki(tiddlers) {
			var filter = $tw.wiki.getTiddler(BODY_FILTER);
			return makeWiki([filter.fields, {
				title: "Other Body Filter",
				tags: "$:/tags/ViewTemplateBodyFilter",
				text: "[tag[Special]then[Special Body]]"
			}].concat(tiddlers));
		}

		it("is first in the cascade", function() {
			var list = $tw.wiki.filterTiddlers("[all[shadows+tiddlers]tag[$:/tags/ViewTemplateBodyFilter]!is[draft]]");
			expect(list[0]).toBe(BODY_FILTER);
		});

		it("routes wikitext tiddlers in outline mode", function() {
			var wiki = cascadeWiki([
				{title: "A", text: "x"},
				{title: "B", text: "x", type: "text/vnd.tiddlywiki"},
				{title: "C", text: "x", type: "text/x-markdown"},
				{title: "D", text: "x", "draft.of": "A"},
				{title: "E", text: "x", tags: "Special"},
				{title: "F", text: "x", tags: "Special"},
				{title: "G", text: "x"},
				{title: "$:/state/rimir/outline/on/A", text: "yes"},
				{title: "$:/state/rimir/outline/on/B", text: "yes"},
				{title: "$:/state/rimir/outline/on/C", text: "yes"},
				{title: "$:/state/rimir/outline/on/D", text: "yes"},
				{title: "$:/state/rimir/outline/on/E", text: "yes"},
				{title: "$:/state/rimir/outline/on/G", text: "no"}
			]);
			expect(bodyFor(wiki, "A")).toBe(BODY);
			expect(bodyFor(wiki, "B")).toBe(BODY);
			expect(bodyFor(wiki, "C")).toBe("$:/core/ui/ViewTemplate/body/default");
			expect(bodyFor(wiki, "D")).toBe("$:/core/ui/ViewTemplate/body/default");
			expect(bodyFor(wiki, "E")).toBe(BODY);
			// Without outline state, other cascade entries work as before
			expect(bodyFor(wiki, "F")).toBe("Special Body");
			expect(bodyFor(wiki, "G")).toBe("$:/core/ui/ViewTemplate/body/default");
		});

		it("leaves system, code-body and hide-body tiddlers alone", function() {
			var wiki = cascadeWiki([
				{title: "$:/S", text: "x"},
				{title: "C", text: "x", "code-body": "yes"},
				{title: "H", text: "x", "hide-body": "yes"},
				{title: "N", text: "x", "code-body": "no"},
				{title: "$:/state/rimir/outline/on/$:/S", text: "yes"},
				{title: "$:/state/rimir/outline/on/C", text: "yes"},
				{title: "$:/state/rimir/outline/on/H", text: "yes"},
				{title: "$:/state/rimir/outline/on/N", text: "yes"}
			]);
			expect(bodyFor(wiki, "$:/S")).not.toBe(BODY);
			expect(bodyFor(wiki, "C")).not.toBe(BODY);
			expect(bodyFor(wiki, "H")).not.toBe(BODY);
			expect(bodyFor(wiki, "N")).toBe(BODY);
		});

		it("body template renders the outline widget", function() {
			var wiki = makeWiki([$tw.wiki.getTiddler(BODY).fields, {title: "T", text: "* a"}]),
				r = render(wiki, "<$let currentTiddler=\"T\"><$transclude $tiddler=\"" + BODY + "\" $mode=\"block\"/></$let>"),
				w = findWidget(r.root, "outline");
			expect(w).not.toBe(null);
			expect(w.units.length).toBe(2);
		});
	});
});
