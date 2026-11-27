/*\
title: $:/plugins/rimir/outline/outline-menu.js
type: application/javascript
module-type: library

Menus of the $outline widget at the selected unit: the block menu (outline-menu key, default Alt-Enter) and the
delete confirmation (outline-delete key, default Delete), both in selection mode; the block menu also from the editor.
install(proto) adds these methods to the widget prototype:

  openMenu(opts)        - open the block menu at the selected unit; false when nothing is selected. opts.convertOnly:
                          only the "Turn into" entries (from the editor, after its save; false when there are none),
                          and the editor opens again afterwards, also on Escape, the caret at opts.caret
  deleteSelected()      - delete the selected unit, after the confirmation menu (see below)
  showMenu(id, entries) - show a menu of entries at unit id
  closeMenu()           - remove it
  handleMenuKeydown(e)  - Up/Down/Home/End move, Enter runs, Escape closes; true when consumed

Block menu entries, in three groups: "Insert after" and "Insert before" (a new block of a type, edited at once; not
for single list items) and "Turn into" (the adapter's convertTypes for the unit). In a tiddler without units the menu
only inserts (at the end of the text). On a transclusion the first entry edits the line itself.
Delete confirmation: "Yes" (with the count of what goes along), on a heading with a section also "Just the heading",
and "Cancel". Childless list items are deleted without asking when $:/config/rimir/outline/quick-delete-items is yes.
Labels are the tiddlers $:/plugins/rimir/outline/language/block/<key>.

\*/
"use strict";

var dom = require("$:/plugins/rimir/outline/dom-utils.js"),
	blockTypes = require("$:/plugins/rimir/outline/block-types.js");

var LABEL_PREFIX = "$:/plugins/rimir/outline/language/block/",
	KEY = {up: 38, down: 40, home: 36, end: 35, enter: 13, escape: 27},
	QUICK_DELETE = "$:/config/rimir/outline/quick-delete-items";

var methods = {};

// Block menu entries for unit `id` (-1: a tiddler without units): [{group, action: "insert"|"convert"|"edit", type, where}]
// Insert and convert entries are labelled with the type's caption (block type tiddlers, see block-types.js)
methods.menuEntries = function(id) {
	var self = this,
		adapter = this.getAdapter(),
		types = blockTypes.getBlockTypes(this.wiki),
		captions = {},
		entries = [];
	if(!adapter) {
		return entries;
	}
	types.forEach(function(t) { captions[t.name] = t.caption; });
	var blockTypesHere = types.filter(function(t) { return t.contexts.indexOf("block") !== -1; });
	if(id === -1) {
		return blockTypesHere.map(function(t) {
			return {group: "group-insert", action: "insert", type: t.name, text: t.caption, where: "end"};
		});
	}
	var unit = this.units[id].unit;
	if(unit.kind === "transclusion") {
		entries.push({group: "", action: "edit", type: "edit"});
	}
	this.diagramTargets(id).forEach(function(d) {
		entries.push({group: "", action: "edit-target", title: d.title, text: self.label("edit-target").replace("$title$", d.title)});
	});
	if(unit.kind === "item") {
		entries = entries.concat(this.addEntries());
	}
	["after", "before"].forEach(function(where) {
		blockTypesHere.forEach(function(t) {
			entries.push({group: where === "after" ? "group-insert" : "group-insert-before", action: "insert", type: t.name,
				text: t.caption, where: where});
		});
	});
	adapter.convertTypes(this.model, id, types).forEach(function(type) {
		entries.push({group: "group-convert", action: "convert", type: type, text: captions[type]});
	});
	return entries;
};

// "Add to this item" entries: the types with the item context (a diagram tiddler or a template, see startTargetEdit)
methods.addEntries = function() {
	return blockTypes.getBlockTypes(this.wiki).filter(function(t) {
		return t.contexts.indexOf("item") !== -1 && t.inline;
	}).map(function(t) {
		return {group: "group-add", action: "add", type: t.name, text: t.caption};
	});
};

methods.label = function(key) {
	return this.wiki.getTiddlerText(LABEL_PREFIX + key, key);
};

methods.openMenu = function(opts) {
	var id = this.selectedId;
	this.closeMenu();
	if(opts && opts.convertOnly) {
		var entries = id === -1 || this.editor ? [] : this.menuEntries(id).filter(function(entry) {
			return entry.action === "convert";
		});
		this.showMenu(id, entries);
		if(this.menu) {
			this.menu.reedit = {caret: opts.caret};
		}
		return !!this.menu;
	}
	if(id === -1 && !this.editor && !this.isReadOnly() && !this.hasSelectable()) {
		this.showMenu(-1, this.menuEntries(-1));
		return true;
	}
	if(id === -1 || this.editor || this.isReadOnly() || !this.ensureCurrent()) {
		return id !== -1;
	}
	this.showMenu(this.selectedId, this.menuEntries(this.selectedId));
	return true;
};

/*
The type menu of a new, still empty editor (Alt-Enter in it): every block type. The editor closes (nothing was written)
and opens again for the picked type at the same place; Escape opens it again as it was.
*/
methods.retypeMenu = function() {
	var ed = this.editor,
		retype = {id: ed.id, where: ed.where, blockType: ed.blockType},
		onItem = ed.id !== -1 && this.units[ed.id] && this.units[ed.id].unit.kind === "item" && ed.where !== "end";
	this.closeEditor(true);
	this.closeMenu();
	this.showMenu(retype.id, blockTypes.getBlockTypes(this.wiki).filter(function(t) {
		return t.contexts.indexOf("block") !== -1;
	}).map(function(t) {
		return {group: "", action: "retype", type: t.name, text: t.caption};
	}).concat(onItem ? this.addEntries() : []));
	if(this.menu) {
		this.menu.retype = retype;
	}
	return !!this.menu;
};

methods.deleteSelected = function() {
	var id = this.selectedId,
		adapter = this.getAdapter();
	this.closeMenu();
	if(id === -1 || this.editor || this.isReadOnly() || !adapter || !this.ensureCurrent()) {
		return id !== -1;
	}
	id = this.selectedId;
	var unit = this.units[id].unit,
		count = adapter.deleteCount(this.model, id),
		yes = {group: "group-delete", action: "delete"};
	if(unit.kind === "item" && !unit.children.length && this.wiki.getTiddlerText(QUICK_DELETE) === "yes") {
		this.operate("deleteUnit");
		return true;
	}
	if(count && unit.kind === "heading") {
		yes.text = this.countLabel("delete-heading", "blocks", count);
	} else if(count && unit.kind === "list") {
		yes.text = this.countLabel("delete-list", "items", count);
	} else if(count && unit.kind === "item" && unit.children.length) {
		yes.text = this.countLabel("delete-children", "sub-items", count);
	} else if(count && unit.kind === "container") {
		yes.text = this.countLabel("delete-container", "blocks", count);
	} else {
		yes.type = "delete";
	}
	var entries = [yes];
	if(count && unit.kind === "heading") {
		entries.push({group: "group-delete", action: "delete", arg: "own", type: "delete-own"});
	}
	entries.push({group: "group-delete", action: "cancel", type: "cancel"});
	this.showMenu(id, entries);
	return true;
};

// Label `key` with $counted$ replaced by "<count> <noun>" (language count-<noun> / count-<noun>-one)
methods.countLabel = function(key, noun, count) {
	var counted = this.label("count-" + noun + (count === 1 ? "-one" : "")).replace("$count$", String(count));
	return this.label(key).replace("$counted$", counted);
};

// Show `entries` ({group, action, type or text, arg}) as a menu below unit `id`; the first entry is active
methods.showMenu = function(id, entries) {
	this.closeMenu();
	var doc = this.document,
		self = this;
	if(!entries.length) {
		return;
	}
	var node = doc.createElement("div"),
		group = null;
	node.className = "rr-ol-menu";
	entries.forEach(function(entry, index) {
		if(entry.group && entry.group !== group) {
			var head = doc.createElement("div");
			head.className = "rr-ol-menu-group";
			head.appendChild(doc.createTextNode(self.label(entry.group)));
			node.appendChild(head);
		}
		group = entry.group;
		var item = doc.createElement("div");
		item.className = "rr-ol-menu-item";
		item.setAttribute("data-ol-menu-index", String(index));
		item.appendChild(doc.createTextNode(entry.text || self.label(entry.type)));
		entry.node = item;
		node.appendChild(item);
	});
	// Mouse: a click runs the entry; mousedown is cancelled so the outline keeps the focus
	node.addEventListener("mousedown", function(event) {
		event.preventDefault();
	}, false);
	node.addEventListener("click", function(event) {
		event.preventDefault();
		event.stopPropagation();
		for(var m = event.target; m && m !== node; m = m.parentNode) {
			if(m.getAttribute && m.getAttribute("data-ol-menu-index") !== null) {
				self.runMenuEntry(parseInt(m.getAttribute("data-ol-menu-index"), 10));
				return;
			}
		}
	}, false);
	this.menu = {id: id, entries: entries, node: node, active: 0};
	this.domNode.appendChild(node);
	this.positionMenu();
	this.setMenuActive(0);
};

// Below the selected unit's first shown DOM node (dom.firstShown), inside the (position: relative) outline container
methods.positionMenu = function() {
	var menu = this.menu,
		anchor = menu.id === -1 ? this.emptyHint : dom.firstShown(this.units[menu.id].domNodes);
	if(!anchor || !anchor.getBoundingClientRect || !this.domNode.getBoundingClientRect) {
		return;
	}
	var a = anchor.getBoundingClientRect(),
		root = this.domNode.getBoundingClientRect();
	menu.node.style.left = Math.max(0, a.left - root.left) + "px";
	menu.node.style.top = (a.bottom - root.top + 2) + "px";
};

methods.setMenuActive = function(index) {
	var menu = this.menu;
	menu.active = Math.max(0, Math.min(menu.entries.length - 1, index));
	menu.entries.forEach(function(entry, i) {
		dom.setClass(entry.node, "rr-ol-menu-active", i === menu.active);
	});
	dom.scrollIntoView(menu.entries[menu.active].node);
};

methods.closeMenu = function() {
	if(this.menu) {
		if(this.menu.node.parentNode) {
			this.menu.node.parentNode.removeChild(this.menu.node);
		}
		this.menu = null;
	}
};

methods.runMenuEntry = function(index) {
	var menu = this.menu,
		entry = menu && menu.entries[index];
	if(!entry) {
		return;
	}
	var id = menu.id,
		reedit = menu.reedit;
	this.closeMenu();
	if(id !== -1 && id !== this.selectedId) {
		this.select(id);
	}
	dom.focus(this.domNode);
	if(entry.action === "add") {
		this.startTargetEdit(id, {isNew: true, typeName: entry.type});
	} else if(entry.action === "edit-target") {
		this.startTargetEdit(id, {title: entry.title});
	} else if(menu.retype) {
		this.startEdit(menu.retype.id, {isNew: true, blockType: entry.type, where: menu.retype.where});
	} else if(reedit) {
		this.operate("convert", entry.type);
		this.editAgain(reedit.caret);
	} else if(entry.action === "cancel") {
		return;
	} else if(entry.action === "delete") {
		this.operate("deleteUnit", entry.arg);
	} else if(entry.action === "edit") {
		this.startEdit(id);
	} else if(entry.action === "insert") {
		this.startEdit(id, {isNew: true, blockType: entry.type, where: entry.where});
	} else {
		this.operate("convert", entry.type);
	}
};

methods.handleMenuKeydown = function(event) {
	var menu = this.menu;
	if(!menu || event.ctrlKey || event.altKey || event.metaKey) {
		return false;
	}
	switch(event.keyCode) {
		case KEY.up: this.setMenuActive(menu.active - 1); return true;
		case KEY.down: this.setMenuActive(menu.active + 1); return true;
		case KEY.home: this.setMenuActive(0); return true;
		case KEY.end: this.setMenuActive(menu.entries.length - 1); return true;
		case KEY.enter: this.runMenuEntry(menu.active); return true;
		case KEY.escape:
			var reedit = menu.reedit,
				retype = menu.retype;
			this.closeMenu();
			if(retype) {
				this.startEdit(retype.id, {isNew: true, blockType: retype.blockType, where: retype.where});
			} else if(reedit) {
				this.editAgain(reedit.caret);
			}
			return true;
	}
	return false;
};

exports.install = function(proto) {
	$tw.utils.each(methods, function(fn, name) {
		proto[name] = fn;
	});
};
