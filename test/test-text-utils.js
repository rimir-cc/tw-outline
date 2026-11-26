/*\
title: $:/plugins/rimir/outline/test/test-text-utils.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for text-utils.js (line endings, splice, line start, relocation).

\*/
"use strict";

var tu = require("$:/plugins/rimir/outline/text-utils.js");

describe("outline text-utils", function() {

	it("eol detects CRLF, LF and defaults to LF", function() {
		expect(tu.eol("a\r\nb\n")).toBe("\r\n");
		expect(tu.eol("a\nb\r\n")).toBe("\n");
		expect(tu.eol("abc")).toBe("\n");
	});

	it("splice replaces and round-trips", function() {
		var text = "hello world";
		expect(tu.splice(text, 6, 11, "there")).toBe("hello there");
		expect(tu.splice(text, 5, 5, "!")).toBe("hello! world");
		var out = tu.splice(text, 0, 5, "bye");
		expect(tu.splice(out, 0, 3, "hello")).toBe(text);
	});

	it("lineStart finds the start of the line", function() {
		var text = "ab\ncd\r\nef";
		expect(tu.lineStart(text, 0)).toBe(0);
		expect(tu.lineStart(text, 2)).toBe(0);
		expect(tu.lineStart(text, 4)).toBe(3);
		expect(tu.lineStart(text, 8)).toBe(7);
		expect(tu.lineStart("\nabc", 0)).toBe(0);
		expect(tu.lineStart("ab\ncd", 2)).toBe(0);
		expect(tu.lineStart("ab\ncd", 5)).toBe(3);
		expect(tu.lineStart("ab\n", 3)).toBe(3);
	});

	it("relocate returns the index of a unique occurrence", function() {
		expect(tu.relocate("xx* a\nyy", "* a")).toBe(2);
	});

	it("relocate returns -1 for zero and two occurrences", function() {
		expect(tu.relocate("abc", "zz")).toBe(-1);
		expect(tu.relocate("* a\n* a", "* a")).toBe(-1);
		expect(tu.relocate("abc", "")).toBe(-1);
	});

	it("mapPosition follows a position over a change: unchanged before it, shifted after it", function() {
		// After the change
		expect(tu.mapPosition("a\n\nb", "ab\n\nb", 3)).toBe(4);
		// Before the change
		expect(tu.mapPosition("x\n\na", "x\n\nab", 0)).toBe(0);
		// A deleted line before it (the common start "* " is not taken for unchanged text)
		expect(tu.mapPosition("* a\n* b", "* b", 4)).toBe(0);
		// Inserted text before it
		expect(tu.mapPosition("* a\n* b", "* a\n* new\n* b", 4)).toBe(10);
		expect(tu.mapPosition("abc", "abc", 1)).toBe(1);
	});

	it("mapPosition returns -1 for a position inside the changed text", function() {
		expect(tu.mapPosition("abcdef", "abXYef", 3)).toBe(-1);
	});
});
