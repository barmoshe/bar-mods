# rtl-kit

Right-to-left for Claude Code mods. One file you copy into a mod, so Hebrew and Arabic read right in a pane, a band or a status line.

A mod draws with Claude Code's own elements. On the desktop app every element is laid out left to right, so a line that mixes Hebrew with English or numbers comes out scrambled, a long line wraps starting at the left, and `Markdown` is both. On the macOS terminals Claude Code prints Hebrew in stored order, so it reads reversed. The kit fixes each of these:

- **Order:** every string goes out wrapped in a right-to-left embedding, so `לבקש מ-Claude: 3 בקשות, 10:00–12:00` reads right, in text and in button labels.
- **Alignment:** long text is wrapped by the kit, one line at a time, each aligned right.
- **Layout:** rows run right to left, columns align right, list markers and table columns start on the right.
- **Markdown:** `k.md()` draws headings, paragraphs, nested lists, quotes and tables with the pieces above.
- **Design:** cards with hover, tabs, chips, stats, one primary button per screen, and colours from the app's theme keys, so light and dark both work.
- **SVG:** a header with chips and a day timeline (lanes against hours, right to left), drawn where the surface has `Svg`.
- **Terminal:** the visual order is computed (Latin words and numbers stay whole, brackets mirror), so Hebrew reads right there too. Where Claude Code already reorders (VS Code's terminal, Windows Terminal, conhost), pass `{ terminal: 'logical' }`, or it is reversed twice.

## Use it

```bash
claude plugin install rtl-kit@bar-mods
```

The plugin brings a skill, `rtl-kit`, that copies `hooks/rtl.tsx` into the mod you are building and uses it (with Read and Write: a shell `cp` out of `~/.claude/` is refused). By hand:

```bash
cp ~/.claude/plugins/marketplaces/bar-mods/rtl-kit/hooks/rtl.tsx <your-mod>/hooks/rtl.tsx
```

```tsx
import { kit } from './rtl'

on('ui.render', { component: 'Pane', requestId: 'mine' }, async ($, e) => {
  const k = kit($.ui.resolve(e), e)
  return k.col('page', [
    k.heading('h', 'שלום'),
    k.para('p', 'טקסט ארוך בעברית עם Claude באמצע, שעובר כמה שורות ונשאר מיושר לימין.'),
    k.row('buttons', [k.primary('ok', 'לאשר', () => approve($)), k.action('no', 'לדחות', () => decline($))]),
  ])
})
```

The copied file has no run-time imports and takes no `$`, so the mod needs nothing else installed. Re-copy it to upgrade; its first line names the version.

`/rtl-gallery` opens a gallery of every piece on the current surface, and a ruler to see how many characters fit a line.

## What it does outside the pane

Nothing. The gallery draws, remembers which tab is open, and reads Claude Code's `theme` setting. No files, processes, network or model calls. The copied `rtl.tsx` makes no calls at all.

## Footprint

From `claude plugin validate`:

- **hooks:** `session.start`, `command.run{command=rtl-gallery}`, `ui.render{component=Pane, requestId=rtl-kit}`
- **calls:** `$.command.register`, `$.config.list`, `$.state.get`, `$.state.set`, `$.ui.open`, `$.ui.resolve`

## Still needed? (Claude Code 2.1.300)

Claude Code 2.1.300 gave `Text` a `dir` prop: `dir="rtl"` sets the base direction, and where Claude Code orders the letters itself (VS Code's terminal, Windows) the rows also sit flush right. It does not replace the kit yet:

- **Desktop:** the app bundles its own Claude Code, and on 2026-10-15 that was 2.1.295, which refuses a whole drawing that names `dir`. The kit is the desktop's answer until the app moves; then `dir` on the desktop gets measured.
- **macOS terminals:** `dir` changes nothing there (Claude Code leaves the order to the terminal), so the kit's visual order is still what makes Hebrew read right.
- **VS Code's terminal and Windows:** Claude Code reorders, so use `{ terminal: 'logical' }` there, and `dir="rtl"` on a Text once every engine you target has it.

## Limits

- Wrapping is by character count, and fonts are proportional: a line can still wrap in the app, and that one wrapped line starts at the left. The default width (90% of the pane's columns) kept every line whole on the desktop; `charsPerColumn` changes it.
- The terminal reordering is a simplified bidi: no combining marks (niqqud), no nested embeddings.
- Claude Code's `theme` setting describes the terminal, not the desktop app, so SVG on the desktop follows the system's colour scheme.

## Surfaces

Looked at in the desktop app's Code tab, every gallery tab. The terminal path is covered by the tests (both surfaces) and its reordering by expected strings; VS Code and the phone use the desktop's path and have not been looked at yet. In `claude -p` and the SDK its hooks run and nothing draws.

Tested on Claude Code 2.1.289; tests re-run on 2.1.295 and 2.1.300, and the terminal path read on 2.1.300 (2026-10-15).
