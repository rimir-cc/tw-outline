/*\
title: $:/plugins/rimir/outline/outline-editor.js
type: application/javascript
module-type: library

In-place editor of the $outline widget. install(proto) adds these methods to the widget prototype:
  startEdit(id, {isNew})       - open the editor for unit `id` (isNew: for a new unit after unit `id`)
  saveEdit({continue})         - write the edit once; continue: open a new unit after the saved one
  cancelEdit()                 - discard the edit
  insertNewline()              - insert a line break at the caret through the engine
  reattachEditor()             - after a re-render: put the host next to the relocated unit
  handleEditorKeydown(event)   - keys while editing (events from inside the host)
  openTarget(title)            - open a transcluded tiddler in outline mode

this.editor = {host, widget, id, isNew, kind, unitKind, hostTag, origSource, origStart, origText, multiline, conflict, caret, hidden}
  host       - <li> (items) or <div>, class rr-ol-editor-host. Not part of the body's widget tree, so a
               re-render of the body does not destroy it.
  widget     - the editor widget tree ($:/plugins/rimir/outline/ui/editor), parent: the outline widget
  id         - unit id in the current mapping (the edited unit, or the anchor of a new unit)
  origSource - source of the unit (anchor) when the edit started; used to relocate it after outside changes
  origText   - tiddler text when the edit started

Typing only changes the buffer $:/temp/rimir/outline/edit/<title>. The tiddler is written once on save.

\*/
"use strict";

var formats = require("$:/plugins/rimir/outline/formats.js"),
	utils = require("$:/plugins/rimir/outline/text-utils.js"),
	buildModel = require("$:/plugins/rimir/outline/model.js").buildModel;

var BUFFER_PREFIX = "$:/temp/rimir/outline/edit/",
	STATE_PREFIX = "$:/state/rimir/outline/on/",
	EDITOR_TIDDLER = "$:/plugins/rimir/outline/ui/editor",
	HOST_CLASS = "rr-ol-editor-host",
	EDITING_CLASS = "rr-ol-editing",
	CONFLICT_CLASS = "rr-ol-conflict",
	CONFLICT_TEXT = "The tiddler changed underneath. Copy your text.";

var methods = {};

methods.bufferTitle = function() {
	return BUFFER_PREFIX + this.tiddlerTitle;
};

/*
Open the editor. Existing unit: the host goes before the unit's first DOM node and the unit is hidden.
New unit (opts.isNew): the host goes after the last DOM node of anchor unit `id`; nothing is written
until it is saved. Returns false when nothing was opened.
*/
methods.startEdit = function(id, opts) {
	opts = opts || {};
	if(this.editor) {
		this.focusEditor();
		return false;
	}
	if(this.isReadOnly() || !this.isSelectable(id) || !this.getAdapter()) {
		return false;
	}
	if(this.wiki.getTiddlerText(this.tiddlerTitle, "") !== this.model.text) {
		// An outside change has not been rendered yet: positions are stale
		this.rebuild();
		return false;
	}
	var unit = this.units[id].unit,
		isNew = !!opts.isNew,
		source = isNew ? "" : this.getAdapter().editSource(this.model.text, this.model, id);
	this.editor = {
		host: null,
		widget: null,
		id: id,
		isNew: isNew,
		kind: isNew ? (unit.kind === "item" ? "item" : "block") : unit.kind,
		unitKind: unit.kind,
		hostTag: unit.kind === "item" ? "li" : "div",
		origSource: this.model.text.substring(unit.start, unit.end),
		origStart: unit.start,
		origText: this.model.text,
		multiline: !isNew && this.getAdapter().isMultiline(this.model, id),
		caret: null
	};
	this.wiki.addTiddler(new $tw.Tiddler({
		title: this.bufferTitle(),
		text: source,
		type: "text/vnd.tiddlywiki"
	}));
	this.placeEditor();
	return true;
};

// Create host + editor widget at the position of this.editor.id (or at the end of the container)
methods.placeEditor = function() {
	var ed = this.editor,
		entry = ed.id === -1 ? null : this.units[ed.id],
		nodes = entry ? entry.domNodes : [],
		host = this.document.createElement(ed.hostTag);
	host.className = HOST_CLASS;
	if(!nodes.length) {
		this.domNode.appendChild(host);
	} else if(ed.isNew) {
		var last = nodes[nodes.length - 1];
		last.parentNode.insertBefore(host, nextSiblingOf(last));
	} else {
		nodes[0].parentNode.insertBefore(host, nodes[0]);
	}
	var self = this;
	host.addEventListener("keydown", function(event) { self.handleEditorKeydown(event); }, false);
	ed.host = host;
	this.hideEdited();
	// The host is in the document now: the FramedEngine needs that to create its iframe
	ed.widget = this.wiki.makeTranscludeWidget(EDITOR_TIDDLER, {
		parentWidget: this,
		document: this.document,
		variables: {
			"outline-edit-tiddler": this.bufferTitle(),
			"len": String(this.wiki.getTiddlerText(this.bufferTitle(), "").length)
		}
	});
	ed.widget.render(host, null);
	if(ed.conflict) {
		this.showConflict();
	}
};

// Hide the edited unit's DOM nodes (not for new units)
methods.hideEdited = function() {
	var ed = this.editor;
	this.unhideEdited();
	ed.hidden = ed.isNew || ed.id === -1 ? [] : this.units[ed.id].domNodes.slice();
	$tw.utils.each(ed.hidden, function(node) {
		setClass(node, EDITING_CLASS, true);
	});
};

methods.unhideEdited = function() {
	var ed = this.editor;
	$tw.utils.each(ed && ed.hidden || [], function(node) {
		setClass(node, EDITING_CLASS, false);
	});
	if(ed) {
		ed.hidden = [];
	}
};

// Remove host and editor widget; the buffer stays
methods.closeEditor = function() {
	var ed = this.editor;
	if(!ed) {
		return;
	}
	this.unhideEdited();
	this.removeHost();
	this.editor = null;
};

methods.removeHost = function() {
	var ed = this.editor;
	if(ed.widget) {
		ed.widget.destroy({removeDOMNodes: false});
		ed.widget = null;
	}
	if(ed.host && ed.host.parentNode) {
		ed.host.parentNode.removeChild(ed.host);
	}
	ed.host = null;
};

methods.cancelEdit = function() {
	if(!this.editor) {
		return false;
	}
	this.closeEditor();
	this.wiki.deleteTiddler(this.bufferTitle());
	focus(this.domNode);
	return true;
};

/*
Save: splice the buffer into the unit's range (or insert the new unit) and write the tiddler once.
If the text changed since the edit started, the unit is located again by its original source. If that
fails, the editor stays open with a conflict notice and the buffer is kept. Returns true when saved.
*/
methods.saveEdit = function(opts) {
	opts = opts || {};
	var ed = this.editor;
	if(!ed) {
		return false;
	}
	var tiddler = this.wiki.getTiddler(this.tiddlerTitle),
		current = tiddler ? (tiddler.fields.text || "") : "",
		adapter = this.getAdapter(),
		newSource = this.wiki.getTiddlerText(this.bufferTitle(), "");
	if(!tiddler || !adapter) {
		this.showConflict();
		return false;
	}
	var target = this.locateEditUnit(current);
	if(!target) {
		this.showConflict();
		return false;
	}
	newSource = newSource.replace(/\r?\n/g, utils.eol(current));
	var result;
	if(ed.isNew) {
		result = adapter.insertNew(current, target.model, target.id, newSource);
	} else {
		result = adapter.replace(current, target.model, target.id, newSource);
	}
	var kind = ed.kind,
		index = ed.isNew ? target.id + 1 : target.id,
		blankNew = ed.isNew && !result;
	this.closeEditor();
	this.wiki.deleteTiddler(this.bufferTitle());
	focus(this.domNode);
	if(blankNew) {
		// Nothing typed into a new unit: nothing to write, the chain ends here
		return true;
	}
	var written = result.text !== current;
	if(written) {
		this.wiki.addTiddler(new $tw.Tiddler(tiddler, {text: result.text}, this.wiki.getModificationFields()));
	}
	this.saveSelection(result.select, index, kind);
	if(opts["continue"]) {
		this.pendingContinue = {start: result.select, kind: kind};
		if(!written) {
			this.runPendingContinue();
		}
	} else if(!written) {
		this.restoreSelection();
	}
	return true;
};

/*
{model, id} of the edited unit (or anchor) in `text`, or null when it cannot be located safely.
Unchanged text: the original unit. Otherwise: the unit whose start is the only occurrence of the
original source.
*/
methods.locateEditUnit = function(text) {
	var ed = this.editor,
		pos = text === ed.origText ? ed.origStart : utils.relocate(text, ed.origSource);
	if(pos === -1) {
		return null;
	}
	var model = this.model && this.model.text === text ? this.model : buildModel(this.wiki, text, this.tiddlerTitle),
		id = findUnit(model, pos, ed.unitKind);
	return id === -1 ? null : {model: model, id: id};
};

// After a re-render: open the new unit requested by saveEdit({continue: true})
methods.runPendingContinue = function() {
	var pending = this.pendingContinue;
	this.pendingContinue = null;
	if(!pending || this.editor) {
		return;
	}
	var id = findUnit(this.model, pending.start, pending.kind);
	if(id !== -1) {
		this.startEdit(id, {isNew: true});
	}
};

/*
After the body was (re-)mapped: put the host next to the relocated unit again. When the host is
still in place it is left alone (moving an iframe reloads it). Otherwise the editor widget is created
again from the buffer, so typed text is kept, and gets the focus and caret back.
*/
methods.reattachEditor = function() {
	var ed = this.editor;
	if(!ed) {
		this.runPendingContinue();
		return;
	}
	var target = this.locateEditUnit(this.model.text);
	ed.id = target && this.isSelectable(target.id) ? target.id : -1;
	if(this.hostInPlace()) {
		this.hideEdited();
		return;
	}
	if(ed.id === -1 && ed.host && isInside(ed.host, this.domNode)) {
		// Unit not found (the save will report the conflict): leave the editor where it is
		this.unhideEdited();
		return;
	}
	var engine = this.editorEngine();
	ed.caret = null;
	if(engine && engine.domNode && typeof engine.domNode.selectionStart === "number") {
		ed.caret = [engine.domNode.selectionStart, engine.domNode.selectionEnd];
	}
	this.unhideEdited();
	this.removeHost();
	this.placeEditor();
	this.focusEditor();
};

// True when the host is attached inside the container at the place the unit asks for
methods.hostInPlace = function() {
	var ed = this.editor;
	if(!ed.host || !isInside(ed.host, this.domNode)) {
		return false;
	}
	if(ed.id === -1) {
		return false;
	}
	var nodes = this.units[ed.id].domNodes;
	if(ed.isNew) {
		return nextSiblingOf(nodes[nodes.length - 1]) === ed.host;
	}
	return nextSiblingOf(ed.host) === nodes[0];
};

methods.editorEngine = function() {
	var found = null;
	function walk(widget) {
		if(found || !widget) {
			return;
		}
		if(widget.engine) {
			found = widget.engine;
			return;
		}
		$tw.utils.each(widget.children, walk);
	}
	walk(this.editor && this.editor.widget);
	return found;
};

methods.focusEditor = function() {
	var engine = this.editorEngine();
	if(engine && engine.focus && $tw.browser) {
		engine.focus();
		var caret = this.editor.caret,
			len = (engine.domNode && engine.domNode.value || "").length;
		if(caret && engine.domNode && engine.domNode.setSelectionRange) {
			engine.domNode.setSelectionRange(Math.min(caret[0], len), Math.min(caret[1], len));
		}
	}
};

methods.showConflict = function() {
	var ed = this.editor;
	ed.conflict = true;
	if(!ed.host) {
		return;
	}
	var children = ed.host.childNodes || [];
	for(var i = 0; i < children.length; i++) {
		if(children[i].className === CONFLICT_CLASS) {
			return;
		}
	}
	var note = this.document.createElement("div");
	note.className = CONFLICT_CLASS;
	note.appendChild(this.document.createTextNode(CONFLICT_TEXT));
	ed.host.insertBefore(note, ed.host.firstChild || null);
};

// Insert a line break at the caret through the engine (keeps undo, height and the buffer in sync)
methods.insertNewline = function() {
	var engine = this.editorEngine();
	if(!engine || !engine.widget || !engine.widget.handleEditTextOperationMessage) {
		return;
	}
	engine.widget.handleEditTextOperationMessage({
		type: "tm-edit-text-operation",
		param: "insert-text",
		paramObject: {text: "\n"}
	});
};

/*
Keys while editing. Events already handled elsewhere (AutoComplete popup) are ignored.
Multi-line units (code blocks, tables, widgets, multi-line items) get native Enter and Shift-Enter.
*/
methods.handleEditorKeydown = function(event) {
	var ed = this.editor;
	if(!ed || event.defaultPrevented) {
		return;
	}
	if(this.keyMatches(event, "outline-save")) {
		this.saveEdit();
	} else if(!ed.multiline && this.keyMatches(event, "outline-continue")) {
		this.saveEdit({"continue": true});
	} else if(!ed.multiline && this.keyMatches(event, "outline-newline")) {
		this.insertNewline();
	} else if(this.keyMatches(event, "outline-cancel")) {
		this.cancelEdit();
	} else {
		return;
	}
	event.preventDefault();
	event.stopPropagation();
};

// Select-mode Shift-Enter
methods.editSelected = function() {
	if(this.selectedId === -1) {
		return false;
	}
	this.startEdit(this.selectedId);
	return true;
};

// Set outline mode on for `title` and open it in the story
methods.openTarget = function(title) {
	if(!title) {
		return false;
	}
	this.wiki.addTiddler(new $tw.Tiddler({title: STATE_PREFIX + title, text: "yes"}));
	this.dispatchEvent({
		type: "tm-navigate",
		navigateTo: title,
		navigateFromTitle: this.tiddlerTitle,
		navigateFromNode: this
	});
	return true;
};

methods.getAdapter = function() {
	var tiddler = this.wiki.getTiddler(this.tiddlerTitle);
	return formats.getFormat(tiddler ? tiddler.fields.type : "");
};

/* ---------- helpers ---------- */

// Unit id with this start, same kind preferred; -1 if none
function findUnit(model, start, kind) {
	var match = -1;
	for(var i = 0; i < model.units.length; i++) {
		var u = model.units[i];
		if(u.start === start) {
			if(!kind || u.kind === kind) {
				return i;
			}
			if(match === -1) {
				match = i;
			}
		}
	}
	return match;
}

// nextSibling for the browser DOM and TW's fake DOM (which has none)
function nextSiblingOf(node) {
	if(node.nextSibling !== undefined) {
		return node.nextSibling;
	}
	var siblings = node.parentNode ? node.parentNode.childNodes : [],
		i = siblings.indexOf(node);
	return i === -1 ? null : (siblings[i + 1] || null);
}

// True when `node` is attached below `ancestor` (fake DOM: removeChild keeps parentNode, so check membership)
function isInside(node, ancestor) {
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
}

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

function focus(node) {
	if(node && node.focus) {
		node.focus({preventScroll: true});
	}
}

exports.isInside = isInside;

exports.install = function(proto) {
	$tw.utils.each(methods, function(fn, name) {
		proto[name] = fn;
	});
};
