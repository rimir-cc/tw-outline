/*\
title: $:/plugins/rimir/outline/dom-utils.js
type: application/javascript
module-type: library

DOM helpers shared by outline-keys.js and outline-editor.js. They work on the browser DOM and on
TW's fake DOM (no nextSibling/contains there; removeChild keeps parentNode).

\*/
"use strict";

exports.setClass = function(node, cls, on) {
	var list = (node.className || "").split(" ").filter(function(c) { return c && c !== cls; });
	if(on) {
		list.push(cls);
	}
	if(list.length) {
		node.className = list.join(" ");
	} else if(node.removeAttribute) {
		node.removeAttribute("class");
	}
};

exports.focus = function(node) {
	if(node && node.focus) {
		node.focus({preventScroll: true});
	}
};

exports.scrollIntoView = function(node) {
	if(node && node.scrollIntoView) {
		node.scrollIntoView({block: "nearest"});
	}
};

// True for input/textarea/select and contenteditable elements and their descendants
exports.isEditable = function(node) {
	for(; node && node.nodeType === 1; node = node.parentNode) {
		var tag = (node.tagName || "").toLowerCase();
		if(tag === "input" || tag === "textarea" || tag === "select" || node.isContentEditable) {
			return true;
		}
	}
	return false;
};

exports.nextSiblingOf = function(node) {
	if(node.nextSibling !== undefined) {
		return node.nextSibling;
	}
	var siblings = node.parentNode ? node.parentNode.childNodes : [],
		i = siblings.indexOf(node);
	return i === -1 ? null : (siblings[i + 1] || null);
};

exports.firstChildOf = function(node) {
	return node.firstChild || null;
};

// True when `node` is attached below (or is) `ancestor`
exports.isInside = function(node, ancestor) {
	if(!node || !ancestor) {
		return false;
	}
	if(ancestor.contains) {
		return ancestor.contains(node);
	}
	while(node && node !== ancestor) {
		var parent = node.parentNode;
		if(!parent || parent.childNodes.indexOf(node) === -1) {
			return false;
		}
		node = parent;
	}
	return node === ancestor;
};

function tagOf(node) {
	return node ? String(node.tagName || node.tag || "").toLowerCase() : "";
}

var LIST_TYPES = {ul: "bullet-list", ol: "numbered-list", dl: "definitions", blockquote: "quote"},
	ITEM_TYPES = {ul: "bullet", ol: "numbered", blockquote: "quote"},
	BLOCK_TYPES = {p: "paragraph", pre: "code-block", table: "table", blockquote: "quote", hr: "rule"},
	// Types of the block menu (format-wikitext BLOCK_TYPES) as badge types
	NEW_BLOCK_TYPES = {paragraph: "paragraph", heading1: "h1", heading2: "h2", heading3: "h3",
		bulleted: "bullet", numbered: "numbered", quote: "quote", code: "code-block"};

/*
Badge type of a unit (kind) from its first DOM node: paragraph, h1-h6, code-block, table, quote, rule, bullet,
numbered, term, definition, bullet-list, numbered-list, definitions, transclusion, widget, or the tag name.
Shown by CSS (attr(data-ol-type)) when badges are on.
*/
exports.unitType = function(kind, node) {
	var tag = tagOf(node);
	switch(kind) {
		case "heading": return /^h[1-6]$/.test(tag) ? tag : "heading";
		case "item": return tag === "dt" ? "term" : tag === "dd" ? "definition" : ITEM_TYPES[tagOf(node.parentNode)] || "item";
		case "list": return LIST_TYPES[tag] || "list";
		case "block": return BLOCK_TYPES[tag] || tag || "block";
		case "transclusion": return "transclusion";
		case "widget": return "widget";
		default: return tag || kind;
	}
};

exports.newBlockType = function(blockType) {
	return NEW_BLOCK_TYPES[blockType] || "";
};
