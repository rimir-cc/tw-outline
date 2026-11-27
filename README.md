# Outline

Work on an ordinary tiddler like on a Streams outline: select a block, edit it in place, move it with Alt-Up/Down, indent it with Tab, and see the result rendered at once. The tiddler stays one tiddler; no helper tiddlers are created.

## Features

- **Always there, idle until used** - no button, no switch: Ctrl-Click (Cmd-Click on Mac) on a block of any wikitext tiddler wakes its outline. Until then the tiddler behaves exactly as without the plugin and costs as good as nothing. Escape with nothing selected, a click outside the tiddler or closing it puts it back to sleep.
- **Same rendering** - the tiddler renders exactly as usual; outline mode only adds data attributes, a selection frame and key handling.
- **Units** - list items, lists, headings (with sections), paragraphs, code blocks, tables, opened HTML containers, transclusion lines, and widgets or macro calls (one opaque unit each).
- **Type badges** - a small, faint label next to every unit shows what it is (paragraph, h2, code-block, bullet, ...), also on the editor field; they take no space. Settings: all (default), headings only, off.
- **Selection** - click, Up/Down, Left/Right to the parent / first child, Escape clears.
- **Move** - Alt-Up/Alt-Down swap a unit with its sibling, subtree included. Headings and blocks also move across heading lines: a new heading moves up over the blocks above it, a paragraph moves into the next section.
- **Indent** - Tab/Shift-Tab demote/promote list items and headings with their subtrees.
- **In-place editor** - Enter or a double-click opens TW's own edit widget at the unit: a compact one-line field by default, optionally the full editor with toolbar. Lists and headings are edited without their marker; nesting stays with Tab/Shift-Tab. Ctrl-Enter saves, Enter saves and starts a new unit, Escape discards, Ctrl-Up/Down save and move the editor to the previous/next unit, Alt-Enter turns the unit into another type. In selection mode Ctrl-Enter starts a new empty unit below the selection.
- **Delete** - the Delete key removes the selection with everything below it, after a small yes/no menu (a heading: with its section or just the heading); list items without sub-items go at once (a setting).
- **Copy, cut, paste** - Ctrl-C, Ctrl-X, Ctrl-V move a unit with its subtree, also to another tiddler; through the system clipboard: formatted into e-mail or Jira, as wikitext into text fields; pasted into an outline a unit takes the level of the place.
- **Undo** - Ctrl-Z takes back the last changes made in the outline (deletes, moves, merges, splits, edits), Ctrl-Y redoes them; for the running session. In the editor too, as long as nothing is typed (after a split, merge or move from the editor).
- **Split and merge** - Enter in the middle of a list item splits it at the caret, at the start of a filled item or paragraph it opens an empty one above; Backspace at the start of an item joins it to the item above (an empty item is deleted), Delete at its end pulls the item below up, like in Streams.
- **Block menu** - Alt-Enter (also in the editor, to turn the edited unit into another type): insert a new paragraph, heading, list, quote or code block after or before the selection (in an empty tiddler: the first block), or turn the selection into another type.
- **Key overview** - press `?` in an outline (or its small ? button) for a table of all keys; the *keys* tab shows the same. Every key is configurable in the settings tab with TW's shortcut editor.
- **Transclusions** - a marker on `{{...}}` lines; Enter opens the target in outline mode.
- **Safe writes** - every write is a splice of a known range; changed text is relocated or refused, never guessed.

## Prerequisites

- TiddlyWiki 5.4.0 or later (JS modules: server restart or reload needed after install)
- Optional: `rimir/theme`, `rimir/doc-template`

## Quick Start

1. Install the plugin and restart the server.
2. Open a wikitext tiddler and Ctrl-Click (Cmd-Click on Mac) a block in it.
3. Click a block; Up/Down select, Alt-Down moves, Tab indents.
4. Enter edits, Ctrl-Enter saves.
5. `?` shows all keys.

Wikitext only; Markdown is not supported yet. llm-inline `AI:` lines do not fire from outline edits.
