// The press line, drawn as SVG for the desktop: ink behind, halftone at the front, blueprint
// ahead, the gates as diamonds at the end. Pure: a plan and a width in, markup out.
//
// The story is the Bar Builds mark's, from idea to product: a step not started is a drawing
// (a blue outline), a step under way is halftone, a step done is solid ink. Orange marks one
// thing, the item being worked on now. Blue fill means it waits on you.

import type { Item, Plan } from '../../types'
import { isRtlFirst } from './bidi'
import { DISPLAY, FONT_FACES, MONO } from './fonts'
import { COUNT_RULE, count, fillOf, findNow, label, STATE_WORDS, waiting } from './grammar'

// Light and dark inks; the SVG picks by the frame's colour scheme.
const LIGHT = { ink: '#1E1D1B', ink2: '#5E5B55', blue: '#1F5FAE', orange: '#F2621B' }
const DARK = { ink: '#ECE8DD', ink2: '#B3B0A8', blue: '#6FAEF2', orange: '#F2621B' }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const n = (v: number) => (Math.round(v * 10) / 10).toString()
export const noteText = (s: string) => s.replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')

// Rough advance widths, enough to fit a title or centre a label.
// Words into at most `max` lines of `px`; the last line is cut with an ellipsis if the rest won't fit.
export function wrapLines(s: string, px: number, size: number, max: number, k = 0.55): string[] {
  const room = Math.max(1, Math.floor(px / (size * k)))
  const out: string[] = []
  let line = ''
  const words = s.split(/\s+/).filter(Boolean)
  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? ''
    const next = line ? `${line} ${w}` : w
    if (Array.from(next).length <= room || !line) {
      line = next
      continue
    }
    if (out.length === max - 1) {
      line = `${line} ${words.slice(i).join(' ')}`
      break
    }
    out.push(line)
    line = w
  }
  if (line) out.push(Array.from(line).length > room ? `${Array.from(line).slice(0, room - 1).join('')}…` : line)
  return out.slice(0, max)
}

const fitTo = (s: string, px: number, size: number, k = 0.55) => {
  const max = Math.max(1, Math.floor(px / (size * k)))
  const chars = Array.from(s)
  return chars.length > max ? `${chars.slice(0, Math.max(1, max - 1)).join('')}…` : s
}

function style(motion: boolean, fonts = true): string {
  const set = (p: typeof LIGHT) =>
    `.i{fill:${p.ink}}.i2{fill:${p.ink2}}.b{fill:${p.blue}}.o{fill:${p.orange}}` +
    `.si{stroke:${p.ink}}.si2{stroke:${p.ink2}}.sb{stroke:${p.blue}}.so{stroke:${p.orange}}`
  const anim = motion
    ? '.pulse{animation:pp-pulse 2.4s ease-in-out infinite}' +
      '@keyframes pp-pulse{0%,100%{opacity:1}50%{opacity:.45}}' +
      '.settle{animation:pp-settle 1.2s cubic-bezier(.3,0,.2,1) both;transform-box:fill-box;transform-origin:left}' +
      '@keyframes pp-settle{from{opacity:.25;transform:scaleX(.4)}to{opacity:1;transform:none}}' +
      '.wipe{animation:pp-wipe 1.4s cubic-bezier(.6,0,.2,1) both}' +
      '@keyframes pp-wipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}' +
      '@media (prefers-reduced-motion:reduce){.pulse,.settle,.wipe{animation:none}}'
    : ''
  return (
    `<style>${fonts ? FONT_FACES : ''}` +
    `.d{font-family:${DISPLAY};font-weight:850}.m{font-family:${MONO}}.n{fill:none}` +
    set(LIGHT) +
    `@media (prefers-color-scheme:dark){${set(DARK)}}${anim}</style>`
  )
}

// A staggered dot screen; dots grow toward the done side only.
let clipSeq = 0
function halftone(x: number, y: number, w: number, h: number, f: number, step = 3.4): string {
  const id = `pp${++clipSeq}`
  let dots = ''
  let row = 0
  for (let cy = y + step / 2; cy < y + h + step; cy += step * 0.866, row++) {
    for (let cx = x + (row % 2 ? step / 2 : 0); cx < x + w + step; cx += step) {
      const t = (cx - x) / w
      const k = clamp((f + 0.24 - t) / 0.48, 0, 1)
      const r = step * 0.58 * Math.sqrt(k)
      if (r > 0.3) dots += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${r.toFixed(2)}"/>`
    }
  }
  return `<clipPath id="${id}"><rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"/></clipPath><g clip-path="url(#${id})" class="i">${dots}</g>`
}

const diamond = (cx: number, cy: number, r: number, cls: string) =>
  `<polygon points="${n(cx)},${n(cy - r)} ${n(cx + r)},${n(cy)} ${n(cx)},${n(cy + r)} ${n(cx - r)},${n(cy)}" class="${cls}"/>`

function tip(it: Item): string {
  const kids = it.children.filter(k => k.state !== '-')
  const share = kids.length ? `${kids.filter(k => k.state === 'x').length} of ${kids.length} sub-steps done` : ''
  const parts = [it.isGate ? `Gate · ${it.title}` : label(it), STATE_WORDS[it.state], share, ...it.notes.map(noteText)]
  return `<title>${esc(parts.filter(Boolean).join(' · '))}</title>`
}

type Seg = { it: Item; x: number; w: number; cx: number; isGate: boolean }
type Bar = { svg: string; segs: Seg[]; front: number | null }

// The bar itself: one segment per step, a diamond per gate.
function bar(plan: Plan, x0: number, y: number, W: number, h: number, o: { gap: number; gw: number; step: number; tips: boolean; settle?: string }): Bar {
  const gates = plan.items.filter(i => i.isGate)
  const work = plan.items.filter(i => !i.isGate)
  const lead = gates.length ? 6 : 0
  // every segment is followed by a gap; the last one's becomes the lead-in to the gates
  const gaps = gates.length ? work.length * o.gap : Math.max(0, work.length - 1) * o.gap
  const sw = Math.max(2, (W - gates.length * o.gw - gaps - lead) / Math.max(1, work.length))
  const now = findNow(plan)
  let x = x0
  let svg = ''
  let front: number | null = null
  const segs: Seg[] = []
  let prevWasWork = false
  for (const it of plan.items) {
    const t = o.tips ? tip(it) : ''
    if (it.isGate) {
      const cx = x + (prevWasWork ? lead : 0) + o.gw / 2
      x = cx + o.gw / 2
      prevWasWork = false
      const cls = it.state === '?' ? 'b' : it.state === 'x' ? 'i' : it.state === '-' ? 'n si2' : 'n sb'
      svg += `<g>${t}${diamond(cx, y + h / 2, Math.min(h / 2, o.gw / 2) - 1, cls)}</g>`
      segs.push({ it, x: cx - o.gw / 2, w: o.gw, cx, isGate: true })
      continue
    }
    prevWasWork = true
    let g = ''
    const f = fillOf(it)
    const isFront = now !== null && it === now.step && it.state !== 'x' && f < 1
    if (f === 1) {
      const cls = o.settle === it.line.toString() ? 'i settle' : 'i'
      g = `<rect x="${n(x)}" y="${y}" width="${n(sw)}" height="${h}" class="${cls}"/>`
    } else if (isFront) {
      const ff = Math.max(f, 0.12)
      g = halftone(x, y, sw, h, ff, o.step) + `<rect x="${n(x + 0.5)}" y="${y + 0.5}" width="${n(sw - 1)}" height="${h - 1}" class="n si" stroke-width="1"/>`
      front = x + sw * ff
    } else if (it.state === '-') {
      g = `<rect x="${n(x + 0.5)}" y="${y + 0.5}" width="${n(sw - 1)}" height="${h - 1}" class="n si2" stroke-dasharray="2 2" opacity=".5"/>`
    } else if (it.state === '!') {
      g = `<rect x="${n(x + 0.5)}" y="${y + 0.5}" width="${n(sw - 1)}" height="${h - 1}" class="n si2"/><path d="M${n(x)} ${y + h} L${n(x + sw)} ${y}" class="si2"/>`
    } else if (it.state === '?') {
      g = `<rect x="${n(x + 0.5)}" y="${y + 0.5}" width="${n(sw - 1)}" height="${h - 1}" class="b sb"/>`
    } else if (it.state === '~') {
      // under way, but not the front of the work: halftone and an ink edge, no orange
      g = halftone(x, y, sw, h, Math.max(f, 0.12), o.step) + `<rect x="${n(x + 0.5)}" y="${y + 0.5}" width="${n(sw - 1)}" height="${h - 1}" class="n si" stroke-width="1"/>`
    } else {
      const partial = f > 0 ? halftone(x, y, sw, h, f, o.step) : ''
      g = partial + `<rect x="${n(x + 0.5)}" y="${y + 0.5}" width="${n(sw - 1)}" height="${h - 1}" class="n sb" stroke-width="1"/>`
    }
    svg += `<g>${t}${g}</g>`
    segs.push({ it, x, w: sw, cx: x + sw / 2, isGate: false })
    x += sw + o.gap
  }
  return { svg, segs, front }
}

// A line of text that reads right whichever script it opens with.
function text(x: number, y: number, s: string, cls: string, size: number, anchor: 'start' | 'middle' | 'end', extra = ''): string {
  const isRtl = isRtlFirst(s)
  const a = isRtl && anchor !== 'middle' ? (anchor === 'start' ? 'end' : 'start') : anchor
  return `<text x="${n(x)}" y="${n(y)}" class="${cls}" font-size="${size}" text-anchor="${a}"${isRtl ? ' direction="rtl"' : ''}${extra}>${esc(s)}</text>`
}

// A dimension line with its label in a gap: blueprint's way of saying how much is left.
function dimension(x1: number, x2: number, y: number, cls: 'si' | 'sb', label: string): string {
  if (x2 - x1 < 30) return ''
  const fill = cls === 'si' ? 'i' : 'b'
  const half = (label.length * 6.1) / 2 + 6
  const mid = (x1 + x2) / 2
  const room = x2 - x1 > half * 2 + 12
  const line = room
    ? `<path d="M${n(x1)} ${y}H${n(mid - half)}M${n(mid + half)} ${y}H${n(x2)}" class="${cls}"/>`
    : `<path d="M${n(x1)} ${y}H${n(x2)}" class="${cls}"/>`
  return (
    `<g>${line}<path d="M${n(x1)} ${y - 4}V${y + 4}M${n(x2)} ${y - 4}V${y + 4}" class="${cls}"/>` +
    (room ? `<text x="${n(mid)}" y="${y + 3.4}" text-anchor="middle" class="m ${fill}" font-size="9.5" letter-spacing=".6">${label}</text>` : '') +
    '</g>'
  )
}

export type PressOptions = {
  // nominal width in CSS pixels; the surface scales the drawing down to fit a narrower slot
  width: number
  fileName: string
  // the line of a step that has just turned done, to settle it in
  settleLine?: number
  // the whole plan has just turned done
  isWipe?: boolean
  motion?: boolean
}

// The pane's masthead: the file, the title, the percentage, and the press line.
export function pressSvg(plan: Plan, o: PressOptions): string {
  clipSeq = 0
  const W = Math.round(o.width)
  const c = count(plan)
  const now = findNow(plan)
  const motion = o.motion !== false
  const pctW = 44 * 0.62 * String(c.pct).length + 26
  // the title takes two lines beside the number before it is cut
  const lines = wrapLines(plan.title || 'Plan', W - pctW - 16, 19, 2)
  const extra = Math.max(0, lines.length - 1) * 22
  const Y = 80 + extra
  const H = 26
  const b = bar(plan, 0, Y, W, H, { gap: 3, gw: 15, step: 3.4, tips: true, settle: o.settleLine?.toString() })
  let s = style(motion)
  s += text(0, 11, o.fileName.toUpperCase(), 'm i2', 10, 'start', ' letter-spacing=".8"')
  lines.forEach((line, i) => {
    s += text(0, 37 + i * 22, line, 'd i', 19, 'start', ' letter-spacing="-.4"')
  })
  s += `<g><title>${esc(COUNT_RULE)}</title><text x="${W}" y="42" text-anchor="end" class="d i" font-size="44" letter-spacing="-1.5">${c.pct}<tspan font-size="22">%</tspan></text>`
  s += `<text x="${W}" y="57" text-anchor="end" class="m i2" font-size="9.5" letter-spacing=".8">${c.done} OF ${c.total} STEPS</text></g>`
  s += `<g${o.isWipe && motion ? ' class="wipe"' : ''}>${b.svg}</g>`

  // the ids under the segments, where they fit
  for (const g of b.segs) {
    if (g.isGate || !g.it.id) continue
    // a mono cell is 0.6 em: the id shrinks to its segment, and is left out under 6.5px
    const size = Math.min(9.5, (g.w - 1) / (g.it.id.length * 0.62))
    if (size < 6.5) continue
    const st = g.it.state
    const cls = fillOf(g.it) === 1 || st === '~' || (now && g.it === now.step) ? 'i' : st === '-' ? 'i2' : 'b'
    const bold = now && g.it === now.step ? ' font-weight="700"' : ''
    s += `<text x="${n(g.cx)}" y="${Y + H + 14}" text-anchor="middle" class="m ${cls}" font-size="${n(size)}"${bold}>${esc(g.it.id)}</text>`
  }

  // now: an orange mark at the halftone's front, and what it is
  if (now && b.front !== null) {
    const fx = b.front
    const nowLabel = `NOW · ${now.item.id || fitTo(now.item.title, 80, 9.5, 0.6)}`
    const lx = clamp(fx, nowLabel.length * 3.1 + 2, W - nowLabel.length * 3.1 - 2)
    s += `<g class="${motion ? 'pulse' : ''}"><path d="M${n(fx)} ${Y - 6}V${Y + H + 2}" class="so" stroke-width="2"/><polygon points="${n(fx - 5)},${Y - 12} ${n(fx + 5)},${Y - 12} ${n(fx)},${Y - 5}" class="o"/></g>`
    s += `<text x="${n(lx)}" y="${Y - 16}" text-anchor="middle" class="m i" font-size="9.5" letter-spacing=".6">${esc(nowLabel)}</text>`
  } else if (c.pct === 100) {
    // done: the print's orange, once, at the end of the line
    const work = b.segs.filter(g => !g.isGate)
    const last = work[work.length - 1]
    if (last) s += `<path d="M${n(last.x + last.w)} ${Y - 6}V${Y + H + 2}" class="so" stroke-width="2"/>`
  }

  // dimension lines: what is done, what is ahead, and the gates that are yours
  const work = b.segs.filter(g => !g.isGate)
  const last = work[work.length - 1]
  const DY = Y + H + 31
  if (last) {
    const firstOpen = work.find(g => fillOf(g.it) < 1)
    const edge = b.front ?? (firstOpen ? firstOpen.x : last.x + last.w)
    if (c.done) s += dimension(0, edge - 3, DY, 'si', `${c.done} DONE`)
    const ahead = work.filter(g => g.it.state === ' ' && fillOf(g.it) === 0 && g.it !== now?.step).length
    if (ahead) s += dimension(edge + 3, last.x + last.w, DY, 'sb', `${ahead} AHEAD`)
  }
  const gates = b.segs.filter(g => g.isGate && g.it.state === '?')
  const firstGate = gates[0]
  const lastGate = gates[gates.length - 1]
  if (firstGate && lastGate) s += `<text x="${n((firstGate.cx + lastGate.cx) / 2)}" y="${DY + 3.4}" text-anchor="middle" class="m b" font-size="9.5" letter-spacing=".6">YOU</text>`

  const HEIGHT = DY + 10
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${HEIGHT}" viewBox="0 0 ${W} ${HEIGHT}">${s}</svg>`
}

// The band's slim bar: no text, no motion, no hover.
export function bandSvg(plan: Plan, width = 120, height = 12): string {
  clipSeq = 0
  const b = bar(plan, 0, 1, width, height - 2, { gap: 1.5, gw: 8, step: 2, tips: false })
  let s = style(false, false) + b.svg
  if (b.front !== null) s += `<path d="M${n(b.front)} 0V${height}" class="so" stroke-width="1.6"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${s}</svg>`
}

// What the pictures say, for a reader that cannot see them.
export function altOf(plan: Plan): string {
  const c = count(plan)
  const now = findNow(plan)
  const w = waiting(plan).length
  return `${plan.title || 'Plan'}: ${c.pct}%, ${c.done} of ${c.total} steps done${now ? `, now ${label(now.item)}` : ''}${w ? `, ${w} waiting on you` : ''}.`
}
