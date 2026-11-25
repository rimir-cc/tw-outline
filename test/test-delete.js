/*\
title: $:/plugins/rimir/outline/test/test-delete.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for deleteUnit, deleteCount, merge and itemBefore in format-wikitext.js, and their post-op guard.

\*/
"use strict";

var model = require("$:/plugins/rimir/outline/model.js"),
	fmt = require("$:/plugins/rimir/outline/format-wikitext.js"),
	fixtures = require("$:/plugins/rimir/outline/test/fixtures.js");

describe("outline delete and merge", function() {

	function build(text) { return model.buildModel($tw.wiki, text); }
	function idOf(m, s, kind) {
		var all = m.units.filter(function(u) { return m.text.substring(u.start, u.end) === s && (!kind || u.kind === kind); });
		return all[all.length - 1].id;
	}
	function del(text, s, mode, kind) {
		var m = build(text), id = idOf(m, s, kind), r = fmt.deleteUnit(text, m, id, mode);
		if(r) {
			expect(model.checkOp($tw.wiki, m, id, "deleteUnit", r.text, undefined, r)).withContext(s).toBe(true);
		}
		return r;
	}
	function merge(text, s, content) {
		var m = build(text), id = idOf(m, s), r = fmt.merge(text, m, id, content);
		if(r) {
			expect(model.checkOp($tw.wiki, m, id, "merge", r.text, undefined, r)).withContext(s).toBe(true);
		}
		return r;
	}

	it("deletes an item with its sub-items", function() {
		expect(del("* a\n* b\n** b1\n*** b2\n* c", "* b").text).toBe("* a\n* c");
		expect(del("* a\n* b\n** b1", "* b").text).toBe("* a");
		expect(del("* a\n** a1\n* b", "** a1").text).toBe("* a\n* b");
	});

	it("an only item takes its list along", function() {
		var r = del("para\n\n* only\n\nend", "* only", undefined, "item");
		expect(r.text).toBe("para\n\nend");
		expect(r.removed.length).toBe(2);
		var m = build("para\n\n* only\n\nend");
		expect(fmt.deleteCount(m, idOf(m, "* only", "item"))).toBe(1);
	});

	it("deletes a heading with its section, or only its line", function() {
		var t = "! A\n\nx\n\n!! B\n\ny\n\n! C\n\nz";
		expect(del(t, "! A").text).toBe("! C\n\nz");
		expect(del(t, "!! B").text).toBe("! A\n\nx\n\n! C\n\nz");
		// Only the heading: its section joins the one above
		expect(del(t, "!! B", "own").text).toBe("! A\n\nx\n\ny\n\n! C\n\nz");
		expect(del(t, "! A", "own").text).toBe("x\n\n!! B\n\ny\n\n! C\n\nz");
		var m = build(t);
		expect(fmt.deleteCount(m, idOf(m, "! A"))).toBe(3);
		expect(fmt.deleteCount(m, idOf(m, "! A"), "own")).toBe(0);
		// "own" is for headings only
		expect(fmt.deleteUnit(t, m, idOf(m, "x"), "own")).toBe(null);
	});

	it("an only child takes its container along", function() {
		var t = "p\n\n<div>\n\n! H\n\nx\n\n</div>\n\nend";
		var r = del(t, "! H");
		expect(r.text).toBe("p\n\nend");
		var m = build(t);
		expect(fmt.deleteCount(m, idOf(m, "! H"))).toBe(2);
		// Only the heading's line: the section keeps the container alive
		expect(del(t, "! H", "own").text).toBe("p\n\n<div>\n\nx\n\n</div>\n\nend");
	});

	it("deletes a whole list, a block, the last unit", function() {
		var t = "p1\n\n* a\n** a1\n* b\n\np2";
		var m = build(t), list = m.units.filter(function(u) { return u.kind === "list"; })[0];
		var r = fmt.deleteUnit(t, m, list.id);
		expect(r.text).toBe("p1\n\np2");
		expect(r.removed.length).toBe(4);
		expect(fmt.deleteCount(m, list.id)).toBe(3);
		expect(del(t, "p1").text).toBe("* a\n** a1\n* b\n\np2");
		expect(del(t, "p2").text).toBe("p1\n\n* a\n** a1\n* b");
		expect(del("p\n\n```\nc\n```\n", "```\nc\n```").text).toBe("p\n");
	});

	it("deletes every unit of the corpus with a guarded, plausible result", function() {
		var n = 0;
		Object.keys(fixtures.NOTES).forEach(function(k) {
			var t = fixtures.NOTES[k], m = build(t);
			m.units.forEach(function(u) {
				var r = fmt.deleteUnit(t, m, u.id);
				if(!r) { return; }
				n++;
				expect(r.text.length).toBeLessThan(t.length);
				expect(model.checkOp($tw.wiki, m, u.id, "deleteUnit", r.text, undefined, r)).withContext(k + " " + u.id).toBe(true);
			});
		});
		expect(n).toBeGreaterThan(20);
	});

	it("the guard refuses a delete that merges neighbours", function() {
		var t = "* a\n\npara\n\n* b", m = build(t), id = idOf(m, "para");
		// Removing the paragraph without a separator would merge the two lists into one
		expect(model.checkOp($tw.wiki, m, id, "deleteUnit", "* a\n* b", undefined, {removed: [id]})).toBe(false);
		expect(model.checkOp($tw.wiki, m, id, "deleteUnit", "* a\n\n* b", undefined, undefined)).toBe(false);
	});

	it("merges an item into the item above", function() {
		var r = merge("* a\n* b\n* c", "* b");
		expect(r.text).toBe("* ab\n* c");
		expect(r.caret).toBe(1);
		expect(r.select).toBe(0);
		// Into the parent, into the last sub-item of the previous sibling
		expect(merge("* a\n** b", "** b").text).toBe("* ab");
		expect(merge("* a\n** a1\n* b", "* b").text).toBe("* a\n** a1b");
		// Its sub-items keep their lines and levels
		expect(merge("* a\n* b\n** b1\n* c", "* b").text).toBe("* ab\n** b1\n* c");
		// Editor text instead of the current content; "" deletes the item; line breaks become <br>
		expect(merge("* a\n* b\n* c", "* b", "new").text).toBe("* anew\n* c");
		expect(merge("* a\n* b\n** b1", "* b", "").text).toBe("* a\n** b1");
		expect(merge("# a\n# b", "# b", "x\ny").text).toBe("# ax<br>y");
		// The caret goes to the end of the target's editor text
		expect(merge("* x<br>y\n* b", "* b").caret).toBe(3);
	});

	it("merge needs an item above in the same list", function() {
		// A blank line between items is still one list: it goes with the merge
		expect(merge("* a\n\n* b", "* b").text).toBe("* ab");
		var t = "* a\n\npara\n\n* b", m = build(t);
		// Two lists: b is the first item of its own list
		expect(fmt.mergeTarget(m, idOf(m, "* b"))).toBe(-1);
		expect(fmt.merge(t, m, idOf(m, "* b"))).toBe(null);
		m = build("para\n\n* a");
		expect(fmt.merge("para\n\n* a", m, idOf(m, "* a", "item"))).toBe(null);
		m = build("p");
		expect(fmt.mergeTarget(m, 0)).toBe(-1);
	});

	it("mergeSource: the item below that merges into an item (Delete at its end)", function() {
		var t = "* a\n* b\n** b1\n* c\n\npara\n\n* d", m = build(t);
		expect(fmt.mergeSource(m, idOf(m, "* a"))).toBe(idOf(m, "* b"));
		// An item with sub-items: its first sub-item
		expect(fmt.mergeSource(m, idOf(m, "* b"))).toBe(idOf(m, "** b1"));
		expect(fmt.mergeSource(m, idOf(m, "** b1"))).toBe(idOf(m, "* c"));
		// The last item of a list: the next list is another one
		expect(fmt.mergeSource(m, idOf(m, "* c"))).toBe(-1);
		expect(fmt.mergeSource(m, idOf(m, "* d"))).toBe(-1);
		expect(fmt.mergeSource(m, idOf(m, "para"))).toBe(-1);
	});

	it("splits an item: the rest goes to a new item right below", function() {
		function split(text, s, rest) {
			var m = build(text), id = idOf(m, s), r = fmt.split(text, m, id, rest);
			if(r) {
				expect(model.checkOp($tw.wiki, m, id, "split", r.text, undefined, r)).withContext(s).toBe(true);
			}
			return r;
		}
		var r = split("* ab\n* c", "* ab", "cd");
		expect(r.text).toBe("* ab\n* cd\n* c");
		expect(r.select).toBe(5);
		// With sub-items the new item becomes the first sub-item: they stay with the item
		expect(split("# a\n#* a1\n# b", "# a", "x").text).toBe("# a\n#* x\n#* a1\n# b");
		// Line breaks become <br>; nothing to split off: null
		expect(split("* a", "* a", "x\ny").text).toBe("* a\n* x<br>y");
		expect(split("* a", "* a", "  ")).toBe(null);
		var m = build("para");
		expect(fmt.split("para", m, 0, "x")).toBe(null);
		// The inverse of merge
		var t = "* one\n** a\n* two", s1 = split(t, "* one", "rest"), m1 = build(s1.text);
		var back = fmt.merge(s1.text, m1, idOf(m1, "** rest"));
		expect(back.text).toBe("* onerest\n** a\n* two");
	});

	it("itemBefore finds the item visually above a position", function() {
		var t = "* a\n** a1\n*** a2\n* b", m = build(t), a = idOf(m, "* a");
		expect(m.text.substring(m.units[fmt.itemBefore(m, a, m.units[a].subtreeEnd)].start).indexOf("*** a2")).toBe(0);
	});
	it("a heading or paragraph turned into a bullet joins a list next to it", function() {
		function conv(text, src, type) {
			var m = build(text);
			return fmt.convert(text, m, idOf(m, src), type);
		}
		expect(conv("! H\n* a\n* b", "! H", "bulleted").text).toBe("* H\n\n* a\n* b");
		expect(conv("! H\n\n* a", "! H", "numbered").text).toBe("# H\n\n* a");
		expect(conv("* z\n\npara\n\n* a", "para", "bulleted").text).toBe("* z\n\n* para\n\n* a");
		expect(conv("! H\n\npara", "! H", "bulleted").text).toBe("* H\n\npara");
	});
});
