// rtl-kit 0.1.3: right-to-left text and a small design language for Claude Code mods.
// https://github.com/barmoshe/bar-mods/tree/main/rtl-kit
//
// Copy this one file into your mod's hooks/ folder and import from './rtl'. It imports nothing at
// run time, takes no `$`, and works on every surface:
//
//   const k = kit($.ui.resolve(e), e)
//   return k.col('page', [k.heading('h', 'שלום'), k.para('p', 'טקסט ארוך בעברית עם Claude באמצע…')])
//
// Why it exists (measured on the desktop app, Claude Code 2.1.288-2.1.289):
// - every element is laid out left to right, so a line that mixes Hebrew with Latin or digits is
//   scrambled; wrapping it in RLE…PDF fixes the order, in a Text and in a Button label;
// - a line that wraps still starts at the left, so long text is wrapped here, one Text per line,
//   each aligned right;
// - Markdown is scrambled and left-aligned, so md() renders markdown with these builders instead;
// - on the macOS terminals Claude Code prints Hebrew in stored order, so it reads reversed, and the
//   terminal gets the visual order computed here. Claude Code reorders it itself in Windows
//   Terminal and VS Code's terminal (since 2.1.74; on 2.1.300 its test is WT_SESSION set or
//   TERM_PROGRAM=vscode): pass { terminal: 'logical' } there, or it is reversed twice.
// - Text's `dir` (Claude Code 2.1.300) does not replace this yet: an engine older than 2.1.300 (the
//   desktop app's, on 2026-10-15) refuses the whole tree over it.
//
// Never name a variable `h` in a .tsx file: JSX compiles to the global h().

// ---------- characters and lines ----------

export type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile' | string

const RTL_CHAR = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/
const LATIN_CHAR = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/
const DIGIT = /[0-9\u0660-\u0669\u06F0-\u06F9]/
const MARKS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g
const RLE = '\u202B'
const PDF = '\u202C'

export const hasRtl = (s: string) => RTL_CHAR.test(s)
// Shows a string exactly in stored order on a surface that does bidi (a preview of terminal output).
export const asStored = (s: string) => `\u202D${s}\u202C`
export const stripMarks = (s: string) => s.replace(MARKS, '')

export type BidiOptions = {
  // 'visual' (the default) reorders right-to-left text for a terminal that draws characters in
  // stored order; 'logical' leaves it for a terminal that does its own bidi.
  terminal?: 'visual' | 'logical'
}

// What to hand an element so a right-to-left string reads right on this surface.
export function bidi(s: string, surface: Surface, opts: BidiOptions = {}): string {
  if (!hasRtl(s)) return s
  if (surface === 'terminal') {
    return opts.terminal === 'logical' ? s : s.split('\n').map(visual).join('\n')
  }
  return `${RLE}${stripMarks(s)}${PDF}`
}

const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«' }

type Dir = 'R' | 'L' | 'N'

function strong(ch: string): Dir {
  if (RTL_CHAR.test(ch)) return 'R'
  if (LATIN_CHAR.test(ch) || DIGIT.test(ch)) return 'L'
  return 'N'
}

// One line in the order a terminal must print it so it reads right to left. A simplified Unicode
// bidi: Latin words and numbers stay left to right (with what sits between them, so "Claude: 3"
// and "10:00–12:00" stay whole), everything else follows the line's direction, set by its first
// letter. Brackets in right-to-left runs are mirrored. Combining marks are not handled.
export function visual(line: string): string {
  const chars = Array.from(stripMarks(line))
  if (!chars.some(c => RTL_CHAR.test(c))) return chars.join('')
  const dirs = chars.map(strong)
  // The line's direction comes from its first letter (digits are weak, as in Unicode's bidi).
  const firstLetter = chars.find(c => RTL_CHAR.test(c) || LATIN_CHAR.test(c)) ?? ''
  const base: Dir = LATIN_CHAR.test(firstLetter) ? 'L' : 'R'
  // A neutral between two left-to-right characters joins them; any other neutral takes the base.
  const resolved = dirs.map((d, i) => {
    if (d !== 'N') return d
    let p = i - 1
    while (p >= 0 && dirs[p] === 'N') p--
    let q = i + 1
    while (q < dirs.length && dirs[q] === 'N') q++
    const before = p >= 0 ? dirs[p] : null
    const after = q < dirs.length ? dirs[q] : null
    return before === 'L' && after === 'L' ? 'L' : base
  })
  const runs: { dir: Dir; text: string[] }[] = []
  chars.forEach((c, i) => {
    const d = resolved[i] ?? base
    const last = runs[runs.length - 1]
    if (last && last.dir === d) last.text.push(c)
    else runs.push({ dir: d, text: [c] })
  })
  const flip = (r: { dir: Dir; text: string[] }) =>
    r.dir === 'R' ? [...r.text].reverse().map(c => MIRROR[c] ?? c).join('') : r.text.join('')
  return (base === 'R' ? [...runs].reverse() : runs).map(flip).join('')
}

// Word-wrap to `width` characters; a word longer than the width is cut.
export function wrap(s: string, width: number): string[] {
  const w = Math.max(8, Math.floor(width))
  const out: string[] = []
  for (const para of s.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let rest = word
      while (Array.from(rest).length > w) {
        if (line) {
          out.push(line)
          line = ''
        }
        out.push(Array.from(rest).slice(0, w).join(''))
        rest = Array.from(rest).slice(w).join('')
      }
      if (!line) line = rest
      else if (Array.from(line).length + 1 + Array.from(rest).length <= w) line = `${line} ${rest}`
      else {
        out.push(line)
        line = rest
      }
    }
    out.push(line)
  }
  return out
}

// ---------- the design language ----------

// Theme keys, so colours follow the app's light and dark themes.
export const tone = {
  accent: 'claude',
  ok: 'success',
  warn: 'warning',
  bad: 'error',
  info: 'permission',
  muted: 'secondaryText',
  line: 'subtle',
  fill: 'userMessageBackground',
} as const
export type Tone = keyof typeof tone

// ---------- markdown, parsed ----------

export type MdBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'item'; depth: number; marker: string; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'code'; text: string }
  | { kind: 'rule' }

// Inline markdown to plain text: links to their text, emphasis and code marks off.
export function inline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

// A table line to its cells: a pipe splits unless escaped (\|) or inside a code span.
export function cells(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let isCode = false
  const s = line.trim()
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
      continue
    }
    if (ch === '`') isCode = !isCode
    if (ch === '|' && !isCode) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  if (s.startsWith('|')) out.shift()
  if (s.endsWith('|') && !s.endsWith('\\|')) out.pop()
  return out.map(c => c.trim())
}

const SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

export function parseMd(src: string): MdBlock[] {
  let lines = src.replace(/\r/g, '').split('\n')
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
    if (end > 0) lines = lines.slice(end + 1)
  }
  const out: MdBlock[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push({ kind: 'para', text: inline(para.join(' ')) })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? ''
    if (/^\s*```/.test(l)) {
      flush()
      const code: string[] = []
      for (i++; i < lines.length && !/^\s*```/.test(lines[i] ?? ''); i++) code.push(lines[i] ?? '')
      out.push({ kind: 'code', text: code.join('\n') })
      continue
    }
    if (l.trim() === '') {
      flush()
      continue
    }
    const hd = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l)
    if (hd) {
      flush()
      out.push({ kind: 'heading', level: (hd[1] ?? '#').length, text: inline(hd[2] ?? '') })
      continue
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) {
      flush()
      out.push({ kind: 'rule' })
      continue
    }
    if (l.trim().startsWith('|') && SEPARATOR.test(lines[i + 1] ?? '')) {
      flush()
      const headers = cells(l).map(inline)
      const rows: string[][] = []
      for (i += 2; i < lines.length && (lines[i] ?? '').trim().startsWith('|'); i++) {
        if (!SEPARATOR.test(lines[i] ?? '')) rows.push(cells(lines[i] ?? '').map(inline))
      }
      i--
      out.push({ kind: 'table', headers, rows })
      continue
    }
    const q = /^\s*>\s?(.*)$/.exec(l)
    if (q) {
      flush()
      const quote = [q[1] ?? '']
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1] ?? '')) quote.push((lines[++i] ?? '').replace(/^\s*>\s?/, ''))
      out.push({ kind: 'quote', text: inline(quote.join(' ')) })
      continue
    }
    const it = /^(\s*)(\d+[.)]|[-*+])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(l)
    if (it) {
      flush()
      const indent = (it[1] ?? '').replace(/\t/g, '  ').length
      const raw = it[2] ?? '-'
      out.push({ kind: 'item', depth: Math.min(3, Math.floor(indent / 2)), marker: /\d/.test(raw) ? raw.replace(')', '.') : '•', text: inline(it[3] ?? '') })
      continue
    }
    const last = out[out.length - 1]
    if (para.length === 0 && last?.kind === 'item' && /^\s{2,}\S/.test(l)) {
      last.text = `${last.text} ${inline(l)}`
      continue
    }
    para.push(l.trim())
  }
  flush()
  return out
}

// ---------- SVG pieces (strings for el.Svg; not drawn on the terminal) ----------

export type Scheme = 'light' | 'dark' | 'auto'

export const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const PALETTE = {
  light: { bg: '#faf9f5', panel: '#f0eee6', text: '#141413', muted: '#6b6a64', grid: '#e3e0d6', accent: '#d97757', info: '#6a9bcc', ok: '#788c5d', warn: '#d4a017', bad: '#c4554d', line: '#b0aea5', fill: '#e8e6dc', onTone: '#ffffff' },
  dark: { bg: '#262624', panel: '#30302e', text: '#f5f4ef', muted: '#a8a69e', grid: '#3d3d3a', accent: '#d97757', info: '#7fb0de', ok: '#94ab72', warn: '#e0b33a', bad: '#d9746c', line: '#6b6a64', fill: '#3a3a37', onTone: '#141413' },
}
type Paint = keyof typeof PALETTE.light

// Fills by class, so 'auto' can switch with the viewer's colour scheme.
function styleFor(scheme: Scheme): string {
  const rules = (p: typeof PALETTE.light) =>
    (Object.keys(p) as Paint[]).map(k => `.f-${k}{fill:${p[k]}}.s-${k}{stroke:${p[k]}}`).join('')
  if (scheme === 'light') return `<style>${rules(PALETTE.light)}</style>`
  if (scheme === 'dark') return `<style>${rules(PALETTE.dark)}</style>`
  return `<style>${rules(PALETTE.light)}@media (prefers-color-scheme: dark){${rules(PALETTE.dark)}}</style>`
}

const FONT = `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, 'Noto Sans Hebrew', 'Noto Sans Arabic', sans-serif"`
const clampWidth = (w: number | undefined) => Math.max(280, Math.min(720, Math.round(w ?? 520)))
// A rough text width, enough to size chips and cut labels: Hebrew and Arabic letters are narrower
// than Latin capitals, digits in between.
export const textWidth = (s: string, size: number) => Array.from(s).reduce((sum, c) => sum + (c === ' ' ? 0.3 : /[A-Z]/.test(c) ? 0.66 : 0.56) * size, 0)
const toneFill = (t: Tone | undefined): Paint =>
  t === 'ok' ? 'ok' : t === 'warn' ? 'warn' : t === 'bad' ? 'bad' : t === 'info' ? 'info' : t === 'muted' || t === 'line' ? 'line' : 'accent'

function fitText(s: string, size: number, max: number): string {
  if (textWidth(s, size) <= max) return s
  const chars = Array.from(s)
  while (chars.length > 1 && textWidth(`${chars.join('')}…`, size) > max) chars.pop()
  return `${chars.join('')}…`
}

export type SvgChip = { label: string; tone?: Tone }

export function svgHeader(o: { title: string; subtitle?: string; chips?: SvgChip[]; scheme?: Scheme; width?: number }): { source: string; width: number; height: number } {
  const width = clampWidth(o.width)
  const chips = o.chips ?? []
  const height = chips.length ? 118 : 78
  const right = width - 22
  let x = right
  const chipSvg = chips.map(c => {
    const w = Math.ceil(textWidth(c.label, 12)) + 22
    const left = x - w
    const out = `<rect class="f-${toneFill(c.tone)}" x="${left}" y="80" width="${w}" height="24" rx="12"/><text class="f-onTone" x="${x - 11}" y="96" direction="rtl" font-size="12" font-weight="600">${escapeXml(c.label)}</text>`
    x = left - 8
    return left > 10 ? out : ''
  }).join('')
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ${FONT}>${styleFor(o.scheme ?? 'auto')}
<rect class="f-bg" width="${width}" height="${height}" rx="14"/>
<rect class="f-accent" x="${width - 6}" y="16" width="4" height="${o.subtitle ? 44 : 26}" rx="2"/>
<text class="f-text" x="${right}" y="38" direction="rtl" font-size="20" font-weight="700">${escapeXml(fitText(o.title, 20, width - 44))}</text>
${o.subtitle ? `<text class="f-muted" x="${right}" y="62" direction="rtl" font-size="13">${escapeXml(fitText(o.subtitle, 13, width - 44))}</text>` : ''}
${chipSvg}</svg>`
  return { source, width, height }
}

export type Lane = { id: string; label: string }
export type Block = { lane: string; start: string; end: string; label?: string; tone?: Tone }

const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

// Lanes (rooms, people) against the hours of one day, read right to left: the first hour at the
// right edge. Blocks outside the hours are clipped.
export function svgTimeline(o: { lanes: Lane[]; blocks: Block[]; from?: number; to?: number; now?: string; scheme?: Scheme; width?: number }): { source: string; width: number; height: number } {
  const width = clampWidth(o.width)
  const from = o.from ?? 8
  const to = Math.max(from + 1, o.to ?? 21)
  const labelW = 86
  const top = 28
  const laneH = 26
  const height = top + o.lanes.length * laneH + 12
  const plotRight = width - labelW - 10
  const plotLeft = 14
  const span = (to - from) * 60
  const xAt = (m: number) => plotRight - ((Math.min(Math.max(m, from * 60), to * 60) - from * 60) / span) * (plotRight - plotLeft)
  const ticks: string[] = []
  const step = to - from > 8 ? 2 : 1
  for (let hr = from; hr <= to; hr += step) {
    const x = xAt(hr * 60)
    ticks.push(`<line class="s-grid" x1="${x}" y1="${top - 6}" x2="${x}" y2="${height - 10}" stroke-width="1"/><text class="f-muted" x="${x}" y="16" text-anchor="middle" font-size="10">${hr}</text>`)
  }
  const lanes = o.lanes.map((l, i) => {
    const y = top + i * laneH
    return `<rect class="f-panel" x="${plotLeft}" y="${y + 3}" width="${plotRight - plotLeft}" height="${laneH - 6}" rx="6"/><text class="f-text" x="${width - 12}" y="${y + laneH / 2 + 4}" direction="rtl" font-size="12" font-weight="600">${escapeXml(fitText(l.label, 12, labelW - 6))}</text>`
  }).join('')
  const blocks = o.blocks.map(b => {
    const i = o.lanes.findIndex(l => l.id === b.lane)
    if (i < 0) return ''
    const y = top + i * laneH
    const x1 = xAt(minutes(b.end))
    const x2 = xAt(minutes(b.start))
    const w = x2 - x1
    if (w <= 1) return ''
    const label = b.label ? fitText(b.label, 11, w - 10) : ''
    return `<rect class="f-${toneFill(b.tone)}" x="${x1 + 1}" y="${y + 4}" width="${w - 2}" height="${laneH - 8}" rx="5"/>${label && w > 26 ? `<text class="f-onTone" x="${x2 - 6}" y="${y + laneH / 2 + 4}" direction="rtl" font-size="11" font-weight="600">${escapeXml(label)}</text>` : ''}`
  }).join('')
  const now = o.now ? (() => {
    const m = minutes(o.now)
    if (m < from * 60 || m > to * 60) return ''
    const x = xAt(m)
    return `<line class="s-bad" x1="${x}" y1="${top - 4}" x2="${x}" y2="${height - 10}" stroke-width="2"/>`
  })() : ''
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ${FONT}>${styleFor(o.scheme ?? 'auto')}
<rect class="f-bg" width="${width}" height="${height}" rx="14"/>${ticks.join('')}${lanes}${blocks}${now}</svg>`
  return { source, width, height }
}

// Claude Code's `theme` setting, from `(await $.config.list()).find(r => r.key === 'theme')?.value`.
// It is the terminal's theme: the desktop app can be light while it says dark (seen 05/10), so on
// the desktop leave the scheme 'auto' and let the system's colour scheme decide.
export function schemeOf(theme: unknown): Scheme {
  const t = typeof theme === 'string' ? theme : ''
  return t.includes('dark') ? 'dark' : t.includes('light') ? 'light' : 'auto'
}

// ---------- the builders ----------

// The element constructors are the engine's; the kit only passes props through.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Els = Record<string, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any
type Press = () => unknown

export type KitOptions = BidiOptions & {
  // How many characters fit in one of the pane's columns, for wrapping long text yourself
  // (measured with the /rtl-gallery ruler; proportional fonts make this an estimate).
  charsPerColumn?: number
}

export type Kit = ReturnType<typeof kit>

export function kit(el: Els, e: { surface: Surface; props?: { bodyColumns?: number } }, opts: KitOptions = {}) {
  const { Box, Text, Button } = el
  const surface = e.surface
  const isTerminal = surface === 'terminal'
  const cols = e.props?.bodyColumns ?? 80
  const width = Math.max(16, Math.floor(cols * (opts.charsPerColumn ?? (isTerminal ? 1 : 0.9))))
  const b = (s: string) => bidi(s, surface, opts)
  // The press hands back what the handler returns, so the engine (and a test's press) can wait for
  // it; dropping the promise lets work run on after the press and its errors go unhandled.
  const run = (f: Press) => () => f()

  const text = (s: string, props: Record<string, unknown> = {}) => <Text {...props}>{b(s)}</Text>

  const para = (key: string, s: string, props: Record<string, unknown> = {}, w = width) => (
    <Box key={key} flexDirection="column" alignItems="flex-end">
      {wrap(s, w).map((l, i) => <Text key={`${key}:${i}`} {...props}>{b(l || ' ')}</Text>)}
    </Box>
  )

  const heading = (key: string, s: string, level = 1) => (
    <Box key={key} flexDirection="column" alignItems="flex-end" marginTop={level > 1 ? 1 : 0}>
      <Text bold color={level === 1 ? tone.accent : undefined}>{b(s)}</Text>
    </Box>
  )

  const muted = (key: string, s: string) => para(key, s, { color: tone.muted })

  const row = (key: string, children: Node[], props: Record<string, unknown> = {}) => (
    <Box key={key} flexDirection="row-reverse" flexWrap="wrap" gap={1} alignItems="center" {...props}>{children}</Box>
  )

  const col = (key: string, children: Node[], props: Record<string, unknown> = {}) => (
    <Box key={key} flexDirection="column" alignItems="flex-end" {...props}>{children}</Box>
  )

  const action = (key: string, label: string, onPress: Press, props: Record<string, unknown> = {}) =>
    <Button key={key} label={b(label)} variant="secondary" onPress={run(onPress)} {...props} />
  const primary = (key: string, label: string, onPress: Press, props: Record<string, unknown> = {}) =>
    <Button key={key} label={b(label)} variant="primary" onPress={run(onPress)} {...props} />
  const quiet = (key: string, label: string, onPress: Press, props: Record<string, unknown> = {}) =>
    <Button key={key} label={b(label)} dimColor onPress={run(onPress)} {...props} />

  // A list row you press: the label as a plain button, a muted line under it.
  // The button carries `key`, so the caller presses the key it passed.
  const item = (key: string, label: string, onPress: Press, meta?: string) => (
    <Box key={`${key}:item`} flexDirection="column" alignItems="flex-end">
      <Button key={key} label={b(label)} plain onPress={run(onPress)} />
      {meta ? para(`${key}:meta`, meta, { color: tone.muted }) : null}
    </Box>
  )

  const chip = (key: string, label: string, t: Tone = 'accent') => (isTerminal
    ? <Text key={key} color={tone[t]}>{b(`[${label}]`)}</Text>
    : <Text key={key} color={tone[t]} backgroundColor={tone.fill} bold>{b(` ${label} `)}</Text>)

  const chips = (key: string, items: SvgChip[]) => row(key, items.map((c, i) => chip(`${key}:${i}`, c.label, c.tone)))

  const stat = (key: string, value: string | number, label: string, t: Tone = 'accent') => (isTerminal
    ? <Text key={key}>{b(`${label}: ${value}`)}</Text>
    : (
      <Box key={key} flexDirection="column" alignItems="flex-end" paddingX={1}>
        <Text bold color={tone[t]}>{String(value)}</Text>
        <Text color={tone.muted}>{b(label)}</Text>
      </Box>
    ))

  const card = (key: string, o: { title?: string; meta?: string; tone?: Tone; actions?: Node[] }, children: Node[] = []) => (
    <Box key={key} flexDirection="column" alignItems="flex-end" borderStyle="round"
      borderColor={o.tone ? tone[o.tone] : tone.line} hover={{ borderColor: tone.accent }} paddingX={1} marginBottom={1}>
      {o.title ? <Text bold>{b(o.title)}</Text> : null}
      {o.meta ? para(`${key}:meta`, o.meta, { color: tone.muted }, width - 4) : null}
      {children}
      {o.actions && o.actions.length ? row(`${key}:actions`, o.actions, { marginTop: 1 }) : null}
    </Box>
  )

  const tabs = (key: string, items: { id: string; label: string }[], current: string, onPick: (id: string) => unknown) =>
    row(key, items.map(t => (t.id === current
      ? <Button key={`${key}:${t.id}`} label={b(t.label)} variant="primary" onPress={run(() => onPick(t.id))} />
      : <Button key={`${key}:${t.id}`} label={b(t.label)} plain onPress={run(() => onPick(t.id))} />)), { marginBottom: 1 })

  // Items with the marker on the right; depth indents from the right.
  const list = (key: string, items: (string | { text: string; depth?: number })[], o: { ordered?: boolean } = {}) => (
    <Box key={key} flexDirection="column" alignItems="flex-end">
      {items.map((x, i) => {
        const it = typeof x === 'string' ? { text: x, depth: 0 } : { text: x.text, depth: x.depth ?? 0 }
        const marker = o.ordered ? `${i + 1}.` : '•'
        return listRow(`${key}:${i}`, marker, it.text, it.depth)
      })}
    </Box>
  )

  const listRow = (key: string, marker: string, s: string, depth: number) => {
    const w = Math.max(12, width - 3 - depth * 2)
    const lines = wrap(s, w)
    return (
      <Box key={key} flexDirection="row-reverse" gap={1} paddingRight={depth * 2}>
        <Text color={tone.muted}>{marker}</Text>
        <Box flexDirection="column" alignItems="flex-end">
          {lines.map((l, i) => <Text key={`${key}:${i}`}>{b(l || ' ')}</Text>)}
        </Box>
      </Box>
    )
  }

  // Columns right to left; each cell wraps inside its share of the width.
  const table = (key: string, headers: string[], rows: string[][], o: { widths?: number[] } = {}) => {
    const n = Math.max(headers.length, ...rows.map(r => r.length), 1)
    const widths = o.widths && o.widths.length === n ? o.widths : Array.from({ length: n }, () => 100 / n)
    const cell = (rk: string, c: string, i: number, props: Record<string, unknown>) => (
      <Box key={`${rk}:${i}`} width={`${Math.round(widths[i] ?? 0)}%`} flexDirection="column" alignItems="flex-end" paddingX={1}>
        {wrap(c, Math.max(6, Math.floor(((width - 2) * (widths[i] ?? 0)) / 100) - 2)).map((l, j) => <Text key={`${rk}:${i}:${j}`} {...props}>{b(l || ' ')}</Text>)}
      </Box>
    )
    return (
      <Box key={key} flexDirection="column" width="100%" borderStyle="round" borderColor={tone.line} marginBottom={1}>
        <Box key={`${key}:head`} flexDirection="row-reverse">
          {Array.from({ length: n }, (_, i) => cell(`${key}:head`, headers[i] ?? '', i, { bold: true, color: tone.muted }))}
        </Box>
        {rows.map((r, ri) => (
          <Box key={`${key}:r${ri}`} flexDirection="row-reverse">
            {Array.from({ length: n }, (_, i) => cell(`${key}:r${ri}`, r[i] ?? '', i, {}))}
          </Box>
        ))}
      </Box>
    )
  }

  // Markdown drawn with the builders above, because the Markdown element cannot do right to left.
  const md = (key: string, src: string) => (
    <Box key={key} flexDirection="column" alignItems="flex-end">
      {parseMd(src).map((blk, i) => {
        const k = `${key}:${i}`
        switch (blk.kind) {
          case 'heading':
            return heading(k, blk.text, blk.level)
          case 'para':
            return <Box key={k} marginBottom={1}>{para(`${k}:p`, blk.text)}</Box>
          case 'item':
            return listRow(k, blk.marker, blk.text, blk.depth)
          case 'quote':
            return card(k, { tone: 'line' }, [para(`${k}:q`, blk.text, {}, width - 4)])
          case 'table':
            return table(k, blk.headers, blk.rows)
          case 'code':
            return <Box key={k} marginBottom={1} borderStyle="round" borderColor={tone.line} paddingX={1}><Text>{blk.text}</Text></Box>
          case 'rule':
            return <Text key={k} color={tone.line}>{'─'.repeat(Math.min(40, width))}</Text>
        }
      })}
    </Box>
  )

  // An SVG piece, or nothing on a surface without Svg.
  const svg = (key: string, piece: { source: string; width: number; height: number }, alt: string) =>
    (!isTerminal && 'Svg' in el ? <el.Svg key={key} source={piece.source} alt={alt} width={piece.width} height={piece.height} /> : null)

  // Pixels for an SVG that spans the pane: an estimate from the columns.
  const svgWidth = Math.max(280, Math.min(720, Math.round(cols * 7.2)))

  return {
    surface, isTerminal, cols, width, svgWidth, bidi: b,
    text, para, heading, muted, row, col, action, primary, quiet, item, chip, chips, stat, card, tabs, list, table, md, svg,
  }
}
