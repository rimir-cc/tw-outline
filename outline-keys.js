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
be selected. A list item with sub-items is framed around its own lines only (drawSelectionBox).

Key overview: toggleHelp sets/deletes $:/temp/rimir/outline/help/<title>; ui/body shows ui/keys-table while it is
"yes". Escape closes it before it clears the selection.

\*/
"use strict";

var formats = require("$:/plugins/rimir/outline/formats.js"),
	findUnit = require("$:/plugins/rimir/outline/model.js").findUnit,
	checkOp = require("$:/plugins/rimir/outline/model.js").checkOp,
	dom = require("$:/plugins/rimir/outline/dom-utils.js"),
	setClass = dom.setClass,
	focus = dom.focus,
	isInside = dom.isInside,
	isEditable = dom.isEditable,
	scrollIntoView = dom.scrollIntoView;

var SELECTION_PREFIX = "$:/temp/rimir/outline/selection/",
	HELP_PREFIX = "$:/temp/rimir/outline/help/",
	READ_ONLY = "$:/status/IsReadOnly",
	SELECTED_CLASS = "rr-ol-selected",
	OWN_CLASS = "rr-ol-selected-own",
	BOX_CLASS = "rr-ol-selbox",
	NESTED_TAGS = {UL: true, OL: true, DL: true, BLOCKQUOTE: true};

/*
Select-mode actions in matching order. run returns true when the key is consumed. Structural keys
(operate) are consumed whenever a unit is selected, even when nothing changes or the wiki is read-only,
so Tab never moves the focus away from a selection. In read-only wikis only up/down/clear/open act.
`char` is a typed character that also triggers the action, whatever the keyboard layout ("?" is shift-slash only
on US layouts).
*/
var ACTIONS = [
	{name: "outline-up", run: function(w) { return w.step(-1); }},
	{name: "outline-down", run: function(w) { return w.step(1); }},
	{name: "outline-up-deep", run: function(w) { return w.step(-1, true); }},
	{name: "outline-down-deep", run: function(w) { return w.step(1, true); }},
	{name: "outline-parent", run: function(w) { return w.stepTree(-1); }},
	{name: "outline-child", run: function(w) { return w.stepTree(1); }},
	{name: "outline-clear", run: function(w) { return w.clearSelection(); }},
	{name: "outline-open", run: function(w) { return w.openTransclusion(); }},
	{name: "outline-edit", run: function(w) { return w.editSelected(); }},
	{name: "outline-menu", run: function(w) { return w.openMenu(); }},
	{name: "outline-move-up", run: function(w) { return w.operate("move", -1); }},
	{name: "outline-move-down", run: function(w) { return w.operate("move", 1); }},
	{name: "outline-indent", run: function(w) { return w.operate("indent"); }},
	{name: "outline-promote", run: function(w) { return w.operate("promote"); }},
	{name: "outline-help", char: "?", run: function(w) { return w.toggleHelp(); }}
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
	var id = findUnit(this.model, parseInt(state.fields.start, 10), state.fields.kind, function(i) {
		return self.isSelectable(i);
	});
	if(id !== -1) {
		return id;
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
	if(this.menu) {
		if(this.menu.id !== id) {
			this.closeMenu();
		} else {
			this.positionMenu();
		}
	}
	this.selectedNodes = id === -1 ? [] : this.units[id].domNodes.slice();
	$tw.utils.each(this.selectedNodes, function(node) {
		setClass(node, SELECTED_CLASS, true);
	});
	this.drawSelectionBox();
};

// First child element of a list item that holds its sub-items, or null
function nestedListOf(node) {
	for(var child = node.firstChild; child; child = child.nextSibling) {
		if(child.nodeType === 1 && NESTED_TAGS[child.tagName]) {
			return child;
		}
	}
	return null;
}

/*
A selected list item with sub-items gets its frame from an overlay box around its own lines only (the item's
element contains its sub-items). Moves still take the sub-items along. Called after every selection change and
when the outline container resizes. Needs a real DOM (ranges, layout); elsewhere the item keeps its plain frame.
*/
methods.drawSelectionBox = function() {
	var nodes = this.selectedNodes || [],
		doc = this.document,
		box = this.selectionBox,
		target = null,
		nested = null;
	$tw.utils.each(nodes, function(node) {
		setClass(node, OWN_CLASS, false);
	});
	if(this.selectedId !== -1 && this.units[this.selectedId].unit.kind === "item" && nodes.length === 1 &&
		doc.createRange && nodes[0].getBoundingClientRect && this.domNode.getBoundingClientRect) {
		nested = nestedListOf(nodes[0]);
		target = nested ? nodes[0] : null;
	}
	if(!target) {
		if(box) {
			box.style.display = "none";
		}
		return;
	}
	var range = doc.createRange();
	range.setStart(target, 0);
	range.setEndBefore(nested);
	var own = range.getBoundingClientRect(),
		item = target.getBoundingClientRect(),
		root = this.domNode.getBoundingClientRect(),
		top = own.height ? own.top : item.top,
		bottom = own.height ? own.bottom : nested.getBoundingClientRect().top;
	if(!box) {
		box = this.selectionBox = doc.createElement("div");
		box.className = BOX_CLASS;
	}
	if(box.parentNode !== this.domNode) {
		this.domNode.appendChild(box);
	}
	box.style.display = "";
	box.style.left = (item.left - root.left) + "px";
	box.style.top = (top - root.top) + "px";
	box.style.width = item.width + "px";
	box.style.height = Math.max(0, bottom - top) + "px";
	setClass(target, OWN_CLASS, true);
};

// Re-apply the saved selection after (re-)mapping
methods.restoreSelection = function() {
	this.showSelection(this.resolveSelection());
};

// Select the previous (-1) or next (1) selectable unit. Without a selection: the first or last one.
/*
Up/Down. `deep` (Ctrl-Up/Down): every unit in document order. Otherwise a whole list counts as one block: Down from a
selected list goes to the unit after it, and Up into a list from below selects the whole list (see outerList).
*/
methods.step = function(dir, deep) {
	// Positions of an unrendered change are stale: remap first (selecting writes nothing)
	this.ensureCurrent();
	var id = this.selectedId, i;
	if(id === -1) {
		i = dir > 0 ? this.nearestSelectable(0) : this.lastSelectable();
	} else {
		var skipEnd = !deep && dir > 0 && this.units[id].unit.kind === "list" ? this.units[id].unit.subtreeEnd : -1;
		for(i = id + dir; i >= 0 && i < this.units.length &&
			(!this.isSelectable(i) || this.units[i].unit.start < skipEnd); i += dir) {}
		if(i < 0 || i >= this.units.length) {
			i = id;
		} else if(!deep && dir < 0) {
			i = this.outerList(i, id);
		}
	}
	if(i === -1) {
		return false;
	}
	this.select(i);
	scrollIntoView(this.units[i].domNodes[0]);
	return true;
};

/*
Left (dir -1): select the parent unit - the item a sub-item belongs to, the whole list of a top-level item, the
heading of a section.
Right (1): select the first child: the list of a heading's section, the first item of a list, the first sub-item.
Units that cannot be selected are passed over. Consumed whenever a unit is selected, also when there is nowhere to go.
*/
methods.stepTree = function(dir) {
	this.ensureCurrent();
	var id = this.selectedId;
	if(id === -1) {
		return false;
	}
	var target = dir < 0 ? this.treeParent(id) : this.treeChild(id);
	if(target !== -1) {
		this.select(target);
		scrollIntoView(this.units[target].domNodes[0]);
	}
	return true;
};

methods.treeParent = function(id) {
	var model = this.model;
	for(var p = model.units[id].parent; p !== -1; p = model.units[p].parent) {
		if(this.isSelectable(p)) {
			return p;
		}
	}
	return -1;
};

methods.treeChild = function(id) {
	var model = this.model, self = this;
	// The first selectable child; a child that cannot be selected stands in for its own first child
	function first(children) {
		for(var i = 0; i < children.length; i++) {
			var c = model.units[children[i]],
				found = self.isSelectable(c.id) ? c.id : first(c.children);
			if(found !== -1) {
				return found;
			}
		}
		return -1;
	}
	return first(model.units[id].children);
};

// The outermost selectable list around unit `i` that does not contain unit `from`; else `i`
methods.outerList = function(i, from) {
	var model = this.model,
		start = model.units[from].start,
		result = i;
	for(var p = model.units[i].parent; p !== -1; p = model.units[p].parent) {
		var u = model.units[p];
		if(u.kind === "list" && !(start >= u.start && start < u.subtreeEnd) && this.isSelectable(p)) {
			result = p;
		}
	}
	return result;
};

methods.lastSelectable = function() {
	for(var i = this.units.length - 1; i >= 0; i--) {
		if(this.isSelectable(i)) { return i; }
	}
	return -1;
};

/* ---------- operations ---------- */

// Enter on a transclusion unit: open the transcluded tiddler in outline mode (openTarget: outline-editor.js)
methods.openTransclusion = function() {
	var id = this.selectedId;
	if(id === -1 || this.units[id].unit.kind !== "transclusion") {
		return false;
	}
	this.openTarget(this.units[id].unit.target);
	return true;
};

/*
Run adapter operation `name` on the selected unit. Returns true when a unit is selected (the key is
consumed), whether or not the text changed. A result that fails the model guard (checkOp) is not written.
*/
methods.operate = function(name, arg) {
	var id = this.selectedId;
	if(id === -1) {
		return false;
	}
	// Read-only, or an open editor in this view (a move could rewrite the edited unit): consumed, no write
	if(this.isReadOnly() || this.editor) {
		return true;
	}
	if(!this.ensureCurrent()) {
		return true;
	}
	id = this.selectedId;
	var tiddler = this.wiki.getTiddler(this.tiddlerTitle),
		text = tiddler.fields.text || "",
		adapter = formats.getFormat(tiddler.fields.type);
	if(!adapter || !adapter[name]) {
		return true;
	}
	var result = adapter[name](text, this.model, id, arg);
	// Guard: never write a result that changes units the operation must leave alone
	if(result && result.text !== text && !checkOp(this.wiki, this.model, id, name, result.text, this.tiddlerTitle)) {
		return true;
	}
	this.applyResult(result);
	return true;
};

/*
True when the positions of this.model fit the tiddler's current text (the tiddler exists). When the text changed
and that change has not been rendered yet, the body is rebuilt first. If the change is this view's own last write
(a key pressed before the refresh after a write), the rebuilt mapping and the restored selection are valid and
the result is true; after any other change it is false (positions are not trusted for a write: do nothing).
*/
methods.ensureCurrent = function() {
	var tiddler = this.wiki.getTiddler(this.tiddlerTitle),
		text = tiddler ? (tiddler.fields.text || "") : "";
	if(tiddler && text === this.model.text) {
		return true;
	}
	this.rebuild();
	return !!tiddler && text === this.lastWritten && this.model.text === text && this.selectedId !== -1;
};

// Write `text` to the tiddler (one change) and remember it as this view's own last write
methods.writeText = function(tiddler, text) {
	this.lastWritten = text;
	this.wiki.addTiddler(new $tw.Tiddler(tiddler, {text: text}, this.wiki.getModificationFields()));
};

/*
Write the adapter result {text, select} to the tiddler (once) and save the selection at the new start.
null (no-op) writes nothing; a result whose text equals the current text only saves the selection.
*/
methods.applyResult = function(result) {
	if(!result) {
		return false;
	}
	var old = this.wiki.getTiddler(this.tiddlerTitle),
		id = this.selectedId,
		// A conversion changes the unit's kind: the result names the new one
		kind = result.kind || (id === -1 ? "" : this.units[id].unit.kind);
	// Same text (e.g. two identical siblings swapped): no write, but the frame still follows result.select
	if(!old || result.text !== (old.fields.text || "")) {
		this.writeText(old, result.text);
	}
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
	// An open block menu takes its keys; any other key closes it and acts as usual
	if(this.menu) {
		if(this.handleMenuKeydown(event)) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		this.closeMenu();
	}
	// An open key overview closes with Escape before Escape clears the selection
	if(event.keyCode === 27 && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && this.isHelpOpen()) {
		this.toggleHelp(false);
		event.preventDefault();
		event.stopPropagation();
		return;
	}
	for(var i = 0; i < ACTIONS.length; i++) {
		var action = ACTIONS[i];
		if((this.keyMatches(event, action.name) || typedChar(event, action.char)) && action.run(this)) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
	}
};

function typedChar(event, ch) {
	return !!ch && event.key === ch && !event.ctrlKey && !event.altKey && !event.metaKey;
}

/* ---------- key overview ---------- */

// The overview (ui/keys-table) is shown by the body template while this temp tiddler is "yes"
methods.helpTitle = function() {
	return HELP_PREFIX + this.tiddlerTitle;
};

methods.isHelpOpen = function() {
	return this.wiki.getTiddlerText(this.helpTitle()) === "yes";
};

// Open, close (open = true/false) or toggle the key overview. Always consumes the key.
methods.toggleHelp = function(open) {
	if(open === undefined) {
		open = !this.isHelpOpen();
	}
	if(open) {
		this.wiki.setText(this.helpTitle(), "text", null, "yes");
	} else if(this.wiki.tiddlerExists(this.helpTitle())) {
		this.wiki.deleteTiddler(this.helpTitle());
	}
	return true;
};

methods.keyMatches = function(event, name) {
	var km = $tw.keyboardManager;
	return !!km && km.checkKeyDescriptors(event, km.parseKeyDescriptors("((" + name + "))", {wiki: this.wiki}));
};

/*
Click on a transclusion marker opens its target. Click on a stamped element selects its unit and focuses
the container. Clicks inside the editor host are left to the editor.
*/
methods.handleClick = function(event) {
	var node = event.target;
	this.closeMenu();
	if(this.editor && this.editor.host && isInside(node, this.editor.host)) {
		return;
	}
	for(var m = node; m && m !== this.domNode; m = m.parentNode) {
		if(m.getAttribute && m.getAttribute("data-ol-target")) {
			event.preventDefault();
			event.stopPropagation();
			this.openTarget(m.getAttribute("data-ol-target"));
			return;
		}
	}
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

exports.install = function(proto) {
	$tw.utils.each(methods, function(fn, name) {
		proto[name] = fn;
	});
};
