# mission-control

A live pane beside the transcript that shows the whole session at a glance.

- **Context ring:** how full the context window is, green under 50%, amber to 80%, red above. A dashed ring spins around it while Claude works.
- **Cost:** what the session has spent so far.
- **Timeline:** one square per tool call, colored by kind (blue reads, green edits, orange shell, purple web, pink agents, teal MCP). The running call pulses, a failed one gets a red outline, a subagent's call is a circle. Hover a square to see the file or command.
- **Commentator:** after each turn, Haiku calls it in one sentence like a sports commentator, naming the real tools and files.
- **Files edited:** the last ten files Claude changed.
- **Milestones:** a toast every 50 tool calls.
- **Buttons:** Mute commentator, Reset.

`/mission` opens the pane. It also opens by itself when a session starts, where there is room for it (144 columns or more).

```bash
claude plugin install mission-control@bar-mods
```

## Footprint

From `claude plugin validate`:

- **hooks:** `session.start`, `command.run{command=mission}`, `prompt.submit`, `tool.call` (observes only, never changes a call), `turn.complete`, `ui.render{component=Pane}`
- **calls:** `$.clock.after`, `$.clock.now`, `$.command.register`, `$.model.complete`, `$.session.usage`, `$.state.get`, `$.state.set`, `$.ui.open`, `$.ui.resolve`, `$.ui.toast`

No files, processes, network or environment. **Cost:** the commentator makes one Haiku call per turn on your plan or API key (low effort, at most 120 output tokens, 15 s timeout). Mute it and it makes none.

## Surfaces

The desktop app draws the ring and timeline as animated SVG. The terminal draws a text version: a bar for the context, the cost, and a row of colored squares. In `claude -p`, the SDK and the VS Code chat panel its hooks run and nothing draws.

Tested on Claude Code 2.1.288.
