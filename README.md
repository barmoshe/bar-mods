# bar-mods

Claude Code mods I build and use every day: live panes, bands and guards that run inside Claude Code itself.

A mod is a Claude Code plugin whose hooks are TypeScript functions running in Claude Code's own process, so it can draw a pane beside the transcript, a band above the prompt, or step into a tool call. Mods need Claude Code 2.1.287 or later and are on by default.

```bash
claude plugin marketplace add barmoshe/bar-mods
```

```bash
claude plugin install mission-control@bar-mods
```

## The mods

| Mod | What it does | Reach |
| :- | :- | :- |
| [turn-meter](turn-meter/) | A band above the prompt. While Claude works it shows the tool running now; after the turn, a one-line summary: seconds, tool calls, and the top tools by count. `/turn-meter` hides it. | Draws and remembers only |
| [modsmith](modsmith/) | A workbench for building mods: which mods loaded, a live tape of every event with its real payload, the four ship gates on the mod in progress (`/gates`), and tools so Claude reads real payloads and runs the gates itself. | Starts local processes (`claude`, `npx`), reads mod folders and settings; no model calls |
| [mission-control](mission-control/) | A pane beside the transcript: an animated context ring, the session's cost, a colored timeline of every tool call (hover a square to see what it did), the files edited, and a sports-commentator recap of each turn. `/mission` opens it. | Draws, remembers, and makes one small Haiku call per turn (mutable) |
| [surface-probe](surface-probe/) | A pane to open before designing for a surface: what it reports (placement, width), how it lays out Hebrew and right-to-left rows, an SVG where there is one, and a button that sends Claude a message and logs how long it waited. `/surface-probe` opens it. | Draws, remembers, and submits one prompt when its send button is pressed |
| [rtl-kit](rtl-kit/) | Right-to-left for mods: one file you copy into a mod so Hebrew and Arabic read in the right order, long text wraps aligned right, and a pane gets cards, tabs, tables, markdown and SVG timelines that read right to left. The terminal gets the visual order. `/rtl-gallery` opens a gallery. | Draws and remembers only; the copied file makes no calls |
| [plan-progress](plan-progress/) | Where a long build stands, beside the conversation, from a plain Markdown plan: "Step 7 of 15", what is happening now (with a live line of what Claude is doing), what needs you only when it does, next, done, pace. Commits that name a step move the plan, and when the work moves past an open step it says so and tells Claude once. `/progress pin <file>`. | Reads and writes the one plan file you pin, reads this session's tool calls and commit messages, adds one sentence to a commit's result when the plan lags; starts the system's opener only when you press Open the file on the desktop |

"Reach" is what a mod can touch, read from `claude plugin validate`. turn-meter, mission-control, surface-probe and rtl-kit start no processes, read no files and never reach the network. plan-progress reads and writes only the plan file you pin, and starts one process (`open`) only when you press Open the file in the desktop app. modsmith runs the gates, so it starts local processes; its README says exactly what it touches.

## How each mod is checked

Every mod here passes four gates before a version ships:

1. `claude plugin validate` on the mod, with a CLI whose version matches the app.
2. `tsc -p <mod>` against the types Claude Code writes beside the mod, with zero errors in `hooks/` and `types/`.
3. `claude plugin test` in the mod's folder: at least one drawing test and one handler test, on both the terminal and desktop surfaces.
4. A look in a real session, in the terminal and in the desktop app's Code tab.

Tested on Claude Code 2.1.288.

## Develop

```bash
claude --plugin-dir ./mission-control
```

Edits hot-reload while the session runs. An installed copy is cached by version, so bump `version` in the mod's `plugin.json` before reinstalling.

## License

MIT

---

Built by [Bar Moshe](https://bar-builds.com/?src=gh-bar-mods)
