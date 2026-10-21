// The pictures, drawn as SVG for the desktop: the brief's masthead (where the build is, and the
// strip under it), the band's strip, and the pace. Pure: a plan and a width in, markup out.
//
// The strip tells the Bar Builds mark's story, from idea to product: a step not started is a
// drawing (a blue outline), a step under way is halftone, a step done is solid ink. Orange marks
// one thing, the item being worked on now. A gate is a diamond where it falls: an outline while
// it is ahead, filled blue once it is due and waits on you.

import type { Item, Plan } from '../../types'
import { isRtlFirst } from './bidi'
import { DISPLAY, FONT_FACES, MONO } from './fonts'
import { COUNT_RULE, count, fillOf, findNow, gateTiers, label, STATE_WORDS, waiting } from './grammar'

// Light and dark inks; the SVG picks by the frame's colour scheme.
const LIGHT = { ink: '#1E1D1B', ink2: '#5E5B55', blue: '#1F5FAE', orange: '#F2621B' }
const DARK = { ink: '#ECE8DD', ink2: '#B3B0A8', blue: '#6FAEF2', orange: '#F2621B' }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n = (v: number) => (Math.round(v * 10) / 10).toString()
export const noteText = (s: string) => s.replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')

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
      const k = Math.max(0, Math.min(1, (f + 0.24 - t) / 0.48))
      const r = step * 0.58 * Math.sqrt(k)
      if (r > 0.3) dots += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${r.toFixed(2)}"/>`
    }
  }
  return `<clipPath id="${id}"><rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"/></clipPath><g clip-path="url(#${id})" class="i">${dots}</g>`
}

const diamond = (cx: number, cy: number, r: number, cls: string) =>
  `<polygon points="${n(cx)},${n(cy - r)} ${n(cx + r)},${n(cy)} ${n(cx)},${n(cy + r)} ${n(cx - r)},${n(cy)}" class="${cls}"/>`

function tip(it: Item, isDue?: boolean): string {
  const kids = it.children.filter(k => k.state !== '-')
  const share = kids.length ? `${kids.filter(k => k.state === 'x').length} of ${kids.length} sub-steps done` : ''
  const word = it.isGate ? (it.state === 'x' ? 'done' : isDue ? 'due: waits on you' : 'ahead') : STATE_WORDS[it.state]
  const parts = [it.isGate ? `Gate · ${it.title}` : label(it), word, share, ...it.notes.map(noteText)]
  return `<title>${esc(parts.filter(Boolean).join(' · '))}</title>`
}

type Seg = { it: Item; x: number; w: number; cx: number; isGate: boolean }
type Strip = { svg: string; segs: Seg[]; front: number | null }

// The strip: one segment per step, a diamond per gate where it falls.
function strip(plan: Plan, y: number, W: number, h: number, o: { gap: number; gw: number; step: number; tips: boolean; settle?: string }): Strip {
  const gates = gateTiers(plan)
  const work = plan.items.filter(i => !i.isGate)
  const lead = gates.length ? 5 : 0
  // every segment is followed by a gap; the last one's becomes the lead-in to the gates
  const gaps = gates.length ? work.length * o.gap : Math.max(0, work.length - 1) * o.gap
  const sw = Math.max(2, (W - gates.length * o.gw - gaps - lead) / Math.max(1, work.length))
  const now = findNow(plan)
  let x = 0
  let svg = ''
  let front: number | null = null
  const segs: Seg[] = []
  let prevWasWork = false
  for (const it of plan.items) {
    if (it.isGate) {
      const g = gates.find(z => z.item === it)
      const cx = x + (prevWasWork ? lead : 0) + o.gw / 2
      x = cx + o.gw / 2
      prevWasWork = false
      const cls = it.state === 'x' ? 'i' : it.state === '-' ? 'n si2' : g?.isDue ? 'b' : 'n sb'
      svg += `<g>${o.tips ? tip(it, g?.isDue) : ''}${diamond(cx, y + h / 2, Math.min(h / 2, o.gw / 2) - 1, cls)}</g>`
      segs.push({ it, x: cx - o.gw / 2, w: o.gw, cx, isGate: true })
      continue
    }
    prevWasWork = true
    let g = ''
    const f = fillOf(it)
    const rect = (cls: string, extra = '') => `<rect x="${n(x + 0.5)}" y="${n(y + 0.5)}" width="${n(sw - 1)}" height="${n(h - 1)}" class="${cls}"${extra}/>`
    if (f === 1) {
      g = `<rect x="${n(x)}" y="${n(y)}" width="${n(sw)}" height="${n(h)}" class="${o.settle === it.line.toString() ? 'i settle' : 'i'}"/>`
    } else if (now && it === now.step) {
      const ff = Math.max(f, 0.15)
      g = halftone(x, y, sw, h, ff, o.step) + rect('n si', ' stroke-width="1"')
      front = x + sw * ff
    } else if (it.state === '~') {
      g = halftone(x, y, sw, h, Math.max(f, 0.12), o.step) + rect('n si', ' stroke-width="1"')
    } else if (it.state === '-') {
      g = rect('n si2', ' stroke-dasharray="2 2" opacity=".5"')
    } else if (it.state === '!') {
      g = rect('n si2') + `<path d="M${n(x)} ${n(y + h)} L${n(x + sw)} ${n(y)}" class="si2"/>`
    } else if (it.state === '?') {
      g = rect('b sb')
    } else {
      g = (f > 0 ? halftone(x, y, sw, h, f, o.step) : '') + rect('n sb', ' stroke-width="1"')
    }
    svg += `<g>${o.tips ? tip(it) : ''}${g}</g>`
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

export type BriefOptions = {
  // nominal width in CSS pixels; the surface scales the drawing to its slot
  width: number
  // the line of a step that has just turned done, to settle it in
  settleLine?: number
  // the whole plan has just turned done
  isWipe?: boolean
  motion?: boolean
}

// The brief's masthead: the plan's name, where the build is ("Step 6 of 15"), and the strip.
export function briefSvg(plan: Plan, o: BriefOptions): string {
  clipSeq = 0
  const W = Math.round(o.width)
  const c = count(plan)
  const now = findNow(plan)
  const motion = o.motion !== false
  let s = style(motion)
  const kicker = wrapLines((plan.title || 'Plan').toUpperCase(), W - 50, 10, 2, 0.62)
  kicker.forEach((line, i) => {
    s += text(0, 11 + i * 13, line, 'm i2', 10, 'start', ' letter-spacing=".8"')
  })
  const hy = 11 + (kicker.length - 1) * 13 + 34
  // how many are done leads: steps finish out of order, so a position ("step 9") can mislead
  const head = now
    ? `<text x="0" y="${hy}" class="d i" font-size="31" letter-spacing="-1">${c.done}<tspan class="i2" font-size="20" dx="6" letter-spacing="-.4">of ${c.total} done</tspan></text>`
    : `<text x="0" y="${hy}" class="d i" font-size="31" letter-spacing="-1">Done<tspan class="i2" font-size="20" dx="6">${c.total} of ${c.total}</tspan></text>`
  s += head
  s += `<g><title>${esc(COUNT_RULE)}</title><text x="${W}" y="${hy}" text-anchor="end" class="m i2" font-size="12">${c.pct}%</text></g>`
  const Y = hy + 12
  const H = 14
  const b = strip(plan, Y, W, H, { gap: 2, gw: 14, step: 2.6, tips: true, settle: o.settleLine?.toString() })
  s += `<g${o.isWipe && motion ? ' class="wipe"' : ''}>${b.svg}</g>`
  // ids under the segments, shrunk to fit, left out under 6.5px
  for (const g of b.segs) {
    if (g.isGate || !g.it.id) continue
    const size = Math.min(9, (g.w - 1) / (g.it.id.length * 0.62))
    if (size < 6.5) continue
    const isLit = fillOf(g.it) === 1 || g.it.state === '~' || (now && g.it === now.step)
    const bold = now && g.it === now.step ? ' font-weight="700"' : ''
    s += `<text x="${n(g.cx)}" y="${Y + H + 11}" text-anchor="middle" class="m ${isLit ? 'i' : g.it.state === '-' ? 'i2' : 'b'}" font-size="${n(size)}"${bold}>${esc(g.it.id)}</text>`
  }
  if (now && b.front !== null) {
    s += `<g class="${motion ? 'pulse' : ''}"><path d="M${n(b.front)} ${Y - 5}V${Y + H + 3}" class="so" stroke-width="2"/></g>`
  } else if (c.pct === 100) {
    const last = b.segs.filter(g => !g.isGate).pop()
    if (last) s += `<path d="M${n(last.x + last.w)} ${Y - 5}V${Y + H + 3}" class="so" stroke-width="2"/>`
  }
  const HEIGHT = Y + H + 15
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${HEIGHT}" viewBox="0 0 ${W} ${HEIGHT}">${s}</svg>`
}

// The band's slim strip: no text, no motion.
export function bandSvg(plan: Plan, width = 120, height = 12): string {
  clipSeq = 0
  const b = strip(plan, 1, width, height - 2, { gap: 1.5, gw: 8, step: 2, tips: false })
  let s = style(false, false) + b.svg
  if (b.front !== null) s += `<path d="M${n(b.front)} 0V${height}" class="so" stroke-width="1.6"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${s}</svg>`
}

// The pace: one ink bar per measured step, as tall as its minutes; the step now as an orange outline.
export function paceSvg(minutes: { id: string; min: number }[], nowId: string | null): string {
  const bars = minutes.slice(-8)
  const max = Math.max(...bars.map(b => b.min), 1)
  const bw = 12
  const gap = 4
  let s = style(false, false)
  bars.forEach((b, i) => {
    const h = 3 + (20 * b.min) / max
    s += `<g><title>${esc(`Step ${b.id}: ${b.min} min`)}</title><rect x="${i * (bw + gap)}" y="${n(23 - h)}" width="${bw}" height="${n(h)}" class="i"/></g>`
  })
  let w = bars.length * (bw + gap)
  if (nowId) {
    s += `<g><title>${esc(`Step ${nowId}: under way`)}</title><rect x="${w + 0.5}" y="7.5" width="${bw - 1}" height="15" class="n so" stroke-dasharray="2 2"/></g>`
    w += bw
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="24" viewBox="0 0 ${w} 24">${s}</svg>`
}

// What the pictures say, for a reader that cannot see them.
export function altOf(plan: Plan): string {
  const c = count(plan)
  const now = findNow(plan)
  const w = waiting(plan).length
  return `${plan.title || 'Plan'}: ${c.done} of ${c.total} done (${c.pct}%)${now ? `, now ${label(now.item)}` : ', every step done'}${w ? `, ${w} waiting on you` : ''}.`
}
