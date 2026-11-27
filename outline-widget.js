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
	editor = require("$:/plugins/rimir/outline/outline-editor.js"),
	menu = require("$:/plugins/rimir/outline/outline-menu.js"),
	undo = require("$:/plugins/rimir/outline/outline-undo.js"),
	clipboard = require("$:/plugins/rimir/outline/outline-clipboard.js"),
	dom = require("$:/plugins/rimir/outline/dom-utils.js"),
	blockTypes = require("$:/plugins/rimir/outline/block-types.js");

var AWAKE_CLASS = "rr-ol-awake",
	MARKER_TIDDLER = "$:/plugins/rimir/outline/ui/transclusion-marker",
	EMPTY_HINT = "$:/plugins/rimir/outline/language/block/empty-hint",
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
// Block menu (Alt-Enter): openMenu, closeMenu, handleMenuKeydown
menu.install(OutlineWidget.prototype);
undo.install(OutlineWidget.prototype);
// System clipboard (copy, cut, paste events): handleCopy, handleCut, handlePaste
clipboard.install(OutlineWidget.prototype);

OutlineWidget.prototype.render = function(parent, nextSibling) {
	this.parentDomNode = parent;
	this.computeAttributes();
	this.execute();
	var domNode = this.document.createElement("div");
	domNode.className = "rr-ol";
	domNode.setAttribute("data-ol-tiddler", this.tiddlerTitle);
	var self = this;
	domNode.addEventListener("keydown", function(event) { self.handleKeydown(event); }, false);
	domNode.addEventListener("click", function(event) { self.handleClick(event); }, false);
	domNode.addEventListener("dblclick", function(event) { self.handleDblClick(event); }, false);
	domNode.addEventListener("copy", function(event) { self.handleCopy(event); }, false);
	domNode.addEventListener("cut", function(event) { self.handleCut(event); }, false);
	domNode.addEventListener("paste", function(event) { self.handlePaste(event); }, false);
	// The block menu closes when the focus leaves the outline
	domNode.addEventListener("focusout", function(event) {
		if(!event.relatedTarget || !domNode.contains(event.relatedTarget)) {
			self.closeMenu();
		}
	}, false);
	parent.insertBefore(domNode, nextSibling);
	this.renderChildren(domNode, null);
	this.domNodes.push(domNode);
	this.domNode = domNode;
	// Idle until woken (Ctrl-Click), unless this tiddler is being worked on (a re-render, another view)
	if(this.wakesItself()) {
		this.wake();
	}
};

// True when the tiddler has a selection or an open edit (their temp tiddlers): a new widget of it starts awake
OutlineWidget.prototype.wakesItself = function() {
	return this.wiki.tiddlerExists(this.selectionTitle()) || this.wiki.tiddlerExists(this.bufferTitle());
};

/*
Wake the outline: map and stamp the units, take keyboard focus (tabindex), watch the layout and mousedowns outside
the tiddler (they put it to sleep). Returns true when it woke, false when it already was awake.
*/
OutlineWidget.prototype.wake = function() {
	if(this.awake) {
		return false;
	}
	var self = this,
		domNode = this.domNode,
		view = this.document.defaultView;
	this.awake = true;
	dom.setClass(domNode, AWAKE_CLASS, true);
	domNode.setAttribute("tabindex", "0");
	this.mapUnits();
	// Layout changes (window width, images, the editor) move the item selection frame
	if($tw.browser && view && view.ResizeObserver) {
		this.resizeObserver = new view.ResizeObserver(function() { self.drawSelectionBox(); });
		this.resizeObserver.observe(domNode);
	}
	if($tw.browser && this.document.addEventListener) {
		this.outsideListener = function(event) {
			if(!self.ownsTarget(event.target)) {
				self.sleep();
			}
		};
		this.document.addEventListener("mousedown", this.outsideListener, true);
	}
	return true;
};

/*
Back to idle: no stamps, markers, selection, menu, key overview or empty hint; no focus stop. Refused (false) while
an editor is open.
*/
OutlineWidget.prototype.sleep = function() {
	if(!this.awake || this.editor) {
		return false;
	}
	this.closeMenu();
	this.stopWatching();
	this.clearStamps();
	this.showSelection(-1);
	this.units = [];
	this.awake = false;
	this.showEmptyHint();
	this.wiki.deleteTiddler(this.selectionTitle());
	this.wiki.deleteTiddler(this.helpTitle());
	dom.setClass(this.domNode, AWAKE_CLASS, false);
	this.domNode.removeAttribute("tabindex");
	return true;
};

/*
True when `node` is in a view of this outline's tiddler: in an outline of the same tiddler (this one or another view
of it, which shares the selection) or in the frame around one (its ? button and key overview).
*/
OutlineWidget.prototype.ownsTarget = function(node) {
	var title = this.tiddlerTitle;
	for(var n = node; n && n.getAttribute; n = n.parentNode) {
		var classes = " " + (n.getAttribute("class") || "") + " ";
		if(classes.indexOf(" rr-ol ") !== -1) {
			return n.getAttribute("data-ol-tiddler") === title;
		}
		if(classes.indexOf(" rr-ol-frame ") !== -1) {
			var own = firstOutline(n);
			return !!own && own.getAttribute("data-ol-tiddler") === title;
		}
	}
	return false;
};

// The first .rr-ol element below `node` (document order), or null
function firstOutline(node) {
	var children = node.children || [];
	for(var i = 0; i < children.length; i++) {
		var child = children[i];
		if(child.getAttribute && (" " + (child.getAttribute("class") || "") + " ").indexOf(" rr-ol ") !== -1) {
			return child;
		}
		var found = firstOutline(child);
		if(found) {
			return found;
		}
	}
	return null;
}

// Stop the layout observer and the outside mousedown listener of an awake outline
OutlineWidget.prototype.stopWatching = function() {
	if(this.resizeObserver) {
		this.resizeObserver.disconnect();
		this.resizeObserver = null;
	}
	if(this.outsideListener) {
		this.document.removeEventListener("mousedown", this.outsideListener, true);
		this.outsideListener = null;
	}
};

OutlineWidget.prototype.execute = function() {
	this.tiddlerTitle = this.getAttribute("tiddler", this.getVariable("currentTiddler"));
	this.model = null;
	this.units = [];
	this.markers = [];
	this.selectedId = -1;
	this.selectedNodes = [];
	this.selectionBox = null;
	this.menu = null;
	this.editor = null;
	this.pendingContinue = null;
	this.markerHtml = null;
	this.lastWritten = null;
	this.undoGroupState = null;
	this.emptyHint = null;
	this.awake = false;
	this.resizeObserver = null;
	this.outsideListener = null;
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
	if(!this.awake) {
		// Another view of this tiddler started working on it (selection, edit): this one wakes too
		if((changedTiddlers[this.selectionTitle()] || changedTiddlers[this.bufferTitle()]) && this.wakesItself()) {
			this.wake();
		}
		return refreshed;
	}
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
	var leaving = this.leftStory();
	this.stopWatching();
	this.closeMenu();
	if(leaving) {
		// Closed (any way: close, close all, close others, a changed story list): forget its outline state, also a
		// changed edit; a reopened tiddler starts idle
		if(this.editor) {
			this.closeEditor(true);
		}
		var wiki = this.wiki;
		$tw.utils.each([this.selectionTitle(), this.bufferTitle(), this.helpTitle()], function(title) {
			if(wiki.tiddlerExists(title)) {
				wiki.deleteTiddler(title);
			}
		});
	} else {
		this.releaseEditor();
	}
	Widget.prototype.destroy.call(this, options);
};

// True when this outline is in a story river (tv-story-list) whose list no longer has its tiddler
OutlineWidget.prototype.leftStory = function() {
	var story = this.getVariable("tv-story-list");
	return !!story && this.wiki.getTiddlerList(story).indexOf(this.tiddlerTitle) === -1;
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
	if(this.awake) {
		this.mapUnits();
	}
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
	this.mapDiagrams();
	this.restoreSelection();
	this.showEmptyHint();
	this.reattachEditor();
};

/*
A tiddler without units (empty, or only whitespace and comments) has nothing to select: a hint says that Enter writes
a first paragraph and Alt-Enter offers the block types. Not part of the body's widget tree; hidden while editing.
*/
OutlineWidget.prototype.showEmptyHint = function() {
	var show = this.awake && !this.hasSelectable() && !this.isReadOnly() && !!this.getAdapter();
	if(show && !this.emptyHint) {
		this.emptyHint = this.document.createElement("div");
		this.emptyHint.className = "rr-ol-empty";
		this.emptyHint.appendChild(this.document.createTextNode(this.wiki.getTiddlerText(EMPTY_HINT, "")));
		this.domNode.appendChild(this.emptyHint);
	} else if(!show && this.emptyHint) {
		if(this.emptyHint.parentNode) {
			this.emptyHint.parentNode.removeChild(this.emptyHint);
		}
		this.emptyHint = null;
	}
};

// Remove stamps and markers of the previous mapping (DOM nodes that were not re-rendered keep them otherwise)
OutlineWidget.prototype.clearStamps = function() {
	$tw.utils.each(this.units, function(entry) {
		$tw.utils.each(entry.domNodes, function(node) {
			node.removeAttribute("data-ol-id");
			node.removeAttribute("data-ol-kind");
			node.removeAttribute("data-ol-start");
			node.removeAttribute("data-ol-type");
			node.removeAttribute("data-ol-typed");
		});
	});
	$tw.utils.each(this.markers, function(marker) {
		if(marker.parentNode) {
			marker.parentNode.removeChild(marker);
		}
	});
	this.markers = [];
	$tw.utils.each(this.diagrams, function(d) {
		d.node.removeAttribute("data-ol-diagram-target");
		d.node.removeAttribute("data-ol-diagram");
	});
	this.diagrams = [];
};

/*
Diagram transclusions: transclude widgets below the body whose target tiddler is of a registered typed block type's
content type (block-types.js), inline inside a unit ({{...}} in a list item) or a block-level transclusion unit. Their
first element gets data-ol-diagram-target (and, for a transclusion unit itself, data-ol-diagram). They are no units of
their own. Only the host's own content is searched: a diagram inside another transcluded tiddler belongs to that one. Fills this.diagrams = [{title, node, id}] (id: the unit whose element contains it).
*/
OutlineWidget.prototype.mapDiagrams = function() {
	var self = this,
		wiki = this.wiki,
		body = this.findBodyTransclude(this),
		types = blockTypes.getBlockTypes(wiki);
	this.diagrams = [];
	if(!body || !types.some(function(t) { return t.behaviour === "typed"; })) {
		return;
	}
	function walk(widget) {
		$tw.utils.each(widget.children, function(child) {
			var title = child.parseTreeNode && child.parseTreeNode.type === "transclude" && !child.transcludeVariable ?
					child.transcludeTitle : null,
				tiddler = title && wiki.getTiddler(title),
				node = tiddler && blockTypes.typeForContentType(wiki, tiddler.fields.type) ? elementNodes(child)[0] : null;
			if(node) {
				var owner = node;
				while(owner && !(owner.getAttribute && owner.getAttribute("data-ol-id") !== null && owner.getAttribute("data-ol-id") !== undefined)) {
					owner = owner.parentNode;
				}
				if(owner && owner !== self.domNode) {
					node.setAttribute("data-ol-diagram-target", title);
					if(owner === node) {
						node.setAttribute("data-ol-diagram", "yes");
					}
					self.diagrams.push({title: title, node: node, id: parseInt(owner.getAttribute("data-ol-id"), 10)});
				}
			} else if(!isForeign(child, self.tiddlerTitle)) {
				walk(child);
			}
		});
	}
	walk(body);
};

// Diagram transclusions inside unit `id` (see mapDiagrams): [{title, node}]
OutlineWidget.prototype.diagramTargets = function(id) {
	return (this.diagrams || []).filter(function(d) { return d.id === id; }).map(function(d) {
		return {title: d.title, node: d.node};
	});
};

OutlineWidget.prototype.stamp = function(entry) {
	var unit = entry.unit;
	$tw.utils.each(entry.domNodes, function(node) {
		node.setAttribute("data-ol-id", unit.id);
		node.setAttribute("data-ol-kind", unit.kind);
		node.setAttribute("data-ol-start", unit.start);
	});
	// The type badge (CSS, when on) goes on the first node only; a registered typed block ($$$type) shows its type's
	// badge and is marked data-ol-typed (placed like a code block's badge)
	if(entry.domNodes.length) {
		var adapter = this.getAdapter(),
			typed = adapter && adapter.typedBlockType ? adapter.typedBlockType(this.model.text, unit, blockTypes.getBlockTypes(this.wiki)) : null;
		entry.domNodes[0].setAttribute("data-ol-type", typed ? typed.badge : dom.unitType(unit.kind, entry.domNodes[0]));
		if(typed) {
			entry.domNodes[0].setAttribute("data-ol-typed", "yes");
		}
	}
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
	var lastStart = 0;
	function walk(widget) {
		$tw.utils.each(widget.children, function(child) {
			var unit = self.matchWidget(child, byAnchor, used) || self.matchOverride(child, used, lastStart);
			if(unit) {
				used[unit.id] = true;
				lastStart = unit.start;
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

/*
A core widget overridden by a custom widget definition (for example `\widget $codeblock` of a plugin) is built as a
transclude of the variable "$<type>" without source positions. The walk is in document order, so it stands for the
next unmatched unit of that type at or after the last matched one. Its rendered elements become the unit's nodes;
its inside stays opaque.
*/
OutlineWidget.prototype.matchOverride = function(widget, used, after) {
	var node = widget.parseTreeNode,
		name = widget.transcludeVariable;
	if(!node || node.type !== "transclude" || !name || name.charAt(0) !== "$" || name.length < 2) {
		return null;
	}
	var type = name.substring(1),
		units = this.model.units;
	for(var i = 0; i < units.length; i++) {
		if(!used[units[i].id] && units[i].tag === type && units[i].start >= after) {
			return units[i];
		}
	}
	return null;
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
