/*\
title: $:/plugins/rimir/outline/test/test-parser-pins.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Pins the TiddlyWiki parser positions (start/end) the outline model relies on.

\*/
"use strict";

describe("outline parser pins", function() {

	function parse(src) {
		return $tw.wiki.parseText("text/vnd.tiddlywiki", src).tree;
	}

	it("list items: ranges exclude nested items", function() {
		var ul = parse("* a\n** b\n* c")[0];
		expect(ul.tag).toBe("ul");
		expect(ul.start).toBe(0);
		var li1 = ul.children[0];
		expect(li1.tag).toBe("li");
		expect(li1.start).toBe(0);
		expect(li1.end).toBe(3);
		var nested = li1.children[1].children[0];
		expect(nested.tag).toBe("li");
		expect(nested.start).toBe(4);
		expect(nested.end).toBe(8);
		var li2 = ul.children[1];
		expect(li2.start).toBe(9);
		expect(li2.end).toBe(12);
	});

	it("heading and paragraph", function() {
		var tree = parse("! H\n\npara");
		expect(tree[0].tag).toBe("h1");
		expect(tree[0].start).toBe(0);
		expect(tree[0].end).toBe(3);
		expect(tree[0].rule).toBe("heading");
		expect(tree[1].tag).toBe("p");
		expect(tree[1].start).toBe(5);
		expect(tree[1].end).toBe(9);
		expect(tree[1].rule).toBe("parseblock");
	});

	// Real shape (differs from the plan): the positioned block node is a "tiddler" widget
	// (rule transcludeblock) whose end includes the newline; the inner "transclude"
	// child carries no start/end. The target is in attributes.tiddler.value.
	it("block transclusion", function() {
		var node = parse("{{X}}\n")[0];
		expect(node.type).toBe("tiddler");
		expect(node.rule).toBe("transcludeblock");
		expect(node.start).toBe(0);
		expect(node.end).toBe(6);
		expect(node.attributes.tiddler.value).toBe("X");
		expect(node.children[0].type).toBe("transclude");
		expect(node.children[0].attributes.$tiddler.value).toBe("X");
	});

	it("pragma wraps the following blocks", function() {
		var tree = parse("\\define m() x\n* a");
		expect(tree[0].type).toBe("set");
		var li = tree[0].children[0].children[0];
		expect(li.tag).toBe("li");
		expect(li.start).toBe(14);
	});

	it("code block", function() {
		var node = parse("```js\nx\n```")[0];
		expect(node.type).toBe("codeblock");
		expect(node.start).toBe(0);
		expect(node.end).toBe(11); // plan said 12; the source is 11 chars
	});

	it("table", function() {
		var node = parse("|a|b|\n")[0];
		expect(node.tag).toBe("table");
		expect(node.start).toBe(0);
	});

	it("block-mode html container", function() {
		var div = parse("<div>\n\n* a\n\n</div>")[0];
		expect(div.tag).toBe("div");
		expect(div.isBlock).toBe(true);
		var ul = div.children.filter(function(c) { return c.tag === "ul"; })[0];
		expect(ul).toBeDefined();
		expect(ul.start).toBe(7);
	});
});
