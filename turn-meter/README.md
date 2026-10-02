# turn-meter

A band above the prompt that tells you what Claude is doing and what the last turn cost in time and tools.

- **While Claude works:** `● working  5 tool calls, now: Bash`
- **After the turn:** `Last turn: 34s, 7 tool calls (Bash 4, Read 2, Edit 1)`, with a Hide button
- **A turn over 2 minutes:** a toast with its length
- **`/turn-meter`:** shows or hides the band

A subagent finishing never replaces the main turn's summary.

```bash
claude plugin install turn-meter@bar-mods
```

## Footprint

From `claude plugin validate`:

- **hooks:** `session.start`, `command.run{command=turn-meter}`, `prompt.submit`, `tool.call` (observes only, never changes a call), `turn.complete`, `ui.render{component=AbovePrompt}`
- **calls:** `$.clock.now`, `$.command.register`, `$.state.get`, `$.state.set`, `$.ui.resolve`, `$.ui.toast`

No files, processes, network, environment or model calls. It costs no tokens.

## Surfaces

Draws in the terminal and the desktop app's Code tab. In `claude -p`, the SDK and the VS Code chat panel its hooks run and nothing draws.

Tested on Claude Code 2.1.288.
