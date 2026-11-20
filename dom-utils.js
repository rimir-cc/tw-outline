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
