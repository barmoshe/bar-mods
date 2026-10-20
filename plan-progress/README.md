# plan-progress

Where a plan stands, beside the conversation. I keep long builds as a plan of numbered steps in plain Markdown, and this mod draws that plan as one press line: ink for what is done, halftone for the step under way, a blueprint outline for what is ahead, and a diamond for each gate that waits on me. A quiet band above the prompt says the same in one line. Claude keeps the plan current through a tool, one line at a time.

**What it reads and writes.** It reads one Markdown file, the plan you pin, and checks it every 2 seconds (a stat; it reads the file only when it changed). It writes that file only when Claude calls its tool to set or add an item, and then only that item's line. It remembers the pinned path, and whether you hid it, per project in its own store. **One process:** on the desktop, pressing Open the file runs your system's opener (`open` on macOS, `explorer` on Windows, `xdg-open` elsewhere) on that file, because the desktop draws only `https:` links. No network, no model calls, no tokens beyond the tool's listing.

```bash
claude plugin install plan-progress@bar-mods
```

Then `/progress pin path/to/plan.md`.

## The block

Progress is a block inside any Markdown file. Everything outside the block is never read or changed, and the file stays readable on GitHub, where `[~]`, `[?]`, `[!]` and `[-]` show as text.

```md
<!-- plan-progress title="Version 3.1 · trainer studio" -->
- [x] 1 · Days in a template · `5d18be5`
- [~] 2 · Exceptions and "שמור"
  - [x] 2a · Tables, codec, rules · `df82ea1`
  - [~] 2b · The editor's draft
  - [ ] 2c · The checks
- [ ] 3 · An exercise not on the list
- [-] 4 · A step we dropped
- [?] gate · The merge · Bar's word
<!-- /plan-progress -->
```

- **The markers:** `<!-- plan-progress title="…" -->` opens the block and `<!-- /plan-progress -->` closes it. The title is optional. One file holds one block; the first is read.
- **A line:** `- [state] id · title`, then optional fields after further ` · ` separators: a commit, a PR, a date, a note. Backticks and Markdown links are kept as written; a field that is only a link `[text](https://…)` is drawn as a link. A line with one field is a title with no id. An item with notes needs an id.
- **States:** `[ ]` to do, `[~]` in progress, `[x]` done (`[X]` too), `[?]` waits on you (a decision or a gate), `[!]` blocked by something else, `[-]` dropped.
- **Nesting:** two levels, a step and its sub-steps. A sub-step is indented two spaces (any indent of two or more).
- **Gates:** an item whose id is `gate` is a milestone, not work. It is drawn as a diamond on the line and never counted. Name a gate by its title.
- **Other lines** inside the block (blank lines, prose, comments) are kept and ignored.

## How it counts

Each top-level step weighs one. A step with sub-steps fills by the share of them done; a step without sub-steps counts only once it is done, so `[~]` alone adds nothing. Gates and dropped items are not counted. The percentage is rounded down, so 100% means every step is done. The pane says this rule when you hover the number.

**Now** is the deepest item marked `[~]`; with none, the first item not done (its first open sub-step, if it has any).

## What you see

- **The band**, above the prompt: the plan's title, a slim press line, the percentage, "now 2d The editor's draft", and "3 wait on you" when something does. Press it to open the pane. Nothing when no plan is pinned or it is hidden.
- **The pane**, `/progress`: the file, the title and the percentage over the press line, with each step's id under its segment, an orange mark at the front of the work, and dimension lines for what is done and what is ahead. Hover a segment for its title, state and note. Below: what waits on you, the step in progress with its sub-steps and notes, what comes next (or every step), when the file last changed, and Hide, Pin another plan, Every step, Open the file.
- **A toast** when a step turns done ("Step 2 done · 4 of 15"), and a short moment when the whole plan does. Sub-steps make no noise.

On the desktop the press line is an SVG carrying its own subsets of Heebo and Cascadia Mono, and it follows the app's light or dark theme. The terminal has no SVG, so it draws the same line in characters: blocks for ink, braille dots for halftone, a dashed line for blueprint. The pane opens unasked at session start only when a plan is pinned and you have not hidden it in that project (in the terminal, only from 144 columns).

**Hebrew.** On the desktop a title that opens in Hebrew is set right to left; a Latin title with a Hebrew word reads as it is. The macOS terminals print text in stored order, so the mod hands them Hebrew in visual order; VS Code's terminal and Windows Terminal order it themselves and get it as written. (The ordering is rtl-kit's.)

## Commands

| | |
| :- | :- |
| `/progress` | open the pane and bring the band back |
| `/progress pin <file>` | pin the plan in that file, for this project |
| `/progress hide` | hide the band and the pane until `/progress` |
| `/progress unpin` | pin nothing |

## The tool Claude calls

`mcp__plan-progress__progress`, one tool with an `action`:

| action | arguments | what it does |
| :- | :- | :- |
| `read` | | the plan, compact: percentage, now, what waits, every line; and a `version` |
| `set` | `item`, `state`, `note?`, `version?` | sets an item's state: `todo`, `doing`, `done`, `waits`, `blocked`, `dropped`. `note` replaces the fields after the title (`""` removes them). |
| `add` | `title`, `id?`, `state?`, `note?`, `after?` or `under?`, `version?` | a new item after another at its depth (after its sub-steps), or as the last sub-step of a step; at the end with neither |
| `pin` | `path` | pins the plan file |

`item` is an id (`2d`) or, for a gate, its title. A write reads the file fresh and changes only that item's line, every other byte kept, line endings included. With the `version` that `read` returned, it refuses when the file changed since (a hand edit), and it always refuses when the file changes while the edit is being made. Hand edits are normal: they show within two seconds, or at once when made with Edit or Write.

An agent working a plan calls `read` when it picks up the build, `set … doing` as it starts a step or sub-step, and `set … done` with the commit as it finishes one.

## Footprint

From `claude plugin validate`:

- **hooks:** `session.start`, `command.run{command=progress}`, `tool.call`, `ui.render{component=AbovePrompt}`, `ui.render{component=Pane, requestId=plan-progress}`
- **calls:** `$.clock.after`, `$.clock.every`, `$.clock.now`, `$.command.register`, `$.env.get`, `$.fs.read`, `$.fs.stat`, `$.fs.write`, `$.process.run` (Open the file), `$.session.version`, `$.state.get`, `$.state.set`, `$.store.delete`, `$.store.get`, `$.store.set`, `$.tool.register`, `$.ui.close`, `$.ui.open`, `$.ui.resolve`, `$.ui.toast`
- **env reads:** `HOME`, `OS`, `TERM_PROGRAM`, `WT_SESSION`

The one `tool.call` hook answers the plan tool and watches Edit and Write on the pinned file; every other call passes through unchanged.

## Surfaces

Draws in the terminal and the desktop app's Code tab. In `claude -p`, the SDK and the VS Code chat panel the tool still works and nothing draws.

## Fonts

`hooks/lib/fonts.ts` holds subsets of Heebo and Cascadia Mono, made by `scripts/make-fonts.py`, under the SIL Open Font License 1.1 (`fonts/OFL.txt`). The rest is MIT.

Tested on Claude Code 2.1.301 (CLI) and 2.1.299 (the desktop app's engine).
