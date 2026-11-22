/*\
title: $:/plugins/rimir/outline/model.js
type: application/javascript
module-type: library

Builds the outline unit model of a wikitext text from TiddlyWiki's parse tree.

buildModel(wiki, text, title) -> {text, units, roots}
Each unit: {id, kind, start, end, subtreeEnd, level, marker, parent, children, tag, target}.
`title` (optional) is the tiddler the text belongs to: a transclusion of it is a widget, not a transclusion.

\*/
"use strict";

// Pragma rules: their nodes wrap the rest of the tree and are never units
var PRAGMA_RULES = {
	macrodef: true, procedure: true, fnprocdef: true, "function": true, import: true,
	importvariables: true, whitespace: true, rules: true, parameters: true, set: true
};
var LIST_TAGS = {ul: true, ol: true, dl: true, blockquote: true};
var ITEM_TAGS = {li: true, dt: true, dd: true, div: true};
var HEADING_RE = /^h([1-6])$/;
var MARKER_CHARS = "*#;:>";

function literal(node, name) {
	var attr = node.attributes && node.attributes[name];
	return attr && attr.type === "string" ? attr.value : null;
}

exports.buildModel = function(wiki, text, title) {
	text = text || "";
	var units = [], roots = [];

	// Own range end without trailing line breaks (some rules include the newline)
	function trimEnd(start, end) {
		end = Math.min(end, text.length);
		while(end > start && (text.charAt(end - 1) === "\n" || text.charAt(end - 1) === "\r")) {
			end--;
		}
		return end;
	}

	function addUnit(node, kind, parent, extra) {
		var start = node.start,
			end = trimEnd(start, node.end),
			unit = {
				id: units.length,
				kind: kind,
				start: start,
				end: end,
				subtreeEnd: end,
				level: 0,
				marker: "",
				parent: parent,
				children: [],
				tag: node.type === "element" ? node.tag : node.type,
				target: null
			};
		$tw.utils.extend(unit, extra || {});
		units.push(unit);
		if(parent === -1) {
			roots.push(unit.id);
		} else {
			units[parent].children.push(unit.id);
		}
		return unit;
	}

	// Widen subtreeEnd of a unit and its ancestors
	function extend(unit, end) {
		while(unit && unit.subtreeEnd < end) {
			unit.subtreeEnd = end;
			unit = unit.parent === -1 ? null : units[unit.parent];
		}
	}

	function hasPosition(node) {
		return typeof node.start === "number" && typeof node.end === "number";
	}

	// Items of a list node (ul/ol/dl/blockquote), as children of `parent`
	function walkItems(listNode, parent) {
		$tw.utils.each(listNode.children || [], function(itemNode) {
			if(itemNode.type !== "element" || !ITEM_TAGS[itemNode.tag] || !hasPosition(itemNode)) {
				return;
			}
			var children = itemNode.children || [],
				first = children[0];
			// Skipped levels ("* a\n*** c") produce a synthetic item that only holds the deeper list
			// and starts where it starts: it is not a unit, its items go to `parent`
			if(first && first.type === "element" && LIST_TAGS[first.tag] && first.start === itemNode.start) {
				$tw.utils.each(children, function(child) {
					if(isNestedList(child)) {
						walkItems(child, parent);
					}
				});
				return;
			}
			var pos = itemNode.start;
			while(pos < text.length && MARKER_CHARS.indexOf(text.charAt(pos)) !== -1) {
				pos++;
			}
			var marker = text.substring(itemNode.start, pos),
				item = addUnit(itemNode, "item", parent, {level: marker.length, marker: marker});
			extend(units[parent], item.end);
			$tw.utils.each(children, function(child) {
				if(isNestedList(child)) {
					walkItems(child, item.id);
				}
			});
		});
	}

	function isNestedList(node) {
		return node.type === "element" && LIST_TAGS[node.tag] && node.rule === undefined;
	}

	// Block-level nodes of one container (root or opened HTML element).
	// `ctx` = {parent: container unit id or -1, headings: stack of open heading units}
	function walkBlocks(nodes, ctx) {
		$tw.utils.each(nodes || [], function(node) {
			walkBlock(node, ctx);
		});
	}

	function currentParent(ctx) {
		return ctx.headings.length ? ctx.headings[ctx.headings.length - 1].id : ctx.parent;
	}

	function walkBlock(node, ctx) {
		if(node.rule && PRAGMA_RULES[node.rule]) {
			walkBlocks(node.children, ctx);
			return;
		}
		if(!hasPosition(node)) {
			// Unpositioned wrapper: step through
			if(node.type !== "text") {
				walkBlocks(node.children, ctx);
			}
			return;
		}
		if(node.type === "text") {
			return;
		}
		if(node.rule === "commentblock") {
			// Comments render nothing. At the top of the text (pragma position) they wrap the rest
			walkBlocks(node.children, ctx);
			return;
		}
		var unit, m;
		if(node.type === "element" && (m = HEADING_RE.exec(node.tag)) && node.rule === "heading") {
			var level = parseInt(m[1], 10);
			while(ctx.headings.length && ctx.headings[ctx.headings.length - 1].level >= level) {
				ctx.headings.pop();
			}
			unit = addUnit(node, "heading", currentParent(ctx), {level: level});
			ctx.headings.push(unit);
			extendParent(unit);
			return;
		}
		var parent = currentParent(ctx);
		if(node.type === "element" && node.rule === "list" && LIST_TAGS[node.tag]) {
			unit = addUnit(node, "list", parent);
			extendParent(unit);
			walkItems(node, unit.id);
			// The list node ends at its last top-level item, without that item's nested items:
			// the list's own range is its full extent
			unit.end = unit.subtreeEnd;
			extendParent(unit);
			return;
		}
		if(node.type === "element" && node.isBlock && node.rule === "html") {
			unit = addUnit(node, "container", parent);
			var before = units.length;
			walkBlocks(node.children, {parent: unit.id, headings: []});
			if(units.length === before) {
				unit.kind = "block";
			}
			extendParent(unit);
			return;
		}
		if(node.type === "element" || node.type === "codeblock" || node.type === "void") {
			if(node.rule === "typedblock") {
				// The typedblock rule starts the node after its "$$$type" header line
				var lineStart = text.lastIndexOf("\n", node.start - 2) + 1;
				if(text.substr(lineStart, 3) === "$$$") {
					node = $tw.utils.extend({}, node, {start: lineStart});
				}
			}
			unit = addUnit(node, "block", parent);
			extendParent(unit);
			return;
		}
		var target = null;
		if(node.type === "tiddler" && node.rule === "transcludeblock") {
			target = literal(node, "tiddler");
		} else if(node.type === "transclude" && !(node.attributes && node.attributes.$variable)) {
			target = literal(node, "$tiddler");
			if(target === null && !(node.attributes && node.attributes.$tiddler)) {
				target = literal(node, "tiddler");
			}
		}
		if(target && target !== title) {
			unit = addUnit(node, "transclusion", parent, {target: target});
		} else {
			unit = addUnit(node, "widget", parent);
		}
		extendParent(unit);
	}

	function extendParent(unit) {
		if(unit.parent !== -1) {
			extend(units[unit.parent], unit.subtreeEnd);
		}
	}

	var tree = wiki.parseText("text/vnd.tiddlywiki", text).tree;
	walkBlocks(tree, {parent: -1, headings: []});
	return {text: text, units: units, roots: roots};
};

/*
Id of the unit that starts at `start`, preferring `kind` (a list and its first item share a start);
-1 if none. accept(id) optionally restricts the candidates (e.g. to units with DOM nodes).
*/
exports.findUnit = function(model, start, kind, accept) {
	var match = -1;
	for(var i = 0; i < model.units.length; i++) {
		var u = model.units[i];
		if(u.start === start && (!accept || accept(u.id))) {
			if(!kind || u.kind === kind) {
				return u.id;
			}
			if(match === -1) {
				match = u.id;
			}
		}
	}
	return match;
};

/*
Post-operation guard: true when `newText` has the units a structural operation `name` on unit `id` of model
`before` must leave. Moves keep the unit count and the kinds and levels (as a multiset: the order changes).
Indent/promote keep the unit count and order; the units of the operated subtree (of the unit's kind) change
their level by exactly +1/-1, all others keep it. Delete, merge and split remove exactly the units
result.removed (ids) and add exactly result.added ({kind, level}), keeping all others with their kinds and levels
(`result`: the adapter's result). Anything else is refused by the caller (no write).
*/
exports.checkOp = function(wiki, before, id, name, newText, title, result) {
	// The adapter's convert checks its own result (a conversion changes kinds and the unit count)
	if(name === "convert") {
		return true;
	}
	var after = exports.buildModel(wiki, newText, title),
		u = before.units[id];
	function signature(units) {
		return units.map(function(x) { return x.kind + ":" + x.level; }).sort().join(",");
	}
	if(name === "deleteUnit" || name === "merge" || name === "split") {
		var removed = (result && result.removed) || [],
			added = (result && result.added) || [];
		return !!u && !!result && (removed.length || added.length) > 0 && signature(after.units) ===
			signature(before.units.filter(function(x) { return removed.indexOf(x.id) === -1; }).concat(added));
	}
	if(!u || after.units.length !== before.units.length) {
		return false;
	}
	if(name === "move") {
		return signature(after.units) === signature(before.units);
	}

	if(name !== "indent" && name !== "promote") {
		return false;
	}
	var delta = name === "indent" ? 1 : -1;
	for(var i = 0; i < before.units.length; i++) {
		var a = before.units[i], b = after.units[i],
			affected = a.kind === u.kind && a.start >= u.start && a.start < u.subtreeEnd;
		if(a.kind !== b.kind || b.level !== a.level + (affected ? delta : 0)) {
			return false;
		}
	}
	return true;
};
