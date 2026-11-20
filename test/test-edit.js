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

	it("isMultiline", function() {
		var t = "|a|b|\n\n```\nx\n```\n\n* a\n\n* m\"\"\"l1\nl2\"\"\"",
			m = build(t);
		expect(fmt.isMultiline(m, unit(m, function(u) { return u.tag === "table"; }).id)).toBe(true);
		expect(fmt.isMultiline(m, unit(m, function(u) { return u.tag === "codeblock"; }).id)).toBe(true);
		expect(fmt.isMultiline(m, idOf(m, "* a"))).toBe(false);
		var multi = unit(m, function(u) { return u.kind === "item" && /l1/.test(m.text.substring(u.start, u.end)); });
		if(multi) { expect(fmt.isMultiline(m, multi.id)).toBe(true); }
	});
});
