# surface-probe

A pane to open before you design a big UI for a surface. It shows what that surface really does, so the plan starts from facts instead of guesses.

- **What the surface reports:** surface, placement (docked beside the transcript or above the prompt), body width in cells, viewport.
- **Right-to-left text:** a Hebrew line, a mixed Hebrew and English line, a `row-reverse` row and a right-aligned box. The terminal draws Hebrew in reverse; the desktop draws it right.
- **SVG:** a banner with Hebrew in it, on surfaces that draw `Svg`.
- **A button that talks to Claude:** "לשלוח ל-Claude" sends Claude a short message and logs how many milliseconds it waited to enter the conversation; "לתיבת ההודעה" only puts it in the prompt box.

```bash
claude plugin install surface-probe@bar-mods
```

Then `/surface-probe`.

## What it does outside the pane

The send button submits one prompt to the conversation, `surface-probe: a button press reached the conversation.`, which starts a turn and costs that turn's tokens. Nothing else: no files, processes, network or model calls of its own.

Two things it was built around, both seen on 2026-10-04:

- One press can fire twice. A second press while the first is sending is ignored, and the log says so.
- The pane opens without taking the keyboard. A pane that holds the keyboard can keep a queued prompt from entering the conversation when the running turn ends.

## Footprint

From `claude plugin validate`:

- **hooks:** `session.start`, `command.run{command=surface-probe}`, `ui.render{component=Pane, requestId=surface-probe}`
- **calls:** `$.clock.now`, `$.command.register`, `$.prompt.fill`, `$.prompt.submit`, `$.state.get`, `$.state.set`, `$.ui.close`, `$.ui.open`, `$.ui.resolve`

## Surfaces

Draws in the terminal and the desktop app's Code tab. In `claude -p`, the SDK and the VS Code chat panel its hooks run and nothing draws.

Tested on Claude Code 2.1.288.
