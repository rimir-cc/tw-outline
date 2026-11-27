/*\
title: $:/plugins/rimir/outline/outline-clipboard.js
type: application/javascript
module-type: library

Copy, cut and paste of the selected unit through the system clipboard: the browser's copy, cut and paste events on
the focused outline (Ctrl-C / Ctrl-X / Ctrl-V, Cmd on Mac, the Edit and context menus). install(proto) adds these
methods to the widget prototype:
  handleCopy(event)  - the selected unit with its subtree to the clipboard; a short flash shows it
  handleCut(event)   - copy, then delete it with its subtree, without asking (Ctrl-Z brings it back)
  handlePaste(event) - insert the clipboard after the selected unit (a tiddler without units: at the end), its levels
                       adapted to the place (adapter paste), and select it

A copy writes three formats: text/html (the unit's source rendered, links to tiddlers as their text, for e-mail and
the like), text/plain (the wikitext source; items of both moved to level 1) and CLIP_TYPE (JSON {kind, source}, see
the adapter's copy). A paste takes CLIP_TYPE, else the plain text as wikitext (adapter clipKind); outside HTML is not
converted.
The events are left to the browser while text is marked, while the focus is not on the outline itself (the editor), and
without a selection. Read-only wikis: copy only. An open editor in this view: cut and paste do nothing.

\*/
"use strict";

var buildModel = require("$:/plugins/rimir/outline/model.js").buildModel,
	dom = require("$:/plugins/rimir/outline/dom-utils.js");

var CLIP_TYPE = "application/x-rimir-outline",
	COPIED_CLASS = "rr-ol-copied",
	FLASH_MS = 600;

exports.CLIP_TYPE = CLIP_TYPE;

var methods = {};

// True while text is marked with the mouse: the browser copies that text as usual
methods.hasTextSelection = function() {
	var view = this.document.defaultView,
		selection = view && view.getSelection ? view.getSelection() : null;
	return !!selection && !selection.isCollapsed && String(selection).length > 0;
};

// Whether a clipboard event is the outline's: the outline itself has the focus (not its editor; the event's target is
// where the caret of the last click is), a unit selected (paste: or no units at all)
methods.ownsClipboardEvent = function(event, paste) {
	return this.awake && this.document.activeElement === this.domNode && !!event.clipboardData && !this.hasTextSelection() &&
		(this.selectedId !== -1 || (paste && !this.hasSelectable()));
};

// The clip of the selected unit ({kind, source}) or null
methods.selectedClip = function() {
	var adapter = this.getAdapter();
	if(!adapter || !adapter.copy || !this.ensureCurrent()) {
		return null;
	}
	var ids = this.rangeIds();
	return ids.length > 1 && adapter.rangeClip ? adapter.rangeClip(this.model.text, this.model, ids) :
		adapter.copy(this.model.text, this.model, this.selectedId);
};

// `source` rendered as HTML in this outline's context, links to tiddlers replaced by their text, no classes
methods.clipHtml = function(source) {
	var parser = this.wiki.parseText("text/vnd.tiddlywiki", source, {parseAsInline: false}),
		container = this.document.createElement("div"),
		widget = this.wiki.makeWidget(parser, {document: this.document, parentWidget: this});
	widget.render(container, null);
	$tw.utils.each(Array.prototype.slice.call(container.querySelectorAll("a.tc-tiddlylink")), function(link) {
		link.parentNode.replaceChild(link.ownerDocument.createTextNode(link.textContent), link);
	});
	$tw.utils.each(Array.prototype.slice.call(container.querySelectorAll("[class]")), function(node) {
		node.removeAttribute("class");
	});
	return container.innerHTML;
};

/*
Source of `clip` for outside: items at level 1, the way they paste into an empty tiddler (a sub-item copied alone
would otherwise render inside empty outer list items). Anything else as it is.
*/
methods.outsideSource = function(clip) {
	var adapter = this.getAdapter();
	if(clip.kind !== "items" || !adapter.paste) {
		return clip.source;
	}
	var result = adapter.paste("", buildModel(this.wiki, "", this.tiddlerTitle), -1, clip,
		buildModel(this.wiki, clip.source, this.tiddlerTitle));
	return result ? result.text : clip.source;
};

// Write the selected unit to the clipboard of `event`; false without a clip
methods.writeClip = function(event) {
	var clip = this.selectedClip();
	if(!clip) {
		return false;
	}
	var source = this.outsideSource(clip);
	event.clipboardData.setData("text/plain", source);
	event.clipboardData.setData("text/html", this.clipHtml(source));
	event.clipboardData.setData(CLIP_TYPE, JSON.stringify(clip));
	this.flashUnit(this.selectedId);
	return true;
};

/*
The outline a clipboard event is for: this one when it owns it, else the outline of its overlay (or one inside that)
when that one has the focus. The browser sends copy/cut/paste to where the page's caret is, which can still be in
this outline's text while its overlay has the keyboard focus. Null when none (or the event was handled already).
*/
methods.clipboardOutline = function(event, paste) {
	if(event.defaultPrevented) {
		return null;
	}
	if(this.ownsClipboardEvent(event, paste)) {
		return this;
	}
	return this.overlay && this.overlay.outline ? this.overlay.outline.clipboardOutline(event, paste) : null;
};

methods.handleCopy = function(event) {
	var w = this.clipboardOutline(event);
	if(w) {
		w.writeClip(event);
		event.preventDefault();
	}
};

// A short highlight of unit `id` with its subtree (a heading: its whole section; CSS class, removed after FLASH_MS)
methods.flashUnit = function(id) {
	var u = this.model && this.model.units[id],
		nodes = [];
	$tw.utils.each(this.units, function(entry) {
		var x = entry.unit;
		if(u && x.start >= u.start && x.start < u.subtreeEnd) {
			nodes.push.apply(nodes, entry.domNodes);
		}
	});
	// Nodes inside another flashed node (sub-items in their item) get it from there
	nodes = nodes.filter(function(node) {
		return !nodes.some(function(other) { return other !== node && other.contains(node); });
	});
	$tw.utils.each(nodes, function(node) {
		dom.setClass(node, COPIED_CLASS, true);
	});
	setTimeout(function() {
		$tw.utils.each(nodes, function(node) {
			dom.setClass(node, COPIED_CLASS, false);
		});
	}, FLASH_MS);
};

// Copy, then delete like Delete's first entry, without asking; one write (one undo step)
methods.handleCut = function(event) {
	var w = this.clipboardOutline(event);
	if(!w) {
		return;
	}
	event.preventDefault();
	if(!w.isReadOnly() && !w.editor && w.writeClip(event)) {
		w.operate("deleteUnit");
	}
};

// The clip on the clipboard of `event`: the outline's own format, else the plain text as wikitext; or null
methods.readClip = function(event, adapter) {
	var data = event.clipboardData, clip = null;
	try {
		clip = JSON.parse(data.getData(CLIP_TYPE) || "null");
	} catch(e) {
		clip = null;
	}
	if(!clip || typeof clip.source !== "string") {
		var text = (data.getData("text/plain") || "").replace(/^(\s*\n)+/, "").replace(/\s+$/, "");
		clip = text && adapter.clipKind ? {source: text} : null;
	}
	if(!clip || !/\S/.test(clip.source)) {
		return null;
	}
	clip.model = buildModel(this.wiki, clip.source, this.tiddlerTitle);
	clip.kind = clip.kind || adapter.clipKind(clip.model);
	return clip;
};

// Paste after the selected unit, or at the end of a tiddler without units
methods.handlePaste = function(event) {
	var w = this.clipboardOutline(event, true);
	if(w && w !== this) {
		w.handlePaste(event);
		return;
	}
	var adapter = this.getAdapter();
	if(!w || !adapter || !adapter.paste) {
		return;
	}
	// Not also imported as tiddlers by a dropzone around the outline (it does not check defaultPrevented)
	event.preventDefault();
	event.stopPropagation();
	var clip = this.readClip(event, adapter);
	if(!clip || this.isReadOnly() || this.editor || !this.ensureCurrent()) {
		return;
	}
	var tiddler = this.wiki.getTiddler(this.tiddlerTitle);
	if(!tiddler) {
		return;
	}
	var id = this.hasSelectable() ? this.selectedId : -1,
		result = adapter.paste(tiddler.fields.text || "", this.model, id, clip, clip.model);
	if(result) {
		this.writeText(tiddler, result.text);
		this.saveSelection(result.select, id + 1, result.kind);
	}
};

exports.install = function(proto) {
	$tw.utils.each(methods, function(fn, name) {
		proto[name] = fn;
	});
};
