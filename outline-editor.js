/*\
title: $:/plugins/rimir/outline/outline-editor.js
type: application/javascript
module-type: library

In-place editor of the $outline widget. install(proto) adds these methods to the widget prototype:
  startEdit(id, {isNew, blockType, where}) - open the editor for unit `id`; isNew: for a new unit after unit `id`
                               (where "before": before it; where "end": at the end of a tiddler without units, id -1)
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
outline-orig-text, outline-orig-edit (the text the editor opened with), outline-is-new (yes/no), outline-unit-kind (for a new unit: those of its anchor) and outline-depth
(a new item's level relative to its anchor, see shiftNewItem).

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
	dom = require("$:/plugins/rimir/outline/dom-utils.js"),
	blockTypes = require("$:/plugins/rimir/outline/block-types.js"),
	SELECTION_PREFIX = require("$:/plugins/rimir/outline/outline-keys.js").SELECTION_PREFIX;

var BUFFER_PREFIX = "$:/temp/rimir/outline/edit/",
	EDITOR_TIDDLER = "$:/plugins/rimir/outline/ui/editor",
	HOST_CLASS = "rr-ol-editor-host",
	// The editor of another tiddler (a diagram) or of a template's content (startTargetEdit)
	TARGET_CLASS = "rr-ol-target-editor",
	// Edited unit hidden (blocks) / only its own content hidden (items: sub-items stay visible)
	EDITING_CLASS = "rr-ol-editing",
	EDITING_OWN_CLASS = "rr-ol-editing-own",
	IS_EDITING_CLASS = "rr-ol-is-editing",
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
function editorState(unitKind, isNew, origSource, origStart, origText, blockType, adapter, where, types) {
	var typeKind = isNew && blockType && adapter && adapter.blockTypeKind ? adapter.blockTypeKind(blockType, types) : null;
	return {
		host: null,
		widget: null,
		id: -1,
		isNew: isNew,
		// A new unit of a chosen block type (block menu): paragraph, heading1, bulleted, code, ...
		blockType: typeKind ? blockType : "",
		kind: typeKind || (isNew ? (unitKind === "item" ? "item" : "block") : unitKind),
		unitKind: unitKind,
		// A new unit goes "after" its anchor (default), "before" it, or at the "end" of the text (no anchor)
		where: isNew ? (where || "after") : "",
		placement: isNew ? (where === "before" ? "before" : "after") : (unitKind === "item" ? "inside" : "before"),
		// A new item after an item (Enter): levels deeper (Tab) or higher (Shift-Tab) than its anchor, while empty
		depth: 0,
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
	var atEnd = !!opts.isNew && opts.where === "end";
	if(atEnd ? this.hasSelectable() : !this.isSelectable(id)) {
		return false;
	}
	var unit = atEnd ? {kind: "", start: 0, end: 0} : this.units[id].unit,
		isNew = !!opts.isNew,
		adapter = this.getAdapter(),
		ed = editorState(unit.kind, isNew, this.model.text.substring(unit.start, unit.end), unit.start, this.model.text,
			opts.blockType, adapter, opts.where, blockTypes.getBlockTypes(this.wiki));
	id = atEnd ? -1 : id;
	ed.id = id;
	ed.multiline = isNew ? this.newTypeIsMultiline(ed.blockType) : adapter.isMultiline(this.model, id);
	this.editor = ed;
	ownersOf(this.wiki)[this.bufferTitle()] = this;
	// A new block of a type with a starter text (a diagram: a minimal valid graph) opens with it
	var newType = isNew && ed.blockType ? blockTypes.getBlockType(this.wiki, ed.blockType) : null,
		initial = isNew ? (newType ? newType.starter : "") : adapter.editSource(this.model.text, this.model, id, blockTypes.getBlockTypes(this.wiki));
	this.wiki.addTiddler(new $tw.Tiddler({
		title: this.bufferTitle(),
		text: initial,
		type: "text/vnd.tiddlywiki",
		"outline-orig-edit": initial,
		"outline-orig-source": ed.origSource,
		"outline-orig-start": String(ed.origStart),
		"outline-orig-text": ed.origText,
		"outline-is-new": isNew ? "yes" : "no",
		"outline-unit-kind": ed.unitKind,
		"outline-block-type": ed.blockType,
		"outline-insert": ed.where
	}));
	this.placeEditor(true);
	// Only when opening: a re-attached editor (after a re-render) keeps its caret
	this.settleCaret();
	return true;
};

/*
Reopen a kept edit (see "Kept edits" above). Returns true when an editor was opened. Not while another live view
owns the editor, in read-only wikis, or for tiddlers without an adapter.
*/
methods.restoreEditor = function() {
	var title = this.bufferTitle(),
		buffer = this.wiki.getTiddler(title);
	if(!this.editor && buffer && buffer.fields["outline-target-mode"] === "yes" && !this.otherOwner()) {
		// A diagram or template edit is not kept over a re-render
		this.wiki.deleteTiddler(title);
		return false;
	}
	if(this.editor || !buffer || buffer.fields["outline-orig-start"] === undefined || this.otherOwner() ||
		this.isReadOnly() || !this.getAdapter()) {
		return false;
	}
	var f = buffer.fields,
		hints = registryOf(restoreHints, this.wiki),
		hint = hints[title] || {},
		ed = editorState(f["outline-unit-kind"] || "", f["outline-is-new"] === "yes", f["outline-orig-source"] || "",
			parseInt(f["outline-orig-start"], 10), f["outline-orig-text"] || "", f["outline-block-type"], this.getAdapter(),
			f["outline-insert"], blockTypes.getBlockTypes(this.wiki));
	delete hints[title];
	this.editor = ed;
	ownersOf(this.wiki)[title] = this;
	var target = this.locateEditUnit(this.model.text);
	ed.id = target && this.isSelectable(target.id) ? target.id : -1;
	if(ed.id === -1 && !(target && ed.where === "end")) {
		ed.notice = "conflict";
	}
	ed.multiline = ed.isNew ? this.newTypeIsMultiline(ed.blockType) :
		(ed.id === -1 ? /[\r\n]/.test(ed.origSource) : this.getAdapter().isMultiline(this.model, ed.id));
	ed.caret = hint.caret || null;
	ed.depth = parseInt(f["outline-depth"], 10) || 0;
	this.placeEditor(!!hint.focused);
	if(hint.focused) {
		this.focusEditor();
	}
	return true;
};

// True when the buffer differs from the text the editor opened with (new unit: anything typed)
methods.editChanged = function() {
	var ed = this.editor,
		buffer = this.wiki.getTiddler(this.bufferTitle()),
		text = buffer ? buffer.fields.text || "" : undefined;
	if(!ed || text === undefined) {
		return false;
	}
	return ed.isNew ? /\S/.test(text) : text !== buffer.fields["outline-orig-edit"];
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
		registryOf(restoreHints, this.wiki)[this.bufferTitle()] = {focused: this.editor.focused, caret: this.editorCaret()};
	}
	this.closeEditor(!keep);
};

// Create host + editor widget at the place of this.editor.id (or at the end of the container).
// focus: whether the new editor takes the focus when it renders
/*
DOM nodes the editor host goes before, into or after. A new block that is inserted after a heading's whole section
(insertsAfterSubtree) is placed after the section's last top-level node.
*/
methods.editAnchorNodes = function() {
	var ed = this.editor,
		adapter = this.getAdapter(),
		types = blockTypes.getBlockTypes(this.wiki),
		// A new block at a list item goes next to the whole list (insertAnchor)
		id = ed.isNew && ed.blockType && adapter ? adapter.insertAnchor(this.model, ed.id, ed.blockType, types) : ed.id;
	if(ed.isNew && ed.where === "after" && ed.blockType && adapter && adapter.insertsAfterSubtree(this.model, id, ed.blockType, types)) {
		var last = this.lastSectionNode(id);
		if(last) {
			return [last];
		}
	}
	return this.units[id].domNodes;
};

// Last top-level DOM node of unit `id` and its section (sub-sections included), or null
methods.lastSectionNode = function(id) {
	var u = this.units[id].unit;
	if(u.kind === "heading") {
		for(var i = u.children.length - 1; i >= 0; i--) {
			var node = this.lastSectionNode(u.children[i]);
			if(node) {
				return node;
			}
		}
	}
	var nodes = this.units[id].domNodes;
	return nodes.length ? nodes[nodes.length - 1] : null;
};

/*
Badge type of the editor field: the edited unit's type, a new block's chosen type, a new item like its anchor,
other new units a paragraph. None for an item edited inside its li (the li keeps its own badge).
*/
methods.editorType = function() {
	var ed = this.editor,
		anchor = ed.id !== -1 && this.units[ed.id] && this.units[ed.id].domNodes[0],
		anchorType = anchor && anchor.getAttribute ? anchor.getAttribute("data-ol-type") : "";
	if(ed.target) {
		var tiddler = ed.target.title ? this.wiki.getTiddler(ed.target.title) : null,
			type = ed.target.typeName ? blockTypes.getBlockType(this.wiki, ed.target.typeName) :
				(tiddler ? blockTypes.typeForContentType(this.wiki, tiddler.fields.type) : null);
		return type ? type.badge : "";
	}
	if(ed.placement === "inside") {
		return "";
	}
	if(!ed.isNew) {
		return anchorType || "";
	}
	if(ed.blockType) {
		var type = blockTypes.getBlockType(this.wiki, ed.blockType);
		return type ? type.badge : "";
	}
	var marker = ed.depth ? this.newItemMarker() : "",
		markerType = {"*": "bullet", "#": "numbered"}[marker.charAt(marker.length - 1)];
	return ed.kind === "item" ? markerType || anchorType || "bullet" : "paragraph";
};

methods.placeEditor = function(focus) {
	var ed = this.editor,
		nodes = ed.id === -1 ? [] : this.editAnchorNodes(),
		host = this.document.createElement(ed.isNew && ed.unitKind === "item" && ed.kind === "item" && nodes.length ? "li" : "div"),
		self = this;
	host.className = HOST_CLASS + (ed.target ? " " + TARGET_CLASS : "");
	var type = this.editorType();
	if(type) {
		host.setAttribute("data-ol-type", type);
	}
	// While an editor is open the field marks the place: no selection frames (they would stay on the saved unit)
	dom.setClass(this.domNode, IS_EDITING_CLASS, true);
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
	host.addEventListener("focusout", function(event) { self.noteBlur(event.target); }, false);
	ed.host = host;
	this.showNewItemDepth();
	this.hideEdited();
	// The host is in the document now: the FramedEngine needs that to create its iframe
	// Inline: a block-mode parse would wrap the editor in a <p>, whose margin leaves a gap below it
	ed.widget = this.wiki.makeTranscludeWidget(EDITOR_TIDDLER, {
		parentWidget: this,
		document: this.document,
		parseAsInline: true,
		variables: {
			"outline-edit-tiddler": this.bufferTitle(),
			"len": String(this.wiki.getTiddlerText(this.bufferTitle(), "").length),
			"outline-edit-focus": focus ? "yes" : "no",
			// A new block of a chosen type names its type in the empty field
			"outline-edit-placeholder": this.newTypeCaption(ed.blockType)
		}
	});
	ed.widget.render(host, null);
	this.trackEngineFocus();
	if(ed.notice) {
		this.showNotice(ed.notice);
	}
};

/*
The editor lost the focus, unless `node` is being removed: browsers blur a focused element while removing it
(a re-render of the edited unit), and the re-attached editor must get the focus back then. Decided one tick
later, when a removed node is no longer connected; focus that moved within the editor (toolbar) also counts.
*/
methods.noteBlur = function(node) {
	var ed = this.editor,
		self = this;
	if(!ed) {
		return;
	}
	setTimeout(function() {
		var active = self.document.activeElement;
		if(self.editor === ed && node.isConnected !== false && !(ed.host && active && ed.host.contains(active))) {
			ed.focused = false;
		}
	}, 0);
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
	engine.domNode.addEventListener("blur", function() { self.noteBlur(engine.domNode); }, false);
	var active = this.document.activeElement;
	ed.focused = !!active && (active === engine.domNode || active === engine.iframeNode);
};

methods.hideEdited = function() {
	var ed = this.editor;
	this.unhideEdited();
	if(ed.isNew || ed.placement === "after" || ed.id === -1) {
		return;
	}
	var cls = ed.placement === "inside" ? EDITING_OWN_CLASS : EDITING_CLASS;
	ed.hidden = this.units[ed.id].domNodes.slice();
	var view = this.document.defaultView;
	$tw.utils.each(ed.hidden, function(node) {
		// An edited item collapses its own text to zero size; the editor and the sub-items get the item's sizes back
		if(cls === EDITING_OWN_CLASS && view && view.getComputedStyle && node.style && node.style.setProperty) {
			var style = view.getComputedStyle(node);
			node.style.setProperty("--rr-ol-font-size", style.fontSize);
			node.style.setProperty("--rr-ol-line-height", style.lineHeight);
		}
		dom.setClass(node, cls, true);
	});
};

methods.unhideEdited = function() {
	var ed = this.editor;
	$tw.utils.each(ed && ed.hidden || [], function(node) {
		dom.setClass(node, EDITING_CLASS, false);
		dom.setClass(node, EDITING_OWN_CLASS, false);
		if(node.style && node.style.removeProperty) {
			node.style.removeProperty("--rr-ol-font-size");
			node.style.removeProperty("--rr-ol-line-height");
		}
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
	dom.setClass(this.domNode, IS_EDITING_CLASS, false);
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
	if(ed.target) {
		return this.saveTargetEdit();
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
	if(ed.isNew && ed.blockType) {
		result = adapter.insertBlock(current, target.model, target.id, ed.blockType, newSource, ed.where, blockTypes.getBlockTypes(this.wiki));
		if(!result) {
			this.closeEditor(true);
			dom.focus(this.domNode);
			return true;
		}
	} else if(ed.isNew) {
		result = adapter.insertNew(current, target.model, target.id, newSource.replace(/\r?\n/g, utils.eol(current)),
			ed.depth && adapter.newItemMarker ? adapter.newItemMarker(target.model, target.id, ed.depth) : null, ed.where);
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
		result = adapter.replace(current, target.model, target.id, newSource.replace(/\r?\n/g, utils.eol(current)),
			blockTypes.getBlockTypes(this.wiki));
	}
	var kind = ed.kind,
		index = ed.isNew && ed.where === "after" ? target.id + 1 : Math.max(0, target.id);
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
	if(ed.where === "end") {
		// Appended at the end: no anchor to find
		return {model: m, id: -1};
	}
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
	// The focus moved elsewhere just before (its blur is decided a tick later, see noteBlur): do not take it back
	var active = this.document.activeElement,
		hadFocus = ed.focused && (!active || active === this.document.body || (!!ed.host && ed.host.contains(active)));
	ed.caret = this.editorCaret();
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

// [selectionStart, selectionEnd] of the editor's textarea, or null
methods.editorCaret = function() {
	var engine = this.editorEngine();
	return engine && engine.domNode && typeof engine.domNode.selectionStart === "number" ?
		[engine.domNode.selectionStart, engine.domNode.selectionEnd] : null;
};

/*
A freshly opened editor starts with the caret at the end of the text (or at editor.caret, set by the caller), never
with the text selected. The edit widget does this when it focuses; some browsers or plugins select the whole text
on focus, and a double-click's own selection can move the caret afterwards. One tick later the caret is set again,
unless a key was pressed (or something typed) meanwhile: the caret is then where the user put it.
*/
methods.settleCaret = function() {
	var ed = this.editor,
		self = this,
		start = this.wiki.getTiddlerText(this.bufferTitle(), "");
	if(!$tw.browser || !ed) {
		return;
	}
	setTimeout(function() {
		var engine = self.editorEngine(),
			node = engine && engine.domNode;
		if(self.editor !== ed || ed.keyed || !node || !node.setSelectionRange || node.value !== start || !ed.focused) {
			return;
		}
		var caret = ed.caret || [node.value.length, node.value.length];
		if(node.selectionStart !== caret[0] || node.selectionEnd !== caret[1]) {
			node.setSelectionRange(caret[0], caret[1]);
		}
	}, 0);
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

/*
Insert a line break at the caret. The FramedEngine (full editor) takes it as a text operation (keeps undo, height
and the buffer in sync). The SimpleEngine (compact editor) has no text operations: the line break goes into the
textarea directly, and an input event lets the engine save the buffer and fix the height.
*/
methods.insertNewline = function() {
	var engine = this.editorEngine();
	if(!engine || !engine.widget || !engine.widget.handleEditTextOperationMessage) {
		return;
	}
	if(!engine.createTextOperation || !engine.createTextOperation()) {
		var node = engine.domNode,
			view = node && node.ownerDocument && node.ownerDocument.defaultView;
		if(!node || !node.setRangeText || !view) {
			return;
		}
		node.setRangeText("\n", node.selectionStart, node.selectionEnd, "end");
		node.dispatchEvent(new view.Event("input", {bubbles: true}));
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
	// Any key (Home, arrows, ...) places the caret itself: settleCaret leaves it alone
	ed.keyed = true;
	if(ed.target) {
		// The editor of another tiddler (a diagram) or of a template's content: save and cancel only
		if(this.keyMatches(event, "outline-save") || (ed.target.template && this.keyMatches(event, "outline-continue"))) {
			this.saveEdit();
		} else if(this.keyMatches(event, "outline-cancel")) {
			this.cancelEdit();
		} else {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		return;
	}
	if(this.keyMatches(event, "outline-save")) {
		this.saveEdit();
	} else if(!ed.multiline && this.keyMatches(event, "outline-continue")) {
		if(!this.editInsertBefore() && !this.editSplit()) {
			this.saveEdit({"continue": true});
		}
	} else if(!ed.multiline && this.keyMatches(event, "outline-newline")) {
		this.insertNewline();
	} else if(this.keyMatches(event, "outline-merge") && this.editMerge()) {
		// consumed
	} else if(this.keyMatches(event, "outline-merge-next") && this.editMergeNext()) {
		// consumed
	} else if(this.keyMatches(event, "outline-undo") && this.editUndo(true)) {
		// consumed
	} else if(this.keyMatches(event, "outline-redo") && this.editUndo(false)) {
		// consumed
	} else if(this.keyMatches(event, "outline-menu")) {
		this.editMenu();
	} else if(this.keyMatches(event, "outline-cancel")) {
		this.cancelEdit();
	} else if(this.keyMatches(event, "outline-move-up")) {
		this.editOperate("move", -1);
	} else if(this.keyMatches(event, "outline-move-down")) {
		this.editOperate("move", 1);
	} else if(this.keyMatches(event, "outline-indent")) {
		this.editOperate("indent");
	} else if(this.keyMatches(event, "outline-promote")) {
		this.editOperate("promote");
	} else if(this.keyMatches(event, "outline-edit-up")) {
		this.editStep(-1);
	} else if(this.keyMatches(event, "outline-edit-down")) {
		this.editStep(1);
	} else {
		return;
	}
	event.preventDefault();
	event.stopPropagation();
};

/*
Move the editor to the previous (dir -1) or next (1) unit: save, then edit the neighbour. A refused save (conflict,
read-only, children) keeps the editor open with its notice. After a blank save the editor goes to the unit at the
same place when that already is the requested neighbour: the one after a deleted unit (down) or the anchor of an
empty new unit (up). At the first/last unit the editor reopens on the same unit.
*/
methods.editStep = function(dir) {
	var ed = this.editor;
	if(!ed) {
		return false;
	}
	// A new unit before its anchor has the anchor below it
	var blank = !/\S/.test(this.wiki.getTiddlerText(this.bufferTitle(), "")),
		stay = blank && (ed.isNew && ed.where !== "before" ? dir < 0 : dir > 0);
	// Step from the edited unit (a new unit: from its anchor), whatever was selected before
	if(ed.id !== -1 && this.selectedId !== ed.id) {
		this.select(ed.id);
	}
	if(!this.saveEdit()) {
		return true;
	}
	// The save may not be rendered yet: remap now so the neighbour is found at its new position
	this.ensureCurrent();
	// Unit by unit (never the whole list): the editor goes into lists
	if(!stay) {
		this.step(dir, true);
	}
	this.editSelected();
	return true;
};

/*
Double-click on unit `id` while editing: save, then edit that unit at its place in the saved text. A refused save
keeps the editor open with its notice; a unit that cannot be found again leaves the outline in selection mode.
*/
methods.editOther = function(id) {
	var ed = this.editor,
		target = this.units[id] && this.units[id].unit;
	if(!ed || !target) {
		return false;
	}
	var oldText = this.model.text;
	if(ed.id !== -1 && this.selectedId !== ed.id) {
		this.select(ed.id);
	}
	if(!this.saveEdit()) {
		return true;
	}
	this.ensureCurrent();
	var start = utils.mapPosition(oldText, this.model.text, target.start),
		self = this,
		next = start === -1 ? -1 : model.findUnit(this.model, start, target.kind, function(i) { return self.isSelectable(i); });
	if(next !== -1 && this.select(next)) {
		this.startEdit(next);
	}
	return true;
};

/*
Tab / Shift-Tab and Alt-Up/Down while editing: like in selection mode, on the edited unit. Save, indent, promote or
move the unit with its subtree, edit it again (at its new place) with the caret where it was. A refused save keeps the editor. With empty text the key is
consumed and nothing changes.
*/
// One undo step for the save and the operation (outline-undo.js)
/*
The marker a new item after an item (Enter) is saved with, at its current depth (see newItemMarker of the adapter);
"" for other editors (also a new item before its anchor) or when the level does not fit (any more).
*/
methods.newItemMarker = function() {
	var ed = this.editor,
		adapter = this.getAdapter();
	if(!ed || !ed.isNew || ed.where !== "after" || ed.blockType || ed.kind !== "item" || ed.unitKind !== "item" || ed.id === -1 || !adapter ||
		!adapter.newItemMarker) {
		return "";
	}
	return adapter.newItemMarker(this.model, ed.id, ed.depth) || "";
};

// Tab (1) / Shift-Tab (-1) on an empty new item: one level deeper / higher, within the range newItemMarker allows
methods.shiftNewItem = function(dir) {
	var ed = this.editor;
	ed.depth += dir;
	if(!this.newItemMarker()) {
		ed.depth -= dir;
		return;
	}
	var buffer = this.wiki.getTiddler(this.bufferTitle());
	if(buffer) {
		this.wiki.addTiddler(new $tw.Tiddler(buffer, {"outline-depth": String(ed.depth)}));
	}
	this.showNewItemDepth();
};

/*
Show a new item's depth: the field moves by one list indentation per level, and gets the marker type of its level
(a bullet under a numbered item, ...)
*/
methods.showNewItemDepth = function() {
	var ed = this.editor,
		host = ed && ed.host;
	if(!host || !host.style || !ed.isNew || ed.kind !== "item") {
		return;
	}
	var view = this.document.defaultView,
		list = host.parentNode,
		step = view && view.getComputedStyle && list ? parseFloat(view.getComputedStyle(list).paddingLeft) || 0 : 0;
	host.style.marginLeft = ed.depth && step ? (ed.depth * step) + "px" : "";
	var type = this.editorType();
	if(type) {
		host.setAttribute("data-ol-type", type);
	}
};

methods.editOperate = function(name, arg) {
	var args = arguments;
	return this.undoGroup(function() { return editOperateSteps.apply(this, args); });
};

function editOperateSteps(name, arg) {
	var ed = this.editor;
	if(!ed) {
		return false;
	}
	// Empty text: an existing unit would be deleted by the save, a new one has nothing to write yet. A new item
	// takes Tab / Shift-Tab as the level it is saved with
	if(!/\S/.test(this.wiki.getTiddlerText(this.bufferTitle(), ""))) {
		if(name === "indent" || name === "promote") {
			this.shiftNewItem(name === "indent" ? 1 : -1);
		}
		return true;
	}
	var caret = this.editorCaret();
	if(ed.id !== -1 && this.selectedId !== ed.id) {
		this.select(ed.id);
	}
	if(!this.saveEdit()) {
		return true;
	}
	this.operate(name, arg);
	this.editAgain(caret);
	return true;
};

// Edit the selected unit again (after a save and an operation on it), the caret at `caret` if given
methods.editAgain = function(caret) {
	// The write may not be rendered yet: remap so the unit is edited at its new position
	this.ensureCurrent();
	if(this.editSelected() && this.editor && caret) {
		this.editor.caret = caret;
		this.focusEditor();
	}
};

/*
Alt-Enter in the editor: save, then the block menu with the "Turn into" entries of the unit (outline-menu.js). The
editor opens again on the unit, converted or not (Escape), the caret where it was. Blank text: a new unit offers every
block type (retypeMenu, outline-menu.js), an existing one does nothing.
*/
methods.editMenu = function() {
	var ed = this.editor;
	if(!ed || ed.target) {
		return;
	}
	if(!/\S/.test(this.wiki.getTiddlerText(this.bufferTitle(), ""))) {
		// A new, still empty unit: choose what it becomes
		if(ed.isNew) {
			this.retypeMenu();
		}
		return;
	}
	var caret = this.editorCaret();
	if(ed.id !== -1 && this.selectedId !== ed.id) {
		this.select(ed.id);
	}
	if(!this.saveEdit() || !this.ensureCurrent()) {
		return;
	}
	if(!this.openMenu({convertOnly: true, caret: caret})) {
		this.editAgain(caret);
	}
};

/*
Ctrl-Z / Ctrl-Y in the editor while its text is as it opened (nothing typed, or the typing undone): the outline's undo
or redo (outline-undo.js), so a split, merge, move or save made from the editor is taken back; the editor then opens
on the unit selected after it. With typed text, or without a step, the key is the text field's own.
*/
methods.editUndo = function(back) {
	if(!this.editor || this.editChanged() || this.isReadOnly() || !this.undoAvailable(back)) {
		return false;
	}
	this.closeEditor(true);
	dom.focus(this.domNode);
	this.undoStep(back);
	if(this.ensureCurrent()) {
		this.editSelected();
	}
	return true;
};

/*
Backspace with the caret at the start of a list item (nothing selected): merge the item into the item above it in its
list (the previous item in document order) and edit that one, the caret where the merged text begins. An empty item
is deleted and the editor goes to the end of the item above; its sub-items stay. An empty new item is discarded the
same way. False (the key acts as usual) anywhere else: not at the start, not a list item, a multi-line item, the
first item of a list, a new item with text.
*/
// One undo step for the save and the operation (outline-undo.js)
methods.editMerge = function() {
	var args = arguments;
	return this.undoGroup(function() { return editMergeSteps.apply(this, args); });
};

function editMergeSteps() {
	var ed = this.editor,
		caret = this.editorCaret(),
		adapter = this.getAdapter();
	if(!ed || ed.multiline || ed.kind !== "item" || ed.unitKind !== "item" || ed.id === -1 || !adapter ||
		!caret || caret[0] !== 0 || caret[1] !== 0) {
		return false;
	}
	var blank = !/\S/.test(this.wiki.getTiddlerText(this.bufferTitle(), ""));
	if(ed.isNew) {
		if(!blank) {
			return false;
		}
		// The item above the empty new one: the last item of the anchor's subtree (before the anchor: the item above
		// the anchor; none: the anchor itself, at its start)
		var anchor = this.units[ed.id].unit,
			before = ed.where === "before",
			above = adapter.itemBefore(this.model, ed.id, before ? anchor.start : anchor.subtreeEnd);
		this.cancelEdit();
		if(above !== -1 && this.select(above) && this.editSelected()) {
			this.editAtEnd();
		} else if(above === -1 && before && this.editSelected() && this.editor) {
			this.editor.caret = [0, 0];
			this.focusEditor();
		}
		return true;
	}
	if(adapter.mergeTarget(this.model, ed.id) === -1) {
		return false;
	}
	if(this.selectedId !== ed.id) {
		this.select(ed.id);
	}
	if(blank) {
		// A blank save would delete the item but refuse one with sub-items: merge "" instead (sub-items stay)
		this.closeEditor(true);
	} else if(!this.saveEdit()) {
		return true;
	}
	if(!this.ensureCurrent()) {
		return true;
	}
	var id = this.selectedId,
		target = adapter.mergeTarget(this.model, id),
		join = target === -1 ? 0 : adapter.editSource(this.model.text, this.model, target, blockTypes.getBlockTypes(this.wiki)).length;
	this.operate("merge", blank ? "" : undefined);
	this.ensureCurrent();
	// Merged: the item above is selected, edited at the join; refused: the same item again, at its start
	var merged = this.selectedId !== id;
	if(this.editSelected() && this.editor) {
		this.editor.caret = merged ? [join, join] : [0, 0];
		this.focusEditor();
	}
	return true;
};

/*
Enter with the caret inside a list item's text (not at its start or end, nothing selected): split the item. The text
before the caret stays, the text after it goes to a new item right below (a sibling, or the first sub-item when the
item has sub-items), which is edited with the caret at its start. The inverse of the Backspace merge. False (Enter
acts as usual: save and new) anywhere else.
*/
// One undo step for the save and the operation (outline-undo.js)
methods.editSplit = function() {
	var args = arguments;
	return this.undoGroup(function() { return editSplitSteps.apply(this, args); });
};

function editSplitSteps() {
	var ed = this.editor,
		caret = this.editorCaret(),
		value = this.wiki.getTiddlerText(this.bufferTitle(), "");
	if(!ed || ed.multiline || ed.isNew || ed.kind !== "item" || ed.unitKind !== "item" || ed.id === -1 || !caret ||
		caret[0] !== caret[1]) {
		return false;
	}
	var head = value.substring(0, caret[0]),
		rest = value.substring(caret[0]);
	if(!/\S/.test(head) || !/\S/.test(rest)) {
		return false;
	}
	if(this.selectedId !== ed.id) {
		this.select(ed.id);
	}
	// Save the part before the caret (with the usual conflict handling), then add the rest below
	this.wiki.setText(this.bufferTitle(), "text", null, head.replace(/[ \t]+$/, ""));
	if(!this.saveEdit()) {
		return true;
	}
	if(!this.ensureCurrent()) {
		return true;
	}
	var id = this.selectedId;
	this.operate("split", rest.replace(/^[ \t]+/, ""));
	this.ensureCurrent();
	var split = this.selectedId !== id;
	if(this.editSelected() && this.editor && split) {
		this.editor.caret = [0, 0];
		this.focusEditor();
	}
	return true;
};

/*
Enter with the caret at the start of a filled list item or paragraph (nothing selected): an empty new unit of its kind
above it (an item with its marker, a paragraph), edited at once; the edited text is saved first. The inverse of the
Backspace merge of an empty item. False (Enter acts as usual) anywhere else.
*/
methods.editInsertBefore = function() {
	var ed = this.editor,
		caret = this.editorCaret(),
		unit = ed && ed.id !== -1 ? this.units[ed.id].unit : null;
	if(!unit || ed.multiline || ed.isNew || !caret || caret[0] !== 0 || caret[1] !== 0 ||
		!(unit.kind === "item" || (unit.kind === "block" && unit.tag === "p")) ||
		!/\S/.test(this.wiki.getTiddlerText(this.bufferTitle(), ""))) {
		return false;
	}
	if(this.selectedId !== ed.id) {
		this.select(ed.id);
	}
	if(this.saveEdit() && this.ensureCurrent()) {
		this.startEdit(this.selectedId, {isNew: true, where: "before"});
	}
	return true;
};

/*
Delete with the caret at the end of a list item (nothing selected): the item below that merges into this one (see
mergeSource) comes up, its text after the caret. The inverse of Backspace at the start of that item. False (the key acts
as usual) anywhere else: not at the end, a blank, new or multi-line item, no such item below.
*/
// One undo step for the save and the operation (outline-undo.js)
methods.editMergeNext = function() {
	var args = arguments;
	return this.undoGroup(function() { return editMergeNextSteps.apply(this, args); });
};

function editMergeNextSteps() {
	var ed = this.editor,
		caret = this.editorCaret(),
		adapter = this.getAdapter(),
		value = this.wiki.getTiddlerText(this.bufferTitle(), "");
	if(!ed || ed.multiline || ed.isNew || ed.kind !== "item" || ed.unitKind !== "item" || ed.id === -1 || !adapter ||
		!adapter.mergeSource || !caret || caret[0] !== value.length || caret[1] !== value.length || !/\S/.test(value)) {
		return false;
	}
	var next = adapter.mergeSource(this.model, ed.id);
	if(next === -1 || !adapter.merge(this.model.text, this.model, next)) {
		return false;
	}
	if(this.selectedId !== ed.id) {
		this.select(ed.id);
	}
	if(!this.saveEdit() || !this.ensureCurrent()) {
		return true;
	}
	var id = this.selectedId,
		join = adapter.editSource(this.model.text, this.model, id).length;
	next = adapter.mergeSource(this.model, id);
	if(next !== -1 && this.select(next)) {
		this.operate("merge");
	}
	this.editAgain([join, join]);
	return true;
}

methods.editAtEnd = function() {
	var len = this.wiki.getTiddlerText(this.bufferTitle(), "").length;
	this.editor.caret = [len, len];
	this.focusEditor();
};

// Select-mode Ctrl-Enter: an empty new unit below the selected one, as Enter at the end of its editor adds (an item on
// its level, a paragraph after anything else). In a tiddler without units: a first paragraph
methods.addBelow = function() {
	if(this.selectedId === -1) {
		return this.editSelected();
	}
	this.startEdit(this.selectedId, {isNew: true});
	return true;
};

// Select-mode Enter. In a tiddler without units: a first paragraph at the end of the text
methods.editSelected = function() {
	if(this.selectedId === -1) {
		return !this.hasSelectable() && this.startEdit(-1, {isNew: true, blockType: "paragraph", where: "end"});
	}
	this.startEdit(this.selectedId);
	return true;
};

// Open `title` in the story, its outline awake: its first unit selected (unless it already has a selection)
methods.openTarget = function(title) {
	if(!title) {
		return false;
	}
	var selection = SELECTION_PREFIX + title;
	if(!this.wiki.tiddlerExists(selection)) {
		this.wiki.addTiddler(new $tw.Tiddler({title: selection, start: "0", index: "0", kind: ""}));
	}
	this.dispatchEvent({
		type: "tm-navigate",
		navigateTo: title,
		navigateFromTitle: this.tiddlerTitle,
		navigateFromNode: this
	});
	return true;
};

/*
The editor of another tiddler or of a template's content, below unit `id` (the unit is not hidden; its text is not
touched until the save). opts:
  {title}             - a diagram tiddler that unit `id` transcludes: its text is edited, the save writes it
  {isNew, typeName}   - "Add to this item" with a type of the item context: a transclude type starts with its starter
                        text; the first save creates the tiddler (newDiagramTitle, the type's content type) and appends
                        {{title}} to the item's line. A template type (inline: a template with $content$) edits the
                        content; the save appends the filled template. Escape before the save writes nothing.
The buffer is the editor buffer of this tiddler, marked outline-target-mode (a re-render does not keep it).
*/
methods.startTargetEdit = function(id, opts) {
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
	var type = opts.isNew ? blockTypes.getBlockType(this.wiki, opts.typeName) : null,
		existing = opts.isNew ? null : this.wiki.getTiddler(opts.title);
	// An existing target must be a diagram: a tiddler of a registered typed type (transcluded wikitext is not edited here)
	if(this.isReadOnly() || !this.getAdapter() || !this.isSelectable(id) || (opts.isNew ? !type || !type.inline :
		!existing || !blockTypes.typeForContentType(this.wiki, existing.fields.type))) {
		return false;
	}
	var unit = this.units[id].unit,
		ed = editorState(unit.kind, false, this.model.text.substring(unit.start, unit.end), unit.start, this.model.text,
			"", this.getAdapter(), "", blockTypes.getBlockTypes(this.wiki)),
		template = type && type.inline !== "transclude" ? type.inline : "",
		initial = opts.isNew ? (template ? "" : type.starter) : this.wiki.getTiddlerText(opts.title, "");
	ed.id = id;
	ed.target = {title: opts.isNew ? "" : opts.title, isNew: !!opts.isNew, typeName: type ? type.name : "", template: template};
	ed.placement = "after";
	ed.multiline = !template;
	this.editor = ed;
	ownersOf(this.wiki)[this.bufferTitle()] = this;
	this.wiki.addTiddler(new $tw.Tiddler({
		title: this.bufferTitle(),
		text: initial,
		type: "text/vnd.tiddlywiki",
		"outline-orig-edit": initial,
		"outline-orig-source": ed.origSource,
		"outline-orig-start": String(ed.origStart),
		"outline-orig-text": ed.origText,
		"outline-unit-kind": ed.unitKind,
		"outline-target-mode": "yes"
	}));
	this.placeEditor(true);
	this.settleCaret();
	return true;
};

// Save of the editor opened by startTargetEdit
methods.saveTargetEdit = function() {
	var ed = this.editor,
		target = ed.target,
		text = this.wiki.getTiddlerText(this.bufferTitle(), "");
	if(this.isReadOnly()) {
		this.showNotice("readonly");
		return false;
	}
	if(!target.isNew) {
		var tiddler = this.wiki.getTiddler(target.title);
		this.closeEditor(true);
		dom.focus(this.domNode);
		if(tiddler && text !== (tiddler.fields.text || "")) {
			this.wiki.addTiddler(new $tw.Tiddler(tiddler, {text: text}, this.wiki.getModificationFields()));
		}
		return true;
	}
	if(!/\S/.test(text)) {
		this.closeEditor(true);
		dom.focus(this.domNode);
		return true;
	}
	var host = this.wiki.getTiddler(this.tiddlerTitle),
		current = host ? (host.fields.text || "") : "",
		located = host ? this.locateEditUnit(current) : null,
		type = blockTypes.getBlockType(this.wiki, target.typeName);
	if(!located || !type) {
		this.showNotice("conflict");
		return false;
	}
	var u = located.model.units[located.id],
		title = target.template ? "" : this.newDiagramTitle(located.id, type.badge, located.model),
		snippet = target.template ? target.template.replace(/\$content\$/g, text.replace(/\s*\r?\n\s*/g, " ").trim()) :
			"{{" + title + "}}";
	this.closeEditor(true);
	dom.focus(this.domNode);
	if(title) {
		this.wiki.addTiddler(new $tw.Tiddler(this.wiki.getCreationFields(), {title: title, type: type.contentType, text: text},
			this.wiki.getModificationFields()));
	}
	this.writeText(host, utils.splice(current, u.end, u.end, " " + snippet));
	this.saveSelection(u.start, located.id, u.kind);
	return true;
};

/*
Base name of a new diagram transcluded in unit `id`: its plain text (transclusions, macro calls, HTML tags and
formatting marks removed, links by their text), cut at a word boundary to about 40 characters, and the badge in
parentheses; the host title when the unit has no text. Made unique (" 1", " 2", ...) when the name is taken.
*/
methods.newDiagramTitle = function(id, badge, model) {
	model = model || this.model;
	var source = this.getAdapter().editSource(model.text, model, id),
		plain = source.replace(/\{\{[^}]*\}\}/g, " ").replace(/<<[\s\S]*?>>/g, " ")
			.replace(/\[\[([^\]|]*)\|[^\]]*\]\]/g, "$1").replace(/\[\[([^\]]*)\]\]/g, "$1")
			.replace(/<[^>]+>/g, " ").replace(/''|\/\/|__|~~|\^\^|,,|`|@@/g, "")
			// Characters that are syntax inside {{...}}: no brackets or parameter bars, no field (!!) or index (##) part
			.replace(/[{}|\[\]]/g, " ").replace(/!!+/g, "!").replace(/##+/g, "#").replace(/\s+/g, " ").trim();
	if(plain.length > 40) {
		var cut = plain.substring(0, 41).replace(/\s+\S*$/, "");
		plain = cut || plain.substring(0, 40);
	}
	return this.wiki.generateNewTitle((plain || this.tiddlerTitle) + " (" + badge + ")");
};

// True when a new unit of block type `name` takes Enter as a line break (fenced and typed blocks)
methods.newTypeIsMultiline = function(name) {
	var type = name ? blockTypes.getBlockType(this.wiki, name) : null;
	return !!type && (type.behaviour === "fenced" || type.behaviour === "typed");
};

// Caption of block type `name` (the new unit's placeholder), "" when there is none
methods.newTypeCaption = function(name) {
	var type = name ? blockTypes.getBlockType(this.wiki, name) : null;
	return type ? type.caption : "";
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
