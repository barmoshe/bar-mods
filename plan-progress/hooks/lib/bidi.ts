// Right-to-left text per surface. The ordering is rtl-kit's (bar-mods/rtl-kit 0.1.3, hooks/rtl.tsx),
// cut down to what plan-progress draws: titles that may hold Hebrew.
//
// - desktop: a line laid out left to right reads a Hebrew-first line wrong, so such a line is
//   wrapped in RLE…PDF; a Latin-first line with a Hebrew word in it is left alone and reads right.
// - terminal, macOS: characters are printed in stored order, so Hebrew is handed over in visual
//   order. Where Claude Code reorders itself (VS Code's terminal, Windows Terminal) it is left in
//   logical order, or it would be reversed twice.
// - svg: the frame does bidi; a Hebrew-first line gets direction="rtl".

const RTL_CHAR = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/
const LATIN_CHAR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/
const DIGIT = /[0-9٠-٩۰-۹]/
const MARKS = /[‎‏‪-‮⁦-⁩]/g
const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«' }

export const hasRtl = (s: string) => RTL_CHAR.test(s)

// True when the first letter is right-to-left.
export function isRtlFirst(s: string): boolean {
  const first = Array.from(s).find(c => RTL_CHAR.test(c) || LATIN_CHAR.test(c))
  return first !== undefined && RTL_CHAR.test(first)
}

type Dir = 'R' | 'L' | 'N'
const strong = (ch: string): Dir => (RTL_CHAR.test(ch) ? 'R' : LATIN_CHAR.test(ch) || DIGIT.test(ch) ? 'L' : 'N')

// One line in the order a terminal that does no bidi must print it.
export function visual(line: string): string {
  const chars = Array.from(line.replace(MARKS, ''))
  if (!chars.some(c => RTL_CHAR.test(c))) return chars.join('')
  const dirs = chars.map(strong)
  const base: Dir = isRtlFirst(line) ? 'R' : 'L'
  const resolved = dirs.map((d, i) => {
    if (d !== 'N') return d
    let p = i - 1
    while (p >= 0 && dirs[p] === 'N') p--
    let q = i + 1
    while (q < dirs.length && dirs[q] === 'N') q++
    const before = p >= 0 ? dirs[p] : null
    const after = q < dirs.length ? dirs[q] : null
    if (before === after && before !== null) return before
    return base
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

export type Where = 'desktop' | 'terminal' | 'terminal-logical'

export function bidi(s: string, where: Where): string {
  if (!hasRtl(s)) return s
  if (where === 'terminal') return s.split('\n').map(visual).join('\n')
  if (where === 'terminal-logical') return s
  return isRtlFirst(s) ? `‫${s.replace(MARKS, '')}‬` : s
}
