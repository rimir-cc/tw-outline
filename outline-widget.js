/*\
title: $:/plugins/rimir/outline/outline-widget.js
type: application/javascript
module-type: widget

The $outline widget: wraps the normal body transclusion of a tiddler, maps the units of its
text to the rendered DOM nodes and stamps them with data-ol-* attributes.

<$outline tiddler=<<currentTiddler>>><$transclude $tiddler=<<currentTiddler>> $mode="block"/></$outline>

After render and refresh:
  widget.model  - buildModel() of the tiddler text
  widget.units  - [{unit, domNodes:[Element]}] in model order

Matching rule (unit <-> widget): a widget matches a unit when its parseTreeNode.start equals the
unit's anchor (the unit start; for $$$ typed blocks the start of the line after the $$$ header,
where the parser starts the node) and its tag (element tag, else parse node type) equals unit.tag.
Each unit matches once, in document order. `end` is only a tie-breaker, because the model trims
trailing line breaks and extends lists to their subtree end.

\*/
"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget,
	buildModel = require("$:/plugins/rimir/outline/model.js").buildModel;

var MARKER_TIDDLER = "$:/plugins/rimir/outline/ui/transclusion-marker",
	LIST_TAGS = {ul: true, ol: true, dl: true, blockquote: true},
	// Kinds whose widgets may contain further units
	DESCEND_KINDS = {list: true, item: true, container: true};

var OutlineWidget = function(parseTreeNode, options) {
	this.initialise(parseTreeNode, options);
};

OutlineWidget.prototype = new Widget();

OutlineWidget.prototype.render = function(parent, nextSibling) {
	this.parentDomNode = parent;
	this.computeAttributes();
	this.execute();
	var domNode = this.document.createElement("div");
	domNode.className = "rr-ol";
	domNode.setAttribute("tabindex", "0");
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
	this.makeChildWidgets();
};

OutlineWidget.prototype.refresh = function(changedTiddlers) {
	var changedAttributes = this.computeAttributes();
	if(changedAttributes.tiddler) {
		this.refreshSelf();
		return true;
	}
	var refreshed = this.refreshChildren(changedTiddlers);
	if(refreshed || changedTiddlers[this.tiddlerTitle]) {
		this.mapUnits();
	}
	return refreshed;
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
	marker.innerHTML = this.wiki.renderTiddler("text/html", MARKER_TIDDLER, {parseAsInline: true});
	node.appendChild(marker);
	this.markers.push(marker);
};

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
			!child.transcludeVariable && child.transcludeTitle === this.tiddlerTitle) {
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

// A transclude widget of another tiddler or of a variable: its positions refer to another text
function isForeign(widget, title) {
	var node = widget.parseTreeNode;
	return !!node && node.type === "transclude" &&
		(!!widget.transcludeVariable || widget.transcludeTitle !== title);
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
