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
	buildModel = require("$:/plugins/rimir/outline/model.js").buildModel,
	mapPosition = require("$:/plugins/rimir/outline/text-utils.js").mapPosition,
	dom = require("$:/plugins/rimir/outline/dom-utils.js"),
	blockTypes = require("$:/plugins/rimir/outline/block-types.js"),
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
	{name: "outline-extend-up", run: function(w) { return w.extendSelection(-1); }},
	{name: "outline-extend-down", run: function(w) { return w.extendSelection(1); }},
	{name: "outline-up", run: function(w) { return w.step(-1); }},
	{name: "outline-down", run: function(w) { return w.step(1); }},
	{name: "outline-up-deep", run: function(w) { return w.step(-1, true); }},
	{name: "outline-down-deep", run: function(w) { return w.step(1, true); }},
	{name: "outline-parent", run: function(w) { return w.stepTree(-1); }},
	{name: "outline-child", run: function(w) { return w.stepTree(1); }},
	// Escape: clears the selection; with nothing selected the outline goes idle
	{name: "outline-clear", run: function(w) { return w.clearSelection() || w.sleep(); }},
	{name: "outline-open", run: function(w) { return w.openTransclusion(); }},
	{name: "outline-open-story", run: function(w) { return w.openTransclusion(true); }},
	{name: "outline-edit", run: function(w) { return w.editSelected(); }},
	{name: "outline-add", run: function(w) { return w.addBelow(); }},
	{name: "outline-menu", run: function(w) { return w.openMenu(); }},
	{name: "outline-delete", run: function(w) { return w.deleteSelected(); }},
	{name: "outline-move-up", run: function(w) { return w.operate("move", -1); }},
	{name: "outline-move-down", run: function(w) { return w.operate("move", 1); }},
	{name: "outline-indent", run: function(w) { return w.operate("indent"); }},
	{name: "outline-promote", run: function(w) { return w.operate("promote"); }},
	{name: "outline-undo", run: function(w) { return w.undoStep(true); }},
	{name: "outline-redo", run: function(w) { return w.undoStep(false); }},
	{name: "outline-help", char: "?", run: function(w) { return w.toggleHelp(); }}
];

var methods = {};

// Operations that run on a range as one step per unit (operateRange)
var RANGE_STEPS = {move: true, indent: true, promote: true};

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
	this.rangeAnchor = -1;
	this.saveSelection(unit.start, id, unit.kind);
	this.showSelection(id);
	return true;
};

/*
Ranges: siblings (the selectable children of the same parent, or the roots) from the anchor (this.rangeAnchor) to the
selected unit (the moving end). A unit's subtree goes along with it. The selection tiddler keeps the anchor as
anchor-start / anchor-kind next to the selected unit's start / index / kind.
*/
methods.siblingsOf = function(id) {
	var model = this.model,
		parent = model.units[id].parent,
		self = this;
	return (parent === -1 ? model.roots : model.units[parent].children).filter(function(i) {
		return self.isSelectable(i);
	});
};

// Ids of the selected units in document order: the range, or the selected unit alone ([] without a selection)
methods.rangeIds = function() {
	var id = this.selectedId;
	if(id === -1) {
		return [];
	}
	var sibs = this.rangeAnchor === -1 || this.rangeAnchor === id ? [] : this.siblingsOf(id),
		a = sibs.indexOf(this.rangeAnchor),
		b = sibs.indexOf(id);
	if(a === -1 || b === -1) {
		return [id];
	}
	return sibs.slice(Math.min(a, b), Math.max(a, b) + 1);
};

// Select the siblings from `anchor` to `focus` (focus is the selected unit); a single unit when they are the same
methods.selectRange = function(anchor, focus) {
	if(!this.isSelectable(focus) || (anchor !== focus && this.siblingsOf(focus).indexOf(anchor) === -1)) {
		return this.select(focus);
	}
	var unit = this.units[focus].unit,
		a = this.units[anchor].unit;
	this.rangeAnchor = anchor === focus ? -1 : anchor;
	this.saveSelection(unit.start, focus, unit.kind, this.rangeAnchor === -1 ? null : {start: a.start, kind: a.kind});
	this.showSelection(focus);
	return true;
};

// Shift-Up/Down: extend (or shrink) the range by the previous / next sibling; stays at the first / last one
methods.extendSelection = function(dir) {
	this.ensureCurrent();
	var id = this.selectedId;
	if(id === -1) {
		return false;
	}
	var sibs = this.siblingsOf(id),
		next = sibs[sibs.indexOf(id) + dir];
	if(next !== undefined) {
		this.selectRange(this.rangeAnchor === -1 ? id : this.rangeAnchor, next);
		scrollIntoView(dom.firstShown(this.units[next].domNodes));
	}
	return true;
};

methods.clearSelection = function() {
	if(this.selectedId === -1) {
		return false;
	}
	// A range collapses to its moving end first
	if(this.rangeIds().length > 1) {
		return this.select(this.selectedId);
	}
	this.wiki.deleteTiddler(this.selectionTitle());
	this.showSelection(-1);
	return true;
};

methods.saveSelection = function(start, index, kind, anchor) {
	this.wiki.addTiddler(new $tw.Tiddler({
		title: this.selectionTitle(),
		start: String(start),
		index: String(index),
		kind: kind || "",
		"anchor-start": anchor ? String(anchor.start) : undefined,
		"anchor-kind": anchor ? anchor.kind || "" : undefined
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

methods.hasSelectable = function() {
	for(var i = 0; i < this.units.length; i++) {
		if(this.isSelectable(i)) {
			return true;
		}
	}
	return false;
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
	if(id === -1) {
		this.rangeAnchor = -1;
	}
	var units = this.units,
		nodes = [];
	$tw.utils.each(this.rangeIds(), function(i) {
		nodes = nodes.concat(units[i].domNodes);
	});
	this.selectedNodes = nodes;
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
	var id = this.resolveSelection(),
		state = this.wiki.getTiddler(this.selectionTitle()),
		self = this,
		anchor = -1;
	// The range's other end, when it is still a sibling of the selected unit
	if(id !== -1 && state && state.fields["anchor-start"] !== undefined) {
		anchor = findUnit(this.model, parseInt(state.fields["anchor-start"], 10), state.fields["anchor-kind"], function(i) {
			return self.isSelectable(i);
		});
		if(anchor === id || this.siblingsOf(id).indexOf(anchor) === -1) {
			anchor = -1;
		}
	}
	this.rangeAnchor = anchor;
	this.showSelection(id);
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
	scrollIntoView(dom.firstShown(this.units[i].domNodes));
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
		scrollIntoView(dom.firstShown(this.units[target].domNodes));
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

// Shift-Enter (outline-open): the tiddler the selected unit transcludes in an overlay (a diagram: its source in place);
// Ctrl-Shift-Enter (outline-open-story, inStory): in the story, in outline mode (openTarget: outline-editor.js)
methods.openTransclusion = function(inStory) {
	var id = this.selectedId,
		target = id === -1 ? null : this.transcludedTitle(id),
		tiddler = target ? this.wiki.getTiddler(target) : null;
	if(!target) {
		return false;
	}
	// A field, index or template transclusion shows part of the tiddler: it opens in the story
	if(!inStory && !this.transcludesPart(id)) {
		// An overlay over the unit (outline-overlay.js): the tiddler's own outline, a diagram's source with a preview
		if(this.openOverlay(id, target)) {
			return true;
		}
	}
	this.openTarget(target);
	return true;
};

// True when the (first) transclusion of unit `id` names a field, an index or a template ({{X!!f}}, {{X##i}},
// {{X||T}}, <$transclude $field=... / $index=...>)
methods.transcludesPart = function(id) {
	var unit = this.units[id].unit,
		source = this.model.text.substring(unit.start, unit.end),
		braces = /\{\{[^{}|]+?(!!|##|\|\|)/.exec(source),
		widget = /<\$transclude\b[^>]*?\s\$?(?:field|index)=/.exec(source);
	return !!(braces && (!widget || braces.index < widget.index)) || !!(widget && !braces);
};

// The tiddler unit `id` transcludes: a transclusion unit's target, or the first transclusion in its source; or null
methods.transcludedTitle = function(id) {
	var unit = this.units[id].unit;
	return unit.kind === "transclusion" ? unit.target : firstTransclusion(this.model.text.substring(unit.start, unit.end));
};

// Title of the first transclusion in `source` ({{title}}, {{title!!field}}, {{title||template}}, or a transclude widget
// with a literal $tiddler / tiddler attribute), or null
function firstTransclusion(source) {
	var braces = /\{\{([^{}|]+?)(?:!!|##|\|\||\}\})/.exec(source),
		widget = /<\$transclude\b[^>]*?\s\$?tiddler=(?:"([^"]*)"|'([^']*)'|\[\[([^\]]*)\]\]|([^\s\/>"']+))/.exec(source),
		first = braces && (!widget || braces.index < widget.index) ? braces : widget;
	if(!first) {
		return null;
	}
	return first === braces ? braces[1].trim() : (widget[1] || widget[2] || widget[3] || widget[4]);
}

// The data-ol-diagram-target element (a diagram transclusion, see mapDiagrams) node is in, or null
function diagramNodeOf(node, root) {
	for(; node && node !== root; node = node.parentNode) {
		if(node.getAttribute && node.getAttribute("data-ol-diagram-target")) {
			return node;
		}
	}
	return null;
}

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
		adapter = formats.getFormat(tiddler.fields.type),
		ids = this.rangeIds();
	if(!adapter || !adapter[name]) {
		return true;
	}
	if(ids.length > 1) {
		if(RANGE_STEPS[name]) {
			return this.operateRange(name, arg, ids, tiddler, adapter);
		}
		if(name === "deleteUnit" && adapter.deleteRange) {
			var removed = adapter.deleteRange(text, this.model, ids);
			if(removed && checkOp(this.wiki, this.model, ids[0], name, removed.text, this.tiddlerTitle, removed)) {
				this.rangeAnchor = -1;
				this.applyResult(removed);
			}
			return true;
		}
		// Other operations act on the range's moving end (the selected unit), like Enter and the block menu
		this.select(id);
	}
	var result = adapter[name](text, this.model, id, arg, blockTypes.getBlockTypes(this.wiki));
	// Guard: never write a result that changes units the operation must leave alone
	if(result && result.text !== text && !checkOp(this.wiki, this.model, id, name, result.text, this.tiddlerTitle, result)) {
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
/*
Externalize the selected unit or range (block menu): its text goes into a new wikitext tiddler (newTiddlerTitle
"externalize"), a reference takes its place (the adapter's externalize). One write of this tiddler (one undo step);
the new tiddler stays on undo. The reference is selected.
*/
methods.externalizeSelected = function() {
	var adapter = this.getAdapter();
	if(this.selectedId === -1 || this.isReadOnly() || this.editor || !adapter || !adapter.externalize || !this.ensureCurrent()) {
		return false;
	}
	var ids = this.rangeIds(),
		tiddler = this.wiki.getTiddler(this.tiddlerTitle),
		text = tiddler ? (tiddler.fields.text || "") : "",
		title = this.newTiddlerTitle("externalize"),
		result = tiddler ? adapter.externalize(text, this.model, ids, title) : null;
	if(!result) {
		return true;
	}
	this.wiki.addTiddler(new $tw.Tiddler(this.wiki.getCreationFields(), {title: title, type: "text/vnd.tiddlywiki",
		text: result.source}, this.wiki.getModificationFields()));
	this.rangeAnchor = -1;
	this.writeText(tiddler, result.text);
	this.saveSelection(result.select, ids[0], result.kind);
	return true;
};

/*
Move, indent or promote a range (`ids`, siblings in document order): the single-unit operation for each unit, the
first one first (the last one first for a move down), each on the model of the text before it and checked like a
single operation; the other units' starts follow each change (mapPosition). All or nothing: one write (one undo step),
the range stays selected. Always consumed.
*/
methods.operateRange = function(name, arg, ids, tiddler, adapter) {
	var wiki = this.wiki,
		title = this.tiddlerTitle,
		types = blockTypes.getBlockTypes(wiki),
		text = tiddler.fields.text || "",
		model = this.model,
		units = ids.map(function(id) { return {start: model.units[id].start, kind: model.units[id].kind}; }),
		order = units.map(function(u, i) { return i; });
	if(name === "move" && arg > 0) {
		order.reverse();
	}
	for(var k = 0; k < order.length; k++) {
		var i = order[k],
			id = findUnit(model, units[i].start, units[i].kind),
			result = id === -1 ? null : adapter[name](text, model, id, arg, types);
		if(!result || !checkOp(wiki, model, id, name, result.text, title, result)) {
			return true;
		}
		for(var j = 0; j < units.length; j++) {
			units[j].start = j === i ? result.select : mapPosition(text, result.text, units[j].start);
			if(units[j].start === -1) {
				return true;
			}
		}
		text = result.text;
		model = buildModel(wiki, text, title);
	}
	// The range must stay in its order (a heading moving over the block above it takes that block into its section,
	// and the next heading would then swap with that section): otherwise nothing is written
	for(var n = 1; n < units.length; n++) {
		if(units[n].start <= units[n - 1].start) {
			return true;
		}
	}
	var focus = ids.indexOf(this.selectedId),
		anchor = ids.indexOf(this.rangeAnchor);
	if(text !== (tiddler.fields.text || "")) {
		this.writeText(tiddler, text);
	}
	this.saveSelection(units[focus].start, this.selectedId, units[focus].kind,
		anchor === -1 ? null : {start: units[anchor].start, kind: units[anchor].kind});
	return true;
};

methods.ensureCurrent = function() {
	var tiddler = this.wiki.getTiddler(this.tiddlerTitle),
		text = tiddler ? (tiddler.fields.text || "") : "";
	if(tiddler && text === this.model.text) {
		return true;
	}
	this.rebuild();
	return !!tiddler && text === this.lastWritten && this.model.text === text && this.selectedId !== -1;
};

// Write `text` to the tiddler (one change, one undo step: outline-undo.js) and remember it as this view's own last write
methods.writeText = function(tiddler, text) {
	this.recordWrite(tiddler ? (tiddler.fields.text || "") : "", text);
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
	// Idle, consumed elsewhere (AutoComplete popups listen in the capture phase), or from an element inside
	if(!this.awake || event.defaultPrevented || event.target !== this.domNode) {
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

// True when `node` is in a link or button (below the outline): its click and double-click are its own
function inControl(node, root) {
	for(var m = node; m && m !== root; m = m.parentNode) {
		if(m.tagName && /^(A|BUTTON)$/i.test(m.tagName)) {
			return true;
		}
	}
	return false;
}

/*
Idle: only Ctrl-Click (Cmd-Click) on the outline does something, outside links and buttons: it wakes the outline and
selects the clicked unit. Awake: click on a transclusion marker opens its target. Click on a stamped element selects
its unit and focuses the container. Clicks inside the editor host are left to the editor.
*/
methods.handleClick = function(event) {
	var node = event.target;
	// Clicks inside this outline's overlay belong to the overlay's own outline; a click outside it closes it (not with
	// changes in it)
	if(this.inOverlay(node)) {
		return;
	}
	if(this.overlay) {
		this.closeOverlay();
	}
	if(!this.awake) {
		if(!(event.ctrlKey || event.metaKey) || inControl(node, this.domNode)) {
			return;
		}
		event.preventDefault();
		this.wake();
		var woken = this.unitIdAt(node);
		if(woken !== -1) {
			this.select(woken);
		}
		focus(this.domNode);
		return;
	}
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
	var id = this.unitIdAt(node);
	// Shift-Click: the range from the anchor (or the selected unit) to the clicked sibling
	if(id !== -1 && event.shiftKey && this.selectedId !== -1) {
		event.preventDefault();
		// The browser extended its text selection on mousedown; it would take over Ctrl-C / Ctrl-X
		var view = this.document.defaultView;
		if(view && view.getSelection) {
			view.getSelection().removeAllRanges();
		}
		if(this.selectRange(this.rangeAnchor === -1 ? this.selectedId : this.rangeAnchor, id)) {
			focus(this.domNode);
		}
		return;
	}
	if(id !== -1 && this.select(id) && !isEditable(event.target)) {
		focus(this.domNode);
	}
};

// Id of the unit whose stamped element contains `node` (the innermost), or -1
methods.unitIdAt = function(node) {
	for(; node && node !== this.domNode; node = node.parentNode) {
		if(node.getAttribute && node.getAttribute("data-ol-id") !== null && node.getAttribute("data-ol-id") !== undefined) {
			return parseInt(node.getAttribute("data-ol-id"), 10);
		}
	}
	return -1;
};

/*
Double-click on a unit edits it (a transclusion: its line, not the target); while another unit is edited, that one is
saved first. Not inside the editor, not on links, buttons or inputs; the word the double-click selected is deselected.
*/
methods.handleDblClick = function(event) {
	var node = event.target;
	if(!this.awake || this.inOverlay(node) || (this.editor && this.editor.host && isInside(node, this.editor.host))) {
		return;
	}
	if(isEditable(node) || inControl(node, this.domNode)) {
		return;
	}
	var id = this.unitIdAt(node),
		view = this.document.defaultView;
	if(id === -1) {
		return;
	}
	event.preventDefault();
	// A diagram inside the unit: its own editor (an open editor is saved first)
	var diagram = diagramNodeOf(node, this.domNode);
	if(diagram) {
		if(!this.editor || this.saveEdit()) {
			this.select(id);
			this.openOverlay(id, diagram.getAttribute("data-ol-diagram-target"));
		}
		return;
	}
	// The word the double-click selected goes first (clearing it later would reset the editor's caret)
	if(view && view.getSelection) {
		view.getSelection().removeAllRanges();
	}
	if(this.editor && this.editor.id !== id) {
		this.editOther(id);
	} else if(this.select(id)) {
		this.startEdit(id);
	}
};

exports.SELECTION_PREFIX = SELECTION_PREFIX;

exports.install = function(proto) {
	$tw.utils.each(methods, function(fn, name) {
		proto[name] = fn;
	});
};
