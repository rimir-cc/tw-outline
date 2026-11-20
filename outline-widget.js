/*\
title: $:/plugins/rimir/outline/outline-widget.js
type: application/javascript
module-type: widget

The $outline widget: wraps the normal body transclusion of a tiddler, maps the units of its
text to the rendered DOM nodes and stamps them with data-ol-* attributes.

<$outline tiddler=<<currentTiddler>>><$transclude $tiddler=<<currentTiddler>> $mode="block"/></$outline>

After render and refresh:
  widget.model      - buildModel() of the tiddler text
  widget.units      - [{unit, domNodes:[Element]}] in model order
  widget.selectedId - selected unit id or -1 (selection and keys: outline-keys.js)
  widget.editor     - open in-place editor or null (outline-editor.js); re-attached after each mapping

Matching rule (unit <-> widget): a widget matches a unit when its parseTreeNode.start equals the
unit's anchor (the unit start; for $$$ typed blocks the start of the line after the $$$ header,
where the parser starts the node) and its tag (element tag, else parse node type) equals unit.tag.
Each unit matches once, in document order. `end` is only a tie-breaker, because the model trims
trailing line breaks and extends lists to their subtree end.

\*/
"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget,
	buildModel = require("$:/plugins/rimir/outline/model.js").buildModel,
	keys = require("$:/plugins/rimir/outline/outline-keys.js"),
	editor = require("$:/plugins/rimir/outline/outline-editor.js");

var MARKER_TIDDLER = "$:/plugins/rimir/outline/ui/transclusion-marker",
	LIST_TAGS = {ul: true, ol: true, dl: true, blockquote: true},
	// Kinds whose widgets may contain further units
	DESCEND_KINDS = {list: true, item: true, container: true},
	// A <span> directly inside these is invalid HTML: the marker goes into their first cell/item
	MARKER_INTO = {ul: "li", ol: "li", dl: "dt dd", table: "td th"};

var OutlineWidget = function(parseTreeNode, options) {
	this.initialise(parseTreeNode, options);
};

OutlineWidget.prototype = new Widget();

// Selection, keys and structural operations: select, step, operate, applyResult, handleKeydown, handleClick
keys.install(OutlineWidget.prototype);
// In-place editor: startEdit, saveEdit, cancelEdit, reattachEditor, handleEditorKeydown, openTarget
editor.install(OutlineWidget.prototype);

OutlineWidget.prototype.render = function(parent, nextSibling) {
	this.parentDomNode = parent;
	this.computeAttributes();
	this.execute();
	var domNode = this.document.createElement("div");
	domNode.className = "rr-ol";
	domNode.setAttribute("tabindex", "0");
	var self = this;
	domNode.addEventListener("keydown", function(event) { self.handleKeydown(event); }, false);
	domNode.addEventListener("click", function(event) { self.handleClick(event); }, false);
	parent.insertBefore(domNode, nextSibling);
	this.renderChildren(domNode, null);
	this.domNodes.push(domNode);
	this.domNode = domNode;
	this.mapUnits();
};

OutlineWidget.prototype.execute = function() {
	this.tiddlerTitle = this.getAttribute("tiddler", this.getVariable("currentTiddler"));
	this.model = null;
	this.units = [];
	this.markers = [];
	this.selectedId = -1;
	this.selectedNodes = [];
	this.editor = null;
	this.pendingContinue = null;
	this.markerHtml = null;
	this.lastWritten = null;
	this.makeChildWidgets();
};

OutlineWidget.prototype.refresh = function(changedTiddlers) {
	var changedAttributes = this.computeAttributes();
	if(changedAttributes.tiddler) {
		this.refreshSelf();
		return true;
	}
	if(changedTiddlers[MARKER_TIDDLER]) {
		this.markerHtml = null;
	}
	var refreshed = this.refreshChildren(changedTiddlers);
	if(this.editor && this.editor.widget) {
		this.editor.widget.refresh(changedTiddlers);
	}
	if(refreshed || changedTiddlers[this.tiddlerTitle]) {
		this.mapUnits();
	} else if(changedTiddlers[this.selectionTitle()]) {
		this.restoreSelection();
	}
	return refreshed;
};

/*
Remove the editor (it is not part of the children). A changed buffer is kept and reopened by the next widget of
this tiddler (an ancestor re-render destroys this widget); an unchanged one is discarded (releaseEditor).
*/
OutlineWidget.prototype.destroy = function(options) {
	this.releaseEditor();
	Widget.prototype.destroy.call(this, options);
};

/*
Re-render the children into the same container (keeps the focus) and remap. Used when the text changed
before the change was rendered.
*/
OutlineWidget.prototype.rebuild = function() {
	this.clearStamps();
	this.showSelection(-1);
	$tw.utils.each(this.children, function(child) {
		child.destroy({removeDOMNodes: true});
	});
	this.makeChildWidgets();
	this.renderChildren(this.domNode, null);
	this.mapUnits();
};

/*
Rebuild the model (when the text changed), match units to widgets, stamp the DOM nodes and
add the transclusion markers. Fills this.model and this.units.
*/
OutlineWidget.prototype.mapUnits = function() {
	var text = this.wiki.getTiddlerText(this.tiddlerTitle, "");
	if(!this.model || this.model.text !== text) {
		this.model = buildModel(this.wiki, text, this.tiddlerTitle);
	}
	this.clearStamps();
	var units = this.model.units,
		domNodes = this.matchUnits(),
		self = this;
	this.units = units.map(function(unit) {
		return {unit: unit, domNodes: domNodes[unit.id] || []};
	});
	$tw.utils.each(this.units, function(entry) {
		self.stamp(entry);
	});
	this.restoreSelection();
	this.reattachEditor();
};

// Remove stamps and markers of the previous mapping (DOM nodes that were not re-rendered keep them otherwise)
OutlineWidget.prototype.clearStamps = function() {
	$tw.utils.each(this.units, function(entry) {
		$tw.utils.each(entry.domNodes, function(node) {
			node.removeAttribute("data-ol-id");
			node.removeAttribute("data-ol-kind");
			node.removeAttribute("data-ol-start");
		});
	});
	$tw.utils.each(this.markers, function(marker) {
		if(marker.parentNode) {
			marker.parentNode.removeChild(marker);
		}
	});
	this.markers = [];
};

OutlineWidget.prototype.stamp = function(entry) {
	var unit = entry.unit;
	$tw.utils.each(entry.domNodes, function(node) {
		node.setAttribute("data-ol-id", unit.id);
		node.setAttribute("data-ol-kind", unit.kind);
		node.setAttribute("data-ol-start", unit.start);
	});
	if(unit.kind === "transclusion" && entry.domNodes.length) {
		this.addMarker(entry.domNodes[0], unit.target);
	}
};

OutlineWidget.prototype.addMarker = function(node, target) {
	var marker = this.document.createElement("span");
	marker.className = "rr-ol-tmark";
	marker.setAttribute("title", target);
	marker.setAttribute("data-ol-target", target);
	if(this.markerHtml === null) {
		this.markerHtml = this.wiki.renderTiddler("text/html", MARKER_TIDDLER, {parseAsInline: true});
	}
	marker.innerHTML = this.markerHtml;
	markerParent(node).appendChild(marker);
	this.markers.push(marker);
};

// The element that takes the marker: the node itself, or for lists and tables their first item/cell
function markerParent(node) {
	var into = MARKER_INTO[(node.tagName || "").toLowerCase()];
	return (into && firstDescendant(node, into.split(" "))) || node;
}

function firstDescendant(node, tags) {
	var children = node.childNodes || [];
	for(var i = 0; i < children.length; i++) {
		var child = children[i];
		if(child.nodeType !== 1) {
			continue;
		}
		if(tags.indexOf((child.tagName || "").toLowerCase()) !== -1) {
			return child;
		}
		var found = firstDescendant(child, tags);
		if(found) {
			return found;
		}
	}
	return null;
}

/*
Walk the widget tree below the body transclusion of the tiddler and return {unitId: [Element]}.
*/
OutlineWidget.prototype.matchUnits = function() {
	var self = this,
		text = this.model.text,
		result = {},
		used = {},
		byAnchor = {};
	$tw.utils.each(this.model.units, function(unit) {
		var anchor = unitAnchor(text, unit);
		(byAnchor[anchor] = byAnchor[anchor] || []).push(unit);
	});
	var body = this.findBodyTransclude(this);
	if(!body) {
		return result;
	}
	function walk(widget) {
		$tw.utils.each(widget.children, function(child) {
			var unit = self.matchWidget(child, byAnchor, used);
			if(unit) {
				used[unit.id] = true;
				result[unit.id] = elementNodes(child);
				if(DESCEND_KINDS[unit.kind]) {
					walk(child);
				}
			} else if(!isForeign(child, self.tiddlerTitle)) {
				walk(child);
			}
		});
	}
	walk(body);
	return result;
};

// First descendant transclude widget that renders this tiddler
OutlineWidget.prototype.findBodyTransclude = function(widget) {
	for(var i = 0; i < widget.children.length; i++) {
		var child = widget.children[i];
		if(child.parseTreeNode && child.parseTreeNode.type === "transclude" &&
			!child.transcludeVariable && child.transcludeTitle === this.tiddlerTitle && rendersText(child)) {
			return child;
		}
		var found = this.findBodyTransclude(child);
		if(found) {
			return found;
		}
	}
	return null;
};

OutlineWidget.prototype.matchWidget = function(widget, byAnchor, used) {
	var node = widget.parseTreeNode;
	if(!node || typeof node.start !== "number") {
		return null;
	}
	var tag = node.type === "element" ? node.tag : node.type,
		candidates = (byAnchor[node.start] || []).filter(function(unit) {
			return !used[unit.id] && unit.tag === tag;
		});
	if(!candidates.length || isSyntheticItem(node)) {
		return null;
	}
	// Tie-breaker: same end (the model trims trailing line breaks, so compare trimmed)
	for(var i = 0; i < candidates.length; i++) {
		if(candidates[i].end === node.end || candidates[i].end === trimEnd(this.model.text, node.start, node.end)) {
			return candidates[i];
		}
	}
	return candidates[0];
};

// Where the parser starts the node of a unit: $$$ typed blocks start after their header line
function unitAnchor(text, unit) {
	if(unit.kind === "block" && text.substr(unit.start, 3) === "$$$") {
		var nl = text.indexOf("\n", unit.start);
		if(nl !== -1) {
			return nl + 1;
		}
	}
	return unit.start;
}

function trimEnd(text, start, end) {
	end = Math.min(end, text.length);
	while(end > start && (text.charAt(end - 1) === "\n" || text.charAt(end - 1) === "\r")) {
		end--;
	}
	return end;
}

// Skipped list levels produce an item that only holds a deeper list starting at the same position
function isSyntheticItem(node) {
	var first = node.children && node.children[0];
	return node.type === "element" && !!first && first.type === "element" &&
		LIST_TAGS[first.tag] && first.start === node.start;
}

/*
A transclude widget of another tiddler, of a variable, or of another field or an index of this tiddler: its
positions refer to another text
*/
function isForeign(widget, title) {
	var node = widget.parseTreeNode;
	return !!node && node.type === "transclude" &&
		(!!widget.transcludeVariable || widget.transcludeTitle !== title || !rendersText(widget));
}

// True when a transclude widget renders the text field (no other field, no index)
function rendersText(widget) {
	return (!widget.transcludeField || widget.transcludeField === "text") && !widget.transcludeIndex;
}

// The widget's own element nodes, or for DOM-less widgets the top-level element nodes of its descendants
function elementNodes(widget) {
	var own = (widget.domNodes || []).filter(isElement);
	if(own.length || (widget.domNodes || []).length) {
		return own;
	}
	var out = [];
	$tw.utils.each(widget.children, function(child) {
		out.push.apply(out, elementNodes(child));
	});
	return out;
}

function isElement(node) {
	return !!node && node.nodeType === 1;
}

exports.outline = OutlineWidget;
