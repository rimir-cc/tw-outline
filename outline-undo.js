/*\
title: $:/plugins/rimir/outline/outline-undo.js
type: application/javascript
module-type: library

Undo and redo of the outline's own writes. install(proto) adds these methods to the widget prototype.

Every text write of the outline (writeText: operations, edits, deletes, merges, splits) records {before, after, sel}:
the text before and after it and the selection before it. The history of a tiddler lives in the temp tiddler
$:/temp/rimir/outline/undo/<title> (JSON {undo: [...], redo: [...]}) for the running session only. It keeps the last
$:/config/rimir/outline/undo-depth steps (default 20). A new write empties the redo list.

Undo writes `before` back, redo writes `after` again, each only while the tiddler still has the text the step left
(after resp. before). Any other text means it changed outside the outline: the history no longer fits and is
dropped, nothing is written.

undoGroup(fn) runs fn so that all its writes form one step (a split saves the edited item and then adds the new one).

\*/
"use strict";

var UNDO_PREFIX = "$:/temp/rimir/outline/undo/",
	DEPTH = "$:/config/rimir/outline/undo-depth",
	DEFAULT_DEPTH = 20;

var methods = {};

methods.undoTitle = function() {
	return UNDO_PREFIX + this.tiddlerTitle;
};

methods.readUndo = function() {
	var state = null;
	try {
		state = JSON.parse(this.wiki.getTiddlerText(this.undoTitle(), "null"));
	} catch(e) {
		state = null;
	}
	if(!state || !$tw.utils.isArray(state.undo) || !$tw.utils.isArray(state.redo)) {
		state = {undo: [], redo: []};
	}
	return state;
};

methods.writeUndo = function(state) {
	this.wiki.addTiddler(new $tw.Tiddler({
		title: this.undoTitle(),
		type: "application/json",
		text: JSON.stringify(state)
	}));
};

// The saved selection {start, index, kind}, or null
methods.selectionSnapshot = function() {
	var state = this.wiki.getTiddler(this.selectionTitle());
	return state ? {start: state.fields.start, index: state.fields.index, kind: state.fields.kind || ""} : null;
};

methods.applySnapshot = function(sel) {
	if(sel) {
		this.saveSelection(sel.start, sel.index, sel.kind);
	} else if(this.wiki.tiddlerExists(this.selectionTitle())) {
		this.wiki.deleteTiddler(this.selectionTitle());
	}
};

// Record a write of the outline (called by writeText before the write)
methods.recordWrite = function(before, after) {
	if(before === after) {
		return;
	}
	var state = this.readUndo(),
		top = state.undo[state.undo.length - 1],
		group = this.undoGroupState;
	if(group && group.started && top && top.after === before) {
		top.after = after;
	} else {
		state.undo.push({before: before, after: after, sel: this.selectionSnapshot()});
		var depth = parseInt(this.wiki.getTiddlerText(DEPTH, ""), 10);
		depth = isNaN(depth) || depth < 1 ? DEFAULT_DEPTH : depth;
		if(state.undo.length > depth) {
			state.undo.splice(0, state.undo.length - depth);
		}
	}
	if(group) {
		group.started = true;
	}
	state.redo = [];
	this.writeUndo(state);
};

// Run fn with all its writes recorded as one step; returns fn's result
methods.undoGroup = function(fn) {
	var outer = this.undoGroupState;
	if(!outer) {
		this.undoGroupState = {started: false};
	}
	try {
		return fn.call(this);
	} finally {
		if(!outer) {
			this.undoGroupState = null;
		}
	}
};

// True when undo (back = true) or redo has a step that fits the tiddler's current text
methods.undoAvailable = function(back) {
	var tiddler = this.wiki.getTiddler(this.tiddlerTitle),
		state = this.readUndo(),
		from = back ? state.undo : state.redo,
		entry = from[from.length - 1];
	return !!tiddler && !!entry && (tiddler.fields.text || "") === (back ? entry.after : entry.before);
};

/*
Undo (back = true) or redo the last step. Always consumes the key. Nothing happens in read-only wikis, while this view
has an open editor, or when there is no step.
*/
methods.undoStep = function(back) {
	if(this.isReadOnly() || this.editor) {
		return true;
	}
	var tiddler = this.wiki.getTiddler(this.tiddlerTitle),
		state = this.readUndo(),
		from = back ? state.undo : state.redo,
		entry = from[from.length - 1];
	if(!tiddler || !entry) {
		return true;
	}
	if((tiddler.fields.text || "") !== (back ? entry.after : entry.before)) {
		// Changed outside the outline since: the history no longer fits
		this.wiki.deleteTiddler(this.undoTitle());
		return true;
	}
	from.pop();
	var sel = this.selectionSnapshot();
	if(back) {
		entry.redoSel = sel;
		state.redo.push(entry);
	} else {
		entry.sel = sel;
		state.undo.push(entry);
	}
	this.writeUndo(state);
	var text = back ? entry.before : entry.after;
	this.lastWritten = text;
	this.wiki.addTiddler(new $tw.Tiddler(tiddler, {text: text}, this.wiki.getModificationFields()));
	this.applySnapshot(back ? entry.sel : (entry.redoSel || entry.sel));
	return true;
};

exports.install = function(proto) {
	$tw.utils.each(methods, function(fn, name) {
		proto[name] = fn;
	});
};
