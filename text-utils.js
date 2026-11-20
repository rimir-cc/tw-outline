/*\
title: $:/plugins/rimir/outline/text-utils.js
type: application/javascript
module-type: library

Small text helpers for outline edits: line endings, splicing, line starts and relocation.

\*/
"use strict";

// First line ending found in text; "\n" when there is none
exports.eol = function(text) {
	var m = /\r\n|\n/.exec(text);
	return m && m[0] === "\r\n" ? "\r\n" : "\n";
};

exports.splice = function(text, start, end, insert) {
	return text.substring(0, start) + insert + text.substring(end);
};

// Index of the first character of the line containing pos
exports.lineStart = function(text, pos) {
	return text.lastIndexOf("\n", pos - 1) + 1;
};

// Index of oldSlice in newText if it occurs exactly once, else -1
exports.relocate = function(newText, oldSlice) {
	if(!oldSlice) {
		return -1;
	}
	var first = newText.indexOf(oldSlice);
	if(first === -1 || newText.indexOf(oldSlice, first + 1) !== -1) {
		return -1;
	}
	return first;
};
