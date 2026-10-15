---
name: rtl-kit
description: Right-to-left UI for Claude Code mods. Copies one file (rtl.tsx) into a mod so Hebrew or Arabic reads in the right order on the desktop, terminal, VS Code and phone, wraps long text right-aligned, and draws cards, tabs, lists, tables, markdown and SVG headers and timelines in a consistent design. Use when building or fixing a mod pane, band or status line with Hebrew, Arabic or any right-to-left text, or when a mod's Hebrew comes out scrambled, reversed or left-aligned.
---

# rtl-kit

A Claude Code mod draws with a fixed set of elements (Box, Text, Button, …), and none of them takes a
text direction. Measured on the desktop app (Claude Code 2.1.288–2.1.289, 2026-10-05):

- every element is laid out left to right, so a line mixing Hebrew with Latin letters or digits is
  scrambled, in a Text and in a Button label;
- a line that wraps starts at the left;
- `Markdown` is scrambled and left-aligned;
- on the macOS terminals Claude Code prints Hebrew in stored order, so it reads reversed. (On
  Windows Terminal, conhost and VS Code's terminal Claude Code reorders it itself, since 2.1.74.)

The kit fixes each of these, and adds a small design language so a pane looks current.

## Use it

1. Copy the kit into the mod: **Read** `<this skill's base directory>/../../hooks/rtl.tsx` and **Write**
   it unchanged to `<mod>/hooks/rtl.tsx`. It is one file with no run-time imports. (Use Read and
   Write, not `cp`: an installed plugin lives under `~/.claude/`, where a shell copy is refused.) The
   base directory is printed when this skill loads. Keep the file's first line (it carries the
   version); copy it again to upgrade. Never write a smaller version of it inline: the terminal
   reordering and the markdown renderer would be lost. (A Write may turn its `\uXXXX` escapes into the
   characters themselves; that is the same code.)
2. Build the kit once per draw, from the render event:

   ```tsx
   import { kit, svgHeader } from './rtl'

   on('ui.render', { component: 'Pane', requestId: 'mine' }, async ($, e) => {
     const k = kit($.ui.resolve(e), e)
     return k.col('page', [
       k.tabs('tabs', [{ id: 'a', label: 'משימות' }, { id: 'b', label: 'חדרים' }], 'a', id => pick($, id)),
       k.card('c1', { title: 'חדר 4 · 10:00–12:00', meta: 'בקשה של מטפלת', tone: 'warn',
         actions: [k.primary('ok', 'לאשר', () => approve($)), k.action('no', 'לדחות', () => decline($))] }),
       k.para('p', longHebrewText),
     ])
   })
   ```
3. Put every user-visible string through a builder (`text`, `para`, `heading`, the buttons) or through
   `k.bidi(s)` when you build an element yourself. Never hand a raw Hebrew string to Text or Button.

## Rules

- **Rows are `k.row` (row-reverse), columns are `k.col` (aligned right).** Don't write
  `flexDirection="row"` in an RTL pane.
- **Long text goes through `k.para`**: it wraps at `k.width` characters and draws each line on its own,
  aligned right. A single Text that wraps on its own starts its lines at the left.
- **Markdown goes through `k.md`**, never the `Markdown` element.
- **One `k.primary` per screen** (the black button); everything else `k.action`, `k.quiet` or `k.item`.
- **Colours are `tone` keys** (`accent`, `ok`, `warn`, `bad`, `info`, `muted`, `line`, `fill`), which are
  theme keys, so they follow light and dark.
- **SVG only where the surface draws it:** `k.svg(key, svgHeader({...}), alt)` returns nothing on the
  terminal. Everything a person types goes through `escapeXml` (the builders do it).
- **Never name a variable `h` in a `.tsx` file**: JSX compiles to the global `h()`.
- **Terminal:** `bidi` prints the visual order there. Where Claude Code or the terminal already
  reorders (VS Code's terminal, Windows), pass `kit(el, e, { terminal: 'logical' })`, or the text is
  reversed twice. Read it in `session.start`: `await $.env.get('TERM_PROGRAM') === 'vscode'`, keep the
  answer in `$.state`, and pass it to `kit()` when drawing.
- **`Text dir` (Claude Code 2.1.300):** sets a Text's base direction and, where the engine reorders,
  flushes it right. Not a replacement yet: the desktop app's bundled engine (2.1.295 on 2026-10-15)
  refuses the whole tree over it. Re-measure the desktop when its engine reaches 2.1.300.

## The API

| Builder | Draws |
| :- | :- |
| `k.text(s, props)` | one line |
| `k.para(key, s, props)` | wrapped, right-aligned lines |
| `k.heading(key, s, level)` | a heading; level 1 in the accent colour |
| `k.muted(key, s)` | secondary text |
| `k.row(key, children)` / `k.col(key, children)` | right-to-left row / right-aligned column |
| `k.primary` / `k.action` / `k.quiet` `(key, label, onPress)` | buttons: black, light, dimmed |
| `k.item(key, label, onPress, meta?)` | a pressable list row with a muted line under it |
| `k.card(key, { title, meta, tone, actions }, children)` | a rounded card, highlighted on hover |
| `k.chip` / `k.chips` | coloured labels |
| `k.stat(key, value, label, tone)` | a number over its label |
| `k.tabs(key, items, current, onPick)` | tabs; the current one primary |
| `k.list(key, items, { ordered })` | a list with its markers on the right; `{ text, depth }` nests |
| `k.table(key, headers, rows, { widths })` | columns right to left; cells wrap inside |
| `k.md(key, markdown)` | headings, paragraphs, lists, quotes, tables, code |
| `k.svg(key, piece, alt)` | an `svgHeader({ title, subtitle, chips })` or `svgTimeline({ lanes, blocks, from, to, now })` |

Pure helpers: `bidi`, `visual`, `wrap`, `hasRtl`, `stripMarks`, `asStored`, `parseMd`, `escapeXml`,
`schemeOf`, `tone`.

## Check it

Open `/rtl-gallery` (this plugin's gallery) on the surface you target to see every piece, and its ruler to
measure how many characters fit a line. The `charsPerColumn` option (default 0.9 on the desktop)
sets the wrap width; Hebrew letters run a little wider than digits.

In tests, strip the marks before comparing text: `stripMarks(t)`.
