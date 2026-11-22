/*\
title: $:/plugins/rimir/outline/format-wikitext.js
type: application/javascript
module-type: outline-format

Wikitext adapter: indent, promote, move, replace, insertNew, remove. Functions take (text, model, id) and return null or {text, select}.

\*/
"use strict";

var utils = require("$:/plugins/rimir/outline/text-utils.js"),
	outlineModel = require("$:/plugins/rimir/outline/model.js");

exports.types = ["text/vnd.tiddlywiki", ""];

// A separator that contains an empty line
var BLANK_LINE = /\n[ \t]*\r?\n/;

// Units of `kind` whose start lies in the subtree of u (u included)
function subtreeUnits(model, u, kind) {
	return model.units.filter(function(d) {
		return d.kind === kind && d.start >= u.start && d.start < u.subtreeEnd;
	});
}

// positions: [{pos, insert}] / removals; applied from the end backwards
function apply(text, edits) {
	edits.sort(function(a, b) { return b.pos - a.pos; });
	edits.forEach(function(e) {
		text = utils.splice(text, e.pos, e.pos + e.remove, e.insert);
	});
	return text;
}

function selectFor(u, edits) {
	// units start never moves: edits at u.start insert before it only for headings, where start stays
	return u.start;
}

exports.indent = function(text, model, id) {
	var u = model.units[id], edits;
	if(!u) { return null; }
	if(u.kind === "item") {
		var sibs = u.parent === -1 ? model.roots : model.units[u.parent].children,
			i = sibs.indexOf(id);
		if(i < 1 || model.units[sibs[i - 1]].kind !== "item") { return null; }
		var c = u.marker.charAt(u.level - 1);
		edits = subtreeUnits(model, u, "item").map(function(d) {
			return {pos: d.start + u.level, remove: 0, insert: c};
		});
	} else if(u.kind === "heading") {
		var hs = subtreeUnits(model, u, "heading");
		if(hs.some(function(h) { return h.level >= 6; })) { return null; }
		edits = hs.map(function(h) { return {pos: h.start, remove: 0, insert: "!"}; });
	} else {
		return null;
	}
	return {text: apply(text, edits), select: selectFor(u, edits)};
};

exports.promote = function(text, model, id) {
	var u = model.units[id], edits;
	if(!u) { return null; }
	if(u.kind === "item") {
		if(u.level <= 1) { return null; }
		edits = subtreeUnits(model, u, "item").map(function(d) {
			return {pos: d.start + u.level - 1, remove: 1, insert: ""};
		});
	} else if(u.kind === "heading") {
		if(u.level <= 1) { return null; }
		edits = subtreeUnits(model, u, "heading").map(function(h) {
			return {pos: h.start, remove: 1, insert: ""};
		});
	} else {
		return null;
	}
	return {text: apply(text, edits), select: selectFor(u, edits)};
};

/*
Swap the unit's whole subtree with the adjacent sibling of the same class (heading vs non-heading).
Items and headings keep the separators as they are. Other blocks that touch (single line break) get a blank line
between them and before the content after the pair, because after the swap a paragraph would otherwise absorb the
block after it. Non-whitespace between the blocks (a comment) is kept and set apart by blank lines.
*/
exports.move = function(text, model, id, dir) {
	var u = model.units[id];
	if(!u || (dir !== -1 && dir !== 1)) { return null; }
	var sibs = u.parent === -1 ? model.roots : model.units[u.parent].children,
		i = sibs.indexOf(id), n = sibs[i + dir];
	if(i < 0 || n === undefined) { return null; }
	var o = model.units[n];
	if((o.kind === "heading") !== (u.kind === "heading")) { return null; }
	if((u.kind === "heading" || u.kind === "item") && (o.kind !== u.kind || o.level !== u.level)) { return null; }
	var a = dir < 0 ? o : u, b = dir < 0 ? u : o,
		A = text.substring(a.start, a.subtreeEnd),
		sep = text.substring(a.subtreeEnd, b.start),
		B = text.substring(b.start, b.subtreeEnd),
		rest = text.substring(b.subtreeEnd);
	if(u.kind !== "item" && u.kind !== "heading") {
		var nl = utils.eol(text),
			gap = /^(?:[ \t]*\r?\n)*/.exec(rest)[0];
		if(/\S/.test(sep)) {
			// Keep anything between the blocks (e.g. a comment), set apart by blank lines on both sides
			sep = nl + nl + sep.trim() + nl + nl;
		} else if(!BLANK_LINE.test(sep)) {
			sep = nl + nl;
		}
		// Only whole line breaks are normalised, so the next line keeps its indentation
		if(/\S/.test(rest) && !BLANK_LINE.test(gap)) {
			rest = nl + nl + rest.substring(gap.length);
		}
	}
	return {
		text: text.substring(0, a.start) + B + sep + A + rest,
		select: dir < 0 ? a.start : a.start + B.length + sep.length
	};
};

// Replace the unit's own source with newSource
/*
Offset where the unit's content starts: after an item's marker or a heading's "!"s and the spaces after them.
The editor shows and replaces only the content, so it cannot change the nesting.
*/
function contentStart(text, u) {
	var prefix = u.kind === "item" ? u.marker : u.kind === "heading" ? new Array(u.level + 1).join("!") : "";
	if(!prefix || text.substring(u.start, u.start + prefix.length) !== prefix) {
		return u.start;
	}
	var pos = u.start + prefix.length;
	return pos + /^[ \t]*/.exec(text.substring(pos, u.end))[0].length;
}

// Text typed with the unit's own marker and a space in front (out of habit) loses that marker
function stripTypedMarker(u, source) {
	if(u.kind === "item" && source && source.substring(0, u.marker.length) === u.marker &&
		/^[ \t]/.test(source.substring(u.marker.length))) {
		return source.substring(u.marker.length).replace(/^[ \t]+/, "");
	}
	return source;
}

/*
Items and headings are one source line: a real line break would end the item (the next line becomes a paragraph
that swallows the following items). Their line breaks are stored as <br>; the editor shows them as line breaks.
*/
function isOneLine(u) {
	return u.kind === "item" || u.kind === "heading";
}

function toBreaks(source) {
	return source.replace(/^(?:[ \t]*\r?\n)+|(?:\r?\n[ \t]*)+$/g, "").replace(/[ \t]*\r?\n/g, "<br>");
}

// Replace the unit's content (see contentStart) with newSource
exports.replace = function(text, model, id, newSource) {
	var u = model.units[id];
	if(!u) { return null; }
	newSource = stripTypedMarker(u, newSource);
	if(isOneLine(u)) {
		newSource = toBreaks(newSource);
	}
	return {text: utils.splice(text, contentStart(text, u), u.end, newSource), select: u.start};
};

/*
Insert a new sibling unit (item) or first block (heading/block); null for blank source. A new item's text that
starts with the item's own marker and a space (typed out of habit) loses that marker: it is added anyway.
*/
exports.insertNew = function(text, model, id, newSource) {
	var u = model.units[id];
	newSource = u ? stripTypedMarker(u, newSource) : newSource;
	if(!u || !newSource || !newSource.trim()) { return null; }
	var nl = utils.eol(text), pos, insert, select;
	if(u.kind === "item") {
		pos = u.subtreeEnd;
		insert = nl + u.marker + " " + toBreaks(newSource);
		select = pos + nl.length;
	} else {
		return insertBlockAt(text, u.end, newSource);
	}
	return {text: utils.splice(text, pos, pos, insert), select: select};
};

// Insert block `source` at `pos` (end of a unit), set apart by a blank line before and, when content follows, after
function insertBlockAt(text, pos, source) {
	var nl = utils.eol(text),
		insert = nl + nl + source,
		rest = text.substring(pos);
	if(/\S/.test(rest) && !/^\r?\n[ \t]*\r?\n/.test(rest)) { insert += nl; }
	return {text: utils.splice(text, pos, pos, insert), select: pos + 2 * nl.length};
}

/*
Block types of the Shift-Enter menu: the unit kind they produce and their source from content (line breaks `nl`).
Headings, list items and quote lines are one source line: their line breaks become <br>.
*/
var BLOCK_TYPES = {
	paragraph: {kind: "block", make: function(c) { return c; }},
	heading1: {kind: "heading", make: function(c) { return "! " + toBreaks(c); }},
	heading2: {kind: "heading", make: function(c) { return "!! " + toBreaks(c); }},
	heading3: {kind: "heading", make: function(c) { return "!!! " + toBreaks(c); }},
	bulleted: {kind: "item", make: function(c) { return "* " + toBreaks(c); }},
	numbered: {kind: "item", make: function(c) { return "# " + toBreaks(c); }},
	quote: {kind: "item", make: function(c) { return "> " + toBreaks(c); }},
	code: {kind: "block", make: function(c, nl) { return "```" + nl + c + nl + "```"; }}
};

// Unit kind a block type produces ("item" for list types), or null
exports.blockTypeKind = function(type) {
	return BLOCK_TYPES[type] ? BLOCK_TYPES[type].kind : null;
};

/*
Where insertBlock puts a new block of `type` after unit `id`: right after a heading's own line for a non-heading
block (it becomes the first block of the section), otherwise after the unit's whole subtree.
*/
exports.insertsAfterSubtree = function(model, id, type) {
	var u = model.units[id];
	return !!u && !(u.kind === "heading" && exports.blockTypeKind(type) !== "heading");
};

// Insert a new block of `type` with `content` after unit `id` (see insertsAfterSubtree); null for blank content
exports.insertBlock = function(text, model, id, type, content) {
	var u = model.units[id], t = BLOCK_TYPES[type];
	if(!u || !t || u.kind === "item" || !content || !content.trim()) { return null; }
	var nl = utils.eol(text);
	content = content.replace(/\r?\n/g, nl);
	var result = insertBlockAt(text, exports.insertsAfterSubtree(model, id, type) ? u.subtreeEnd : u.end, t.make(content, nl));
	result.kind = t.kind;
	return result;
};

// Content of a paragraph, heading or code block (line breaks as \n, <br> of headings too), or null for other units
function blockContent(text, u) {
	if(u.kind === "heading") {
		return text.substring(contentStart(text, u), u.end).replace(/<br\s*\/?>/gi, "\n");
	}
	if(u.kind !== "block") {
		return null;
	}
	var source = text.substring(u.start, u.end).replace(/\r\n/g, "\n");
	if(u.tag === "p") {
		return source;
	}
	if(u.tag === "codeblock") {
		return source.replace(/^[^\n]*\n?/, "").replace(/\n?```[ \t]*$/, "");
	}
	return null;
}

/*
The "Turn into" types offered for unit `id`: a bullet switches between bulleted and numbered, a whole list too;
paragraphs, headings and code blocks turn into the other block types. The current type is left out.
*/
exports.convertTypes = function(model, id) {
	var u = model.units[id];
	if(!u) { return []; }
	if(u.kind === "item") {
		var last = u.marker.charAt(u.marker.length - 1);
		return last === "*" ? ["numbered"] : last === "#" ? ["bulleted"] : [];
	}
	if(u.kind === "list") {
		return u.tag === "ul" ? ["numbered"] : u.tag === "ol" ? ["bulleted"] : [];
	}
	var text = model.text;
	if(blockContent(text, u) === null) { return []; }
	var all = u.tag === "codeblock" ? ["paragraph", "bulleted", "numbered", "quote"] :
		["paragraph", "heading1", "heading2", "heading3", "bulleted", "numbered", "quote", "code"];
	return all.filter(function(type) {
		return !(type === "paragraph" && u.tag === "p") && !(u.kind === "heading" && /^heading/.test(type));
	});
};

// Replace the * or # at marker position `index` (-1: every position) with `ch` in `items`; null when nothing changes
function switchMarkers(text, items, index, ch) {
	var edits = [];
	items.forEach(function(it) {
		for(var i = 0; i < it.marker.length; i++) {
			var c = it.marker.charAt(i);
			if((index === -1 || i === index) && (c === "*" || c === "#") && c !== ch) {
				edits.push(it.start + i);
			}
		}
	});
	if(!edits.length) { return null; }
	edits.sort(function(a, b) { return b - a; });
	edits.forEach(function(pos) { text = utils.splice(text, pos, pos + 1, ch); });
	return text;
}

// Items of the subtree of unit u (u itself when it is an item)
function subtreeItems(model, u) {
	return model.units.filter(function(x) {
		return x.kind === "item" && x.start >= u.start && x.start < u.subtreeEnd;
	});
}

/*
Turn unit `id` into block type `type` (see convertTypes). A bullet switches with all its siblings of the same level
(one list type per level; their sub-items follow at that marker position). A whole list switches at all levels.
Other units are rewritten from their content and set apart by blank lines. The result is parsed again: it must
yield a unit of the new kind at the unit's place and no other change in the unit count, otherwise null.
*/
exports.convert = function(text, model, id, type) {
	var u = model.units[id];
	if(!u || exports.convertTypes(model, id).indexOf(type) === -1) { return null; }
	var ch = type === "numbered" ? "#" : "*", newText, kind = u.kind, start = u.start, nl = utils.eol(text);
	if(u.kind === "item") {
		var sibs = (u.parent === -1 ? model.roots : model.units[u.parent].children).map(function(i) { return model.units[i]; })
			.filter(function(x) { return x.kind === "item" && x.level === u.level; }),
			items = [];
		sibs.forEach(function(x) { items = items.concat(subtreeItems(model, x)); });
		newText = switchMarkers(text, items, u.level - 1, ch);
	} else if(u.kind === "list") {
		newText = switchMarkers(text, subtreeItems(model, u), -1, ch);
	} else {
		var source = BLOCK_TYPES[type].make(blockContent(text, u).replace(/\n/g, nl), nl),
			before = text.substring(0, u.start),
			after = text.substring(u.end),
			breaksBefore = (/(?:\r?\n[ \t]*)*$/.exec(before)[0].match(/\n/g) || []).length,
			breaksAfter = (/^(?:[ \t]*\r?\n)*/.exec(after)[0].match(/\n/g) || []).length;
		if(/\S/.test(before) && breaksBefore === 1) {
			source = nl + source;
			start += nl.length;
		}
		if(/\S/.test(after) && breaksAfter === 1) {
			source += nl;
		}
		newText = utils.splice(text, u.start, u.end, source);
		kind = BLOCK_TYPES[type].kind;
	}
	if(newText === null || newText === text) { return null; }
	// A block that becomes a list item also gets its list unit
	var parsed = outlineModel.buildModel($tw.wiki, newText),
		expected = model.units.length + (kind === "item" && u.kind !== "item" && u.kind !== "list" ? 1 : 0);
	if(parsed.units.length !== expected || outlineModel.findUnit(parsed, start, kind) === -1) {
		return null;
	}
	return {text: newText, select: start, kind: kind};
};

/*
Delete a unit without children (blank save in the editor); null for units with children.
Items that have siblings lose their own range plus one adjacent line break. Other units (and an only
item) also lose the blank lines after them, so exactly one separator stays between the neighbours;
the last unit takes the line breaks before it instead.
*/
exports.remove = function(text, model, id) {
	var u = model.units[id];
	if(!u || u.children.length) { return null; }
	var a = u.start, b = u.end,
		after = text.substring(b),
		parent = u.parent === -1 ? null : model.units[u.parent],
		m;
	if(u.kind === "item" && parent && parent.children.length > 1) {
		m = /^\r?\n/.exec(after);
		if(m && /\S/.test(after.substring(m[0].length))) {
			b += m[0].length;
		} else {
			m = /\r?\n$/.exec(text.substring(0, a));
			a -= m ? m[0].length : 0;
		}
	} else {
		m = /^(?:[ \t]*\r?\n)*/.exec(after);
		if(/\S/.test(after.substring(m[0].length))) {
			b += m[0].length;
		} else {
			m = /(?:\r?\n[ \t]*)*$/.exec(text.substring(0, a));
			a -= m[0].length;
		}
	}
	var result = utils.splice(text, a, b, "");
	return {text: result, select: Math.min(a, result.length)};
};

// What the editor shows: the unit's content, without an item marker or heading prefix; <br> in items and headings as line breaks
exports.editSource = function(text, model, id) {
	var u = model.units[id];
	if(!u) { return ""; }
	var content = text.substring(contentStart(text, u), u.end);
	return isOneLine(u) ? content.replace(/<br\s*\/?>/gi, "\n") : content;
};

// True when Enter must be a plain newline in the editor
exports.isMultiline = function(model, id) {
	var u = model.units[id];
	if(!u) { return false; }
	if(u.tag === "codeblock" || u.tag === "table" || u.kind === "widget" || u.kind === "container") { return true; }
	return /[\r\n]/.test(model.text.substring(u.start, u.end));
};
