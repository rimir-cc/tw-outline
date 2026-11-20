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
