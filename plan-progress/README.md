# plan-progress

Where a long build stands, beside the conversation, and a plan that keeps itself current. I keep builds as a plan of numbered steps in plain Markdown. This mod answers the three questions I ask it, in order: how far are we ("13 of 16 done"), what is happening now (the step, how long it has run, what Claude is doing this minute), and what needs me (only when something does). Every agent's plan view fails the same way, the agent forgets to update it, so this one also reads the evidence: commits that name a step move the plan, and when the work has moved past an open step, it says so.

**What it reads and writes.**
- It reads one Markdown file, the plan you pin, and checks it every 2 seconds (a stat; it reads the file only when it changed).
- It watches this session's tool calls: what Claude is doing (for the live line), Edit and Write on the plan (to redraw at once), and `git commit` in Bash. From a commit it reads the message in the command line, and only uses the step ids it names.
- It writes the plan file in three cases, each one line: Claude calls its tool to set or add an item; a commit names a step not yet started, which it marks in progress; or you press "Mark … done" on a lag it shows.
- It keeps each plan's history (commit ids, when items started and finished, the lags it showed) in its own store, so every session that pins the file reads the same.
- **One line to Claude:** when a commit shows the work has moved past an item still in progress, it adds one sentence to that commit's result, which Claude reads (a few tokens, once per lag), and the pane says it did.
- **One process:** on the desktop, pressing Open the file runs your system's opener (`open`, `explorer`, `xdg-open`), because the desktop draws only `https:` links.
- No network, no model calls.

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
- [ ] PR · The one PR, its CI run
- [?] gate · The merge · Bar's word
<!-- /plan-progress -->
```

- **The markers:** `<!-- plan-progress title="…" -->` opens the block and `<!-- /plan-progress -->` closes it. The title is optional. One file holds one block; the first is read.
- **A line:** `- [state] id · title`, then optional fields after further ` · ` separators: a commit, a PR, a date, a note. Backticks and Markdown links are kept as written; a field that is only a link `[text](https://…)` is drawn as a link. A line with one field is a title with no id. An item with notes needs an id.
- **States:** `[ ]` to do, `[~]` in progress, `[x]` done (`[X]` too), `[?]` waits on you (a decision or a gate), `[!]` blocked by something else, `[-]` dropped.
- **Nesting:** two levels, a step and its sub-steps. A sub-step is indented two spaces (any indent of two or more).
- **Gates:** an item whose id is `gate` is a milestone, not work, drawn as a diamond where it falls and never counted. A gate is **due** only when every step before it is done: then it needs you. Until then it is ahead, one quiet line, however it is marked. Name a gate by its title.
- **Other lines** inside the block (blank lines, prose, comments) are kept and ignored.

## Commits that name a step

Write the step's id after "step" or "steps" in the commit message, the way the trainer studio's build does: `feat(drafts): an exercise not on the list (3.1 step 3a)`, `(3.1 steps 3b, 3c)`, `(3.1 step 2a, 2b part)`. Only ids the plan has count, so `3.1` or `part` never match. When such a commit lands in a session with the mod:

- the commit is attached to each step it names, and its time is that step's start if it had none;
- a step it names that was not started becomes in progress (and its step, for a sub-step);
- when the commit names a later step while an earlier one is still in progress, that earlier step **looks done**. The pane shows it under "The plan is behind", marked inferred, with Mark done and Not yet. Claude reads one sentence about it in the commit's result. The mod never closes a step by itself.

## How it counts

Each top-level step weighs one. A step with sub-steps fills by the share of them done; a step without sub-steps counts only once it is done, so `[~]` alone adds nothing. Gates and dropped items are not counted. The percentage is rounded down, so 100% means every step is done. The pane leads with how many steps are done ("13 of 16 done") and keeps the percentage small. A position ("step 9 of 16") would mislead: steps finish out of order, and steps can be added.

**Pace** appears once two steps were seen both start and finish: the minutes each took, a bar per step, and the range a step takes. What is left is that range times the steps left, in hours, always a range ("about 7-10 h"). There is no finish time before there is pace to read.

## What you see

**The pane** (`/progress`), top to bottom; a section with nothing in it takes no room:

- the plan's name, **13 of 16 done** in big type, the percentage small, and the strip: ink for what is done, halftone at the front with the orange mark, a blueprint outline ahead, a diamond per gate. Hover a segment for its title, state and notes.
- **The plan is behind:** a step the commits moved past, with Mark done and Not yet.
- **Needs you now:** a decision marked `[?]`, or a gate that is due, with a button that puts "Go ahead with …" in the prompt box for you to send. Otherwise one quiet line: "◇ 3 gates ahead, after PR: …".
- **Now:** the step, how long ago it started, its open sub-steps with their notes, its commits, and while Claude works, one live line of what it is doing ("Claude · Run the emulator and browser suites").
- **Next:** the next three steps. **Done:** one line of ids and when the last one closed; Every step shows them all. **Pace**, when there is one.
- the file, when it changed, and Every step, Hide, Pin another plan, Open the file.

**The band**, above the prompt: the strip, "13/16 done · 6 Demo data · 9 h". A second line only when a gate is due ("◆ terraform apply needs your word") or the plan is behind. Press it to open the pane. Nothing when no plan is pinned or it is hidden.

**A toast** when a step turns done ("Step 3 done · 5 of 15"), and a short moment when the whole plan does. Sub-steps make no noise.

On the desktop the masthead is an SVG carrying its own subsets of Heebo and Cascadia Mono, and it follows the app's light or dark theme. The terminal draws the same brief in characters: blocks for ink, braille dots for halftone, a dashed line for blueprint. The pane opens unasked at session start only when a plan is pinned and you have not hidden it in that project (in the terminal, only from 144 columns).

**Hebrew.** On the desktop a title that opens in Hebrew is set right to left; a Latin title with a Hebrew word reads as it is. The macOS terminals print text in stored order, so the mod hands them Hebrew in visual order; VS Code's terminal and Windows Terminal order it themselves and get it as written. (The ordering is rtl-kit's.)

## Commands

| | |
| :- | :- |
| `/progress` | open the pane and bring the band back |
| `/progress pin <file>` | pin the plan in that file, for this project |
| `/progress hide` | hide the band and the pane until `/progress` |
| `/progress unpin` | pin nothing |

`/progress` is a command file (`commands/progress.md`), so the desktop app lists it from the session's start; the mod answers it at once, with no model turn. `/plan-progress:progress` is the same command. You can also just ask Claude ("show the plan's progress", "pin progress-3-1.md"): the tool does the same.

## The tool Claude calls

`mcp__plan-progress__progress`, one tool with an `action`:

| action | arguments | what it does |
| :- | :- | :- |
| `read` | | the plan, compact: percentage, now, what waits, the gates ahead, every line, and whether it looks behind; and a `version` |
| `set` | `item`, `state`, `note?`, `version?` | sets an item's state: `todo`, `doing`, `done`, `waits`, `blocked`, `dropped`. `note` replaces the fields after the title (`""` removes them). |
| `add` | `title`, `id?`, `state?`, `note?`, `after?` or `under?`, `version?` | a new item after another at its depth (after its sub-steps), or as the last sub-step of a step; at the end with neither |
| `pin` | `path` | pins the plan file |
| `show`, `hide`, `unpin` | | opens the pane, hides the band and the pane, pins nothing |

`item` is an id (`2d`) or, for a gate, its title. A write reads the file fresh and changes only that item's line, every other byte kept, line endings included. With the `version` that `read` returned, it refuses when the file changed since (a hand edit), and it always refuses when the file changes while the edit is being made. Hand edits are normal: they show within two seconds, or at once when made with Edit or Write.

An agent working a plan calls `read` when it picks up the build, `set … doing` as it starts a step or sub-step, `set … done` with the commit as it finishes one, and names the step in each commit message.

## Footprint

From `claude plugin validate`:

- **hooks:** `session.start`, `command.run{command=/^(?:plan-progress:)?progress$/}`, `prompt.submit`, `tool.call`, `turn.complete`, `ui.render{component=AbovePrompt}`, `ui.render{component=Pane, requestId=plan-progress}`
- **calls:** `$.clock.after`, `$.clock.every`, `$.clock.now`, `$.env.get`, `$.fs.read`, `$.fs.stat`, `$.fs.write`, `$.process.run` (Open the file), `$.prompt.fill` (Give the word), `$.session.version`, `$.state.get`, `$.state.set`, `$.store.delete`, `$.store.get`, `$.store.set`, `$.tool.register`, `$.ui.close`, `$.ui.open`, `$.ui.resolve`, `$.ui.toast`
- **env reads:** `HOME`, `OS`, `TERM_PROGRAM`, `WT_SESSION`

The one `tool.call` hook answers the plan tool, notes what Claude is doing, redraws on an Edit or Write of the plan, and reads `git commit` results; it passes every call through, adding one sentence of context to a commit's result only when that commit shows the plan is behind. The `prompt.submit` hook acts only on a prompt that is `/progress …`: where a command file arrives as a prompt (the desktop app, `claude -p`), it answers and drops it, so no turn runs. Every other prompt passes untouched. `turn.complete` clears the live line.

## Surfaces

Draws in the terminal and the desktop app's Code tab. In `claude -p`, the SDK and the VS Code chat panel the tool and the commit reading still work and nothing draws.

## Fonts

`hooks/lib/fonts.ts` holds subsets of Heebo and Cascadia Mono, made by `scripts/make-fonts.py`, under the SIL Open Font License 1.1 (`fonts/OFL.txt`). The rest is MIT.

Tested on Claude Code 2.1.301 (CLI) and 2.1.299 (the desktop app's engine).
