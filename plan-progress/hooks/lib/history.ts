// What the plan's history says: commits that name steps, when items started and finished, when
// the plan lags the work, and the pace. Pure: no `$`, type-only imports.

import type { Commit, History, Item, Lag, Plan } from '../../types'
import { fillOf } from './grammar'

export const emptyHistory = (): History => ({ items: {}, commits: [], nudged: [], dismissed: [] })
const MAX_COMMITS = 300

// Every item, steps and sub-steps, in plan order.
const flat = (plan: Plan): Item[] => plan.items.flatMap(i => [i, ...i.children])
const keyOf = (it: Item) => it.id

// The ids a commit message names after "step" or "steps": "(3.1 step 3d)", "(3.1 steps 3b, 3c)",
// "(3.1 step 2a, 2b part)". Only ids the plan has count, so "3.1" or "part" never match.
export function stepRefs(message: string, plan: Plan): string[] {
  const ids = new Set(flat(plan).filter(i => i.id && !i.isGate).map(i => i.id))
  const found: string[] = []
  for (const m of message.matchAll(/\bsteps?\s+([^)\n]*)/gi)) {
    for (const token of (m[1] ?? '').split(/[\s,&/+]+|\band\b/)) {
      const t = token.trim().replace(/[.:;]+$/, '')
      if (t && ids.has(t) && !found.includes(t)) found.push(t)
    }
  }
  return found
}

export const isWipMessage = (message: string) => /^\s*wip\b|\bstarted\b|\bwip\(/i.test(message)

// The message of a `git commit` command line: -m/--message values, or a heredoc's body.
export function commitMessage(command: string): string {
  const parts: string[] = []
  for (const m of command.matchAll(/(?:-m|--message)\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))/g)) parts.push(m[1] ?? m[2] ?? m[3] ?? '')
  const doc = /<<-?\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\s*\1\b/.exec(command)
  if (doc?.[2]) parts.push(doc[2])
  return parts.join('\n')
}

// Records a commit; the items it names gain it, and started at its time if they had not.
export function addCommit(h: History, c: Commit): History {
  if (h.commits.some(x => x.sha === c.sha)) return h
  const items = { ...h.items }
  for (const id of c.items) {
    const was = items[id] ?? { commits: [] }
    items[id] = { ...was, startedAt: Math.min(was.startedAt ?? c.at, c.at), commits: [...was.commits, c.sha] }
  }
  return { ...h, items, commits: [...h.commits, c].slice(-MAX_COMMITS) }
}

// Records what changed between two reads of the file: first seen under way, first seen done.
export function addTransitions(h: History, before: Plan | null, after: Plan, now: number): History {
  const was = new Map((before ? flat(before) : []).map(i => [keyOf(i), i] as const))
  const items = { ...h.items }
  let changed = false
  for (const it of flat(after)) {
    if (!it.id || it.isGate) continue
    const old = was.get(it.id)
    const t = items[it.id] ?? { commits: [] }
    const isDone = fillOf(it) === 1
    const isUnderway = !isDone && (it.state === '~' || fillOf(it) > 0)
    const wasDone = old ? fillOf(old) === 1 : false
    let next = t
    // the first read of a file only learns the start of what is under way, never invents a finish
    if (isUnderway && t.startedAt === undefined && before) next = { ...next, startedAt: now }
    if (isDone && !wasDone && before && old) next = { ...next, doneAt: now, startedAt: next.startedAt ?? now }
    if (!isDone && t.doneAt !== undefined) {
      const { doneAt: _, ...rest } = next
      next = rest
    }
    if (next !== t) {
      items[it.id] = next
      changed = true
    }
  }
  return changed ? { ...h, items } : h
}

// Two copies of one file's history (two sessions) as one: commits by sha, the earliest start.
export function mergeHistory(a: History, b: History): History {
  let h: History = { ...a, nudged: [...new Set([...a.nudged, ...b.nudged])], dismissed: [...new Set([...a.dismissed, ...b.dismissed])] }
  for (const c of b.commits) h = addCommit(h, c)
  const items = { ...h.items }
  for (const [id, t] of Object.entries(b.items)) {
    const mine = items[id] ?? { commits: [] }
    const startedAt = [mine.startedAt, t.startedAt].filter((v): v is number => v !== undefined)
    const doneAt = mine.doneAt ?? t.doneAt
    items[id] = {
      commits: [...new Set([...mine.commits, ...t.commits])],
      ...(startedAt.length ? { startedAt: Math.min(...startedAt) } : {}),
      ...(doneAt !== undefined ? { doneAt } : {}),
    }
  }
  return { ...h, items }
}

const lagKey = (item: string, movedTo: string) => `${item}>${movedTo}`

// Items still open although a later commit names a later item: the work moved on. Inferred.
export function lags(plan: Plan, h: History): Lag[] {
  const order = flat(plan).filter(i => i.id && !i.isGate)
  const pos = new Map(order.map((it, i) => [it.id, i] as const))
  const parentOf = new Map(plan.items.flatMap(s => s.children.map(k => [k.id, s.id] as const)))
  // the item itself, its step or its own sub-steps; a later sibling counts as moving on
  const related = (a: string, b: string) => a === b || parentOf.get(a) === b || parentOf.get(b) === a
  const out: Lag[] = []
  for (const it of order) {
    // a step with sub-steps lags through its sub-steps, not itself
    if (it.children.length || it.state !== '~') continue
    const t = h.items[it.id]
    const mine = h.commits.filter(c => c.items.includes(it.id))
    const last = Math.max(t?.startedAt ?? 0, ...mine.map(c => c.at))
    if (!last) continue
    const later = h.commits.find(c => c.at > last && c.items.some(x => !related(x, it.id) && (pos.get(x) ?? -1) > (pos.get(it.id) ?? -1)))
    if (!later) continue
    const movedTo = later.items.find(x => !related(x, it.id) && (pos.get(x) ?? -1) > (pos.get(it.id) ?? -1)) ?? ''
    const key = lagKey(it.id, movedTo)
    if (h.dismissed.includes(key)) continue
    const lastCommit = mine[mine.length - 1]
    out.push({ item: it.id, title: it.title, movedTo, lastSha: lastCommit?.sha ?? '', since: later.at, isNudged: h.nudged.includes(key) })
  }
  return out
}

export const lagId = (l: Lag) => lagKey(l.item, l.movedTo)

export function nudgeText(l: Lag, path: string): string {
  return (
    `plan-progress: the plan (${path}) still has ${l.item} · ${l.title} in progress, but your commits have moved on to ${l.movedTo}. ` +
    `If ${l.item} is done, mark it with mcp__plan-progress__progress (action "set", item "${l.item}", state "done"${l.lastSha ? `, note "\`${l.lastSha}\`"` : ''}). If it is not, carry on.`
  )
}

export type Pace = {
  // minutes each measured step took, oldest first
  minutes: { id: string; min: number }[]
  // the range a step has taken, and what that range makes of the steps left, in hours
  perStep: [number, number]
  left: [number, number]
  stepsLeft: number
}

// Pace from steps whose start and finish were both seen; none before two are.
export function pace(plan: Plan, h: History): Pace | null {
  const steps = plan.items.filter(i => !i.isGate && i.state !== '-')
  const minutes = steps
    .map(s => ({ s, t: h.items[s.id] }))
    .filter(({ t }) => t?.startedAt !== undefined && t?.doneAt !== undefined && (t.doneAt ?? 0) > (t.startedAt ?? 0))
    .map(({ s, t }) => ({ id: s.id, min: Math.round(((t?.doneAt ?? 0) - (t?.startedAt ?? 0)) / 60000), at: t?.doneAt ?? 0 }))
    .sort((a, b) => a.at - b.at)
    .map(({ id, min }) => ({ id, min }))
  if (minutes.length < 2) return null
  const recent = minutes.slice(-4).map(m => m.min)
  const lo = Math.max(1, Math.min(...recent))
  const hi = Math.max(lo, Math.max(...recent))
  const stepsLeft = steps.filter(s => fillOf(s) < 1).length
  const round = (m: number) => Math.max(1, Math.round(m / 60))
  return { minutes, perStep: [lo, hi], left: [round(stepsLeft * lo), round(stepsLeft * hi)], stepsLeft }
}

// "19 min", "2 h", "3 days": how long ago, for a glance.
export function since(ms: number, now: number): string {
  const min = Math.max(0, Math.round((now - ms) / 60000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min`
  const hours = Math.round(min / 60)
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`
}
