/*\
title: $:/plugins/rimir/outline/test/fixtures.js
type: application/javascript
module-type: library

Fixture notes and invariant helpers for the outline specs.

\*/
"use strict";

var NOTES = {};

// Plain nested lists, 3+ deep, with a trailing newline
NOTES.nestedLists = [
	"! Shopping",
	"",
	"* Fruit",
	"** Apples",
	"*** Granny Smith",
	"*** Braeburn",
	"**** from the local market",
	"** Pears",
	"* Vegetables",
	"** Carrots",
	"* Dairy",
	""
].join("\n");

// Mixed list markers: * and # and ; : and >
NOTES.mixedMarkers = [
	"* Setup",
	"*# install the package",
	"*# configure the wiki",
	"*#* check the port",
	"* Terms",
	"; Outline",
	": a tree of blocks",
	"; Unit",
	": one selectable piece",
	"",
	"> quoted line one",
	"> quoted line two",
	"",
	"# first",
	"#* inner bullet",
	"# second",
	""
].join("\n");

// Headings ! to !!! with paragraphs and lists inside the sections
NOTES.headings = [
	"! Project",
	"",
	"Intro paragraph for the project.",
	"",
	"!! Goals",
	"",
	"* Ship the plugin",
	"* Write the docs",
	"",
	"!!! Details",
	"",
	"A detail paragraph",
	"spanning two lines.",
	"",
	"* Detail item",
	"** Nested detail",
	"",
	"!! Risks",
	"",
	"Some risks are listed here.",
	"",
	"! Appendix",
	"",
	"Closing words.",
	""
].join("\n");

// Code block, table, {{X}} and {{X||T}} lines, macro line, $list block
NOTES.blocks = [
	"! Reference",
	"",
	"```js",
	"var x = 1;",
	"```",
	"",
	"|!Name |!Value |",
	"|alpha |1 |",
	"|beta |2 |",
	"",
	"{{Some Tiddler}}",
	"",
	"{{Some Tiddler||Some Template}}",
	"",
	"<<my-macro arg>>",
	"",
	"<$list filter=\"[tag[Task]]\">",
	"",
	"<$text text=<<currentTiddler>>/>",
	"",
	"</$list>",
	"",
	"After the blocks.",
	""
].join("\n");

// <div> container holding blocks
NOTES.container = [
	"Before the container.",
	"",
	"<div class=\"box\">",
	"",
	"! Inside heading",
	"",
	"* inside item one",
	"* inside item two",
	"",
	"Inside paragraph.",
	"",
	"</div>",
	"",
	"* after item",
	""
].join("\n");

// \procedure pragma at the top
NOTES.procedure = [
	"\\procedure greet(name)",
	"Hello <<name>>",
	"\\end",
	"",
	"! Greetings",
	"",
	"* <<greet World>>",
	"** nested after pragma",
	"* second",
	""
].join("\n");

// """ list item, item with class (*.cls), multi-line content
NOTES.specialItems = [
	"* normal item",
	"*.cls classed item",
	"** nested classed",
	"*.cls2 another classed item",
	"* \"\"\"multi",
	"line item\"\"\"",
	"* after the triple-quote item",
	"** its child",
	""
].join("\n");

// CRLF note (file from Windows)
NOTES.crlf = [
	"! Windows note",
	"",
	"* one",
	"** two",
	"*** three",
	"* four",
	"",
	"Final paragraph.",
	""
].join("\r\n");

// No trailing newline: last line is a list item
NOTES.noTrailingNewline = [
	"! Tail",
	"",
	"* first",
	"* last item without newline"
].join("\n");

// Empty text and pragma-only text
NOTES.empty = "";
NOTES.pragmaOnly = "\\define m() x\n\\procedure p()\nbody\n\\end\n";

exports.NOTES = NOTES;

/*
Assert that, in `after`, the text before the smallest range start and after the largest
range end (mapped to the same lengths relative to the end of the text) is unchanged.
`ranges` are [[start,end]] in `before`. The tail is compared against the same
suffix of `before` that follows the largest end.
*/
exports.assertOnlyRangesChanged = function(before, after, ranges) {
	var min = Infinity, max = -Infinity;
	(ranges || []).forEach(function(r) {
		if(r[0] < min) { min = r[0]; }
		if(r[1] > max) { max = r[1]; }
	});
	if(min === Infinity) {
		expect(after).toBe(before);
		return;
	}
	var prefix = before.substring(0, min),
		suffix = before.substring(max);
	expect(after.substring(0, min)).toBe(prefix);
	expect(after.length).not.toBeLessThan(prefix.length + suffix.length);
	expect(after.substring(after.length - suffix.length)).toBe(suffix);
};

/* Array of "kind:level:parent" per unit, for structure comparisons */
exports.unitSignature = function(model) {
	return model.units.map(function(u) {
		return u.kind + ":" + u.level + ":" + u.parent;
	});
};
