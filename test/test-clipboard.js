/*\
title: $:/plugins/rimir/outline/test/test-clipboard.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for copy and paste in format-wikitext.js (outline clipboard: levels adapted to the paste place).

\*/
"use strict";

var model = require("$:/plugins/rimir/outline/model.js"),
	fmt = require("$:/plugins/rimir/outline/format-wikitext.js");

describe("outline clipboard", function() {

	function build(text) { return model.buildModel($tw.wiki, text); }
	function idOf(m, s, kind) {
		var all = m.units.filter(function(u) { return m.text.substring(u.start, u.end) === s && (!kind || u.kind === kind); });
		return all[all.length - 1].id;
	}
	// Copy unit `s` of `from`, paste it after unit `at` of `text` (null: the end, as in an empty tiddler)
	function paste(text, at, from, s, kinds) {
		kinds = kinds || {};
		var fm = build(from),
			clip = fmt.copy(from, fm, idOf(fm, s, kinds.from)),
			m = build(text);
		return fmt.paste(text, m, at === null ? -1 : idOf(m, at, kinds.at), clip, build(clip.source));
	}

	it("copy: the unit with its subtree, by kind", function() {
		var text = "! H\n\npara\n\n!! S\n\n* a\n** a1\n* b\n\n! I", m = build(text);
		expect(fmt.copy(text, m, idOf(m, "* a"))).toEqual({kind: "items", source: "* a\n** a1"});
		expect(fmt.copy(text, m, idOf(m, "* a\n** a1\n* b", "list"))).toEqual({kind: "items", source: "* a\n** a1\n* b"});
		expect(fmt.copy(text, m, idOf(m, "! H"))).toEqual({kind: "heading", source: "! H\n\npara\n\n!! S\n\n* a\n** a1\n* b"});
		expect(fmt.copy(text, m, idOf(m, "para"))).toEqual({kind: "block", source: "para"});
		expect(fmt.copy(text, m, 99)).toBeNull();
	});

	it("items after an item: its level, deeper items keep their extra marker characters", function() {
		var r = paste("# x\n## y\n# z", "## y", "* a\n** a1", "* a");
		expect(r.text).toBe("# x\n## y\n## a\n##* a1\n# z");
		expect(r.select).toBe(9);
		expect(r.kind).toBe("item");
		// After the item's whole subtree
		expect(paste("* x\n** x1\n* y", "* x", "* a", "* a").text).toBe("* x\n** x1\n* a\n* y");
	});

	it("items after a whole list: at its end, at its top level", function() {
		expect(paste("para\n\n# x\n# y", "# x\n# y", "* a\n** a1", "* a", {at: "list"}).text).toBe("para\n\n# x\n# y\n# a\n#* a1");
	});

	it("items after a heading or a block: a new list at level 1", function() {
		expect(paste("! H\n\npara", "! H", "#* a\n#** b", "#* a").text).toBe("! H\n\n* a\n** b\n\npara");
		expect(paste("para\n\nmore", "para", "#* a\n#** b", "#* a").text).toBe("para\n\n* a\n** b\n\nmore");
		// A whole list copied
		expect(paste("para", "para", "** a\n** b", "** a\n** b", {from: "list"}).text).toBe("para\n\n* a\n* b");
	});

	it("heading after a heading: after its section, at its level; sub-headings keep their distance", function() {
		var r = paste("! A\n\nx\n\n! B", "! A", "!! S\n\ny\n\n!!! T\n\nz", "!! S");
		expect(r.text).toBe("! A\n\nx\n\n! S\n\ny\n\n!! T\n\nz\n\n! B");
		expect(r.select).toBe(8);
		expect(r.kind).toBe("heading");
	});

	it("heading after a non-heading: one below the section's heading, levels stop at 6", function() {
		expect(paste("!!!!! A\n\npara", "para", "! S\n\n!! T", "! S").text).toBe("!!!!! A\n\npara\n\n!!!!!! S\n\n!!!!!! T");
		expect(paste("para", "para", "!!! S", "!!! S").text).toBe("para\n\n! S");
		expect(paste("!! A\n\n* a\n* b", "* a", "! S", "! S").text).toBe("!! A\n\n* a\n* b\n\n!!! S");
	});

	it("blocks: after the outermost list of an item, right below a heading line, after other blocks", function() {
		expect(paste("* a\n** a1\n* b\n\nend", "** a1", "hello", "hello").text).toBe("* a\n** a1\n* b\n\nhello\n\nend");
		expect(paste("! H\n\npara", "! H", "hello", "hello").text).toBe("! H\n\nhello\n\npara");
		expect(paste("para", "para", "hello", "hello").text).toBe("para\n\nhello");
		expect(paste("para", "para", "hello", "hello").kind).toBe("block");
	});

	it("only real markers and headings are rewritten (not lines in a code block)", function() {
		expect(paste("! A", "! A", "!! S\n\n```\n* x\n! y\n```", "!! S").text).toBe("! A\n\n! S\n\n```\n* x\n! y\n```");
	});

	it("line breaks follow the target text", function() {
		expect(paste("* a\r\n* b", "* a", "* n\n** m", "* n").text).toBe("* a\r\n* n\r\n** m\r\n* b");
	});

	it("empty tiddler: at the end, items at level 1, a heading at level 1", function() {
		expect(paste("", null, "** a", "** a").text).toBe("* a");
		expect(paste("", null, "!!! S", "!!! S").text).toBe("! S");
		expect(paste("<!-- c -->", null, "hello", "hello").text).toBe("<!-- c -->\n\nhello");
	});

	it("clipKind (plain text from outside): one list, one heading, else block", function() {
		expect(fmt.clipKind(build("* a\n** b\n* c"))).toBe("items");
		expect(fmt.clipKind(build("!! S\n\ntext\n\n* a"))).toBe("heading");
		expect(fmt.clipKind(build("para"))).toBe("block");
		expect(fmt.clipKind(build("* a\n\npara"))).toBe("block");
		expect(fmt.clipKind(build("para\n\n! H"))).toBe("block");
		// Outside plain text pasted with its kind: a list adapts to the item it lands after
		var cm = build("* n\n** m");
		expect(fmt.paste("# x\n# y", build("# x\n# y"), 1, {kind: fmt.clipKind(cm), source: cm.text}, cm).text)
			.toBe("# x\n# n\n#* m\n# y");
	});

	it("nothing to paste or no such unit: null", function() {
		var m = build("para");
		expect(fmt.paste("para", m, 0, null, null)).toBeNull();
		expect(fmt.paste("para", m, 5, {kind: "block", source: "x"}, build("x"))).toBeNull();
	});
});
