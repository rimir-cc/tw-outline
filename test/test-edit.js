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
			r = fmt.replace(text, m, u.id, "* changed");
		expect(r.text).toBe("* changed\n** a1\n* b");
		expect(r.select).toBe(0);
		fixtures.assertOnlyRangesChanged(text, r.text, [[u.start, u.end]], expect);
	});

	it("editSource returns own source", function() {
		var text = "* a\n** a1\n* b", m = build(text);
		expect(fmt.editSource(text, m, idOf(m, "* a"))).toBe("* a");
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

	it("new item keeps CRLF", function() {
		var text = "* a\r\n** a1\r\n* b", m = build(text),
			r = fmt.insertNew(text, m, idOf(m, "* a"), "x");
		expect(r.text).toBe("* a\r\n** a1\r\n* x\r\n* b");
		expect(r.text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
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
