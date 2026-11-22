/*\
title: $:/plugins/rimir/outline/outline-menu.js
type: application/javascript
module-type: library

Block menu of the $outline widget (outline-menu key, default Shift-Enter, in selection mode).
install(proto) adds these methods to the widget prototype:

  openMenu()            - open the menu at the selected unit; false when nothing can be offered
  closeMenu()           - remove it
  handleMenuKeydown(e)  - Up/Down/Home/End move, Enter runs, Escape closes; true when consumed

Entries, in two groups: "Insert after" (a new block of a type, edited at once; not for single list items) and
"Turn into" (the adapter's convertTypes for the unit). On a transclusion the first entry edits the line itself.
Labels are the tiddlers $:/plugins/rimir/outline/language/block/<type>.

\*/
"use strict";

var dom = require("$:/plugins/rimir/outline/dom-utils.js");

var LABEL_PREFIX = "$:/plugins/rimir/outline/language/block/",
	INSERT_TYPES = ["paragraph", "heading1", "heading2", "heading3", "bulleted", "numbered", "quote", "code"],
	KEY = {up: 38, down: 40, home: 36, end: 35, enter: 13, escape: 27};

var methods = {};

// Entries for unit `id`: [{group, action: "insert"|"convert"|"edit", type}]
methods.menuEntries = function(id) {
	var adapter = this.getAdapter(),
		unit = this.units[id].unit,
		entries = [];
	if(!adapter) {
		return entries;
	}
	if(unit.kind === "transclusion") {
		entries.push({group: "", action: "edit", type: "edit"});
	}
	if(unit.kind !== "item") {
		INSERT_TYPES.forEach(function(type) {
			entries.push({group: "group-insert", action: "insert", type: type});
		});
	}
	adapter.convertTypes(this.model, id).forEach(function(type) {
		entries.push({group: "group-convert", action: "convert", type: type});
	});
	return entries;
};

methods.label = function(key) {
	return this.wiki.getTiddlerText(LABEL_PREFIX + key, key);
};

methods.openMenu = function() {
	var id = this.selectedId;
	this.closeMenu();
	if(id === -1 || this.editor || this.isReadOnly() || !this.ensureCurrent()) {
		return id !== -1;
	}
	id = this.selectedId;
	var entries = this.menuEntries(id),
		doc = this.document,
		self = this;
	if(!entries.length) {
		return true;
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
		item.appendChild(doc.createTextNode(self.label(entry.type)));
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
	return true;
};

// Below the selected unit's first DOM node, inside the (position: relative) outline container
methods.positionMenu = function() {
	var menu = this.menu,
		anchor = this.units[menu.id].domNodes[0];
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
	var id = menu.id;
	this.closeMenu();
	if(id !== this.selectedId) {
		this.select(id);
	}
	dom.focus(this.domNode);
	if(entry.action === "edit") {
		this.startEdit(id);
	} else if(entry.action === "insert") {
		this.startEdit(id, {isNew: true, blockType: entry.type});
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
		case KEY.escape: this.closeMenu(); return true;
	}
	return false;
};

exports.install = function(proto) {
	$tw.utils.each(methods, function(fn, name) {
		proto[name] = fn;
	});
};
