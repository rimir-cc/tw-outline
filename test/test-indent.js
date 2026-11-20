/*\
title: $:/plugins/rimir/outline/test/test-indent.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for indent and promote in format-wikitext.js.

\*/
"use strict";

var model = require("$:/plugins/rimir/outline/model.js"),
	fmt = require("$:/plugins/rimir/outline/format-wikitext.js"),
	formats = require("$:/plugins/rimir/outline/formats.js"),
	fixtures = require("$:/plugins/rimir/outline/test/fixtures.js");

describe("outline indent/promote", function() {

	function build(text) { return model.buildModel($tw.wiki, text); }
	function idOf(m, s) {
		return m.units.filter(function(u) { return m.text.substring(u.start, u.end) === s; })[0].id;
	}
	function run(fn, text, s) {
		var m = build(text);
		return fn(text, m, idOf(m, s));
	}

	it("indent bullet", function() {
		var r = run(fmt.indent, "* a\n* b\n** b1", "* b");
		expect(r.text).toBe("* a\n** b\n*** b1");
		expect(r.select).toBe(4);
	});
	it("indent numbered", function() {
		expect(run(fmt.indent, "# a\n# b", "# b").text).toBe("# a\n## b");
	});
	it("indent mixed", function() {
		expect(run(fmt.indent, "# x\n#* a\n#* b", "#* b").text).toBe("# x\n#* a\n#** b");
	});
	it("indent uses the item's own char for descendants", function() {
		expect(run(fmt.indent, "#* a\n#* b\n#** b1", "#* b").text).toBe("#* a\n#** b\n#*** b1");
	});
	it("no previous sibling", function() {
		expect(run(fmt.indent, "* a\n* b", "* a")).toBe(null);
	});
	it("promote at depth 1", function() {
		expect(run(fmt.promote, "* a\n* b", "* b")).toBe(null);
	});
	it("promote captures following siblings", function() {
		expect(run(fmt.promote, "* a\n** b\n** c", "** b").text).toBe("* a\n* b\n** c");
	});
	it("heading section", function() {
		expect(run(fmt.indent, "! A\n\ntext\n\n!! B", "! A").text).toBe("!! A\n\ntext\n\n!!! B");
	});
	it("heading promote", function() {
		expect(run(fmt.promote, "!! A\n\n!!! B", "!! A").text).toBe("! A\n\n!! B");
		expect(run(fmt.promote, "! A", "! A")).toBe(null);
	});
	it("heading limit", function() {
		expect(run(fmt.indent, "!! A\n\n!!!!!! B", "!! A")).toBe(null);
	});
	it("class item", function() {
		expect(run(fmt.indent, "* a\n*.cls b", "*.cls b").text).toBe("* a\n**.cls b");
	});
	it("other kinds are null", function() {
		var m = build("para\n\n* a");
		expect(fmt.indent("para\n\n* a", m, 0)).toBe(null);
		expect(fmt.promote("para\n\n* a", m, 0)).toBe(null);
	});
	it("indent keeps CRLF", function() {
		var t = fixtures.NOTES.crlf, m = build(t),
			r = fmt.indent(t, m, idOf(m, "* four"));
		expect(r.text.replace(/\r\n/g, "").indexOf("\n")).toBe(-1);
		expect(r.text.split("\r\n").length).toBe(t.split("\r\n").length);
	});
	it("getFormat", function() {
		expect(formats.getFormat("text/vnd.tiddlywiki")).toBeTruthy();
		expect(formats.getFormat("")).toBeTruthy();
		expect(formats.getFormat("text/x-markdown")).toBe(null);
	});
	it("post-op guard refuses a changed unit count and level jumps other than one", function() {
		var t = "* a\n* b\n** b1\n* c", m = build(t), b = idOf(m, "* b");
		expect(model.checkOp($tw.wiki, m, b, "indent", "* a\n** b\n*** b1\n* c")).toBe(true);
		// The subtree stayed behind
		expect(model.checkOp($tw.wiki, m, b, "indent", "* a\n** b\n** b1\n* c")).toBe(false);
		// Two levels
		expect(model.checkOp($tw.wiki, m, b, "indent", "* a\n*** b\n**** b1\n* c")).toBe(false);
		// A unit outside the subtree changed
		expect(model.checkOp($tw.wiki, m, b, "indent", "* a\n** b\n*** b1\n** c")).toBe(false);
		// Unit count changed
		expect(model.checkOp($tw.wiki, m, b, "indent", "* a\n** b\n*** b1\n\npara")).toBe(false);
		expect(model.checkOp($tw.wiki, m, b, "promote", "* a\nb\n* b1\n* c")).toBe(false);
		var h = "! A\n\n!! B\n\nx", mh = build(h);
		expect(model.checkOp($tw.wiki, mh, idOf(mh, "!! B"), "promote", "! A\n\n! B\n\nx")).toBe(true);
		expect(model.checkOp($tw.wiki, mh, idOf(mh, "!! B"), "indent", "! A\n\n!!!! B\n\nx")).toBe(false);
	});
	it("round trip and range", function() {
		Object.keys(fixtures.NOTES).forEach(function(name) {
			var t = fixtures.NOTES[name], m = build(t);
			m.units.forEach(function(u) {
				if(u.kind !== "item" && u.kind !== "heading") { return; }
				var r = fmt.indent(t, m, u.id);
				if(!r) { return; }
				fixtures.assertOnlyRangesChanged(t, r.text, [[u.start, u.subtreeEnd]], expect);
				expect(model.checkOp($tw.wiki, m, u.id, "indent", r.text)).withContext(name + " " + u.id).toBe(true);
				var m2 = build(r.text), nid = m2.units.filter(function(x) { return x.start === r.select; })[0].id,
					back = fmt.promote(r.text, m2, nid);
				expect(back && back.text).toBe(t);
				expect(model.checkOp($tw.wiki, m2, nid, "promote", back.text)).withContext(name + " " + u.id).toBe(true);
			});
		});
	});
});
