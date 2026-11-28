/*\
title: $:/plugins/rimir/outline/test/test-block-types.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the block type registry (block-types.js): built-in shadows, types added by tagged tiddlers, broken types.

\*/
"use strict";

describe("outline block types", function() {

	var blockTypes = require("$:/plugins/rimir/outline/block-types.js"),
		TAG = "$:/tags/rimir/outline/BlockType",
		PLUGIN = "$:/plugins/rimir/outline";

	// A wiki with the outline plugin's shadow tiddlers and `tiddlers`
	function pluginWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddler($tw.wiki.getTiddler(PLUGIN));
		wiki.readPluginInfo();
		wiki.registerPluginTiddlers("plugin");
		wiki.unpackPluginTiddlers();
		wiki.addTiddlers(tiddlers || []);
		return wiki;
	}

	function names(types) {
		return types.map(function(t) { return t.name; });
	}

	var OUTLINE = pluginWiki();

	var GRAPHVIZ = {title: "T/graphviz", tags: TAG, name: "graphviz", caption: "Graphviz graph", badge: "graphviz",
		behaviour: "typed", "content-type": "text/vnd.graphviz", starter: "digraph {}", contexts: "block item",
		inline: "transclude", docs: "https://graphviz.org/documentation/", "list-after": "$:/plugins/rimir/outline/blocktypes/code"};

	it("lists the built-ins in order with their badges", function() {
		var types = blockTypes.getBlockTypes(pluginWiki());
		expect(names(types)).toEqual(["paragraph", "heading1", "heading2", "heading3", "bulleted", "numbered", "quote", "quote-block", "code"]);
		expect(types.map(function(t) { return t.badge; })).toEqual(["paragraph", "h1", "h2", "h3", "bullet", "numbered", "quote", "quote", "code-block"]);
		expect(types.map(function(t) { return t.kind; })).toEqual(["block", "heading", "heading", "heading", "item", "item", "item", "block", "block"]);
		expect(blockTypes.getBlockType(OUTLINE, "heading2").make("a\nb", "\n")).toBe("!! a<br>b");
		expect(blockTypes.getBlockType(OUTLINE, "code").make("a\nb", "\n")).toBe("```\na\nb\n```");
		expect(blockTypes.getBlockType(OUTLINE, "numbered").make("x", "\n")).toBe("# x");
		expect(blockTypes.getBlockType(OUTLINE, "paragraph").make("x", "\n")).toBe("x");
		expect(blockTypes.getBlockType(OUTLINE, "paragraph").contexts).toEqual(["block"]);
		expect(blockTypes.getBlockType(OUTLINE, "heading1").singleLine).toBe(true);
		expect(blockTypes.getBlockType(OUTLINE, "code").singleLine).toBe(false);
	});

	it("takes the captions of the built-ins as labels", function() {
		expect(blockTypes.getBlockType(OUTLINE, "bulleted").caption).toBe("Bulleted list");
	});

	it("adds a type from a tagged tiddler", function() {
		var wiki = pluginWiki([GRAPHVIZ]),
			types = blockTypes.getBlockTypes(wiki),
			gv = types[types.length - 1];
		expect(gv.name).toBe("graphviz");
		expect(gv.contentType).toBe("text/vnd.graphviz");
		expect(gv.contexts).toEqual(["block", "item"]);
		expect(gv.inline).toBe("transclude");
		expect(gv.starter).toBe("digraph {}");
		expect(gv.docs).toBe("https://graphviz.org/documentation/");
		expect(gv.make("x", "\n")).toBe("$$$text/vnd.graphviz\nx\n$$$");
		expect(blockTypes.typeForContentType(wiki, "text/vnd.graphviz")).toBe(gv);
		expect(blockTypes.typeForContentType(wiki, "text/plain")).toBeNull();
		expect(blockTypes.getBlockType(wiki, "nope")).toBeNull();
	});

	it("skips broken types", function() {
		var wiki = pluginWiki([
			{title: "T/a", tags: TAG, name: "a", caption: "A", behaviour: "heading"},
			{title: "T/b", tags: TAG, name: "b", caption: "B", behaviour: "nope"},
			{title: "T/c", tags: TAG, name: "c", caption: "C", behaviour: "fenced", open: "<<<"},
			{title: "T/d", tags: TAG, caption: "D", behaviour: "paragraph"},
			{title: "T/e", tags: TAG, name: "e", caption: "E", behaviour: "typed"}
		]);
		expect(names(blockTypes.getBlockTypes(wiki))).toEqual(["paragraph", "heading1", "heading2", "heading3", "bulleted", "numbered", "quote", "quote-block", "code"]);
	});

	it("follows changes of the type tiddlers", function() {
		var wiki = pluginWiki();
		expect(names(blockTypes.getBlockTypes(wiki)).indexOf("graphviz")).toBe(-1);
		wiki.addTiddler(GRAPHVIZ);
		expect(names(blockTypes.getBlockTypes(wiki)).indexOf("graphviz")).toBe(9);
		wiki.deleteTiddler(GRAPHVIZ.title);
		expect(names(blockTypes.getBlockTypes(wiki)).indexOf("graphviz")).toBe(-1);
	});
});
