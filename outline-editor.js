/*\
title: $:/plugins/rimir/outline/outline-editor.js
type: application/javascript
module-type: library

In-place editor of the $outline widget. install(proto) adds these methods to the widget prototype:
  startEdit(id, {isNew})       - open the editor for unit `id` (isNew: for a new unit after unit `id`)
  saveEdit({continue})         - write the edit once; continue: open a new unit after the saved one
  cancelEdit()                 - discard the edit
  insertNewline()              - insert a line break at the caret through the engine
  reattachEditor()             - after a re-render: put the host next to the relocated unit, or reopen a kept edit
  releaseEditor()              - on destroy: close the editor, keep a changed buffer for the next widget
  handleEditorKeydown(event)   - keys while editing (events from inside the host)
  openTarget(title)            - open a transcluded tiddler in outline mode

this.editor = {host, widget, id, isNew, kind, unitKind, placement, origSource, origStart, origText, multiline,
               notice, caret, focused, hidden}
  host       - <div> (or <li> for a new item), class rr-ol-editor-host. Not part of the body's widget tree, so
               a re-render of the body does not destroy it.
  placement  - "inside": first child of the edited item's element (its sub-items stay visible);
               "before": before the edited unit's first DOM node; "after": after the anchor of a new unit
  widget     - the editor widget tree ($:/plugins/rimir/outline/ui/editor), parent: the outline widget
  id         - unit id in the current mapping (the edited unit, or the anchor of a new unit), -1: not found
  origSource - own source of the unit (anchor) when the edit started; relocates it after outside changes
  origText   - tiddler text when the edit started

Buffer: $:/temp/rimir/outline/edit/<title>, one per tiddler. Typing only changes the buffer; the tiddler is
written once on save. When the same tiddler is shown twice, the view that opened the editor owns the buffer
(module registry `owners`): other views cannot open a second editor and never touch the buffer.
The buffer also carries what is needed to reopen the edit: fields outline-orig-source, outline-orig-start,
outline-orig-text, outline-is-new (yes/no) and outline-unit-kind (for a new unit: those of its anchor).

Kept edits: when the widget is destroyed (an ancestor re-rendered, the tiddler was closed) and the buffer differs
from what the editor started with, the buffer is kept, not discarded. The next $outline widget of that tiddler
that maps its units and finds such a buffer without a live owner reopens the editor at the unit (located as on
save: unchanged text -> the same unit, otherwise the one unit with the same own source and kind); if the unit is
gone it opens with the conflict notice, so the text stays visible. Escape and the toolbar toggle-off discard it.

\*/
"use strict";

var formats = require("$:/plugins/rimir/outline/formats.js"),
	utils = require("$:/plugins/rimir/outline/text-utils.js"),
	model = require("$:/plugins/rimir/outline/model.js"),
	dom = require("$:/plugins/rimir/outline/dom-utils.js");

var BUFFER_PREFIX = "$:/temp/rimir/outline/edit/",
	STATE_PREFIX = "$:/state/rimir/outline/on/",
	EDITOR_TIDDLER = "$:/plugins/rimir/outline/ui/editor",
	HOST_CLASS = "rr-ol-editor-host",
	// Edited unit hidden (blocks) / only its own content hidden (items: sub-items stay visible)
	EDITING_CLASS = "rr-ol-editing",
	EDITING_OWN_CLASS = "rr-ol-editing-own",
	NOTICES = {
		conflict: {cls: "rr-ol-notice rr-ol-conflict", text: "The tiddler changed underneath. Copy your text."},
		children: {cls: "rr-ol-notice rr-ol-children", text: "Remove or move its children first."},
		readonly: {cls: "rr-ol-notice rr-ol-readonly", text: "The wiki is read-only."}
	};

// Per wiki: buffer title -> outline widget that owns the open editor for it
var registries = new WeakMap(),
	// Per wiki: buffer title -> {focused, caret} of an editor whose widget was destroyed with a kept buffer
	restoreHints = new WeakMap();

function registryOf(map, wiki) {
	var registry = map.get(wiki);
	if(!registry) {
		registry = Object.create(null);
		map.set(wiki, registry);
	}
	return registry;
}

function ownersOf(wiki) {
	return registryOf(registries, wiki);
}

// Editor state for unit kind `unitKind` (for a new unit: the anchor's kind); id and multiline are set by the caller
function editorState(unitKind, isNew, origSource, origStart, origText) {
	return {
		host: null,
		widget: null,
		id: -1,
		isNew: isNew,
		kind: isNew ? (unitKind === "item" ? "item" : "block") : unitKind,
		unitKind: unitKind,
		placement: isNew ? "after" : (unitKind === "item" ? "inside" : "before"),
		origSource: origSource,
		origStart: origStart,
		origText: origText,
		multiline: false,
		notice: null,
		caret: null,
		focused: false,
		hidden: []
	};
}

var methods = {};

methods.bufferTitle = function() {
	return BUFFER_PREFIX + this.tiddlerTitle;
};

methods.ownsBuffer = function() {
	return ownersOf(this.wiki)[this.bufferTitle()] === this;
};

// The other view that has a live editor for this tiddler, or null
methods.otherOwner = function() {
	var owner = ownersOf(this.wiki)[this.bufferTitle()];
	if(!owner || owner === this || !owner.editor || owner.domNode.isConnected === false) {
		return null;
	}
	return owner;
};

/*
Open the editor. Nothing is written until it is saved. Returns false when nothing was opened (also when
another view of the same tiddler has an open editor: that one gets the focus instead).
*/
methods.startEdit = function(id, opts) {
	opts = opts || {};
	if(this.editor) {
		this.focusEditor();
		return false;
	}
	var owner = this.otherOwner();
	if(owner) {
		owner.focusEditor();
		return false;
	}
	if(this.isReadOnly() || !this.getAdapter()) {
		return false;
	}
	if(this.wiki.getTiddlerText(this.tiddlerTitle, "") !== this.model.text) {
		// A change has not been rendered yet: positions are stale. After this view's own write the selection is
		// restored from the saved one, so an edit of the selected unit can go on; otherwise do nothing
		var fromSelection = id === this.selectedId;
		if(!this.ensureCurrent() || !fromSelection) {
			return false;
		}
		id = this.selectedId;
	}
	if(!this.isSelectable(id)) {
		return false;
	}
	var unit = this.units[id].unit,
		isNew = !!opts.isNew,
		adapter = this.getAdapter(),
		ed = editorState(unit.kind, isNew, this.model.text.substring(unit.start, unit.end), unit.start, this.model.text);
	ed.id = id;
	ed.multiline = !isNew && adapter.isMultiline(this.model, id);
	this.editor = ed;
	ownersOf(this.wiki)[this.bufferTitle()] = this;
	this.wiki.addTiddler(new $tw.Tiddler({
		title: this.bufferTitle(),
		text: isNew ? "" : adapter.editSource(this.model.text, this.model, id),
		type: "text/vnd.tiddlywiki",
		"outline-orig-source": ed.origSource,
		"outline-orig-start": String(ed.origStart),
		"outline-orig-text": ed.origText,
		"outline-is-new": isNew ? "yes" : "no",
		"outline-unit-kind": ed.unitKind
	}));
	this.placeEditor(true);
	return true;
};

/*
Reopen a kept edit (see "Kept edits" above). Returns true when an editor was opened. Not while another live view
owns the editor, in read-only wikis, or for tiddlers without an adapter.
*/
methods.restoreEditor = function() {
	var title = this.bufferTitle(),
		buffer = this.wiki.getTiddler(title);
	if(this.editor || !buffer || buffer.fields["outline-orig-start"] === undefined || this.otherOwner() ||
		this.isReadOnly() || !this.getAdapter()) {
		return false;
	}
	var f = buffer.fields,
		hints = registryOf(restoreHints, this.wiki),
		hint = hints[title] || {},
		ed = editorState(f["outline-unit-kind"] || "", f["outline-is-new"] === "yes", f["outline-orig-source"] || "",
			parseInt(f["outline-orig-start"], 10), f["outline-orig-text"] || "");
	delete hints[title];
	this.editor = ed;
	ownersOf(this.wiki)[title] = this;
	var target = this.locateEditUnit(this.model.text);
	ed.id = target && this.isSelectable(target.id) ? target.id : -1;
	if(ed.id === -1) {
		ed.notice = "conflict";
	}
	ed.multiline = !ed.isNew && (ed.id === -1 ? /[\r\n]/.test(ed.origSource) : this.getAdapter().isMultiline(this.model, ed.id));
	ed.caret = hint.caret || null;
	this.placeEditor(!!hint.focused);
	if(hint.focused) {
		this.focusEditor();
	}
	return true;
};

// True when the buffer differs from what the editor started with (new unit: anything typed)
methods.editChanged = function() {
	var ed = this.editor,
		text = this.wiki.getTiddlerText(this.bufferTitle());
	if(!ed || text === undefined) {
		return false;
	}
	return ed.isNew ? /\S/.test(text) : text !== ed.origSource;
};

/*
The widget goes away (ancestor re-render, tiddler closed, outline mode off): close the editor. A changed buffer
is kept for the next widget of this tiddler (restoreEditor), with the focus and caret; otherwise it is discarded.
*/
methods.releaseEditor = function() {
	if(!this.editor) {
		return;
	}
	var keep = this.ownsBuffer() && this.editChanged();
	if(keep) {
		var engine = this.editorEngine(),
			caret = engine && engine.domNode && typeof engine.domNode.selectionStart === "number" ?
				[engine.domNode.selectionStart, engine.domNode.selectionEnd] : null;
		registryOf(restoreHints, this.wiki)[this.bufferTitle()] = {focused: this.editor.focused, caret: caret};
	}
	this.closeEditor(!keep);
};

// Create host + editor widget at the place of this.editor.id (or at the end of the container).
// focus: whether the new editor takes the focus when it renders
methods.placeEditor = function(focus) {
	var ed = this.editor,
		nodes = ed.id === -1 ? [] : this.units[ed.id].domNodes,
		host = this.document.createElement(ed.placement === "after" && ed.unitKind === "item" && nodes.length ? "li" : "div"),
		self = this;
	host.className = HOST_CLASS;
	if(!nodes.length) {
		this.domNode.appendChild(host);
	} else if(ed.placement === "after") {
		var last = nodes[nodes.length - 1];
		last.parentNode.insertBefore(host, dom.nextSiblingOf(last));
	} else if(ed.placement === "inside") {
		nodes[0].insertBefore(host, nodes[0].firstChild || null);
	} else {
		nodes[0].parentNode.insertBefore(host, nodes[0]);
	}
	host.addEventListener("keydown", function(event) { self.handleEditorKeydown(event); }, false);
	host.addEventListener("focusin", function() { if(self.editor) { self.editor.focused = true; } }, false);
	host.addEventListener("focusout", function() { if(self.editor) { self.editor.focused = false; } }, false);
	ed.host = host;
	this.hideEdited();
	// The host is in the document now: the FramedEngine needs that to create its iframe
	ed.widget = this.wiki.makeTranscludeWidget(EDITOR_TIDDLER, {
		parentWidget: this,
		document: this.document,
		variables: {
			"outline-edit-tiddler": this.bufferTitle(),
			"len": String(this.wiki.getTiddlerText(this.bufferTitle(), "").length),
			"outline-edit-focus": focus ? "yes" : "no"
		}
	});
	ed.widget.render(host, null);
	this.trackEngineFocus();
	if(ed.notice) {
		this.showNotice(ed.notice);
	}
};

// The FramedEngine's textarea lives in an iframe: its focus events do not reach the host
methods.trackEngineFocus = function() {
	var ed = this.editor,
		engine = this.editorEngine(),
		self = this;
	if(!engine || !engine.domNode || !engine.domNode.addEventListener) {
		return;
	}
	engine.domNode.addEventListener("focus", function() { if(self.editor === ed) { ed.focused = true; } }, false);
	engine.domNode.addEventListener("blur", function() { if(self.editor === ed) { ed.focused = false; } }, false);
	var active = this.document.activeElement;
	ed.focused = !!active && (active === engine.domNode || active === engine.iframeNode);
};

methods.hideEdited = function() {
	var ed = this.editor;
	this.unhideEdited();
	if(ed.placement === "after" || ed.id === -1) {
		return;
	}
	var cls = ed.placement === "inside" ? EDITING_OWN_CLASS : EDITING_CLASS;
	ed.hidden = this.units[ed.id].domNodes.slice();
	$tw.utils.each(ed.hidden, function(node) {
		dom.setClass(node, cls, true);
	});
};

methods.unhideEdited = function() {
	var ed = this.editor;
	$tw.utils.each(ed && ed.hidden || [], function(node) {
		dom.setClass(node, EDITING_CLASS, false);
		dom.setClass(node, EDITING_OWN_CLASS, false);
	});
	if(ed) {
		ed.hidden = [];
	}
};

// Remove host and editor widget; release the buffer, and delete it when `discard`
methods.closeEditor = function(discard) {
	if(!this.editor) {
		return;
	}
	this.unhideEdited();
	this.removeHost();
	this.editor = null;
	if(this.ownsBuffer()) {
		delete ownersOf(this.wiki)[this.bufferTitle()];
		if(discard) {
			this.wiki.deleteTiddler(this.bufferTitle());
		}
	}
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
	this.closeEditor(true);
	dom.focus(this.domNode);
	return true;
};

/*
Save: splice the buffer into the unit's range (or insert the new unit) and write the tiddler once.
Blank text: a new unit writes nothing; an existing unit without children is deleted, one with children is
refused with a notice. If the unit cannot be located safely after an outside change, the editor stays
open with a conflict notice and the buffer is kept. Returns true when the editor was closed.
*/
methods.saveEdit = function(opts) {
	opts = opts || {};
	var ed = this.editor;
	if(!ed) {
		return false;
	}
	var newSource = this.wiki.getTiddlerText(this.bufferTitle(), ""),
		blank = !/\S/.test(newSource);
	if(ed.isNew && blank) {
		// Nothing typed into a new unit: nothing to write, a continue chain ends here
		this.closeEditor(true);
		dom.focus(this.domNode);
		return true;
	}
	if(this.isReadOnly()) {
		this.showNotice("readonly");
		return false;
	}
	var tiddler = this.wiki.getTiddler(this.tiddlerTitle),
		current = tiddler ? (tiddler.fields.text || "") : "",
		adapter = this.getAdapter(),
		target = tiddler && adapter ? this.locateEditUnit(current) : null;
	if(!target) {
		this.showNotice("conflict");
		return false;
	}
	var result;
	if(ed.isNew) {
		result = adapter.insertNew(current, target.model, target.id, newSource.replace(/\r?\n/g, utils.eol(current)));
		if(!result) {
			// Nothing left to insert (e.g. only the item marker was typed): like a blank new unit
			this.closeEditor(true);
			dom.focus(this.domNode);
			return true;
		}
	} else if(blank) {
		result = adapter.remove(current, target.model, target.id);
		if(!result) {
			this.showNotice("children");
			return false;
		}
	} else {
		result = adapter.replace(current, target.model, target.id, newSource.replace(/\r?\n/g, utils.eol(current)));
	}
	var kind = ed.kind,
		index = ed.isNew ? target.id + 1 : target.id;
	this.closeEditor(true);
	dom.focus(this.domNode);
	var written = result.text !== current;
	if(written) {
		this.writeText(tiddler, result.text);
	}
	this.saveSelection(result.select, index, blank ? "" : kind);
	if(opts["continue"] && !blank) {
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
Unchanged text: the original unit. Otherwise: the one unit of the same kind whose own source equals the
original own source; none or several -> null.
*/
methods.locateEditUnit = function(text) {
	var ed = this.editor,
		m = this.model && this.model.text === text ? this.model : model.buildModel(this.wiki, text, this.tiddlerTitle);
	if(text === ed.origText) {
		var same = model.findUnit(m, ed.origStart, ed.unitKind);
		return same === -1 ? null : {model: m, id: same};
	}
	var found = m.units.filter(function(u) {
		return u.kind === ed.unitKind && text.substring(u.start, u.end) === ed.origSource;
	});
	return found.length === 1 ? {model: m, id: found[0].id} : null;
};

// After a re-render: open the new unit requested by saveEdit({continue: true})
methods.runPendingContinue = function() {
	var pending = this.pendingContinue;
	this.pendingContinue = null;
	if(!pending || this.editor) {
		return;
	}
	var id = model.findUnit(this.model, pending.start, pending.kind);
	if(id !== -1) {
		this.startEdit(id, {isNew: true});
	}
};

/*
After the body was (re-)mapped: put the host next to the relocated unit again. When the host is still in
place it is left alone (moving an iframe reloads it). Otherwise the editor widget is created again from the
buffer, so typed text is kept. It gets the focus (and caret) back only if it had the focus before.
*/
methods.reattachEditor = function() {
	var ed = this.editor;
	if(!ed) {
		if(!this.restoreEditor()) {
			this.runPendingContinue();
		}
		return;
	}
	var target = this.locateEditUnit(this.model.text);
	ed.id = target && this.isSelectable(target.id) ? target.id : -1;
	if(this.hostInPlace()) {
		this.hideEdited();
		return;
	}
	if(ed.id === -1 && dom.isInside(ed.host, this.domNode)) {
		// Unit not found (the save will report the conflict): leave the editor where it is
		this.unhideEdited();
		return;
	}
	var hadFocus = ed.focused,
		engine = this.editorEngine();
	ed.caret = null;
	if(engine && engine.domNode && typeof engine.domNode.selectionStart === "number") {
		ed.caret = [engine.domNode.selectionStart, engine.domNode.selectionEnd];
	}
	this.unhideEdited();
	this.removeHost();
	this.placeEditor(hadFocus);
	if(hadFocus) {
		this.focusEditor();
	}
};

// True when the host is attached inside the container at the place the unit asks for
methods.hostInPlace = function() {
	var ed = this.editor;
	if(ed.id === -1 || !dom.isInside(ed.host, this.domNode)) {
		return false;
	}
	var nodes = this.units[ed.id].domNodes;
	if(ed.placement === "after") {
		return dom.nextSiblingOf(nodes[nodes.length - 1]) === ed.host;
	}
	if(ed.placement === "inside") {
		return ed.host.parentNode === nodes[0] && nodes[0].firstChild === ed.host;
	}
	return dom.nextSiblingOf(ed.host) === nodes[0];
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
		this.editor.focused = true;
	}
};

// Show notice `name` (NOTICES) at the top of the host; replaces a previous notice
methods.showNotice = function(name) {
	var ed = this.editor,
		info = NOTICES[name];
	ed.notice = name;
	if(!ed.host) {
		return;
	}
	var children = Array.prototype.slice.call(ed.host.childNodes || []);
	$tw.utils.each(children, function(child) {
		if(child.nodeType === 1 && (child.className || "").split(" ").indexOf("rr-ol-notice") !== -1) {
			ed.host.removeChild(child);
		}
	});
	var note = this.document.createElement("div");
	note.className = info.cls;
	note.appendChild(this.document.createTextNode(info.text));
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

exports.install = function(proto) {
	$tw.utils.each(methods, function(fn, name) {
		proto[name] = fn;
	});
};
