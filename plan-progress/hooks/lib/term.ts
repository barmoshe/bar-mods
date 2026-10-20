// The press line in characters, for the terminal (no SVG there): blocks for ink, braille dots for
// halftone, open brackets of line for blueprint, diamonds for gates. Pure: runs of text with a
// tone each, which the hooks module turns into Text elements.

import type { Plan } from '../../types'
import { fillOf, findNow, gateTiers } from './grammar'

export type Tone = 'ink' | 'dim' | 'blue' | 'now'
export type Run = { text: string; tone: Tone }

// From full dots to none: the halftone, one character per cell.
const DOTS = ['⣿', '⣷', '⣶', '⣤', '⣀', ' ']

function push(runs: Run[], text: string, tone: Tone) {
  const last = runs[runs.length - 1]
  if (last && last.tone === tone) last.text += text
  else runs.push({ text, tone })
}

// `cells`: how wide the bar may be. Each step gets the same whole number of cells (1 to 3).
export function barRuns(plan: Plan, cells: number): Run[] {
  const work = plan.items.filter(i => !i.isGate)
  const gates = plan.items.filter(i => i.isGate)
  const room = cells - (gates.length ? gates.length + 1 : 0) - 1
  const per = Math.max(1, Math.min(3, Math.floor(room / Math.max(1, work.length))))
  const now = findNow(plan)
  const dueGates = new Set(gateTiers(plan).filter(g => g.isDue).map(g => g.item))
  const runs: Run[] = []
  let isAfterWork = false
  for (const it of plan.items) {
    if (it.isGate) {
      if (isAfterWork) push(runs, ' ', 'dim')
      isAfterWork = false
      // filled once due (it waits on you), an outline while ahead
      const isDue = dueGates.has(it)
      push(runs, it.state === 'x' || isDue ? '◆' : it.state === '-' ? '·' : '◇', it.state === 'x' ? 'ink' : it.state === '-' ? 'dim' : 'blue')
      continue
    }
    isAfterWork = true
    const f = fillOf(it)
    if (f === 1) {
      push(runs, '█'.repeat(per), 'ink')
    } else if (now && it === now.step) {
      const ff = Math.max(f, 0.12)
      let dots = ''
      for (let i = 0; i < per; i++) {
        const t = (i + 0.5) / per
        const k = Math.max(0, Math.min(1, (ff + 0.24 - t) / 0.48))
        dots += DOTS[Math.min(DOTS.length - 1, Math.round((1 - k) * (DOTS.length - 2)))] ?? '⣀'
      }
      push(runs, dots, 'ink')
      push(runs, '▏', 'now')
    } else if (it.state === '-') {
      push(runs, '·'.repeat(per), 'dim')
    } else if (it.state === '!') {
      push(runs, '╳'.repeat(per), 'dim')
    } else if (it.state === '?') {
      push(runs, '█'.repeat(per), 'blue')
    } else {
      push(runs, per === 1 ? '▫' : `╶${'─'.repeat(per - 2)}╴`, 'blue')
    }
  }
  return runs
}

export const runsText = (runs: Run[]) => runs.map(r => r.text).join('')
