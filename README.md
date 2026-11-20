# Outline

Work on an ordinary tiddler like on a Streams outline: select a block, edit it in place, move it with Alt-Up/Down, indent it with Tab, and see the result rendered at once. The tiddler stays one tiddler; no helper tiddlers are created.

## Features

- **Toggle per tiddler** - an *outline* button in the view toolbar. Off means the normal view.
- **Same rendering** - the tiddler renders exactly as usual; outline mode only adds data attributes, a selection frame and key handling.
- **Units** - list items, lists, headings (with sections), paragraphs, code blocks, tables, opened HTML containers, transclusion lines, and widgets or macro calls (one opaque unit each).
- **Selection** - click, Up/Down, Escape clears.
- **Move** - Alt-Up/Alt-Down swap a unit with its sibling, subtree included. Moves stay inside the parent.
- **Indent** - Tab/Shift-Tab demote/promote list items and headings with their subtrees.
- **In-place editor** - Shift-Enter opens TW's own edit widget at the unit. Ctrl-Enter saves, Enter saves and starts a new unit, Escape discards.
- **Transclusions** - a marker on `{{...}}` lines; Enter opens the target in outline mode.
- **Safe writes** - every write is a splice of a known range; changed text is relocated or refused, never guessed.

## Prerequisites

- TiddlyWiki 5.4.0 or later (JS modules: server restart or reload needed after install)
- Optional: `rimir/theme`, `rimir/doc-template`

## Quick Start

1. Install the plugin and restart the server.
2. Open a wikitext tiddler and press *outline* in its view toolbar.
3. Click a block; Up/Down select, Alt-Down moves, Tab indents.
4. Shift-Enter edits, Ctrl-Enter saves.

Wikitext only; Markdown is not supported yet. llm-inline `AI:` lines do not fire from outline edits.
