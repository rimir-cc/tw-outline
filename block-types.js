/*\
title: $:/plugins/rimir/outline/block-types.js
type: application/javascript
module-type: library

Registry of block types: tiddlers tagged $:/tags/rimir/outline/BlockType, in tag order. Outline ships its own as
shadows ($:/plugins/rimir/outline/blocktypes/*); other plugins add theirs the same way.

getBlockTypes(wiki)                  -> [type] (cached until the next tiddler change)
getBlockType(wiki, name)             -> type or null
typeForContentType(wiki, contentType) -> the typed type for a content type, or null

type: {title, name, caption, badge, behaviour, level, marker, open, close, contentType, starter, docs, contexts, inline,
       turnInto, singleLine, kind, make(content, nl)}
  docs       - a link to the format's documentation (shown with a diagram's code field, ui/diagram-tools)
Examples for a type are tiddlers tagged $:/tags/rimir/outline/Snippet with for: <type name> (ui/diagram-tools).
  behaviour  - paragraph | heading (level 1-6) | item (marker) | fenced (open, close lines) | typed (content-type:
               a $$$<content-type> ... $$$ block)
  kind       - the unit kind it produces: block, heading or item
  singleLine - heading and item: one source line (line breaks become <br>)
  contexts   - where it can be inserted: "block" and/or "item" (inside a list item)
  inline     - for the item context: "transclude" or a template with $content$
A tiddler without a name, with an unknown behaviour or without the fields its behaviour needs is skipped.

\*/
"use strict";

var utils = require("$:/plugins/rimir/outline/text-utils.js");

var TAG = "$:/tags/rimir/outline/BlockType",
	KINDS = {paragraph: "block", heading: "heading", item: "item", fenced: "block", typed: "block"};

exports.TAG = TAG;

function field(tiddler, name) {
	var value = tiddler.fields[name];
	return typeof value === "string" ? value : "";
}

// The type of a tagged tiddler, or null when it is broken
function makeType(tiddler) {
	var behaviour = field(tiddler, "behaviour"),
		type = {
			title: tiddler.fields.title,
			name: field(tiddler, "name").trim(),
			caption: field(tiddler, "caption") || field(tiddler, "name"),
			badge: field(tiddler, "badge"),
			behaviour: behaviour,
			level: parseInt(field(tiddler, "level"), 10) || 0,
			marker: field(tiddler, "marker").trim(),
			open: field(tiddler, "open"),
			close: field(tiddler, "close"),
			contentType: field(tiddler, "content-type").trim(),
			starter: field(tiddler, "starter"),
			docs: field(tiddler, "docs").trim(),
			contexts: $tw.utils.parseStringArray(field(tiddler, "contexts") || "block"),
			inline: field(tiddler, "inline"),
			turnInto: field(tiddler, "turn-into"),
			kind: KINDS[behaviour],
			singleLine: behaviour === "heading" || behaviour === "item"
		};
	if(!type.name || !type.kind) {
		return null;
	}
	switch(behaviour) {
		case "paragraph":
			type.make = function(c) { return c; };
			break;
		case "heading":
			if(type.level < 1 || type.level > 6) { return null; }
			var bangs = new Array(type.level + 1).join("!");
			type.make = function(c) { return bangs + " " + utils.toBreaks(c); };
			break;
		case "item":
			if(!/^[*#>]+$/.test(type.marker)) { return null; }
			type.make = function(c) { return type.marker + " " + utils.toBreaks(c); };
			break;
		case "fenced":
			if(!type.open || !type.close) { return null; }
			type.make = function(c, nl) { return type.open + nl + c + nl + type.close; };
			break;
		case "typed":
			if(!type.contentType) { return null; }
			type.make = function(c, nl) { return "$$$" + type.contentType + nl + c + nl + "$$$"; };
			break;
	}
	return type;
}

// Cached in the wiki's global cache, which TiddlyWiki clears synchronously on every tiddler change
exports.getBlockTypes = function(wiki) {
	return wiki.getGlobalCache("rimir-outline-block-types", function() {
		var types = [], seen = Object.create(null);
		$tw.utils.each(wiki.filterTiddlers("[all[shadows+tiddlers]tag[" + TAG + "]!is[draft]]"), function(title) {
			var tiddler = wiki.getTiddler(title),
				type = tiddler && makeType(tiddler);
			if(type && !seen[type.name]) {
				seen[type.name] = true;
				types.push(type);
			}
		});
		return types;
	});
};

exports.getBlockType = function(wiki, name) {
	var types = exports.getBlockTypes(wiki);
	for(var i = 0; i < types.length; i++) {
		if(types[i].name === name) { return types[i]; }
	}
	return null;
};

exports.typeForContentType = function(wiki, contentType) {
	var types = exports.getBlockTypes(wiki);
	for(var i = 0; i < types.length; i++) {
		if(types[i].behaviour === "typed" && types[i].contentType === contentType) { return types[i]; }
	}
	return null;
};
