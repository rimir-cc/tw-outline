/*\
title: $:/plugins/rimir/outline/outline-overlay.js
type: application/javascript
module-type: library

Transclusion overlay of the $outline widget: Shift-Enter (outline-open) on a wikitext transclusion opens the target
tiddler's own outline in an overlay over the unit (ui/overlay: a title bar and an $outline of the target), where it is
navigated and edited as always. install(proto) adds:

  openOverlay(id, title) - open the overlay of `title` over unit `id` (one per outline; a further one opens inside it)
  closeOverlay(force)    - close it, select the unit again, focus this outline; refused while an editor is open in it
                           (or in an overlay inside it) unless forced (its unit is gone, this outline goes away):
                           then that edit is kept like an edit over a re-render
  overlayBusy()          - true while an editor is open in the overlay (or in one inside it), or a diagram's source
                           in it is changed
  saveOverlay()          - a diagram overlay: write the source into the diagram tiddler and close

A diagram (a tiddler of a registered typed block type, see block-types.js) opens in ui/overlay-diagram instead: its
source in a code field (buffer $:/temp/rimir/outline/diagram/<this title>, of the diagram's type) and a live preview of
the buffer below it. Ctrl-Enter (outline-save) saves, Escape (outline-cancel) closes without writing.
  placeOverlay()         - after a remap: put it at its unit's top again; close it when the unit is gone
  inOverlay(node)        - true when node is inside this outline's overlay
  overlayHost()          - for the outline inside an overlay: the outline that opened it (else null)

this.overlay = {id, start, kind, title, element, widget, outline}
The element is a child of this outline's container, outside the body's widget tree: a re-render keeps it. The host
ignores events from inside it (handleClick, handleDblClick, ownsTarget); the overlay's outline counts its whole overlay
as its own, so a click on the title bar does not close it. The overlay's outline does not sleep on its own: its sleep
(Escape with nothing selected, a click outside) closes the overlay.

\*/
"use strict";

var dom = require("$:/plugins/rimir/outline/dom-utils.js"),
	findUnit = require("$:/plugins/rimir/outline/model.js").findUnit,
	SELECTION_PREFIX = require("$:/plugins/rimir/outline/outline-keys.js").SELECTION_PREFIX;

var blockTypes = require("$:/plugins/rimir/outline/block-types.js");

var TEMPLATE = "$:/plugins/rimir/outline/ui/overlay",
	DIAGRAM_TEMPLATE = "$:/plugins/rimir/outline/ui/overlay-diagram",
	DIAGRAM_BUFFER_PREFIX = "$:/temp/rimir/outline/diagram/",
	OVERLAY_CLASS = "rr-ol-overlay",
	HOST_VARIABLE = "rr-ol-overlay-host";

function findOutline(widget) {
	for(var i = 0; i < (widget.children || []).length; i++) {
		var child = widget.children[i];
		if(child.parseTreeNode && child.parseTreeNode.type === "outline") {
			return child;
		}
		var found = findOutline(child);
		if(found) {
			return found;
		}
	}
	return null;
}

var methods = {};

methods.openOverlay = function(id, title) {
	if(!this.isSelectable(id) || !title || !this.wiki.tiddlerExists(title)) {
		return false;
	}
	this.closeOverlay();
	var target = this.wiki.getTiddler(title),
		diagram = !!blockTypes.typeForContentType(this.wiki, target.fields.type),
		buffer = diagram ? DIAGRAM_BUFFER_PREFIX + this.tiddlerTitle : "",
		unit = this.units[id].unit,
		element = this.document.createElement("div"),
		typed = blockTypes.typeForContentType(this.wiki, target.fields.type),
		variables = {"rr-ol-overlay-target": title, "rr-ol-overlay-buffer": buffer, "rr-ol-overlay-type": typed ? typed.name : ""},
		self = this;
	variables[HOST_VARIABLE] = "yes";
	if(diagram) {
		this.wiki.addTiddler(new $tw.Tiddler({title: buffer, type: target.fields.type, text: target.fields.text || ""}));
	} else {
		// The overlay's outline wakes itself on render when its selection tiddler exists (first unit, or the kept one)
		var selection = SELECTION_PREFIX + title;
		if(!this.wiki.tiddlerExists(selection)) {
			this.wiki.addTiddler(new $tw.Tiddler({title: selection, start: "0", index: "0", kind: ""}));
		}
	}
	element.className = OVERLAY_CLASS;
	this.domNode.appendChild(element);
	var widget = this.wiki.makeTranscludeWidget(diagram ? DIAGRAM_TEMPLATE : TEMPLATE, {
		parentWidget: this,
		document: this.document,
		variables: variables
	});
	widget.render(element, null);
	this.overlay = {id: id, start: unit.start, kind: unit.kind, title: title, element: element, widget: widget,
		outline: diagram ? null : findOutline(widget), diagram: diagram, buffer: buffer, orig: target.fields.text || ""};
	// The diagram's code field: Ctrl-Enter saves, Escape closes without writing
	if(diagram) {
		element.addEventListener("keydown", function(event) {
			if(self.keyMatches(event, "outline-save")) {
				self.saveOverlay();
			} else if(self.keyMatches(event, "outline-cancel")) {
				self.closeOverlay(true);
			} else {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
		}, false);
	}
	// Title bar buttons (data-ol-overlay-action): close, open in the story
	// A mousedown on the title bar or the overlay's edge does not move the keyboard focus to this outline (below it)
	element.addEventListener("mousedown", function(event) {
		var o = self.overlay;
		if(o && o.outline && !dom.isInside(event.target, o.outline.domNode)) {
			event.preventDefault();
			dom.focus(o.outline.domNode);
		}
	}, false);
	element.addEventListener("click", function(event) {
		for(var n = event.target; n && n !== element; n = n.parentNode) {
			var action = n.getAttribute && n.getAttribute("data-ol-overlay-action");
			if(action) {
				event.preventDefault();
				event.stopPropagation();
				if(self.closeOverlay() && action === "story") {
					self.openTarget(title);
				}
				return;
			}
		}
	}, false);
	this.placeOverlay();
	if(this.overlay) {
		if(element.scrollIntoView && this.document.defaultView) {
			element.scrollIntoView({block: "nearest"});
		}
		if(this.overlay.outline) {
			dom.focus(this.overlay.outline.domNode);
			// Copy / cut / paste go where the caret is (dom.caretInto)
			dom.caretInto(this.overlay.outline.domNode);
		}
	}
	return true;
};

methods.overlayBusy = function() {
	var o = this.overlay;
	if(o && o.diagram) {
		return this.wiki.getTiddlerText(o.buffer, "") !== o.orig;
	}
	var outline = o && o.outline;
	return !!outline && (!!outline.editor || outline.overlayBusy());
};

methods.saveOverlay = function() {
	var o = this.overlay;
	if(!o || !o.diagram) {
		return false;
	}
	var text = this.wiki.getTiddlerText(o.buffer, ""),
		tiddler = this.wiki.getTiddler(o.title);
	if(tiddler && text !== (tiddler.fields.text || "")) {
		this.wiki.addTiddler(new $tw.Tiddler(tiddler, {text: text}, this.wiki.getModificationFields()));
	}
	return this.closeOverlay(true);
};

methods.closeOverlay = function(force) {
	var o = this.overlay;
	if(!o) {
		return false;
	}
	if(!force && this.overlayBusy()) {
		return false;
	}
	this.overlay = null;
	if(o.outline) {
		o.outline.closingOverlay = true;
	}
	o.widget.destroy();
	if(o.element.parentNode) {
		o.element.parentNode.removeChild(o.element);
	}
	if(o.buffer) {
		this.wiki.deleteTiddler(o.buffer);
	}
	if(this.awake && this.units.length) {
		var id = findUnit(this.model, o.start, o.kind);
		if(id !== -1) {
			this.select(id);
		}
		dom.focus(this.domNode);
		dom.caretInto(this.domNode);
	}
	return true;
};

methods.placeOverlay = function() {
	var o = this.overlay;
	if(!o) {
		return;
	}
	var id = this.units.length ? findUnit(this.model, o.start, o.kind) : -1;
	if(id === -1 || !this.isSelectable(id)) {
		this.closeOverlay(true);
		return;
	}
	o.id = id;
	// Over the unit: from its first shown element's top, relative to this outline's container (the positioning
	// context; offsetTop would be relative to a positioned list or item)
	var node = dom.firstShown(this.units[id].domNodes);
	if(node && node.getBoundingClientRect && this.domNode.getBoundingClientRect && o.element.style) {
		o.element.style.top = (node.getBoundingClientRect().top - this.domNode.getBoundingClientRect().top) + "px";
	}
};

methods.inOverlay = function(node) {
	return !!this.overlay && dom.isInside(node, this.overlay.element);
};

methods.overlayHost = function() {
	if(this.getVariable(HOST_VARIABLE) !== "yes") {
		return null;
	}
	for(var w = this.parentWidget; w; w = w.parentWidget) {
		if(w.overlay && w.overlay.widget && dom.isInside(this.domNode, w.overlay.element)) {
			return w;
		}
	}
	return null;
};

exports.install = function(proto) {
	$tw.utils.each(methods, function(fn, name) {
		proto[name] = fn;
	});
};
