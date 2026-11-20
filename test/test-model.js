/*\
title: $:/plugins/rimir/outline/test/test-model.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for model.js (unit list with kinds, levels, parents and subtree ranges).

\*/
"use strict";

var model = require("$:/plugins/rimir/outline/model.js"),
	fixtures = require("$:/plugins/rimir/outline/test/fixtures.js");

describe("outline model", function() {

	function build(text, title) {
		return model.buildModel($tw.wiki, text, title);
	}
	function src(m, u) {
		return m.text.substring(u.start, u.end);
	}
	function byText(m, s) {
		return m.units.filter(function(u) { return src(m, u) === s; })[0];
	}

	it("simple list", function() {
		var m = build("* a\n** b\n* c");
		expect(fixtures.unitSignature(m)).toEqual(["list:0:-1", "item:1:0", "item:2:1", "item:1:0"]);
		expect(m.units[1].subtreeEnd).toBe(8);
		expect(m.units[1].end).toBe(3);
		expect(m.units[1].marker).toBe("*");
		expect(m.units[2].marker).toBe("**");
		expect(m.units[1].children).toEqual([2]);
		expect(m.units[0].children).toEqual([1, 3]);
		expect(m.units[0].subtreeEnd).toBe(12);
		expect(m.units[0].end).toBe(12);
		expect(m.units[3].subtreeEnd).toBe(12);
		expect(m.roots).toEqual([0]);
		expect(m.units[1].tag).toBe("li");
		expect(m.units[0].tag).toBe("ul");
	});

	it("list range covers nested items of its last item", function() {
		var m = build("* x\n** y");
		expect(m.units[0].end).toBe(8);
		expect(m.units[0].end).toBe(m.units[0].subtreeEnd);
		m = build("; t\n: d\n;; u");
		expect(m.units[0].kind).toBe("list");
		expect(src(m, m.units[0])).toBe("; t\n: d\n;; u");
		expect(m.units[0].end).toBe(m.units[0].subtreeEnd);
		m = build("! H\n\n* x\n** y\n\n! I");
		expect(src(m, m.units[1])).toBe("* x\n** y");
		expect(m.units[1].end).toBe(m.units[1].subtreeEnd);
	});

	it("headings with sections", function() {
		var text = "! A\n\np1\n\n!! B\n\np2\n\n! C",
			m = build(text);
		expect(fixtures.unitSignature(m)).toEqual([
			"heading:1:-1", "block:0:0", "heading:2:0", "block:0:2", "heading:1:-1"
		]);
		var A = m.units[0], p1 = m.units[1], B = m.units[2], p2 = m.units[3], C = m.units[4];
		expect(A.subtreeEnd).toBe(p2.end);
		expect(p2.end).toBe(17);
		expect(B.subtreeEnd).toBe(17);
		expect(C.subtreeEnd).toBe(text.length);
		expect(p1.parent).toBe(A.id);
		expect(A.children).toEqual([1, 2]);
		expect(m.roots).toEqual([0, 4]);
		expect(A.tag).toBe("h1");
		expect(B.tag).toBe("h2");
		expect(p1.tag).toBe("p");
	});

	it("content before first heading", function() {
		var m = build("intro\n\n! A");
		expect(fixtures.unitSignature(m)).toEqual(["block:0:-1", "heading:1:-1"]);
		expect(m.units[0].children).toEqual([]);
	});

	it("transclusion", function() {
		var m = build("{{X}}");
		expect(m.units.length).toBe(1);
		expect(m.units[0].kind).toBe("transclusion");
		expect(m.units[0].target).toBe("X");
		m = build("{{X||T}}");
		expect(m.units[0].kind).toBe("transclusion");
		expect(m.units[0].target).toBe("X");
		m = build("<<m>>");
		expect(m.units[0].kind).toBe("widget");
		expect(m.units[0].target).toBe(null);
	});

	it("transclusion: newline excluded from the unit range", function() {
		var m = build("{{X}}\n\npara");
		expect(m.units[0].start).toBe(0);
		expect(m.units[0].end).toBe(5);
	});

	it("transclusion: widget forms", function() {
		var m = build("<$transclude $tiddler=X/>\n\n<$transclude tiddler=Y/>\n\n<$transclude $tiddler={{a}}/>\n\n<$transclude $tiddler=\"\"/>\n");
		expect(m.units.map(function(u) { return u.kind + ":" + u.target; })).toEqual([
			"transclusion:X", "transclusion:Y", "widget:null", "widget:null"
		]);
	});

	it("transclusion of the tiddler itself or of a field is a widget", function() {
		expect(build("{{Me}}\n", "Me").units[0].kind).toBe("widget");
		expect(build("{{!!f}}\n").units[0].kind).toBe("widget");
		var m = build("{{X!!f}}\n");
		expect(m.units[0].kind).toBe("transclusion");
		expect(m.units[0].target).toBe("X");
	});

	it("container opened", function() {
		var m = build("<div>\n\n* a\n\n</div>");
		expect(fixtures.unitSignature(m)).toEqual(["container:0:-1", "list:0:0", "item:1:1"]);
		expect(m.units[0].tag).toBe("div");
		expect(m.units[0].end).toBe(18);
		expect(m.units[0].subtreeEnd).toBe(18);
	});

	it("container with headings: heading parent is the container", function() {
		var m = build(fixtures.NOTES.container);
		expect(fixtures.unitSignature(m)).toEqual([
			"block:0:-1", "container:0:-1", "heading:1:1", "list:0:2", "item:1:3", "item:1:3", "block:0:2",
			"list:0:-1", "item:1:7"
		]);
		expect(m.units[2].subtreeEnd).toBe(m.units[6].end);
	});

	it("html element without block content is a block; widgets are not opened", function() {
		var m = build("<div>inline</div>\n\n<$list filter=x>\n\n* a\n\n</$list>");
		expect(fixtures.unitSignature(m)).toEqual(["block:0:-1", "widget:0:-1"]);
		expect(m.units[1].tag).toBe("list");
	});

	it("pragmas skipped", function() {
		var m = build("\\procedure p() x\n\n* a");
		expect(fixtures.unitSignature(m)).toEqual(["list:0:-1", "item:1:0"]);
		expect(m.units[1].start).toBe(18);
		expect(m.text.charAt(m.units[1].start)).toBe("*");
	});

	it("stacked pragmas skipped, <$set> widget is not a pragma", function() {
		var m = build("\\import [[x]]\n\\rules except dash\n\\parameters (a)\n\\whitespace trim\n\n<<m>>\n\n<$set name=a value=b>\n\nx\n\n</$set>");
		expect(fixtures.unitSignature(m)).toEqual(["widget:0:-1", "widget:0:-1"]);
		expect(m.units[1].tag).toBe("set");
	});

	it("empty and pragma-only text", function() {
		expect(build("").units.length).toBe(0);
		expect(build("\\whitespace trim").units.length).toBe(0);
		expect(build(fixtures.NOTES.pragmaOnly).units.length).toBe(0);
		expect(build("").roots).toEqual([]);
	});

	it("subtree ranges with CRLF", function() {
		var text = "* a\r\n** b\r\n* c",
			m = build(text);
		expect(fixtures.unitSignature(m)).toEqual(["list:0:-1", "item:1:0", "item:2:1", "item:1:0"]);
		expect(m.units[1].subtreeEnd).toBe(9);
		expect(text.substring(m.units[1].start, m.units[1].subtreeEnd)).toBe("* a\r\n** b");
		expect(m.units[1].end).toBe(3);
	});

	it("CRLF: block ends exclude the line break", function() {
		var m = build(fixtures.NOTES.crlf);
		m.units.forEach(function(u) {
			expect(/[\r\n]$/.test(src(m, u))).toBe(false);
		});
		expect(src(m, m.units[m.units.length - 1])).toBe("Final paragraph.");
	});

	it("multi-line item", function() {
		var m = build(fixtures.NOTES.specialItems),
			item = byText(m, "* \"\"\"multi\nline item\"\"\"");
		expect(item).toBeDefined();
		expect(item.kind).toBe("item");
		expect(m.text.substring(item.end - 3, item.end)).toBe("\"\"\"");
		expect(m.text.charAt(item.end)).toBe("\n");
	});

	it("classed items: marker stops at the class", function() {
		var m = build(fixtures.NOTES.specialItems);
		var cls = byText(m, "*.cls classed item");
		expect(cls.marker).toBe("*");
		expect(cls.level).toBe(1);
		expect(m.units[cls.children[0]].marker).toBe("**");
	});

	it("mixed markers, definition lists and blockquotes", function() {
		var m = build(fixtures.NOTES.mixedMarkers);
		expect(fixtures.unitSignature(m)).toEqual([
			"list:0:-1", "item:1:0", "item:2:1", "item:2:1", "item:3:3", "item:1:0",
			"list:0:-1", "item:1:6", "item:1:6", "item:1:6", "item:1:6",
			"list:0:-1", "item:1:11", "item:1:11",
			"list:0:-1", "item:1:14", "item:2:15", "item:1:14"
		]);
		expect(m.units[4].marker).toBe("*#*");
		expect(m.units[1].subtreeEnd).toBe(m.units[4].end);
		expect(m.units[7].marker).toBe(";");
		expect(m.units[8].marker).toBe(":");
		expect(m.units[12].marker).toBe(">");
		expect(m.units[12].tag).toBe("div");
		expect(m.units[11].tag).toBe("blockquote");
	});

	it("skipped list levels: no phantom item, list subtree covers all items", function() {
		var text = "* a\n*** c\n*** d",
			m = build(text);
		expect(fixtures.unitSignature(m)).toEqual(["list:0:-1", "item:1:0", "item:3:1", "item:3:1"]);
		expect(m.units[2].start).toBe(4);
		expect(m.units[2].end).toBe(9);
		expect(m.units[0].subtreeEnd).toBe(text.length);
		expect(m.units[1].subtreeEnd).toBe(text.length);
	});

	it("blocks fixture: kinds, tags and targets", function() {
		var m = build(fixtures.NOTES.blocks);
		expect(m.units.map(function(u) { return u.kind + ":" + u.tag + ":" + u.parent; })).toEqual([
			"heading:h1:-1", "block:codeblock:0", "block:table:0", "transclusion:tiddler:0",
			"transclusion:tiddler:0", "widget:transclude:0", "widget:list:0", "block:p:0"
		]);
		expect(m.units[3].target).toBe("Some Tiddler");
		expect(m.units[4].target).toBe("Some Tiddler");
		expect(src(m, m.units[2])).toBe("|!Name |!Value |\n|alpha |1 |\n|beta |2 |");
		expect(src(m, m.units[7])).toBe("After the blocks.");
	});

	it("typed block starts at its $$$ header line; comments are not units", function() {
		var text = "<!-- c -->\n\n$$$text/plain\nx\n$$$\n\n---\n",
			m = build(text);
		expect(fixtures.unitSignature(m)).toEqual(["block:0:-1", "block:0:-1"]);
		expect(src(m, m.units[0])).toBe("$$$text/plain\nx\n$$$");
		expect(src(m, m.units[1])).toBe("---");
	});

	it("comment between blocks is not a unit", function() {
		var m = build("para\n\n<!-- c -->\n\n---");
		expect(fixtures.unitSignature(m)).toEqual(["block:0:-1", "block:0:-1"]);
		expect(m.units[1].tag).toBe("hr");
	});

	it("styled block is one opaque block", function() {
		var m = build("@@.cls\n* a\n@@\n\npara");
		expect(fixtures.unitSignature(m)).toEqual(["block:0:-1", "block:0:-1"]);
		expect(src(m, m.units[0])).toBe("@@.cls\n* a\n@@");
	});

	it("corpus: every fixture builds a consistent model", function() {
		Object.keys(fixtures.NOTES).forEach(function(name) {
			var text = fixtures.NOTES[name], m;
			expect(function() { m = build(text); }).not.toThrow();
			expect(m.text).toBe(text);
			var lastStart = -1;
			m.units.forEach(function(u, i) {
				expect(u.id).withContext(name + " id").toBe(i);
				expect(u.start).withContext(name + " order").not.toBeLessThan(lastStart);
				lastStart = u.start;
				expect(u.start < u.end).withContext(name + " range " + i).toBe(true);
				expect(u.end <= u.subtreeEnd).withContext(name + " subtreeEnd " + i).toBe(true);
				expect(u.subtreeEnd <= text.length).toBe(true);
				if(u.parent === -1) {
					expect(m.roots).toContain(i);
				} else {
					var p = m.units[u.parent];
					expect(u.parent < i).withContext(name + " parent first " + i).toBe(true);
					expect(p.children).toContain(i);
					expect(u.start >= p.start && u.subtreeEnd <= p.subtreeEnd)
						.withContext(name + " inside parent " + i).toBe(true);
				}
				u.children.forEach(function(c) { expect(m.units[c].parent).toBe(i); });
			});
		});
	});

	it("corpus: units per fixture", function() {
		expect(fixtures.unitSignature(build(fixtures.NOTES.nestedLists))).toEqual([
			"heading:1:-1", "list:0:0", "item:1:1", "item:2:2", "item:3:3", "item:3:3", "item:4:5",
			"item:2:2", "item:1:1", "item:2:8", "item:1:1"
		]);
		expect(fixtures.unitSignature(build(fixtures.NOTES.headings))).toEqual([
			"heading:1:-1", "block:0:0", "heading:2:0", "list:0:2", "item:1:3", "item:1:3",
			"heading:3:2", "block:0:6", "list:0:6", "item:1:8", "item:2:9",
			"heading:2:0", "block:0:11", "heading:1:-1", "block:0:13"
		]);
		expect(fixtures.unitSignature(build(fixtures.NOTES.procedure))).toEqual([
			"heading:1:-1", "list:0:0", "item:1:1", "item:2:2", "item:1:1"
		]);
		expect(fixtures.unitSignature(build(fixtures.NOTES.noTrailingNewline))).toEqual([
			"heading:1:-1", "list:0:0", "item:1:1", "item:1:1"
		]);
	});
});
