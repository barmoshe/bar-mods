# modsmith

A workbench for building Claude Code mods. It shows what the engine is really doing (which mods loaded, every event and its real payload) and runs the four ship gates on the mod you are working on. It also gives Claude three tools, so while it builds a mod it can read a real event payload instead of guessing from the 14,000-line types file, and run the gates in one call instead of by hand.

**Reach, up front:** modsmith starts local processes (`claude` and `npx`, for the gates and a version check), reads mod folders and your settings, and reads `HOME`. It makes no model calls and sends nothing anywhere; the only network use is `npx` fetching TypeScript the first time the types gate runs. With its tools on, their descriptions add a few hundred tokens to every request. By default it runs `claude plugin validate` on a dev mod each time that mod reloads. Both are switches (below).

```bash
claude plugin install modsmith@bar-mods
```

## What you get

- **Mods:** every mod this session saw load, with the events it hooks, the `$` calls it makes and how many times it reloaded; installed plugins and dev mods on disk beside them. Pick one as the gate target.
- **Tape:** the last 150 events (tool calls with their outcome and time, prompts, turns, commands, subagents, compaction, plugin loads, and other mods' button presses, inputs and selects). Pick a row to see the real `e` as JSON and copy it. Pause, clear, filter by family. Obvious secrets (`sk-…`, `ghp_…`, bearer tokens, `token=` values) are scrubbed before anything is kept, and the tape lives only in the session's memory.
- **Gates:** the four from the bar every bar-mods mod passes:
  1. **validate:** `claude plugin validate`, green only with no warnings;
  2. **types:** `tsc` against the types Claude Code writes beside the mod, zero errors outside `tests/` (the first run fetches TypeScript and takes about half a minute; after that, a few seconds);
  3. **tests:** `claude plugin test`;
  4. **eyes:** three checkboxes for terminal, desktop and a narrow width.

  It also warns when your `claude` CLI is older than the engine (an older CLI fails correct mod code), when the README's footprint misses a hook or call validate found, and when the installed copy has the same version as the one you are about to ship.
- **Band:** right after a dev mod reloads, until your next prompt: `↻ my-mod reloaded · 4 hooks · validate ✓`. It stacks above any other mod's band.

`/modsmith` opens the pane. It also opens by itself when a dev mod loads, where there is room (144 columns or more). `/gates [mod folder]` runs the gates with no Claude turn and prints the result.

## Tools for Claude

| Tool | What it answers |
| :- | :- |
| `mcp__modsmith__events` | Recent events with their payloads; `event` filters by name or prefix (`tool.call`, `ui.`), `limit` defaults to 20 |
| `mcp__modsmith__gates` | Runs the gates on `dir` (default: the target), `only` picks some; pass/fail with trimmed output per gate |
| `mcp__modsmith__mods` | The roster, with each mod's events and calls |

## Options

Set in `/plugin` on the installed plugin:

| Option | Default | What it does |
| :- | :- | :- |
| `tools` | on | Register the three tools |
| `autoValidate` | on | Validate a dev mod on every reload |
| `recordAppends` | off | Also record `session.append`, every transcript row (floods the tape) |
| `cliPath`, `npxPath` | `claude`, `npx` | Where the gates find them, when the app's PATH does not |

## Footprint

From `claude plugin validate`:

- **hooks:** `session.start`, `session.end`, `plugin.register`, `prompt.submit`, `turn.start`, `turn.complete`, `agent.spawn`, `session.compact`, `tool.call` (observes; answers only its own tools), `command.run` (answers only `/modsmith` and `/gates`), `ui.press`, `ui.input`, `ui.select`, `session.append` (only with `recordAppends`), `ui.render{component=AbovePrompt}`, `ui.render{component=Pane}`
- **calls:** `$.clock.after`, `$.clock.now`, `$.command.register`, `$.env.get` (`HOME`), `$.fs.exists`, `$.fs.list`, `$.fs.read`, `$.process.run` (`claude`, `npx`), `$.session.id`, `$.session.version`, `$.settings.read`, `$.state.get`, `$.state.set`, `$.tool.register`, `$.ui.copy`, `$.ui.open`, `$.ui.resolve`

It never changes another mod's event: every hook passes the event on unchanged.

## Notes

- A `plugin.register` hook only sees mods that load after modsmith, so a mod that loaded first shows as installed or on disk until it reloads.
- Draws in the terminal and the desktop app's Code tab. In `claude -p` the commands and tools still work: `claude -p "/gates ." --plugin-dir ./my-mod` gates a mod from a script.

Tested on Claude Code 2.1.288.
