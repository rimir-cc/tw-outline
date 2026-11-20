/*\
title: $:/plugins/rimir/outline/outline-keys.js
type: application/javascript
module-type: library

Selection, configurable keys and structural operations of the $outline widget.
install(proto) adds these methods to the widget prototype. They use widget.model, widget.units,
widget.domNode and widget.tiddlerTitle (see outline-widget.js).

Selection state: $:/temp/rimir/outline/selection/<title> with fields start, index and kind.
After a re-render the unit with the saved start is selected again (same kind preferred, because a list
and its first item share a start). Otherwise the saved index, clamped. Units without DOM nodes cannot
be selected.

\*/
"use strict";

var formats = require("$:/plugins/rimir/outline/formats.js");

var SELECTION_PREFIX = "$:/temp/rimir/outline/selection/",
	READ_ONLY = "$:/status/IsReadOnly",
	SELECTED_CLASS = "rr-ol-selected";

/*
Select-mode actions in matching order. run returns true when the key is consumed. Structural keys
(operate) are consumed whenever a unit is selected, even when nothing changes or the wiki is read-only,
so Tab never moves the focus away from a selection. In read-only wikis only up/down/clear/open act.
*/
var ACTIONS = [
	{name: "outline-up", run: function(w) { return w.step(-1); }},
	{name: "outline-down", run: function(w) { return w.step(1); }},
	{name: "outline-clear", run: function(w) { return w.clearSelection(); }},
	{name: "outline-open", run: function(w) { return w.openTransclusion(); }},
	{name: "outline-move-up", run: function(w) { return w.operate("move", -1); }},
	{name: "outline-move-down", run: function(w) { return w.operate("move", 1); }},
	{name: "outline-indent", run: function(w) { return w.operate("indent"); }},
	{name: "outline-promote", run: function(w) { return w.operate("promote"); }}
];

var methods = {};

/* ---------- selection ---------- */

methods.selectionTitle = function() {
	return SELECTION_PREFIX + this.tiddlerTitle;
};

methods.isSelectable = function(id) {
	var entry = this.units[id];
	return !!entry && entry.domNodes.length > 0;
};

// Select unit `id` and save the selection. Returns false for units that cannot be selected.
methods.select = function(id) {
	if(!this.isSelectable(id)) {
		return false;
	}
	var unit = this.units[id].unit;
	this.saveSelection(unit.start, id, unit.kind);
	this.showSelection(id);
	return true;
};

methods.clearSelection = function() {
	if(this.selectedId === -1) {
		return false;
	}
	this.wiki.deleteTiddler(this.selectionTitle());
	this.showSelection(-1);
	return true;
};

methods.saveSelection = function(start, index, kind) {
	this.wiki.addTiddler(new $tw.Tiddler({
		title: this.selectionTitle(),
		start: String(start),
		index: String(index),
		kind: kind || ""
	}));
};

// Unit id for the saved selection in the current mapping, or -1
methods.resolveSelection = function() {
	var state = this.wiki.getTiddler(this.selectionTitle()),
		self = this;
	if(!state || !this.units.length) {
		return -1;
	}
	var start = parseInt(state.fields.start, 10),
		kind = state.fields.kind,
		matches = this.units.filter(function(entry) {
			return entry.unit.start === start && self.isSelectable(entry.unit.id);
		}),
		sameKind = matches.filter(function(entry) { return entry.unit.kind === kind; });
	if(sameKind.length || matches.length) {
		return (sameKind[0] || matches[0]).unit.id;
	}
	var index = parseInt(state.fields.index, 10);
	if(isNaN(index)) {
		return -1;
	}
	index = Math.max(0, Math.min(index, this.units.length - 1));
	return this.nearestSelectable(index);
};

// `index` itself if selectable, else the next selectable unit after it, else the one before it
methods.nearestSelectable = function(index) {
	var i;
	for(i = index; i < this.units.length; i++) {
		if(this.isSelectable(i)) { return i; }
	}
	for(i = index - 1; i >= 0; i--) {
		if(this.isSelectable(i)) { return i; }
	}
	return -1;
};

// Move the selection frame to unit `id` (-1: none) without touching the state tiddler
methods.showSelection = function(id) {
	$tw.utils.each(this.selectedNodes || [], function(node) {
		setClass(node, SELECTED_CLASS, false);
	});
	this.selectedId = id;
	this.selectedNodes = id === -1 ? [] : this.units[id].domNodes.slice();
	$tw.utils.each(this.selectedNodes, function(node) {
		setClass(node, SELECTED_CLASS, true);
	});
};

// Re-apply the saved selection after (re-)mapping
methods.restoreSelection = function() {
	this.showSelection(this.resolveSelection());
};

// Select the previous (-1) or next (1) selectable unit. Without a selection: the first or last one.
methods.step = function(dir) {
	var id = this.selectedId, i;
	if(id === -1) {
		i = dir > 0 ? this.nearestSelectable(0) : this.lastSelectable();
	} else {
		for(i = id + dir; i >= 0 && i < this.units.length && !this.isSelectable(i); i += dir) {}
		if(i < 0 || i >= this.units.length) {
			i = id;
		}
	}
	if(i === -1) {
		return false;
	}
	this.select(i);
	scrollIntoView(this.units[i].domNodes[0]);
	return true;
};

methods.lastSelectable = function() {
	for(var i = this.units.length - 1; i >= 0; i--) {
		if(this.isSelectable(i)) { return i; }
	}
	return -1;
};

/* ---------- operations ---------- */

// Stub until the transclusion jump is implemented: consumes Enter on transclusion units only
methods.openTransclusion = function() {
	var id = this.selectedId;
	return id !== -1 && this.units[id].unit.kind === "transclusion";
};

/*
Run adapter operation `name` on the selected unit. Returns true when a unit is selected (the key is
consumed), whether or not the text changed.
*/
methods.operate = function(name, arg) {
	var id = this.selectedId;
	if(id === -1) {
		return false;
	}
	if(this.isReadOnly()) {
		return true;
	}
	var tiddler = this.wiki.getTiddler(this.tiddlerTitle),
		text = tiddler ? (tiddler.fields.text || "") : "";
	if(!tiddler || text !== this.model.text) {
		// An outside change has not been rendered yet: positions are stale
		this.rebuild();
		return true;
	}
	var adapter = formats.getFormat(tiddler.fields.type);
	if(!adapter || !adapter[name]) {
		return true;
	}
	this.applyResult(adapter[name](text, this.model, id, arg));
	return true;
};

/*
Write the adapter result {text, select} to the tiddler (once) and save the selection at the new start.
null (no-op) writes nothing.
*/
methods.applyResult = function(result) {
	if(!result) {
		return false;
	}
	var old = this.wiki.getTiddler(this.tiddlerTitle),
		id = this.selectedId,
		kind = id === -1 ? "" : this.units[id].unit.kind;
	this.wiki.addTiddler(new $tw.Tiddler(old, {text: result.text}, this.wiki.getModificationFields()));
	this.saveSelection(result.select, id === -1 ? 0 : id, kind);
	return true;
};

methods.isReadOnly = function() {
	return this.wiki.getTiddlerText(READ_ONLY) === "yes";
};

/* ---------- events ---------- */

methods.handleKeydown = function(event) {
	// Consumed elsewhere (AutoComplete popups listen in the capture phase), or from an element inside
	if(event.defaultPrevented || event.target !== this.domNode) {
		return;
	}
	for(var i = 0; i < ACTIONS.length; i++) {
		var action = ACTIONS[i];
		if(this.keyMatches(event, action.name) && action.run(this)) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
	}
};

methods.keyMatches = function(event, name) {
	var km = $tw.keyboardManager;
	return !!km && km.checkKeyDescriptors(event, km.parseKeyDescriptors("((" + name + "))", {wiki: this.wiki}));
};

// Click on a stamped element selects its unit and focuses the container
methods.handleClick = function(event) {
	var node = event.target;
	while(node && node !== this.domNode) {
		if(node.getAttribute && node.getAttribute("data-ol-id") !== null && node.getAttribute("data-ol-id") !== undefined) {
			if(this.select(parseInt(node.getAttribute("data-ol-id"), 10)) && !isEditable(event.target)) {
				focus(this.domNode);
			}
			return;
		}
		node = node.parentNode;
	}
};

/* ---------- helpers ---------- */

function setClass(node, cls, on) {
	var list = (node.className || "").split(" ").filter(function(c) { return c && c !== cls; });
	if(on) {
		list.push(cls);
	}
	if(list.length) {
		node.className = list.join(" ");
	} else if(node.removeAttribute) {
		node.removeAttribute("class");
	}
}

function isEditable(node) {
	for(; node && node.nodeType === 1; node = node.parentNode) {
		var tag = (node.tagName || "").toLowerCase();
		if(tag === "input" || tag === "textarea" || tag === "select" || node.isContentEditable) {
			return true;
		}
	}
	return false;
}

function focus(node) {
	if(node.focus) {
		node.focus({preventScroll: true});
	}
}

function scrollIntoView(node) {
	if(node && node.scrollIntoView) {
		node.scrollIntoView({block: "nearest"});
	}
}

exports.install = function(proto) {
	$tw.utils.each(methods, function(fn, name) {
		proto[name] = fn;
	});
};
