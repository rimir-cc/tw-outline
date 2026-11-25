/*\
title: $:/plugins/rimir/outline/format-wikitext.js
type: application/javascript
module-type: outline-format

Wikitext adapter: indent, promote, move, replace, insertNew, remove, deleteUnit, merge, split, copy, paste. Functions take (text, model, id) and return null or {text, select}.

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
/*
Alt-Up/Down. Siblings swap with their subtrees: items and headings only with one of the same kind and level, other
blocks with other blocks. Across a heading line ("cross", block level only, not out of a container):
- a heading moves up over the block or deeper heading above it (its line goes above, that block joins its section);
- a heading moves down over a following higher heading (its section goes below that line and becomes a sub-section);
- a block moves down over the next heading line (into that section) and up over its section's heading line.
Whole blocks are set apart by blank lines. The result has the moved unit's new start (select) and cross: true for a
move across a heading line.
*/
exports.move = function(text, model, id, dir) {
	var u = model.units[id];
	if(!u || (dir !== -1 && dir !== 1)) { return null; }
	var sibs = u.parent === -1 ? model.roots : model.units[u.parent].children,
		i = sibs.indexOf(id), o = model.units[sibs[i + dir]];
	if(i < 0) { return null; }
	if(u.kind === "item") {
		if(!o || o.kind !== "item" || o.level !== u.level) { return null; }
		return swap(text, o, u, dir, false);
	}
	if(u.kind === "heading") {
		if(o && o.kind === "heading" && o.level === u.level) {
			return swap(text, o, u, dir, false);
		}
		if(dir < 0 && o && (o.kind !== "heading" || o.level > u.level)) {
			return swapRanges(text, o.start, o.subtreeEnd, u.start, u.end, o.start, true);
		}
		if(dir > 0 && o && o.kind === "heading" && o.level < u.level) {
			return swapRanges(text, u.start, u.subtreeEnd, o.start, o.end, -1, true);
		}
		return null;
	}
	if(o && o.kind !== "heading") {
		return swap(text, o, u, dir, true);
	}
	if(dir > 0) {
		var h = o || nextHeading(model, u);
		return h ? swapRanges(text, u.start, u.subtreeEnd, h.start, h.end, -1, true) : null;
	}
	var p = !o && u.parent !== -1 ? model.units[u.parent] : null;
	return p && p.kind === "heading" ? swapRanges(text, p.start, p.end, u.start, u.subtreeEnd, p.start, true) : null;
};

// Swap sibling u with its neighbour o (dir -1: o is above) with their subtrees
function swap(text, o, u, dir, blocks) {
	var a = dir < 0 ? o : u, b = dir < 0 ? u : o,
		r = swapRanges(text, a.start, a.subtreeEnd, b.start, b.subtreeEnd, dir < 0 ? a.start : -1, blocks);
	delete r.cross;
	return r;
}

/*
Swap range A [a0, a1) with the later range B [b0, b1): A's text goes where B was and vice versa. `select`: the moved
unit's new start, -1 when it is A's text (it then starts after B's text and the separator). `blocks`: set the two
apart, and the text after them, by blank lines (anything between them, e.g. a comment, stays between them).
*/
function swapRanges(text, a0, a1, b0, b1, select, blocks) {
	var A = text.substring(a0, a1),
		sep = text.substring(a1, b0),
		B = text.substring(b0, b1),
		rest = text.substring(b1);
	if(blocks) {
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
		text: text.substring(0, a0) + B + sep + A + rest,
		select: select === -1 ? a0 + B.length + sep.length : select,
		cross: true
	};
}

// The heading that starts right after block u in document order, in the same container (or at the root); or null
function nextHeading(model, u) {
	var next = null;
	model.units.forEach(function(x) {
		if(x.start >= u.subtreeEnd && (!next || x.start < next.start)) {
			next = x;
		}
	});
	return next && next.kind === "heading" && sectionRoot(model, next) === sectionRoot(model, u) ? next : null;
}

// The nearest ancestor of u that is not a heading (a container), or -1
function sectionRoot(model, u) {
	var p = u.parent;
	while(p !== -1 && model.units[p].kind === "heading") {
		p = model.units[p].parent;
	}
	return p;
}

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

/*
Fence lines of a code block (```lang ... ```) or a <<< quote block (<<<class ... <<< citation) that the editor
leaves out: {open, content, close} (content lines joined by \n), or null for other units.
*/
function fenced(text, u) {
	var fence = u.tag === "codeblock" ? /^```/ : (u.kind === "block" && u.tag === "blockquote" ? /^<<</ : null),
		lines = fence ? text.substring(u.start, u.end).split(/\r?\n/) : [];
	if(lines.length < 2 || !fence.test(lines[0]) || !fence.test(lines[lines.length - 1])) {
		return null;
	}
	return {open: lines[0], content: lines.slice(1, -1).join("\n"), close: lines[lines.length - 1]};
}

// A whole quote of > lines: the editor shows its lines without their first ">"
function isQuoteList(u) {
	return u.kind === "list" && u.tag === "blockquote";
}

function unquote(source) {
	return source.split(/\r?\n/).map(function(line) {
		return line.replace(/^>[ \t]?/, "");
	}).join("\n");
}

// Edited lines back into > lines: a ">" in front ("> " before text, ">" before a deeper marker); blank lines go
function quote(source, nl) {
	return source.split(/\r?\n/).filter(function(line) {
		return /\S/.test(line);
	}).map(function(line) {
		return (outlineModel.MARKER_CHARS.indexOf(line.charAt(0)) !== -1 ? ">" : "> ") + line;
	}).join(nl);
}

// Replace the unit's content (see contentStart, fenced, isQuoteList) with newSource
exports.replace = function(text, model, id, newSource) {
	var u = model.units[id];
	if(!u) { return null; }
	var nl = utils.eol(text),
		f = fenced(text, u);
	if(f) {
		return {text: utils.splice(text, u.start, u.end, f.open + nl + newSource + nl + f.close), select: u.start};
	}
	if(isQuoteList(u)) {
		return {text: utils.splice(text, u.start, u.end, quote(newSource, nl)), select: u.start};
	}
	newSource = stripTypedMarker(u, newSource);
	if(isOneLine(u)) {
		newSource = toBreaks(newSource);
	}
	return {text: utils.splice(text, contentStart(text, u), u.end, newSource), select: u.start};
};

/*
Insert a new sibling unit (item) or first block (heading/block) after unit `id`, or, `where` "before", in front of it
(an item: a sibling with its marker; anything else: a paragraph); null for blank source. A new item's text that
starts with the item's own marker and a space (typed out of habit) loses that marker: it is added anyway.
*/
exports.insertNew = function(text, model, id, newSource, marker, where) {
	var u = model.units[id];
	newSource = u ? stripTypedMarker(u, newSource) : newSource;
	if(!u || !newSource || !newSource.trim()) { return null; }
	var nl = utils.eol(text), pos, insert, select;
	if(u.kind === "item" && where === "before") {
		pos = u.start;
		insert = u.marker + " " + toBreaks(newSource) + nl;
		select = pos;
	} else if(u.kind === "item") {
		pos = u.subtreeEnd;
		insert = nl + (marker || u.marker) + " " + toBreaks(newSource);
		select = pos + nl.length;
	} else if(where === "before") {
		return insertBlockBefore(text, u, newSource);
	} else {
		return insertBlockAt(text, u.end, newSource);
	}
	return {text: utils.splice(text, pos, pos, insert), select: select};
};

/*
Marker of a new item after item `id` (insertNew), `delta` levels deeper (Tab) or higher (negative, Shift-Tab) than
the item: one more of the item's last marker character per level deeper, one character less per level higher. Null
when out of range: above depth 1, or more than one level below the last item of the item's subtree (the new item
would have no parent).
*/
exports.newItemMarker = function(model, id, delta) {
	var u = model.units[id];
	if(!u || u.kind !== "item") { return null; }
	var items = subtreeUnits(model, u, "item"),
		last = items[items.length - 1];
	var length = u.marker.length + delta;
	if(length < 1 || length > last.marker.length + 1) { return null; }
	return delta > 0 ? u.marker + u.marker.charAt(u.marker.length - 1).repeat(delta) :
		u.marker.substring(0, length);
};

// Insert block `source` at `pos` (end of a unit), set apart by a blank line before and, when content follows, after
function insertBlockAt(text, pos, source) {
	var nl = utils.eol(text),
		insert = nl + nl + source,
		rest = text.substring(pos);
	if(/\S/.test(rest) && !/^\r?\n[ \t]*\r?\n/.test(rest)) { insert += nl; }
	return {text: utils.splice(text, pos, pos, insert), select: pos + 2 * nl.length};
}

// Insert block `source` in front of unit `u`, set apart by blank lines (it ends the section above)
function insertBlockBefore(text, u, source) {
	var nl = utils.eol(text),
		before = text.substring(0, u.start),
		lead = !/\S/.test(before) || /\n[ \t]*\r?\n[ \t]*$/.test(before) ? "" : (/\n[ \t]*$/.test(before) ? nl : nl + nl);
	return {text: utils.splice(text, u.start, u.start, lead + source + nl + nl), select: u.start + lead.length};
}

/*
Block types of the block menu (Alt-Enter): the unit kind they produce and their source from content (line breaks `nl`).
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

/*
Insert a new block of `type` with `content`. `where`: "after" (default) unit `id` (see insertsAfterSubtree), "before"
it (it ends the section above), or "end" of the text (`id` is ignored: the first block of an empty tiddler). Not
next to a single list item. Null for blank content.
*/
exports.insertBlock = function(text, model, id, type, content, where) {
	var u = model.units[id], t = BLOCK_TYPES[type];
	if(!t || !content || !content.trim()) { return null; }
	var nl = utils.eol(text), result;
	content = content.replace(/\r?\n/g, nl);
	if(where === "end") {
		var head = text.replace(/\s+$/, ""),
			prefix = /\S/.test(head) ? head + nl + nl : "";
		result = {text: prefix + t.make(content, nl), select: prefix.length};
	} else if(!u || u.kind === "item") {
		return null;
	} else if(where === "before") {
		result = insertBlockBefore(text, u, t.make(content, nl));
	} else {
		result = insertBlockAt(text, exports.insertsAfterSubtree(model, id, type) ? u.subtreeEnd : u.end, t.make(content, nl));
	}
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
	var f = u.tag === "codeblock" ? fenced(text, u) : null;
	return f ? f.content : null;
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

// True when unit u has `count` list neighbours (the previous and next unit at its level, by document order) to join
function joinsNeighbours(model, u, count) {
	var sibs = u.parent === -1 ? model.roots : model.units[u.parent].children,
		i = sibs.indexOf(u.id),
		prev = model.units[sibs[i - 1]],
		// A heading's section follows it: its next neighbour is its first child
		next = u.kind === "heading" && u.children.length ? model.units[u.children[0]] : model.units[sibs[i + 1]],
		lists = [prev, next].filter(function(x) { return x && x.kind === "list"; }).length;
	return lists >= count;
}

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
	// A block that becomes a list item also gets its list unit, unless it joins a list right above or below it (TW
	// continues a list over blank lines): one list less for each neighbour it joins
	var parsed = outlineModel.buildModel($tw.wiki, newText),
		toItem = kind === "item" && u.kind !== "item" && u.kind !== "list",
		expected = model.units.length + (toItem ? 1 : 0),
		joined = toItem ? expected - parsed.units.length : 0;
	if((joined !== 0 && !(joined > 0 && joined <= 2 && joinsNeighbours(model, u, joined))) ||
		outlineModel.findUnit(parsed, start, kind) === -1) {
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
	return cut(text, model, u, u.end);
};

// Remove [u.start, end) with the separator rules of remove
function cut(text, model, u, end) {
	var a = u.start, b = end,
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
}

/*
The unit a delete of `id` removes: an only item takes its list along, an only child its HTML container (an empty list
cannot stay, an empty container would turn into a plain block). Repeated upwards.
*/
function deleteTarget(model, id) {
	var u = model.units[id];
	for(;;) {
		var parent = u && u.parent !== -1 ? model.units[u.parent] : null;
		if(!parent || parent.children.length !== 1 ||
			!(u.kind === "item" && parent.kind === "list" || parent.kind === "container")) {
			return u;
		}
		u = parent;
	}
}

// Ids of u and all units below it
function subtreeIds(model, u) {
	return u.children.reduce(function(ids, c) { return ids.concat(subtreeIds(model, model.units[c])); }, [u.id]);
}

/*
Number of units a delete of `id` removes besides the unit itself (mode "own": none; a heading's section stays and
joins the section above). What goes along with an only child (its list or container) is counted too.
*/
exports.deleteCount = function(model, id, mode) {
	var u = deleteTarget(model, id);
	return !u || mode === "own" ? 0 : subtreeIds(model, u).length - 1;
};

/*
Delete unit `id` with its subtree (an item with its sub-items, a heading with its section, a list with its items),
or with mode "own" only a heading's line. Separators as in remove. result.removed: the ids of the removed units.
*/
exports.deleteUnit = function(text, model, id, mode) {
	var u = model.units[id], result;
	if(!u) { return null; }
	if(mode === "own") {
		if(u.kind !== "heading") { return null; }
		result = cut(text, model, u, u.end);
		result.removed = [u.id];
		return result;
	}
	u = deleteTarget(model, id);
	result = cut(text, model, u, u.subtreeEnd);
	result.removed = subtreeIds(model, u);
	return result;
};

/*
Clipboard (outline-clipboard.js). copy: the source of unit `id` with its subtree, as Delete takes it, and its clip kind:
"items" (an item with its sub-items, a whole list), "heading" (with its section) or "block" (anything else).
*/
exports.copy = function(text, model, id) {
	var u = model.units[id];
	if(!u) { return null; }
	return {
		kind: u.kind === "item" || u.kind === "list" ? "items" : (u.kind === "heading" ? "heading" : "block"),
		source: text.substring(u.start, u.subtreeEnd)
	};
};

/*
Clip kind of a source from outside (plain text on the clipboard), by its model `cm`: "items" when it is one list,
"heading" when it is one heading (with its section), else "block" (pasted as it is).
*/
exports.clipKind = function(cm) {
	var root = cm.roots.length === 1 ? cm.units[cm.roots[0]] : null;
	return root && root.kind === "list" ? "items" : (root && root.kind === "heading" ? "heading" : "block");
};

// The list an item belongs to at the top (a list unit: itself), any other unit itself
function outermostList(model, u) {
	while(u.parent !== -1 && (u.kind === "item" || u.kind === "list") &&
		(model.units[u.parent].kind === "item" || model.units[u.parent].kind === "list")) {
		u = model.units[u.parent];
	}
	return u;
}

// Level of the heading whose section unit `u` is in, 0 outside any section
function sectionLevel(model, u) {
	var p = u.parent;
	while(p !== -1 && model.units[p].kind !== "heading") {
		p = model.units[p].parent;
	}
	return p === -1 ? 0 : model.units[p].level;
}

/*
Clip source with its levels adapted, by its model `cm`. Items: the top items get marker `top`, deeper ones `top` plus
their own characters beyond the top marker. Heading: the first heading gets level `top`, the others keep their
distance to it, at most 6. Blocks stay. Only units of the model are rewritten, not marker-like lines in a code block.
*/
function relevel(cm, kind, top) {
	var edits = [];
	if(kind === "items") {
		var items = cm.units.filter(function(x) { return x.kind === "item"; }),
			base = items[0].marker;
		items.forEach(function(x) {
			edits.push({pos: x.start, remove: x.marker.length, insert: top + x.marker.substring(base.length)});
		});
	} else if(kind === "heading") {
		var headings = cm.units.filter(function(x) { return x.kind === "heading"; }),
			first = headings[0].level;
		headings.forEach(function(x) {
			edits.push({pos: x.start, remove: x.level, insert: "!".repeat(Math.max(1, Math.min(6, top + x.level - first)))});
		});
	}
	return apply(cm.text, edits);
}

/*
Paste `clip` ({kind, source} of copy; `cm`: the outline model of its source) after unit `id`, -1: at the end of the
text (a tiddler without units). Levels adapt to the place:
- items after an item: siblings after its subtree, at its marker; after a whole list: at its end, at its top level;
  elsewhere a new list at level 1
- a heading after a heading: after its section, at its level; elsewhere one level below the heading of the section
  it lands in (level 1 outside any section)
- under a selected heading, other clips go right below its line; a selected item anchors them at its outermost list
Returns {text, select, kind} (select: the first pasted unit, kind: its kind) or null.
*/
exports.paste = function(text, model, id, clip, cm) {
	var u = id === -1 ? null : model.units[id];
	if(!clip || !cm || !cm.units.length || (id !== -1 && !u)) { return null; }
	var kind = clip.kind,
		items = cm.units.filter(function(x) { return x.kind === "item"; }),
		headings = cm.units.filter(function(x) { return x.kind === "heading"; });
	if(kind === "items" && !items.length || kind === "heading" && !headings.length) { return null; }
	var nl = utils.eol(text),
		newList = kind === "items" ? items[0].marker.charAt(items[0].marker.length - 1) : "",
		result;
	function adapted(top) {
		return relevel(cm, kind, top).replace(/\r?\n/g, nl);
	}
	if(!u) {
		var head = text.replace(/\s+$/, ""),
			prefix = /\S/.test(head) ? head + nl + nl : "";
		result = {text: prefix + adapted(kind === "items" ? newList : 1), select: prefix.length};
	} else if(kind === "items" && (u.kind === "item" || u.kind === "list")) {
		var top = u.kind === "item" ? u.marker : model.units[u.children[0]].marker;
		result = {text: utils.splice(text, u.subtreeEnd, u.subtreeEnd, nl + adapted(top)), select: u.subtreeEnd + nl.length};
	} else if(u.kind === "heading") {
		result = kind === "heading" ? insertBlockAt(text, u.subtreeEnd, adapted(u.level)) :
			insertBlockAt(text, u.end, adapted(newList));
	} else {
		var anchor = outermostList(model, u);
		result = insertBlockAt(text, anchor.subtreeEnd, adapted(kind === "items" ? newList : sectionLevel(model, anchor) + 1));
	}
	result.kind = kind === "items" ? "item" : (kind === "heading" ? "heading" : cm.units[cm.roots[0]].kind);
	return result;
};

/*
Split list item `id` (Enter in the middle of its text, after its content was saved as the part before the caret):
a new item with `rest` (the editor text after the caret) goes directly below the item's line. It is a sibling with
the same marker, or, when the item has sub-items, their first one (marker of the first sub-item), so the sub-items
stay with the item. Backspace at its start (merge) gives back the original. Returns {text, select, kind, added}.
*/
exports.split = function(text, model, id, rest) {
	var u = model.units[id];
	if(!u || u.kind !== "item" || typeof rest !== "string" || !/\S/.test(rest)) { return null; }
	var first = u.children.length ? model.units[u.children[0]] : null,
		marker = first ? first.marker : u.marker,
		nl = utils.eol(text),
		insert = nl + marker + " " + toBreaks(stripTypedMarker(u, rest));
	return {
		text: utils.splice(text, u.end, u.end, insert),
		select: u.end + nl.length,
		kind: "item",
		added: [{kind: "item", level: marker.length}]
	};
};

// The last item of the list of item `id` that starts before `pos` (the item visually above `pos`), or -1
exports.itemBefore = function(model, id, pos) {
	var u = model.units[id], root = u;
	if(!u || u.kind !== "item") { return -1; }
	while(root && root.kind !== "list") {
		root = root.parent === -1 ? null : model.units[root.parent];
	}
	var target = -1, start = -1;
	model.units.forEach(function(d) {
		if(root && d.kind === "item" && d.start < pos && d.start > start && d.start >= root.start && d.start < root.subtreeEnd) {
			target = d.id;
			start = d.start;
		}
	});
	return target;
};

// The item above list item `id` in its list (the previous item in document order), or -1
exports.mergeTarget = function(model, id) {
	var u = model.units[id];
	return u ? exports.itemBefore(model, id, u.start) : -1;
};

// The item that merges into list item `id` (whose mergeTarget it is: the next item in document order), or -1
exports.mergeSource = function(model, id) {
	var u = model.units[id], next = null;
	if(!u || u.kind !== "item") { return -1; }
	model.units.forEach(function(d) {
		if(d.kind === "item" && d.start > u.start && (!next || d.start < next.start)) {
			next = d;
		}
	});
	return next && exports.mergeTarget(model, next.id) === id ? next.id : -1;
};

/*
Merge list item `id` into the item above it (mergeTarget): its content goes to the end of that item's line and its
own line goes; its sub-items keep their lines and levels. content: the editor text to merge instead of the item's
current content ("" deletes the item). Returns {text, select, kind, caret, removed} (caret: where the merged text starts in
the target's editor text), or null without an item above.
*/
exports.merge = function(text, model, id, content) {
	var u = model.units[id],
		pid = exports.mergeTarget(model, id),
		p = pid === -1 ? null : model.units[pid];
	// Only line breaks between the two (a blank line inside one list goes with the merge)
	if(!p || /\S/.test(text.substring(p.end, u.start))) { return null; }
	var c = typeof content === "string" ? toBreaks(stripTypedMarker(u, content)) : text.substring(contentStart(text, u), u.end);
	return {
		text: text.substring(0, p.end) + c + text.substring(u.end),
		select: p.start,
		kind: "item",
		caret: exports.editSource(text, model, pid).length,
		removed: [id]
	};
};

// What the editor shows: the unit's content, without an item marker or heading prefix, a code block's or <<< quote's
// fence lines, a whole quote's ">"s; <br> in items and headings as line breaks
exports.editSource = function(text, model, id) {
	var u = model.units[id];
	if(!u) { return ""; }
	var f = fenced(text, u);
	if(f) {
		return f.content;
	}
	if(isQuoteList(u)) {
		return unquote(text.substring(u.start, u.end));
	}
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
