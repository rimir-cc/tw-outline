/*\
title: $:/plugins/rimir/outline/test/test-move.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for move in format-wikitext.js.

\*/
"use strict";

var model = require("$:/plugins/rimir/outline/model.js"),
	fmt = require("$:/plugins/rimir/outline/format-wikitext.js"),
	fixtures = require("$:/plugins/rimir/outline/test/fixtures.js");

describe("outline move", function() {

	function build(text) { return model.buildModel($tw.wiki, text); }
	function idOf(m, s) {
		return m.units.filter(function(u) { return m.text.substring(u.start, u.end) === s; })[0].id;
	}
	function run(text, s, dir) {
		var m = build(text);
		return fmt.move(text, m, idOf(m, s), dir);
	}

	it("items with children", function() {
		var r = run("* a\n** a1\n* b\n** b1", "* b", -1);
		expect(r.text).toBe("* b\n** b1\n* a\n** a1");
		expect(r.select).toBe(0);
		var r2 = run("* a\n** a1\n* b\n** b1", "* a", 1);
		expect(r2.text).toBe("* b\n** b1\n* a\n** a1");
		expect(r2.select).toBe(10);
	});
	it("headings with sections", function() {
		expect(run("! A\n\nx\n\n! B\n\ny", "! B", -1).text).toBe("! B\n\ny\n\n! A\n\nx");
	});
	it("blocks in section", function() {
		expect(run("! H\n\np1\n\np2\n", "p2", -1).text).toBe("! H\n\np2\n\np1\n");
	});
	it("edge no-ops", function() {
		expect(run("* a\n* b", "* a", -1)).toBe(null);
		expect(run("* a\n* b", "* b", 1)).toBe(null);
		expect(run("! H\n\np\n\n!! S\n\nq", "p", 1)).toBe(null);
		expect(run("* a\n* b\n\np", "* b", 1)).toBe(null);
		expect(run("intro\n\n! H\n\nx", "intro", 1)).toBe(null);
		expect(run("intro\n\n! H\n\nx", "! H", -1)).toBe(null);
		expect(run("! P\n\n!!! c\n\n!! d", "!! d", -1)).toBe(null);
		expect(run("* a\n*** c\n** d", "** d", -1)).toBe(null);
	});
	it("container", function() {
		var t = "<div>\n\np1\n\np2\n\n</div>";
		expect(run(t, "p1", 1).text).toBe("<div>\n\np2\n\np1\n\n</div>");
		expect(run(t, "p2", 1)).toBe(null);
	});
	it("container moves as a whole", function() {
		var t = "<div>\n\np1\n\n</div>\n\nafter";
		expect(run(t, "after", -1).text).toBe("after\n\n<div>\n\np1\n\n</div>");
	});
	it("move last unit without trailing newline", function() {
		expect(run("p1\n\np2", "p2", -1).text).toBe("p2\n\np1");
		expect(run("* a\n* b", "* b", -1).text).toBe("* b\n* a");
	});
	it("keeps CRLF", function() {
		var t = "* one\r\n* two\r\n\r\np", m = build(t);
		expect(fmt.move(t, m, idOf(m, "* two"), -1).text).toBe("* two\r\n* one\r\n\r\np");
		var t2 = "a\r\n\r\nb\r\n", m2 = build(t2);
		expect(fmt.move(t2, m2, idOf(m2, "b"), -1).text).toBe("b\r\n\r\na\r\n");
	});
	it("blocks that touch (single line break) are swapped with a blank-line separator", function() {
		expect(run("* a\n* b\npara", "para", -1).text).toBe("para\n\n* a\n* b");
		expect(run("para\n\n* a\n* b\nend", "* a\n* b", 1).text).toBe("para\n\nend\n\n* a\n* b");
		expect(run("```\ncode\n```\npara", "para", -1).text).toBe("para\n\n```\ncode\n```");
		expect(run("|a |\n|b |\npara", "para", -1).text).toBe("para\n\n|a |\n|b |");
		// ...and before the content after the pair
		expect(run("para\n\n* a\n* b\nend", "para", 1).text).toBe("* a\n* b\n\npara\n\nend");
		var t = "* a\r\n* b\r\npara", m = build(t);
		expect(fmt.move(t, m, idOf(m, "para"), -1).text).toBe("para\r\n\r\n* a\r\n* b");
		// A comment between the blocks is kept, never deleted
		expect(run("* a\n* b\n<!-- keep me -->\npara two", "para two", -1).text).toBe("para two\n\n<!-- keep me -->\n\n* a\n* b");
		expect(run("```\ncode\n```\n<!-- c -->\npara", "para", -1).text).toBe("para\n\n<!-- c -->\n\n```\ncode\n```");
		// The line after the pair keeps its indentation
		expect(run("para\n\n```\nx\n```\n  next", "para", 1).text).toBe("```\nx\n```\n\npara\n\n  next");
		// Items and headings keep their single line break
		expect(run("* a\n* b", "* b", -1).text).toBe("* b\n* a");
		expect(run("! A\n! B", "! B", -1).text).toBe("! B\n! A");
	});
	it("post-op guard refuses a move that changes the units", function() {
		var t = "* a\n* b\npara", m = build(t), p = idOf(m, "para");
		expect(model.checkOp($tw.wiki, m, p, "move", "para\n\n* a\n* b")).toBe(true);
		// The old separator-keeping swap merged everything into one paragraph
		expect(model.checkOp($tw.wiki, m, p, "move", "para\n* a\n* b")).toBe(false);
		// Same count, other kinds
		expect(model.checkOp($tw.wiki, m, p, "move", "para\n\n* a\n\n```\nx\n```")).toBe(false);
		// A move never changes levels
		expect(model.checkOp($tw.wiki, m, p, "move", "para\n\n* a\n** b")).toBe(false);
	});
	it("touching blocks keep their units after a move", function() {
		["* a\n* b\npara", "para\n\n* a\n* b\nend", "```\ncode\n```\npara"].forEach(function(t) {
			var m = build(t);
			m.units.forEach(function(u) {
				[1, -1].forEach(function(dir) {
					var r = fmt.move(t, m, u.id, dir);
					if(r) {
						expect(build(r.text).units.length).withContext(JSON.stringify(t) + " " + u.id + " " + dir).toBe(m.units.length);
					}
				});
			});
		});
	});
	it("round trip and invariants over the corpus", function() {
		var moved = 0;
		Object.keys(fixtures.NOTES).forEach(function(k) {
			var t = fixtures.NOTES[k], m = build(t);
			m.units.forEach(function(u) {
				[1, -1].forEach(function(dir) {
					var r = fmt.move(t, m, u.id, dir);
					if(!r) { return; }
					moved++;
					var m2 = build(r.text);
					expect(m2.units.length).withContext(k + " " + u.id).toBe(m.units.length);
					function ks(mm) { return mm.units.map(function(x) { return x.kind + ":" + x.level; }).sort(); }
					expect(ks(m2)).toEqual(ks(m));
					var nid = -1;
					m2.units.forEach(function(x) { if(x.start === r.select && x.kind === u.kind) { nid = x.id; } });
					expect(nid).not.toBe(-1);
					var sibs = u.parent === -1 ? m.roots : m.units[u.parent].children,
						o = m.units[sibs[sibs.indexOf(u.id) + dir]],
						lo = dir < 0 ? o.start : u.start, hi = dir < 0 ? u.subtreeEnd : o.subtreeEnd;
					fixtures.assertOnlyRangesChanged(t, r.text, [[lo, hi]], expect);
					expect(model.checkOp($tw.wiki, m, u.id, "move", r.text)).withContext(k + " " + u.id + " " + dir).toBe(true);
					var back = fmt.move(r.text, m2, nid, -dir);
					// Touching blocks get a blank-line separator: the way back keeps it, so it only gives back the same units
					var a = dir < 0 ? o : u, b = dir < 0 ? u : o;
					var blank = /\n[ \t]*\r?\n/, gap = /^\s*/.exec(t.substring(b.subtreeEnd))[0];
					if(u.kind !== "item" && u.kind !== "heading" && (!blank.test(t.substring(a.subtreeEnd, b.start)) ||
						(b.subtreeEnd + gap.length < t.length && !blank.test(gap)))) {
						expect(back && ks(build(back.text))).withContext(k + " " + u.id + " " + dir).toEqual(ks(m));
					} else {
						expect(back && back.text).withContext(k + " " + u.id + " " + dir).toBe(t);
					}
				});
			});
		});
		expect(moved).toBeGreaterThan(10);
	});
});
