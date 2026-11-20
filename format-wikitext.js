/*\
title: $:/plugins/rimir/outline/format-wikitext.js
type: application/javascript
module-type: outline-format

Wikitext adapter: indent and promote. Functions take (text, model, id) and return null or {text, select}.

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
