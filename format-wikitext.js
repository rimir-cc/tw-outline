/*\
title: $:/plugins/rimir/outline/format-wikitext.js
type: application/javascript
module-type: outline-format

Wikitext adapter: indent, promote, move, replace, insertNew, remove. Functions take (text, model, id) and return null or {text, select}.

\*/
"use strict";

var utils = require("$:/plugins/rimir/outline/text-utils.js");

exports.types = ["text/vnd.tiddlywiki", ""];

// Units of `kind` whose start lies in the subtree of u (u included)
function subtreeUnits(model, u, kind) {
	return model.units.filter(function(d) {
		return d.kind === kind && d.start >= u.start && d.start < u.subtreeEnd;
	});
}

// positions: [{pos, insert}] / removals; applied from the end backwards
function apply(text, edits) {
	edits.sort(function(a, b) { return b.pos - a.pos; });
	edits.forEach(function(e) {
		text = utils.splice(text, e.pos, e.pos + e.remove, e.insert);
	});
	return text;
}

function selectFor(u, edits) {
	// units start never moves: edits at u.start insert before it only for headings, where start stays
	return u.start;
}

exports.indent = function(text, model, id) {
	var u = model.units[id], edits;
	if(!u) { return null; }
	if(u.kind === "item") {
		var sibs = u.parent === -1 ? model.roots : model.units[u.parent].children,
			i = sibs.indexOf(id);
		if(i < 1 || model.units[sibs[i - 1]].kind !== "item") { return null; }
		var c = u.marker.charAt(u.level - 1);
		edits = subtreeUnits(model, u, "item").map(function(d) {
			return {pos: d.start + u.level, remove: 0, insert: c};
		});
	} else if(u.kind === "heading") {
		var hs = subtreeUnits(model, u, "heading");
		if(hs.some(function(h) { return h.level >= 6; })) { return null; }
		edits = hs.map(function(h) { return {pos: h.start, remove: 0, insert: "!"}; });
	} else {
		return null;
	}
	return {text: apply(text, edits), select: selectFor(u, edits)};
};

exports.promote = function(text, model, id) {
	var u = model.units[id], edits;
	if(!u) { return null; }
	if(u.kind === "item") {
		if(u.level <= 1) { return null; }
		edits = subtreeUnits(model, u, "item").map(function(d) {
			return {pos: d.start + u.level - 1, remove: 1, insert: ""};
		});
	} else if(u.kind === "heading") {
		if(u.level <= 1) { return null; }
		edits = subtreeUnits(model, u, "heading").map(function(h) {
			return {pos: h.start, remove: 1, insert: ""};
		});
	} else {
		return null;
	}
	return {text: apply(text, edits), select: selectFor(u, edits)};
};

// Swap the unit's whole subtree with the adjacent sibling of the same class (heading vs non-heading)
exports.move = function(text, model, id, dir) {
	var u = model.units[id];
	if(!u || (dir !== -1 && dir !== 1)) { return null; }
	var sibs = u.parent === -1 ? model.roots : model.units[u.parent].children,
		i = sibs.indexOf(id), n = sibs[i + dir];
	if(i < 0 || n === undefined) { return null; }
	var o = model.units[n];
	if((o.kind === "heading") !== (u.kind === "heading")) { return null; }
	if((u.kind === "heading" || u.kind === "item") && (o.kind !== u.kind || o.level !== u.level)) { return null; }
	var a = dir < 0 ? o : u, b = dir < 0 ? u : o,
		A = text.substring(a.start, a.subtreeEnd),
		sep = text.substring(a.subtreeEnd, b.start),
		B = text.substring(b.start, b.subtreeEnd);
	return {
		text: text.substring(0, a.start) + B + sep + A + text.substring(b.subtreeEnd),
		select: dir < 0 ? a.start : a.start + B.length + sep.length
	};
};

// Replace the unit's own source with newSource
exports.replace = function(text, model, id, newSource) {
	var u = model.units[id];
	if(!u) { return null; }
	return {text: utils.splice(text, u.start, u.end, newSource), select: u.start};
};

// Insert a new sibling unit (item) or first block (heading/block); null for blank source
exports.insertNew = function(text, model, id, newSource) {
	var u = model.units[id];
	if(!u || !newSource || !newSource.trim()) { return null; }
	var nl = utils.eol(text), pos, insert, select;
	if(u.kind === "item") {
		pos = u.subtreeEnd;
		insert = nl + u.marker + " " + newSource;
		select = pos + nl.length;
	} else {
		pos = u.end;
		insert = nl + nl + newSource;
		select = pos + 2 * nl.length;
		var rest = text.substring(pos);
		if(/\S/.test(rest) && !/^\r?\n[ \t]*\r?\n/.test(rest)) { insert += nl; }
	}
	return {text: utils.splice(text, pos, pos, insert), select: select};
};

/*
Delete a unit without children (blank save in the editor); null for units with children.
Items that have siblings lose their own range plus one adjacent line break. Other units (and an only
item) also lose the blank lines after them, so exactly one separator stays between the neighbours;
the last unit takes the line breaks before it instead.
*/
exports.remove = function(text, model, id) {
	var u = model.units[id];
	if(!u || u.children.length) { return null; }
	var a = u.start, b = u.end,
		after = text.substring(b),
		parent = u.parent === -1 ? null : model.units[u.parent],
		m;
	if(u.kind === "item" && parent && parent.children.length > 1) {
		m = /^\r?\n/.exec(after);
		if(m && /\S/.test(after.substring(m[0].length))) {
			b += m[0].length;
		} else {
			m = /\r?\n$/.exec(text.substring(0, a));
			a -= m ? m[0].length : 0;
		}
	} else {
		m = /^(?:[ \t]*\r?\n)*/.exec(after);
		if(/\S/.test(after.substring(m[0].length))) {
			b += m[0].length;
		} else {
			m = /(?:\r?\n[ \t]*)*$/.exec(text.substring(0, a));
			a -= m[0].length;
		}
	}
	var result = utils.splice(text, a, b, "");
	return {text: result, select: Math.min(a, result.length)};
};

// What the editor shows
exports.editSource = function(text, model, id) {
	var u = model.units[id];
	return u ? text.substring(u.start, u.end) : "";
};

// True when Enter must be a plain newline in the editor
exports.isMultiline = function(model, id) {
	var u = model.units[id];
	if(!u) { return false; }
	if(u.tag === "codeblock" || u.tag === "table" || u.kind === "widget" || u.kind === "container") { return true; }
	return /[\r\n]/.test(model.text.substring(u.start, u.end));
};
