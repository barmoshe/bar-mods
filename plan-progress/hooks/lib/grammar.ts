// The plan-progress block: reading it, counting it, and changing one line of it.
// Pure: no `$`, type-only imports, so a node script can run it unchanged.
//
// <!-- plan-progress title="Version 3.1" -->
// - [x] 1 · Days in a template · `5d18be5`
// - [~] 2 · Exceptions
//   - [x] 2a · Tables, codec, rules
//   - [~] 2b · The editor's draft
// - [?] gate · The merge · Bar's word
// <!-- /plan-progress -->

import type { Item, ItemState, Plan } from '../../types'

const OPEN = /^\s*<!--\s*plan-progress(?:\s+title="([^"]*)")?\s*-->\s*$/
const CLOSE = /^\s*<!--\s*\/plan-progress\s*-->\s*$/
const ITEM = /^( *)[-*] \[([ xX~?!-])\] (.*)$/
const SEP = /\s+·\s+/g
export const STATES: readonly ItemState[] = [' ', 'x', '~', '?', '!', '-']
export const STATE_WORDS: Record<ItemState, string> = {
  ' ': 'to do',
  x: 'done',
  '~': 'in progress',
  '?': 'waits on you',
  '!': 'blocked',
  '-': 'dropped',
}
export const COUNT_RULE =
  'Each step weighs one. A step with sub-steps fills by the share of them done. Gates and dropped items are not counted.'

// The file's lines with any '\r' kept on each, so joining with '\n' gives the bytes back.
const linesOf = (text: string) => text.split('\n')
const bare = (line: string) => (line.endsWith('\r') ? line.slice(0, -1) : line)

export type Block = { title: string; open: number; close: number }

export function findBlock(text: string): Block | null {
  const lines = linesOf(text)
  for (let i = 0; i < lines.length; i++) {
    const m = OPEN.exec(bare(lines[i] ?? ''))
    if (!m) continue
    for (let j = i + 1; j < lines.length; j++) {
      if (CLOSE.test(bare(lines[j] ?? ''))) return { title: m[1] ?? '', open: i, close: j }
    }
    return null
  }
  return null
}

function fieldsOf(content: string): string[] {
  return content.split(SEP).map(f => f.trim())
}

export function parse(text: string): Plan | null {
  const block = findBlock(text)
  if (!block) return null
  const lines = linesOf(text)
  const items: Item[] = []
  for (let i = block.open + 1; i < block.close; i++) {
    const m = ITEM.exec(bare(lines[i] ?? ''))
    if (!m) continue
    const indent = (m[1] ?? '').length
    const raw = m[2] ?? ' '
    const state: ItemState = raw === 'X' ? 'x' : (raw as ItemState)
    const fields = fieldsOf(m[3] ?? '')
    const one = fields.length === 1
    const id = one ? '' : (fields[0] ?? '')
    const item: Item = {
      state,
      id,
      title: one ? (fields[0] ?? '') : (fields[1] ?? ''),
      notes: one ? [] : fields.slice(2),
      isGate: id.toLowerCase() === 'gate',
      line: i,
      children: [],
    }
    const parent = items[items.length - 1]
    if (indent >= 2 && parent) parent.children.push(item)
    else items.push(item)
  }
  return { title: block.title, items }
}

// ---------- counting ----------

const isLive = (it: Item) => it.state !== '-'

export function fillOf(it: Item): number {
  if (it.state === 'x') return 1
  const kids = it.children.filter(isLive)
  if (kids.length === 0) return 0
  return kids.filter(k => k.state === 'x').length / kids.length
}

export type Count = { pct: number; sum: number; done: number; total: number }

export function count(plan: Plan): Count {
  const work = plan.items.filter(i => !i.isGate && isLive(i))
  const sum = work.reduce((a, i) => a + fillOf(i), 0)
  const done = work.filter(i => fillOf(i) === 1).length
  // floor, so 100% means every step is done
  const pct = work.length === 0 ? 0 : Math.floor((100 * sum) / work.length + 1e-9)
  return { pct, sum, done, total: work.length }
}

export type Now = { item: Item; step: Item }

// The deepest item in progress; with none, the first item not done.
export function findNow(plan: Plan): Now | null {
  for (const step of plan.items) {
    const kid = step.children.find(k => k.state === '~')
    if (kid) return { item: kid, step }
    if (step.state === '~') return { item: step, step }
  }
  for (const step of plan.items) {
    if (step.isGate || !isLive(step) || fillOf(step) === 1) continue
    const kid = step.children.find(k => isLive(k) && k.state !== 'x')
    return { item: kid ?? step, step }
  }
  return null
}

const everyItem = (plan: Plan) => plan.items.flatMap(i => [i, ...i.children])
export const waiting = (plan: Plan) => everyItem(plan).filter(i => i.state === '?')
export const blocked = (plan: Plan) => everyItem(plan).filter(i => i.state === '!')

// The steps after the current one that are still to do.
export function upNext(plan: Plan, k: number): Item[] {
  const now = findNow(plan)
  return plan.items.filter(i => !i.isGate && i.state === ' ' && i !== now?.step).slice(0, k)
}

// ---------- finding an item by what an agent or a person calls it ----------

export const label = (it: Item) => (it.id ? `${it.id} · ${it.title}` : it.title)

export function resolve(plan: Plan, ref: string): Item | string {
  const want = ref.trim()
  const all = everyItem(plan)
  const lower = want.toLowerCase()
  const tries: ((it: Item) => boolean)[] = [
    it => it.id === want,
    it => label(it) === want,
    it => it.title === want,
    it => it.id.toLowerCase() === lower || it.title.toLowerCase() === lower,
    it => `${it.id}: ${it.title}`.toLowerCase() === lower,
    it => it.title.toLowerCase().startsWith(lower) || label(it).toLowerCase().startsWith(lower),
  ]
  for (const t of tries) {
    const hits = all.filter(t)
    if (hits.length === 1 && hits[0]) return hits[0]
    if (hits.length > 1) {
      return `"${want}" matches ${hits.length} items: ${hits.map(label).join('; ')}. Name one by its title.`
    }
  }
  return `No item called "${want}". The items are: ${all.map(label).join('; ')}.`
}

// ---------- writing: one line at a time, everything else byte for byte ----------

export type Edit = { text: string; line: number } | { error: string }

function replaceLine(text: string, at: number, next: string): string {
  const lines = linesOf(text)
  const old = lines[at] ?? ''
  lines[at] = old.endsWith('\r') ? `${next}\r` : next
  return lines.join('\n')
}

function insertLine(text: string, at: number, next: string): string {
  const lines = linesOf(text)
  const isCrlf = (lines[0] ?? '').endsWith('\r')
  lines.splice(at, 0, isCrlf ? `${next}\r` : next)
  return lines.join('\n')
}

// A note: plain text, kept on one line and clear of the field separator.
const cleanNote = (note: string) => note.replace(/[\r\n]+/g, ' ').replace(/\s+·\s+/g, ', ').trim()

// Sets an item's state, and its notes when `note` is given ('' removes them).
export function setItem(text: string, ref: string, state: ItemState, note?: string): Edit {
  const plan = parse(text)
  if (!plan) return { error: 'The file has no plan-progress block.' }
  const it = resolve(plan, ref)
  if (typeof it === 'string') return { error: it }
  const line = bare(linesOf(text)[it.line] ?? '')
  const m = ITEM.exec(line)
  if (!m) return { error: `Line ${it.line + 1} is not an item any more; read the file again.` }
  const head = `${m[1] ?? ''}${line.slice((m[1] ?? '').length, (m[1] ?? '').length + 2)}`
  let content = m[3] ?? ''
  if (note !== undefined) {
    // keep "id · title" exactly as written, then the new note
    SEP.lastIndex = 0
    const seps = [...content.matchAll(SEP)]
    const titleEnds = it.id === '' ? (seps[0]?.index ?? content.length) : (seps[1]?.index ?? content.length)
    const kept = content.slice(0, titleEnds)
    const n = cleanNote(note)
    content = n ? `${kept} · ${n}` : kept
  }
  return { text: replaceLine(text, it.line, `${head}[${state}] ${content}`), line: it.line }
}

export type NewItem = {
  id?: string
  title: string
  state?: ItemState
  note?: string
  // place it after this item, at the same depth (after its sub-steps)
  after?: string
  // or make it the last sub-step of this item
  under?: string
}

export function addItem(text: string, add: NewItem): Edit {
  const plan = parse(text)
  const block = findBlock(text)
  if (!plan || !block) return { error: 'The file has no plan-progress block.' }
  const title = cleanNote(add.title)
  if (!title) return { error: 'A new item needs a title.' }
  const id = cleanNote(add.id ?? '')
  const state = add.state ?? ' '
  const note = cleanNote(add.note ?? '')
  const body = [id, title, note].filter(Boolean).join(' · ')
  let at = block.close
  let indent = ''
  if (add.under !== undefined) {
    const parent = resolve(plan, add.under)
    if (typeof parent === 'string') return { error: parent }
    if (plan.items.indexOf(parent) < 0) return { error: `${label(parent)} is a sub-step; sub-steps have none of their own.` }
    const last = parent.children[parent.children.length - 1]
    at = (last ?? parent).line + 1
    indent = '  '
  } else if (add.after !== undefined) {
    const prev = resolve(plan, add.after)
    if (typeof prev === 'string') return { error: prev }
    const isChild = plan.items.indexOf(prev) < 0
    const last = prev.children[prev.children.length - 1]
    at = (last ?? prev).line + 1
    indent = isChild ? '  ' : ''
  } else {
    const lastTop = plan.items[plan.items.length - 1]
    const lastLine = lastTop ? (lastTop.children[lastTop.children.length - 1] ?? lastTop).line : block.open
    at = lastLine + 1
  }
  return { text: insertLine(text, at, `${indent}- [${state}] ${body}`), line: at }
}

// ---------- a compact read for an agent picking up the build ----------

export function summary(plan: Plan, path: string): string {
  const c = count(plan)
  const now = findNow(plan)
  const out: string[] = [`${plan.title || 'Plan'}: ${c.pct}%, ${c.done} of ${c.total} steps done (${path}).`]
  if (now) out.push(`Now: ${label(now.item)}${now.item !== now.step ? ` (in step ${label(now.step)})` : ''}.`)
  const w = waiting(plan)
  if (w.length) out.push(`Waits on the person: ${w.map(label).join('; ')}.`)
  const b = blocked(plan)
  if (b.length) out.push(`Blocked: ${b.map(label).join('; ')}.`)
  out.push('')
  for (const it of plan.items) {
    out.push(`- [${it.state}] ${[label(it), ...it.notes].join(' · ')}`)
    for (const k of it.children) out.push(`  - [${k.state}] ${[label(k), ...k.notes].join(' · ')}`)
  }
  return out.join('\n')
}
