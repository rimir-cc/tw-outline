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
	if(pos <= 0) {
		return 0;
	}
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

/*
Position `pos` of oldText in newText, where newText is oldText with one stretch changed: unchanged before the change,
shifted by the length difference after it; -1 inside the changed stretch. The common end is taken first, so a
deleted or inserted line before `pos` is not mistaken for unchanged text at the start.
*/
exports.mapPosition = function(oldText, newText, pos) {
	var max = Math.min(oldText.length, newText.length), suffix = 0, prefix = 0;
	while(suffix < max && oldText.charAt(oldText.length - 1 - suffix) === newText.charAt(newText.length - 1 - suffix)) {
		suffix++;
	}
	while(prefix < max - suffix && oldText.charAt(prefix) === newText.charAt(prefix)) {
		prefix++;
	}
	if(pos >= oldText.length - suffix) {
		return pos + newText.length - oldText.length;
	}
	return pos < prefix ? pos : -1;
};
