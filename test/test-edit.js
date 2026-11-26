/*\
title: $:/plugins/rimir/outline/test/test-edit.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for replace, insertNew, editSource and isMultiline in format-wikitext.js.

\*/
"use strict";

var model = require("$:/plugins/rimir/outline/model.js"),
	fmt = require("$:/plugins/rimir/outline/format-wikitext.js"),
	fixtures = require("$:/plugins/rimir/outline/test/fixtures.js");

describe("outline edit", function() {

	function build(text) { return model.buildModel($tw.wiki, text); }
	function unit(m, pred) { return m.units.filter(pred)[0]; }
	function idOf(m, s) {
		// last match = innermost (a list and its only item can share a source)
		var all = m.units.filter(function(u) { return m.text.substring(u.start, u.end) === s; });
		return all[all.length - 1].id;
	}

	it("replace keeps rest", function() {
		var text = "* a\n** a1\n* b", m = build(text), u = m.units[idOf(m, "* a")],
			r = fmt.replace(text, m, u.id, "changed");
		expect(r.text).toBe("* changed\n** a1\n* b");
		expect(r.select).toBe(0);
		fixtures.assertOnlyRangesChanged(text, r.text, [[u.start, u.end]], expect);
	});

	it("editSource returns own source", function() {
		var text = "* a\n** a1\n* b", m = build(text);
		expect(fmt.editSource(text, m, idOf(m, "* a"))).toBe("a");
	});

	it("editor shows and replaces content only: item markers and heading prefixes stay", function() {
		var text = "! Head\n\n* a\n**#  deep\n;term\n:def\n\npara", m = build(text);
		expect(fmt.editSource(text, m, idOf(m, "! Head"))).toBe("Head");
		expect(fmt.editSource(text, m, idOf(m, "**#  deep"))).toBe("deep");
		expect(fmt.editSource(text, m, idOf(m, ";term"))).toBe("term");
		expect(fmt.editSource(text, m, idOf(m, "para"))).toBe("para");
		expect(fmt.replace(text, m, idOf(m, "! Head"), "New").text).toBe("! New\n\n* a\n**#  deep\n;term\n:def\n\npara");
		expect(fmt.replace(text, m, idOf(m, "**#  deep"), "x").text).toBe("! Head\n\n* a\n**#  x\n;term\n:def\n\npara");
		expect(fmt.replace(text, m, idOf(m, ":def"), "d2").text).toBe("! Head\n\n* a\n**#  deep\n;term\n:d2\n\npara");
		// Content that looks like markup stays content; the own marker typed out of habit is not doubled
		expect(fmt.replace(text, m, idOf(m, "* a"), "*bold*").text).toContain("\n* *bold*\n");
		expect(fmt.replace(text, m, idOf(m, "* a"), "* b").text).toContain("\n* b\n");
	});

	it("code blocks and <<< quotes: the editor leaves out their fence lines, they stay", function() {
		var text = "```js\nvar a;\nvar b;\n```\n\n<<<.cls\nsaid\n<<< Someone\n\n```\n```", m = build(text),
			code = idOf(m, "```js\nvar a;\nvar b;\n```"), q = idOf(m, "<<<.cls\nsaid\n<<< Someone");
		expect(fmt.editSource(text, m, code)).toBe("var a;\nvar b;");
		expect(fmt.editSource(text, m, q)).toBe("said");
		expect(fmt.editSource(text, m, idOf(m, "```\n```"))).toBe("");
		expect(fmt.replace(text, m, code, "x()").text).toBe("```js\nx()\n```\n\n<<<.cls\nsaid\n<<< Someone\n\n```\n```");
		expect(fmt.replace(text, m, q, "one\ntwo").text).toBe("```js\nvar a;\nvar b;\n```\n\n<<<.cls\none\ntwo\n<<< Someone\n\n```\n```");
		// CRLF text: the inserted line breaks follow it
		var crlf = "```\r\na\r\n```", cm = build(crlf);
		expect(fmt.editSource(crlf, cm, 0)).toBe("a");
		expect(fmt.replace(crlf, cm, 0, "b\r\nc").text).toBe("```\r\nb\r\nc\r\n```");
	});

	it("a whole > quote: the editor shows its lines without their first >, saving puts it back", function() {
		var text = "para\n\n> q1\n>> deeper\n>* item\n> q2\n\nend", m = build(text),
			list = unit(m, function(u) { return u.kind === "list"; }).id;
		expect(fmt.editSource(text, m, list)).toBe("q1\n> deeper\n* item\nq2");
		expect(fmt.replace(text, m, list, "q1\n> deeper\n\nnew\n* item").text)
			.toBe("para\n\n> q1\n>> deeper\n> new\n>* item\n\nend");
		// Unchanged: the same source
		expect(fmt.replace(text, m, list, fmt.editSource(text, m, list)).text).toBe(text);
	});

	it("line breaks in items and headings are stored as <br>, shown as line breaks", function() {
		var text = "! H\n\n* a\n** a1\n* b\n\npara", m = build(text);
		var r = fmt.replace(text, m, idOf(m, "* a"), "a\nsecond\r\nthird");
		expect(r.text).toBe("! H\n\n* a<br>second<br>third\n** a1\n* b\n\npara");
		// The list keeps its structure
		var m2 = build(r.text);
		expect(m2.units.length).toBe(m.units.length);
		expect(fmt.editSource(r.text, m2, idOf(m2, "* a<br>second<br>third"))).toBe("a\nsecond\nthird");
		expect(fmt.editSource("* x<br/>y<BR />z", build("* x<br/>y<BR />z"), 1)).toBe("x\ny\nz");
		// Headings too; leading/trailing line breaks are dropped
		expect(fmt.replace(text, m, idOf(m, "! H"), "H\nsub\n").text).toBe("! H<br>sub\n\n* a\n** a1\n* b\n\npara");
		// A new item
		expect(fmt.insertNew(text, m, idOf(m, "* b"), "n1\nn2").text).toBe("! H\n\n* a\n** a1\n* b\n* n1<br>n2\n\npara");
		// Paragraphs keep real line breaks
		expect(fmt.replace(text, m, idOf(m, "para"), "p1\np2").text).toBe("! H\n\n* a\n** a1\n* b\n\np1\np2");
		// Single-line units: Enter stays save-and-continue
		expect(fmt.isMultiline(m2, idOf(m2, "* a<br>second<br>third"))).toBe(false);
	});

	describe("insertBlock", function() {
		it("after a block, a list or a heading's section", function() {
			var text = "! H\n\npara\n\n* a\n** a1\n\n! I", m = build(text);
			expect(fmt.insertBlock(text, m, idOf(m, "para"), "heading2", "New").text).toBe("! H\n\npara\n\n!! New\n\n* a\n** a1\n\n! I");
			var list = m.units.filter(function(u) { return u.kind === "list"; })[0].id;
			expect(fmt.insertBlock(text, m, list, "paragraph", "p2").text).toBe("! H\n\npara\n\n* a\n** a1\n\np2\n\n! I");
			// A heading: a new heading goes after its whole section, other blocks right after the heading line
			expect(fmt.insertBlock(text, m, idOf(m, "! H"), "heading1", "G").text).toBe("! H\n\npara\n\n* a\n** a1\n\n! G\n\n! I");
			expect(fmt.insertBlock(text, m, idOf(m, "! H"), "bulleted", "first").text).toBe("! H\n\n* first\n\npara\n\n* a\n** a1\n\n! I");
			var r = fmt.insertBlock(text, m, idOf(m, "! I"), "code", "x\ny");
			expect(r.text).toBe(text + "\n\n```\nx\ny\n```");
			expect(r.select).toBe(text.length + 2);
			expect(r.kind).toBe("block");
			expect(fmt.insertBlock(text, m, idOf(m, "para"), "numbered", "n1\nn2").text).toContain("\n\n# n1<br>n2\n\n");
			expect(fmt.insertBlock(text, m, idOf(m, "para"), "quote", "q").kind).toBe("item");
			// Blank content, an item anchor: nothing
			expect(fmt.insertBlock(text, m, idOf(m, "para"), "paragraph", "  ")).toBeNull();
			expect(fmt.insertBlock(text, m, idOf(m, "* a"), "paragraph", "x")).toBeNull();
		});
	});

	describe("convert", function() {
		function conv(text, source, type) {
			var m = build(text), id = typeof source === "number" ? source : idOf(m, source);
			return fmt.convert(text, m, id, type);
		}
		it("offers the types that fit the unit", function() {
			var text = "! H\n\npara\n\n* a\n** a1\n\n```\nc\n```\n\n<div>\n\nx\n\n</div>", m = build(text);
			expect(fmt.convertTypes(m, idOf(m, "para"))).toEqual(["heading1", "heading2", "heading3", "bulleted", "numbered", "quote", "code"]);
			expect(fmt.convertTypes(m, idOf(m, "! H"))).toEqual(["paragraph", "heading2", "heading3", "bulleted", "numbered", "quote", "code"]);
			expect(fmt.convertTypes(m, idOf(m, "* a"))).toEqual(["numbered"]);
			expect(fmt.convertTypes(m, idOf(m, "```\nc\n```"))).toEqual(["paragraph", "bulleted", "numbered", "quote"]);
			var div = m.units.filter(function(u) { return u.kind === "container"; })[0].id;
			expect(fmt.convertTypes(m, div)).toEqual([]);
		});
		it("paragraphs, headings and code blocks are rewritten from their content", function() {
			expect(conv("para\n\nnext", "para", "heading2").text).toBe("!! para\n\nnext");
			expect(conv("! Head\n\nnext", "! Head", "paragraph").text).toBe("Head\n\nnext");
			expect(conv("a\nb\n\nnext", "a\nb", "bulleted").text).toBe("* a<br>b\n\nnext");
			expect(conv("line1\nline2", "line1\nline2", "code").text).toBe("```\nline1\nline2\n```");
			expect(conv("```js\nx = 1\n```", "```js\nx = 1\n```", "paragraph").text).toBe("x = 1");
			var r = conv("p", "p", "numbered");
			expect(r.text).toBe("# p");
			expect(r.kind).toBe("item");
		});
		it("a heading changes its level: only its own !s, its class stays, its section is not touched", function() {
			var text = "!! H\n\npara\n\n!!! S\n\nx", m = build(text);
			expect(fmt.convertTypes(m, idOf(m, "!! H"))).toEqual(["paragraph", "heading1", "heading3", "bulleted", "numbered", "quote", "code"]);
			var r = conv(text, "!! H", "heading1");
			expect(r.text).toBe("! H\n\npara\n\n!!! S\n\nx");
			expect(r.kind).toBe("heading");
			expect(r.select).toBe(0);
			expect(conv(text, "!! H", "heading3").text).toBe("!!! H\n\npara\n\n!!! S\n\nx");
			expect(conv("!!.cls H<br>two", "!!.cls H<br>two", "heading1").text).toBe("!.cls H<br>two");
			// Deeper than the menu's levels: all three are offered
			expect(fmt.convertTypes(build("!!!! D"), 0)).toEqual(["paragraph", "heading1", "heading2", "heading3", "bulleted", "numbered", "quote", "code"]);
			expect(conv("!!.cls H", "!!.cls H", "heading2")).toBeNull();
		});
		it("neighbours stay apart: a converted heading does not merge with the paragraph after it", function() {
			var r = conv("! H\npara", "! H", "paragraph");
			expect(r.text).toBe("H\n\npara");
			expect(conv("* a\n```\nc\n```", "```\nc\n```", "paragraph").text).toBe("* a\n\nc");
		});
		it("a bullet switches with its siblings of the same level; their sub-items follow", function() {
			var text = "* a\n** a1\n* b\n** b1\n*** b1x";
			expect(conv(text, "* b", "numbered").text).toBe("# a\n#* a1\n# b\n#* b1\n#** b1x");
			expect(conv(text, "** b1", "numbered").text).toBe("* a\n** a1\n* b\n*# b1\n*#* b1x");
			// Only the siblings under the same parent
			expect(conv("* a\n** a1\n* b\n** b1", "** a1", "numbered").text).toBe("* a\n*# a1\n* b\n** b1");
		});
		it("a whole list switches at all levels", function() {
			var text = "* a\n** a1\n*# a2", m = build(text),
				list = m.units.filter(function(u) { return u.kind === "list"; })[0].id;
			var r = fmt.convert(text, m, list, "numbered");
			expect(r.text).toBe("# a\n## a1\n## a2");
			expect(r.kind).toBe("list");
		});
		it("types that are not offered do nothing", function() {
			expect(conv("para", "para", "paragraph")).toBeNull();
			expect(conv("* a", "* a", "bulleted")).toBeNull();
			expect(conv("* a", "* a", "heading1")).toBeNull();
		});
	});

	it("new item after subtree", function() {
		var text = "* a\n** a1\n* b", m = build(text),
			r = fmt.insertNew(text, m, idOf(m, "* a"), "x");
		expect(r.text).toBe("* a\n** a1\n* x\n* b");
		expect(r.select).toBe(10);
	});

	it("new item after last line", function() {
		var text = "* a", m = build(text), r = fmt.insertNew(text, m, idOf(m, "* a"), "x");
		expect(r.text).toBe("* a\n* x");
		expect(r.select).toBe(4);
	});

	it("new item: a typed leading marker equal to the item's marker is not doubled", function() {
		var text = "* a\n** a1\n* b", m = build(text);
		expect(fmt.insertNew(text, m, idOf(m, "* a"), "* foo").text).toBe("* a\n** a1\n* foo\n* b");
		expect(fmt.insertNew(text, m, idOf(m, "** a1"), "**  deep").text).toBe("* a\n** a1\n** deep\n* b");
		// Other text that starts with marker characters stays
		expect(fmt.insertNew(text, m, idOf(m, "* a"), "*bold*").text).toBe("* a\n** a1\n* *bold*\n* b");
		expect(fmt.insertNew(text, m, idOf(m, "* a"), "** deeper").text).toBe("* a\n** a1\n* ** deeper\n* b");
		// Only the marker: nothing to insert
		expect(fmt.insertNew(text, m, idOf(m, "* a"), "*  ")).toBeNull();
	});
	it("new item at another level: newItemMarker range and the marker passed to insertNew", function() {
		var text = "* a\n** a1\n*** a2\n* b\n#* c", m = build(text), a = idOf(m, "* a");
		// Deeper: down to one below the last item of a's subtree (a2); higher: down to level 1
		expect(fmt.newItemMarker(m, a, 0)).toBe("*");
		expect(fmt.newItemMarker(m, a, 3)).toBe("****");
		expect(fmt.newItemMarker(m, a, 4)).toBeNull();
		expect(fmt.newItemMarker(m, a, -1)).toBeNull();
		expect(fmt.newItemMarker(m, idOf(m, "*** a2"), -2)).toBe("*");
		// One more of the last marker character, one character less
		expect(fmt.newItemMarker(m, idOf(m, "#* c"), 1)).toBe("#**");
		expect(fmt.newItemMarker(m, idOf(m, "#* c"), -1)).toBe("#");
		// Not an item
		expect(fmt.newItemMarker(build("para"), 0, 0)).toBeNull();
		expect(fmt.insertNew(text, m, a, "x", "**").text).toBe("* a\n** a1\n*** a2\n** x\n* b\n#* c");
	});

	it("new item keeps CRLF", function() {
		var text = "* a\r\n** a1\r\n* b", m = build(text),
			r = fmt.insertNew(text, m, idOf(m, "* a"), "x");
		expect(r.text).toBe("* a\r\n** a1\r\n* x\r\n* b");
		expect(r.text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
	});

	it("new unit before: an item with the item's marker, a paragraph before anything else", function() {
		var t = "* a\n* b\n** b1", m = build(t);
		expect(fmt.insertNew(t, m, idOf(m, "* b"), "x", null, "before")).toEqual({text: "* a\n* x\n* b\n** b1", select: 4});
		expect(fmt.insertNew(t, m, idOf(m, "** b1"), "** y", null, "before").text).toBe("* a\n* b\n** y\n** b1");
		t = "para\n\nnext";
		m = build(t);
		expect(fmt.insertNew(t, m, idOf(m, "next"), "x", null, "before")).toEqual({text: "para\n\nx\n\nnext", select: 6});
		expect(fmt.insertNew(t, m, idOf(m, "para"), "x", null, "before").text).toBe("x\n\npara\n\nnext");
		expect(fmt.insertNew(t, m, idOf(m, "para"), "  ", null, "before")).toBe(null);
		// CRLF
		t = "* a\r\n* b";
		m = build(t);
		expect(fmt.insertNew(t, m, idOf(m, "* b"), "x", null, "before").text).toBe("* a\r\n* x\r\n* b");
	});

	it("heading new paragraph", function() {
		var text = "! H\n\ntext", m = build(text),
			r = fmt.insertNew(text, m, idOf(m, "! H"), "x");
		expect(r.text).toBe("! H\n\nx\n\ntext");
		expect(r.select).toBe(5);
	});

	it("heading new paragraph without blank line after", function() {
		var text = "! H\ntext", m = build(text),
			r = fmt.insertNew(text, m, idOf(m, "! H"), "x");
		expect(r.text).toBe("! H\n\nx\n\ntext");
	});

	it("heading new paragraph at end of text", function() {
		var text = "! H", m = build(text), r = fmt.insertNew(text, m, 0, "x");
		expect(r.text).toBe("! H\n\nx");
	});

	it("block new paragraph", function() {
		var text = "para\n\nnext", m = build(text),
			r = fmt.insertNew(text, m, idOf(m, "para"), "x");
		expect(r.text).toBe("para\n\nx\n\nnext");
		expect(r.select).toBe(6);
	});

	it("blank new unit", function() {
		var text = "* a", m = build(text);
		expect(fmt.insertNew(text, m, 0, "")).toBeNull();
		expect(fmt.insertNew(text, m, 0, "  \n ")).toBeNull();
	});

	it("heading new paragraph keeps trailing newline count", function() {
		var text = "! H\n", m = build(text), r = fmt.insertNew(text, m, 0, "x");
		expect(r.text).toBe("! H\n\nx\n");
	});

	it("isMultiline", function() {
		var t = "|a|b|\n\n```\nx\n```\n\n* a\n\n<$list filter=\"[all[]]\"/>\n\n<div>\n\npara\n\n</div>\n\npa\nrb",
			m = build(t);
		function find(tag, kind) {
			var u = unit(m, function(u) { return (tag && u.tag === tag) || (kind && u.kind === kind); });
			expect(u).toBeDefined();
			return u.id;
		}
		expect(fmt.isMultiline(m, find("table"))).toBe(true);
		expect(fmt.isMultiline(m, find("codeblock"))).toBe(true);
		expect(fmt.isMultiline(m, find(null, "widget"))).toBe(true);
		expect(fmt.isMultiline(m, find(null, "container"))).toBe(true);
		expect(fmt.isMultiline(m, idOf(m, "* a"))).toBe(false);
		var para = unit(m, function(u) { return m.text.substring(u.start, u.end) === "pa\nrb"; });
		expect(para).toBeDefined();
		expect(fmt.isMultiline(m, para.id)).toBe(true);
		var m2 = build(fixtures.NOTES.specialItems),
			multi = unit(m2, function(u) { return u.kind === "item" && /^\* """multi/.test(m2.text.substring(u.start, u.end)); });
		expect(multi).toBeDefined();
		expect(fmt.isMultiline(m2, multi.id)).toBe(true);
	});

	describe("remove", function() {
		function removed(text, source) {
			var m = build(text), r = fmt.remove(text, m, idOf(m, source));
			return r && r.text;
		}

		it("removes an item and one line break", function() {
			expect(removed("* a\n* b\n* c", "* b")).toBe("* a\n* c");
			expect(removed("* a\n* b", "* b")).toBe("* a");
			expect(removed("* a\n* b\n\npara", "* b")).toBe("* a\n\npara");
			expect(removed("* a\r\n* b\r\n* c", "* b")).toBe("* a\r\n* c");
		});

		it("keeps one blank-line separator between remaining blocks", function() {
			expect(removed("p1\n\np2\n\np3", "p2")).toBe("p1\n\np3");
			expect(removed("p1\n\np2", "p2")).toBe("p1");
			expect(removed("p1\n\np2", "p1")).toBe("p2");
			expect(removed("p1\r\n\r\np2\r\n\r\np3", "p2")).toBe("p1\r\n\r\np3");
		});

		it("refuses units with children", function() {
			var text = "* a\n** a1", m = build(text);
			expect(fmt.remove(text, m, idOf(m, "* a"))).toBe(null);
		});

		it("selects the place of the removed unit", function() {
			var text = "* a\n* b\n* c", m = build(text), r = fmt.remove(text, m, idOf(m, "* b"));
			expect(r.select).toBe(4);
		});
	});
});
