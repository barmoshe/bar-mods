---
description: Show the pinned plan's progress beside the conversation (pin <file>, hide, unpin)
argument-hint: [pin <file> | hide | unpin]
---

The plan-progress mod answers this command itself, without a turn. If you are reading this, it did not: call the
`mcp__plan-progress__progress` tool for the person's request instead, once, and say its answer in one line.

- No arguments, or `show`: action `show`.
- `pin <file>`: action `pin` with that file as `path`.
- `hide` or `unpin`: that action.

The request: /progress $ARGUMENTS
