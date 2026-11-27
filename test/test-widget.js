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

	// An idle outline (as rendered by the body template)
	function renderIdle(wiki, title) {
		var r = render(wiki, "<$outline tiddler=\"" + title + "\"><$transclude $tiddler=\"" + title + "\" $mode=\"block\"/></$outline>");
		r.widget = findWidget(r.root, "outline");
		return r;
	}

	function renderOutline(wiki, title) {
		var r = renderIdle(wiki, title);
		r.widget.wake();
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
			.replace(/ tabindex="0"/g, "")
			.replace(/<div class="rr-ol-empty">[^<]*<\/div>/g, "");
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

	it("a typed block of a registered type gets its type's badge and data-ol-typed", function() {
		var wiki = makeWiki([{title: "T", text: "para\n\n$$$text/vnd.graphviz\ndigraph{}\n$$$\n\n$$$text/plain\nx\n$$$"},
				{title: "GV", tags: "$:/tags/rimir/outline/BlockType", name: "graphviz", caption: "Graphviz graph", badge: "graphviz",
					behaviour: "typed", "content-type": "text/vnd.graphviz"}]),
			r = renderOutline(wiki, "T"),
			typed = r.widget.units.filter(function(e) { return e.unit.kind === "block" && e.unit.start > 0; });
		expect(typed.length).toBe(2);
		expect(typed[0].domNodes[0].getAttribute("data-ol-type")).toBe("graphviz");
		expect(typed[0].domNodes[0].getAttribute("data-ol-typed")).toBe("yes");
		expect(typed[1].domNodes[0].getAttribute("data-ol-typed")).toBeFalsy();
		r.widget.sleep();
		expect(typed[0].domNodes[0].getAttribute("data-ol-typed")).toBeFalsy();
	});

	describe("diagram transclusions", function() {
		var TYPE = {title: "GV", tags: "$:/tags/rimir/outline/BlockType", name: "graphviz", caption: "Graphviz graph",
			badge: "graphviz", behaviour: "typed", "content-type": "text/plain", contexts: "block item", inline: "transclude"};

		function stamps(r) {
			return r.widget.units.map(function(e) {
				return e.domNodes.map(function(n) { return n.getAttribute("data-ol-id") + ":" + n.getAttribute("data-ol-type"); }).join(",");
			});
		}

		it("marks a diagram transcluded inline in a unit; it is no unit of its own", function() {
			var wiki = makeWiki([TYPE, {title: "T", text: "* a {{G}}\n* b"}, {title: "G", type: "text/plain", text: "g"}]),
				r = renderOutline(wiki, "T"),
				item = r.widget.units.filter(function(e) { return e.unit.kind === "item"; })[0].unit.id,
				targets = r.widget.diagramTargets(item);
			expect(targets.length).toBe(1);
			expect(targets[0].title).toBe("G");
			expect(targets[0].node.getAttribute("data-ol-diagram-target")).toBe("G");
			expect(r.widget.units.length).toBe(3);
			expect(r.widget.diagramTargets(item + 1)).toEqual([]);
		});

		it("leaves transclusions of other types alone", function() {
			var wiki = makeWiki([TYPE, {title: "T", text: "* a {{O}}\n* b"}, {title: "O", text: "other"}]),
				r = renderOutline(wiki, "T"),
				plain = renderOutline(makeWiki([{title: "T", text: "* a {{O}}\n* b"}, {title: "O", text: "other"}]), "T");
			expect(r.widget.diagramTargets(1)).toEqual([]);
			expect(stamps(r)).toEqual(stamps(plain));
			expect(r.container.innerHTML).toBe(plain.container.innerHTML);
		});

		it("marks a block-level diagram transclusion unit", function() {
			var wiki = makeWiki([TYPE, {title: "T", text: "para\n\n{{G}}"}, {title: "G", type: "text/plain", text: "g"}]),
				r = renderOutline(wiki, "T"),
				unit = r.widget.units.filter(function(e) { return e.unit.kind === "transclusion"; })[0];
			expect(unit.domNodes[0].getAttribute("data-ol-diagram")).toBe("yes");
			expect(r.widget.diagramTargets(unit.unit.id)[0].title).toBe("G");
		});

		it("a diagram inside another transcluded tiddler belongs to that tiddler, not to the host's unit", function() {
			var wiki = makeWiki([TYPE, {title: "T", text: "* a {{N}}\n* b\n\n{{N}}"}, {title: "N", text: "n {{G}}"},
					{title: "G", type: "text/plain", text: "g"}]),
				r = renderOutline(wiki, "T");
			expect(r.widget.diagrams).toEqual([]);
			expect(r.container.innerHTML).not.toContain("data-ol-diagram");
		});

		it("an idle outline marks nothing; sleep removes the marks", function() {
			var wiki = makeWiki([TYPE, {title: "T", text: "* a {{G}}"}, {title: "G", type: "text/plain", text: "g"}]),
				r = renderIdle(wiki, "T");
			expect(r.container.innerHTML).not.toContain("data-ol-diagram-target");
			r.widget.wake();
			expect(r.container.innerHTML).toContain("data-ol-diagram-target");
			r.widget.sleep();
			expect(r.container.innerHTML).not.toContain("data-ol-diagram-target");
		});
	});

	it("a list item that is only a transclusion is marked (orange frame); sleep removes the mark", function() {
		var wiki = makeWiki([{title: "T", text: "* {{X}}\n* <$transclude $tiddler=\"X\"/>\n*   {{X}}  \n* a {{X}}\n* {{X}} {{Y}}"},
				{title: "X", text: "x"}, {title: "Y", text: "y"}]),
			r = renderOutline(wiki, "T"),
			marks = r.widget.units.filter(function(e) { return e.unit.kind === "item"; }).map(function(e) {
				return e.domNodes[0].getAttribute("data-ol-only-transclusion") || "";
			});
		expect(marks).toEqual(["yes", "yes", "yes", "", ""]);
		r.widget.sleep();
		expect(r.container.innerHTML).not.toContain("data-ol-only-transclusion");
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
			w = findWidget(r.root, "outline");
		w.wake();
		var codes = w.model.units.filter(function(u) { return u.tag === "codeblock"; });
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

	describe("body filter", function() {

		function bodyFor(wiki, title) {
			return wiki.filterTiddlers(
				"[<currentTiddler>] :cascade[all[shadows+tiddlers]tag[$:/tags/ViewTemplateBodyFilter]!is[draft]get[text]] :and[!is[blank]else[$:/core/ui/ViewTemplate/body/default]]",
				$tw.rootWidget.makeFakeWidgetWithVariables({currentTiddler: title})
			)[0];
		}

		function cascadeWiki(tiddlers) {
			var filter = $tw.wiki.getTiddler(BODY_FILTER);
			// Ordered like the real cascade: the outline's first, other filters, the core default
			return makeWiki([{
				title: "$:/tags/ViewTemplateBodyFilter",
				list: "[[" + BODY_FILTER + "]] [[Other Body Filter]] $:/config/ViewTemplateBodyFilters/default"
			}, {
				title: "Other Body Filter",
				tags: "$:/tags/ViewTemplateBodyFilter",
				text: "[tag[Special]then[Special Body]]"
			}, filter.fields, $tw.wiki.getTiddler("$:/config/ViewTemplateBodyFilters/default").fields].concat(tiddlers));
		}

		it("is first in the cascade", function() {
			var list = $tw.wiki.filterTiddlers("[all[shadows+tiddlers]tag[$:/tags/ViewTemplateBodyFilter]!is[draft]]");
			expect(list[0]).toBe(BODY_FILTER);
		});

		it("a filter that yields an empty title for every tiddler (else[]) does not block it", function() {
			var wiki = cascadeWiki([{title: "A", text: "x"}, {
				title: "Blank Body Filter",
				tags: "$:/tags/ViewTemplateBodyFilter",
				text: "[{$:/state/none}get[text]match[x]then[Never]else[]]"
			}]);
			wiki.addTiddler({title: "$:/tags/ViewTemplateBodyFilter",
				list: "[[" + BODY_FILTER + "]] [[Other Body Filter]] [[Blank Body Filter]] $:/config/ViewTemplateBodyFilters/default"});
			expect(bodyFor(wiki, "A")).toBe(BODY);
		});

		it("routes every wikitext tiddler, other body filters first", function() {
			var wiki = cascadeWiki([
				{title: "A", text: "x"},
				{title: "B", text: "x", type: "text/vnd.tiddlywiki"},
				{title: "C", text: "x", type: "text/x-markdown"},
				{title: "D", text: "x", "draft.of": "A"},
				{title: "E", text: "x", tags: "Special"},
				{title: "O", text: "x", outline: "no"}
			]);
			expect(bodyFor(wiki, "A")).toBe(BODY);
			expect(bodyFor(wiki, "B")).toBe(BODY);
			expect(bodyFor(wiki, "C")).toBe("$:/core/ui/ViewTemplate/body/default");
			expect(bodyFor(wiki, "D")).toBe("$:/core/ui/ViewTemplate/body/default");
			expect(bodyFor(wiki, "E")).toBe("Special Body");
			expect(bodyFor(wiki, "O")).toBe("$:/core/ui/ViewTemplate/body/default");
		});

		it("routes nothing when outline is not enabled", function() {
			var wiki = cascadeWiki([{title: "A", text: "x"}, {title: "$:/config/rimir/outline/enabled", text: "no"}]);
			expect(bodyFor(wiki, "A")).toBe("$:/core/ui/ViewTemplate/body/default");
			wiki.addTiddler({title: "$:/config/rimir/outline/enabled", text: "yes"});
			expect(bodyFor(wiki, "A")).toBe(BODY);
		});

		it("leaves system, code-body and hide-body tiddlers alone", function() {
			var wiki = cascadeWiki([
				{title: "$:/S", text: "x"},
				{title: "C", text: "x", "code-body": "yes"},
				{title: "H", text: "x", "hide-body": "yes"},
				{title: "N", text: "x", "code-body": "no"}
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
			// Idle until woken
			expect(w.units.length).toBe(0);
			w.wake();
			expect(w.units.length).toBe(2);
		});
	});

	describe("idle and wake", function() {

		var SEL = "$:/temp/rimir/outline/selection/T";

		function stamped(r) {
			return elements(r.container).filter(function(el) { return el.getAttribute("data-ol-id") !== null && el.getAttribute("data-ol-id") !== undefined; });
		}
		function click(r, node, mods) {
			var ev = {target: node, ctrlKey: !!(mods && mods.ctrl), metaKey: !!(mods && mods.meta), prevented: false,
				preventDefault: function() { ev.prevented = true; }, stopPropagation: function() {}};
			r.widget.handleClick(ev);
			return ev;
		}
		// The body's paragraphs (not the one the test markup wraps around the outline)
		function paras(r) {
			return elements(r.widget.domNode).filter(function(el) { return el.tag === "p"; });
		}

		it("an idle outline maps nothing", function() {
			var r = renderIdle(makeWiki([{title: "T", text: "a\n\nb"}]), "T");
			expect(r.widget.awake).toBe(false);
			expect(r.widget.units.length).toBe(0);
			expect(stamped(r).length).toBe(0);
			expect(r.widget.domNode.getAttribute("tabindex")).toBeFalsy();
		});

		it("Ctrl-Click (Cmd-Click) wakes and selects the clicked unit", function() {
			var r = renderIdle(makeWiki([{title: "T", text: "a\n\nb"}]), "T");
			var ev = click(r, paras(r)[1], {ctrl: true});
			expect(ev.prevented).toBe(true);
			expect(r.widget.awake).toBe(true);
			expect(r.widget.selectedId).toBe(1);
			expect(r.widget.domNode.getAttribute("tabindex")).toBe("0");
			expect(r.widget.domNode.className).toContain("rr-ol-awake");
			expect(stamped(r).length).toBe(2);
			var r2 = renderIdle(makeWiki([{title: "T", text: "a\n\nb"}]), "T");
			click(r2, paras(r2)[0], {meta: true});
			expect(r2.widget.selectedId).toBe(0);
		});

		it("a plain click and a double-click on an idle outline do nothing", function() {
			var wiki = makeWiki([{title: "T", text: "a\n\nb"}]),
				r = renderIdle(wiki, "T");
			click(r, paras(r)[0]);
			r.widget.handleDblClick({target: paras(r)[0], preventDefault: function() {}});
			expect(r.widget.awake).toBe(false);
			expect(r.widget.editor).toBe(null);
			expect(wiki.tiddlerExists(SEL)).toBe(false);
		});

		it("Ctrl-Click on a link does not wake", function() {
			var r = renderIdle(makeWiki([{title: "T", text: "a [[X]]"}]), "T"),
				link = elements(r.container).filter(function(el) { return el.tag === "a"; })[0];
			var ev = click(r, link, {ctrl: true});
			expect(ev.prevented).toBe(false);
			expect(r.widget.awake).toBe(false);
		});

		it("a new widget wakes itself when the selection or edit buffer tiddler exists", function() {
			var r = renderIdle(makeWiki([{title: "T", text: "a\n\nb"}, {title: SEL, start: "3", index: "1", kind: "block"}]), "T");
			expect(r.widget.awake).toBe(true);
			expect(r.widget.selectedId).toBe(1);
			var r2 = renderIdle(makeWiki([{title: "T", text: "a"}, {title: "$:/temp/rimir/outline/edit/T", text: "x"}]), "T");
			expect(r2.widget.awake).toBe(true);
		});

		it("an idle view wakes when another view of the tiddler selects or edits", function() {
			var wiki = makeWiki([{title: "T", text: "a\n\nb"}]),
				r = renderIdle(wiki, "T");
			wiki.addTiddler({title: SEL, start: "3", index: "1", kind: "block"});
			r.root.refresh({"$:/temp/rimir/outline/selection/T": {modified: true}});
			expect(r.widget.awake).toBe(true);
			expect(r.widget.selectedId).toBe(1);
		});

		it("sleep is refused while editing", function() {
			var r = renderOutline(makeWiki([{title: "T", text: "a"}]), "T");
			r.widget.select(0);
			r.widget.startEdit(0);
			expect(r.widget.sleep()).toBe(false);
			expect(r.widget.awake).toBe(true);
		});

		it("an idle widget does no work on a text change", function() {
			var wiki = makeWiki([{title: "T", text: "a"}]),
				r = renderIdle(wiki, "T");
			spyOn(r.widget, "mapUnits").and.callThrough();
			wiki.addTiddler({title: "T", text: "a\n\nb"});
			r.root.refresh({T: {modified: true}});
			expect(r.widget.mapUnits).not.toHaveBeenCalled();
			expect(stamped(r).length).toBe(0);
		});
	});

	describe("leaving the story", function() {

		var TEMPS = ["$:/temp/rimir/outline/selection/T", "$:/temp/rimir/outline/edit/T", "$:/temp/rimir/outline/help/T"];

		function inStory(list) {
			var wiki = makeWiki([{title: "T", text: "a"}, {title: "SL", list: list}].concat(TEMPS.map(function(t) { return {title: t, text: "x"}; })));
			var r = render(wiki, "<$let tv-story-list=\"SL\"><$outline tiddler=\"T\"><$transclude $tiddler=\"T\" $mode=\"block\"/></$outline></$let>");
			r.wiki = wiki;
			r.widget = findWidget(r.root, "outline");
			return r;
		}

		it("a tiddler no longer in the story forgets its selection, edit and key overview (any way of closing)", function() {
			var r = inStory("Other");
			r.widget.destroy({removeDOMNodes: true});
			TEMPS.forEach(function(t) { expect(r.wiki.tiddlerExists(t)).toBe(false); });
		});

		it("a re-render while the tiddler stays in the story keeps them", function() {
			var r = inStory("T Other");
			r.widget.destroy({removeDOMNodes: true});
			TEMPS.forEach(function(t) { expect(r.wiki.tiddlerExists(t)).toBe(true); });
		});
	});

	it("a mousedown in another view of the same tiddler is not outside", function() {
		var wiki = makeWiki([{title: "T", text: "a"}, {title: "U", text: "u"}]),
			r = render(wiki, "<div class=\"rr-ol-frame\"><div class=\"bar\">?</div>\n\n<$outline tiddler=\"T\"><$transclude $tiddler=\"T\" $mode=\"block\"/></$outline></div>\n\n" +
				"<div class=\"rr-ol-frame\"><div class=\"bar\">?</div>\n\n<$outline tiddler=\"T\"><$transclude $tiddler=\"T\" $mode=\"block\"/></$outline></div>\n\n" +
				"<$outline tiddler=\"U\"><$transclude $tiddler=\"U\" $mode=\"block\"/></$outline>"),
			views = [];
		(function collect(w) {
			if(w.parseTreeNode && w.parseTreeNode.type === "outline") { views.push(w); }
			(w.children || []).forEach(collect);
		})(r.root);
		var a = views[0], b = views[1], u = views[2];
		function first(el, tag) { return elements(el).filter(function(x) { return x.tag === tag; })[0]; }
		expect(b.ownsTarget(first(a.domNode, "p"))).toBe(true);
		// The frame around the other view (its ? button)
		expect(b.ownsTarget(first(a.parentDomNode, "div"))).toBe(true);
		expect(b.ownsTarget(first(b.domNode, "p"))).toBe(true);
		expect(b.ownsTarget(first(u.domNode, "p"))).toBe(false);
		expect(b.ownsTarget(r.container)).toBe(false);
	});
});
