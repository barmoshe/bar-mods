// plan-progress: a plan's progress, read from a plain Markdown block, drawn above the prompt and
// beside the conversation. It keeps itself current from the evidence: the agent's tool calls, hand
// edits, and commits whose messages name a step ("(3.1 step 3d)").
//
// Only this file touches `$`. The grammar, the history, the writer and the drawing are pure files in lib/.

import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { Env, History, Item, ItemState, Lag, Moment, Plan, Snapshot } from '../types'
import { bidi } from './lib/bidi'
import type { Where } from './lib/bidi'
import { altOf, bandSvg, briefSvg, noteText, paceSvg } from './lib/draw'
import {
  addItem,
  count,
  COUNT_RULE,
  fillOf,
  findNow,
  gatesAhead,
  label,
  parse,
  setItem,
  summary,
  upNext,
  waiting,
} from './lib/grammar'
import type { Edit } from './lib/grammar'
import { addCommit, addTransitions, commitMessage, emptyHistory, isWipMessage, lagId, lags, mergeHistory, nudgeText, pace, since, stepRefs } from './lib/history'
import { barRuns } from './lib/term'
import type { Tone } from './lib/term'

const PANE = 'plan-progress'
const TITLE = 'Plan progress'
const POLL_MS = 2000
const TOOL = 'mcp__plan-progress__progress'
// a live line older than this is left out: the agent has stopped
const LIVE_MS = 3 * 60_000

const pinned = atom({ plugin: 'plan-progress', key: 'pinned' } as const, null)
const snap = atom({ plugin: 'plan-progress', key: 'snap' } as const, null)
const isHidden = atom({ plugin: 'plan-progress', key: 'isHidden' } as const, false)
const showAll = atom({ plugin: 'plan-progress', key: 'showAll' } as const, false)
const isPinning = atom({ plugin: 'plan-progress', key: 'isPinning' } as const, false)
const minute = atom({ plugin: 'plan-progress', key: 'minute' } as const, 0)
const env = atom({ plugin: 'plan-progress', key: 'env' } as const, { engine: '', isTermLogical: false, opener: 'open' })
const moment = atom({ plugin: 'plan-progress', key: 'moment' } as const, null)
const hist = atom({ plugin: 'plan-progress', key: 'hist' } as const, null)
const live = atom({ plugin: 'plan-progress', key: 'live' } as const, null)

// The project this session works in; pins and Hide are remembered per project.
let root = ''
const pinKey = () => `pin:${root}`
const hideKey = () => `hidden:${root}`
const histKey = (path: string) => `hist:${path}`
const shown = (path: string) => (root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path)

// ---------- history: kept in the store, so every session that pins the file reads the same ----------

function isHistory(v: unknown): v is History {
  return typeof v === 'object' && v !== null && 'items' in v && 'commits' in v && Array.isArray((v as History).commits)
}

async function storedHistory($: EngineInterface, path: string): Promise<History> {
  const v = await $.store.get(histKey(path)).catch(() => undefined)
  return isHistory(v) ? { ...emptyHistory(), ...v } : emptyHistory()
}

async function saveHistory($: EngineInterface, path: string, next: History): Promise<void> {
  await update($, hist, () => next)
  await $.store.set(histKey(path), next)
}

// ---------- reading the pinned file ----------

function moved(before: Plan | null, after: Plan): { step: Item | null; isPlanDone: boolean } {
  if (!before) return { step: null, isPlanDone: false }
  const key = (it: Item) => (it.id ? `id:${it.id}` : `t:${it.title}`)
  const was = new Map(before.items.map(it => [key(it), fillOf(it)] as const))
  const step = after.items.find(it => !it.isGate && fillOf(it) === 1 && (was.get(key(it)) ?? 1) < 1) ?? null
  const isPlanDone = count(after).pct === 100 && count(before).pct < 100
  return { step, isPlanDone }
}

async function load($: EngineInterface): Promise<void> {
  const path = await read($, pinned)
  if (!path) {
    await update($, snap, () => null)
    await update($, hist, () => null)
    return
  }
  const stat = await $.fs.stat(path).catch(() => null)
  if (!stat || stat.kind !== 'file') {
    await update($, snap, () => ({ path, mtimeMs: 0, size: 0, plan: null, error: `${path} is not there.` }))
    return
  }
  const text = await $.fs.read(path).catch(() => null)
  if (text === null || typeof text !== 'string') {
    await update($, snap, () => ({ path, mtimeMs: stat.mtimeMs, size: stat.size, plan: null, error: `${path} could not be read.` }))
    return
  }
  const plan = parse(text)
  const before = await read($, snap)
  const samePlan = before && before.path === path ? before.plan : null
  const next: Snapshot = { path, mtimeMs: stat.mtimeMs, size: stat.size, plan, error: plan ? null : `${path} has no <!-- plan-progress --> block.` }
  await update($, snap, () => next)
  if (!plan) return
  // the history this file has, from the store on a first read, and what this read changed
  const was = samePlan ? ((await read($, hist)) ?? emptyHistory()) : await storedHistory($, path)
  const now = await $.clock.now()
  const after = addTransitions(was, samePlan, plan, now)
  if (after !== was || !samePlan) await saveHistory($, path, after)
  if (!samePlan) return
  const { step, isPlanDone } = moved(samePlan, plan)
  if (!step && !isPlanDone) return
  const c = count(plan)
  const m: Moment = isPlanDone ? { kind: 'plan', id: '', until: now + 6000 } : { kind: 'step', id: String(step?.line ?? ''), until: now + 6000 }
  await update($, moment, () => m)
  $.clock.after(6500, () => {
    update($, moment, () => null).catch(() => undefined)
  })
  $.ui.toast(isPlanDone ? `${plan.title || 'The plan'}: every step done` : `Step ${step?.id || step?.title} done · ${c.done} of ${c.total}`)
}

async function poll($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const m = Math.floor(now / 60000)
  if ((await read($, minute)) !== m) await update($, minute, () => m)
  const path = await read($, pinned)
  if (!path) return
  const was = await read($, snap)
  const stat = await $.fs.stat(path).catch(() => null)
  const isSame = was !== null && stat !== null && was.mtimeMs === stat.mtimeMs && was.size === stat.size
  if (!isSame) await load($)
  // commits another session saw arrive through the store
  const mine = await read($, hist)
  const theirs = await storedHistory($, path)
  if (mine && theirs.commits.length + theirs.nudged.length + theirs.dismissed.length !== mine.commits.length + mine.nudged.length + mine.dismissed.length) {
    await update($, hist, () => mergeHistory(mine, theirs))
  }
}

async function pin($: EngineInterface, asked: string): Promise<string> {
  const path = asked.trim().replace(/^~(?=\/)/, (await $.env.get('HOME')) ?? '~')
  if (!path) return 'Name the plan file: /progress pin path/to/plan.md'
  const stat = await $.fs.stat(path, { resolve: true }).catch(() => null)
  if (!stat || stat.kind !== 'file' || !stat.realPath) return `${asked.trim()} is not a file.`
  const text = await $.fs.read(stat.realPath).catch(() => '')
  const plan = typeof text === 'string' ? parse(text) : null
  if (!plan) return `${asked.trim()} has no <!-- plan-progress --> block. The README says how to write one.`
  await update($, pinned, () => stat.realPath ?? path)
  await update($, isPinning, () => false)
  await update($, isHidden, () => false)
  await $.store.set(pinKey(), stat.realPath)
  await $.store.delete(hideKey())
  await load($)
  $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
  const c = count(plan)
  return `Pinned ${plan.title || stat.realPath}: ${c.done} of ${c.total} done, ${c.pct}%.`
}

// A remote surface draws only https: links, so the desktop opens the file with the system's opener:
// the one process this mod starts, and only on a press.
async function openFile($: EngineInterface, path: string): Promise<void> {
  const { opener } = await read($, env)
  const r = await $.process.run([opener, path], { timeoutMs: 10_000 })
  if (r.exitCode !== 0) $.ui.toast(`Could not open ${path}`)
}

async function hide($: EngineInterface): Promise<void> {
  await update($, isHidden, () => true)
  await $.store.set(hideKey(), true)
  await $.ui.close({ id: PANE }).catch(() => undefined)
}

async function show($: EngineInterface): Promise<void> {
  await update($, isHidden, () => false)
  await $.store.delete(hideKey())
  await $.ui.open({ id: PANE, title: TITLE })
}

// ---------- writing ----------

const STATE_OF: Record<string, ItemState> = {
  todo: ' ', 'to do': ' ', ' ': ' ', '': ' ',
  doing: '~', 'in progress': '~', '~': '~',
  done: 'x', x: 'x',
  waits: '?', 'waits on you': '?', '?': '?',
  blocked: '!', '!': '!',
  dropped: '-', '-': '-',
}

const answer = (body: string) => ({ result: [{ type: 'text' as const, text: body }] })
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

// Write one edit to the pinned file: fresh read, the edit, and no write if the file moved meanwhile.
async function write($: EngineInterface, edit: (text: string) => Edit, version: number | undefined): Promise<string> {
  const path = await read($, pinned)
  if (!path) return 'No plan is pinned. Call this tool with action "pin" and the plan file\'s path first.'
  const before = await $.fs.stat(path).catch(() => null)
  if (!before) return `${path} is not there any more.`
  if (version !== undefined && Math.round(before.mtimeMs) !== Math.round(version)) {
    return 'The file changed since you read it (someone edited it). Nothing was written. Call read again, then retry.'
  }
  const text = await $.fs.read(path)
  if (typeof text !== 'string') return `${path} could not be read as text.`
  const r = edit(text)
  if ('error' in r) return r.error
  const again = await $.fs.stat(path).catch(() => null)
  if (!again || again.mtimeMs !== before.mtimeMs || again.size !== before.size) {
    return 'The file changed while this edit was being made. Nothing was written. Call read again, then retry.'
  }
  await $.fs.write(path, r.text)
  await load($)
  const s = await read($, snap)
  const after = await $.fs.stat(path).catch(() => null)
  const line = r.text.split('\n')[r.line]?.replace(/\r$/, '') ?? ''
  return `Wrote line ${r.line + 1}: ${line}\n${s?.plan ? summary(s.plan, path).split('\n')[0] : ''}\nversion: ${Math.round(after?.mtimeMs ?? 0)}`
}

// A commit landed in this session. Attach it to the items its message names, start what it names
// that had not started, and when the work has moved on past an open item, tell the agent once.
async function onCommit($: EngineInterface, sha: string, command: string): Promise<string[]> {
  const s = await read($, snap)
  if (!s?.plan) return []
  const message = commitMessage(command) || command
  const ids = stepRefs(message, s.plan)
  if (!ids.length) return []
  const at = await $.clock.now()
  let hs = addCommit((await read($, hist)) ?? (await storedHistory($, s.path)), { sha: sha.slice(0, 7), at, items: ids, isWip: isWipMessage(message) })
  await saveHistory($, s.path, hs)
  const steps = new Map(s.plan.items.flatMap(st => [[st.id, st] as const, ...st.children.map(k => [k.id, k] as const)]))
  const parentOf = new Map(s.plan.items.flatMap(st => st.children.map(k => [k.id, st] as const)))
  for (const id of ids) {
    const it = steps.get(id)
    const parent = parentOf.get(id)
    if (parent && parent.state === ' ') await write($, text => setItem(text, parent.id, '~'), undefined)
    if (it && it.state === ' ') await write($, text => setItem(text, id, '~'), undefined)
  }
  const now = await read($, snap)
  hs = (await read($, hist)) ?? hs
  const fresh = now?.plan ? lags(now.plan, hs).filter(l => !l.isNudged) : []
  if (!fresh.length) return []
  await saveHistory($, s.path, { ...hs, nudged: [...hs.nudged, ...fresh.map(lagId)] })
  return fresh.map(l => nudgeText(l, shown(s.path)))
}

async function closeLag($: EngineInterface, l: Lag): Promise<void> {
  const r = await write($, text => setItem(text, l.item, 'x'), undefined)
  $.ui.toast(r.startsWith('Wrote') ? `${l.item} marked done` : r)
}

async function dismissLag($: EngineInterface, l: Lag): Promise<void> {
  const path = await read($, pinned)
  const hs = await read($, hist)
  if (!path || !hs) return
  await saveHistory($, path, { ...hs, dismissed: [...hs.dismissed, lagId(l)] })
}

// ---------- the command and the tool ----------

const PROGRESS = /^(?:plan-progress:)?progress$/
const PROGRESS_LINE = /^\s*\/(?:plan-progress:)?progress(?:\s+([\s\S]*))?$/

// The arguments of a /progress submission, or null when the prompt is anything else.
function progressArgs(text: string, command: { name: string; args: string } | undefined): string | null {
  if (command) return PROGRESS.test(command.name) ? command.args : null
  const m = PROGRESS_LINE.exec(text)
  return m ? (m[1] ?? '').trim() : null
}

// /progress [show | pin <file> | hide | unpin], and the tool's show, hide and unpin.
async function runCommand($: EngineInterface, args: string): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  if (verb === 'pin') return pin($, rest.join(' '))
  if (verb === 'hide') {
    await hide($)
    return 'Plan progress hidden. /progress brings it back.'
  }
  if (verb === 'unpin') {
    await update($, pinned, () => null)
    await $.store.delete(pinKey())
    await load($)
    await $.ui.close({ id: PANE }).catch(() => undefined)
    return 'No plan is pinned now.'
  }
  if (verb && verb !== 'show') return `/progress takes pin <file>, hide or unpin; "${verb}" is none of them.`
  await show($)
  const s = await read($, snap)
  if (!s) return 'No plan is pinned. /progress pin path/to/plan.md pins one.'
  return s.plan ? altOf(s.plan) : (s.error ?? 'No plan.')
}

async function runTool($: EngineInterface, input: Record<string, unknown>): Promise<string> {
  const action = str(input.action) ?? 'read'
  if (action === 'pin') return pin($, str(input.path) ?? '')
  if (action === 'show' || action === 'hide' || action === 'unpin') return runCommand($, action)
  const version = typeof input.version === 'number' ? input.version : undefined
  if (action === 'read') {
    await load($)
    const s = await read($, snap)
    if (!s) return 'No plan is pinned. Call this tool with action "pin" and the plan file\'s path.'
    if (!s.plan) return s.error ?? 'No plan.'
    const hs = (await read($, hist)) ?? emptyHistory()
    const behind = lags(s.plan, hs).map(l => `${l.item} is still in progress, but the commits moved on to ${l.movedTo}.`)
    return `${summary(s.plan, s.path)}${behind.length ? `\n\nThe plan looks behind: ${behind.join(' ')}` : ''}\n\nversion: ${Math.round(s.mtimeMs)}`
  }
  if (action === 'set') {
    const item = str(input.item)
    const state = STATE_OF[(str(input.state) ?? '').toLowerCase()]
    if (!item) return 'Name the item: its id (2d), or a gate\'s title.'
    if (state === undefined) return 'state is one of: todo, doing, done, waits, blocked, dropped.'
    const note = str(input.note)
    return write($, text => setItem(text, item, state, note), version)
  }
  if (action === 'add') {
    const title = str(input.title)
    if (!title) return 'A new item needs a title.'
    const state = STATE_OF[(str(input.state) ?? 'todo').toLowerCase()] ?? ' '
    return write($, text => addItem(text, { id: str(input.id), title, state, note: str(input.note), after: str(input.after), under: str(input.under) }), version)
  }
  return `No action "${action}". The actions are read, set, add, pin, show, hide and unpin.`
}

// What the agent is doing, in a few words, from one of its tool calls.
function describe(tool: string, input: Record<string, unknown>): string {
  const base = (p: unknown) => (typeof p === 'string' ? (p.split('/').pop() ?? p) : 'a file')
  const said = typeof input.description === 'string' ? input.description.trim() : ''
  if (tool === TOOL) return 'updating the plan'
  if (tool === 'Bash') return said || 'running a command'
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'Write' || tool === 'NotebookEdit') return `editing ${base(input.file_path ?? input.notebook_path)}`
  if (tool === 'Read') return `reading ${base(input.file_path)}`
  if (tool === 'Grep' || tool === 'Glob') return 'searching the code'
  if (tool === 'Agent' || tool === 'Task') return said ? `with a subagent: ${said}` : 'with a subagent'
  if (tool.startsWith('Web')) return 'reading the web'
  if (tool.startsWith('mcp__')) return `using ${tool.split('__')[1] ?? tool}`
  return `using ${tool}`
}

// ---------- drawing ----------

type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Link'>

const GLYPH: Record<ItemState, string> = { x: '●', '~': '◐', ' ': '○', '?': '◆', '!': '✕', '-': '–' }
const toneOf = (st: ItemState, isNow: boolean): Tone =>
  isNow ? 'now' : st === 'x' || st === '~' ? 'ink' : st === ' ' || st === '?' ? 'blue' : 'dim'
const COLOR: Record<Tone, string> = { ink: 'text', dim: 'inactive', blue: '#4C8DFF', now: '#F2621B' }

function noteEls(el: Els, notes: string[]) {
  const { Link, Text } = el
  return notes.map(note => {
    const link = /^\[([^\]]+)\]\((https?:[^)\s]+)\)$/.exec(note.trim())
    if (link && link[1] && link[2]) return <Link href={link[2]} label={link[1]} />
    const isCode = /^(`[^`]+`\s*)+$/.test(note.trim()) || /^(#?\d+|[A-Z]+ #\d+|[0-9a-f]{7,40})$/.test(note.trim())
    return isCode ? <Text mono dimColor wrap="wrap">{noteText(note)}</Text> : <Text dimColor wrap="wrap">{noteText(note)}</Text>
  })
}

function rowOf(el: Els, it: Item, isNow: boolean, where: Where, width: number, extra?: string) {
  const { Box, Text } = el
  const tone = toneOf(it.state, isNow)
  const id = it.isGate ? 'gate' : it.id
  const idCells = Math.max(3, id.length)
  // the desktop's dock is about 45 cells: a row's notes go under its title there
  const isNarrow = width < 72
  const hasNotes = it.notes.length > 0 || Boolean(extra)
  const notes = (
    <Box flexDirection="row" gap={1} flexWrap="wrap">
      {noteEls(el, it.notes)}
      {extra ? <Text dimColor>{extra}</Text> : null}
    </Box>
  )
  return (
    <Box key={`row-${it.line}`} flexDirection="row" gap={1} alignItems="flex-start">
      <Text color={COLOR[tone]}>{isNow ? '◉' : GLYPH[it.state]}</Text>
      <Box width={idCells} flexShrink={0}>
        <Text mono dimColor={!isNow}>{id}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
        <Text weight={isNow ? 'semibold' : 'regular'} strikethrough={it.state === '-'} dimColor={it.state === '-'} wrap="wrap">
          {bidi(it.title, where)}
        </Text>
        {hasNotes && isNarrow && notes}
      </Box>
      {hasNotes && !isNarrow && <Box flexShrink={0}>{notes}</Box>}
    </Box>
  )
}

// A section's label, and a quiet fact on its right.
function caption(el: Els, text: string, right?: string) {
  const { Box, Text } = el
  return (
    <Box key={`cap-${text}`} flexDirection="row" justifyContent="space-between" gap={1}>
      <Text size="caption" weight="semibold" dimColor>
        {text}
      </Text>
      {right ? (
        <Text size="caption" dimColor>
          {right}
        </Text>
      ) : null}
    </Box>
  )
}

type View = {
  plan: Plan
  hs: History
  now: number
  path: string
  liveText: string | null
  where: Where
  width: number
  isAll: boolean
  surface: string
}

// Needs you now: the strong block, only when something blocks the work. The gates still ahead: one quiet line.
function needsPart($: EngineInterface, el: Els, v: View) {
  const { Box, Button, Text } = el
  const w = waiting(v.plan)
  const ahead = gatesAhead(v.plan)
  if (w.length) {
    return (
      <Box key="needs" flexDirection="column" gap={0}>
        {caption(el, `NEEDS YOU NOW · ${w.length}`)}
        {w.map(it => (
          <Box key={`need-${it.line}`} flexDirection="column">
            <Box flexDirection="row" gap={1} alignItems="flex-start">
              <Text color={COLOR.blue}>◆</Text>
              <Text weight="semibold" wrap="wrap">
                {bidi(it.title, v.where)}
              </Text>
            </Box>
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              {noteEls(el, it.notes)}
              <Button
                key={`word-${it.line}`}
                label={it.isGate ? 'Give the word' : 'Answer'}
                onPress={() => {
                  $.prompt.fill({ text: it.isGate ? `Go ahead with ${it.title}.` : `About ${label(it)}: ` }).catch(() => undefined)
                }}
              />
            </Box>
          </Box>
        ))}
      </Box>
    )
  }
  if (!ahead.length) return null
  const lastWork = v.plan.items.filter(i => !i.isGate).pop()
  return (
    <Text key="ahead" dimColor wrap="wrap">
      {`◇ ${ahead.length} ${ahead.length === 1 ? 'gate' : 'gates'} ahead${lastWork ? `, after ${lastWork.id || 'the last step'}` : ''}: ${ahead.map(g => g.title).join(', ')}`}
    </Text>
  )
}

// The plan is behind: an open item the commits moved past. Inferred, with one press to close it.
function lagPart($: EngineInterface, el: Els, v: View) {
  const { Box, Button, Text } = el
  const ls = lags(v.plan, v.hs).slice(0, 2)
  if (!ls.length) return null
  return (
    <Box key="lag" flexDirection="column">
      {caption(el, 'THE PLAN IS BEHIND', 'inferred')}
      {ls.map(l => (
        <Box key={`lag-${lagId(l)}`} flexDirection="column">
          <Text wrap="wrap">{`${l.item} looks done: the commits moved on to ${l.movedTo} ${since(l.since, v.now)} ago.${l.isNudged ? ' Claude was told.' : ''}`}</Text>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Button key={`close-${lagId(l)}`} label={`Mark ${l.item} done`} variant="primary" onPress={() => closeLag($, l).catch(() => undefined)} />
            <Button key={`keep-${lagId(l)}`} label="Not yet" onPress={() => dismissLag($, l).catch(() => undefined)} />
          </Box>
        </Box>
      ))}
    </Box>
  )
}

function nowPart(el: Els, v: View) {
  const { Box, Text } = el
  const n = findNow(v.plan)
  if (!n) {
    return (
      <Text key="all-done" size="heading" weight="semibold">
        Every step is done.
      </Text>
    )
  }
  const s = n.step
  const t = v.hs.items[s.id]
  const kids = s.children.filter(k => k.state !== '-')
  const share = kids.length ? ` · ${kids.filter(k => k.state === 'x').length} OF ${kids.length}` : ''
  const started = t?.startedAt !== undefined ? `started ${since(t.startedAt, v.now)} ago` : undefined
  const shas = t?.commits.length ? `${t.commits.length} ${t.commits.length === 1 ? 'commit' : 'commits'}, last ${t.commits[t.commits.length - 1]}` : ''
  return (
    <Box key="now" flexDirection="column">
      {caption(el, `NOW${share}`, started)}
      <Text size="heading" weight="semibold" wrap="wrap">
        {`${s.id ? `${s.id} · ` : ''}${bidi(s.title, v.where)}`}
      </Text>
      {s.children
        .filter(k => k.state !== 'x' || k === n.item)
        .map(k => rowOf(el, k, k === n.item, v.where, v.width))}
      {!s.children.length && s.notes.length > 0 && (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {noteEls(el, s.notes)}
        </Box>
      )}
      {shas ? (
        <Text mono size="caption" dimColor>
          {shas}
        </Text>
      ) : null}
      {v.liveText ? (
        <Box flexDirection="row" gap={1}>
          <Text color={COLOR.now}>●</Text>
          <Text dimColor wrap="wrap">{`Claude · ${v.liveText}`}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

function nextPart(el: Els, v: View) {
  const { Box } = el
  const items = v.isAll ? v.plan.items.filter(i => !i.isGate) : upNext(v.plan, 3)
  if (!items.length) return null
  return (
    <Box key="next" flexDirection="column">
      {caption(el, v.isAll ? 'EVERY STEP' : 'NEXT')}
      {items.map(it => rowOf(el, it, false, v.where, v.width))}
    </Box>
  )
}

function donePart(el: Els, v: View) {
  const { Box, Text } = el
  if (v.isAll) return null
  const done = v.plan.items.filter(i => !i.isGate && fillOf(i) === 1)
  if (!done.length) return null
  const last = Math.max(0, ...done.map(i => v.hs.items[i.id]?.doneAt ?? 0))
  return (
    <Box key="done" flexDirection="column">
      {caption(el, `DONE · ${done.length}`, last ? `last ${since(last, v.now)} ago` : undefined)}
      <Text mono dimColor wrap="wrap">
        {done.map(i => i.id || '·').join('  ')}
      </Text>
    </Box>
  )
}

function pacePart(e: { surface: string }, el: Els, v: View, svg: ReturnType<typeof caption> | null) {
  const { Box, Text } = el
  const pc = pace(v.plan, v.hs)
  if (!pc || pc.stepsLeft === 0) return null
  const [lo, hi] = pc.perStep
  const [l1, l2] = pc.left
  const facts = `a step takes ${lo === hi ? `${lo}` : `${lo}-${hi}`} min · ${pc.stepsLeft} left: about ${l1 === l2 ? `${l1}` : `${l1}-${l2}`} h`
  const bars = e.surface === 'terminal' ? <Text>{pc.minutes.slice(-8).map(m => '▁▂▃▄▅▆▇█'[Math.min(7, Math.round((7 * m.min) / Math.max(...pc.minutes.map(x => x.min))))]).join('')}</Text> : svg
  return (
    <Box key="pace" flexDirection="column">
      {caption(el, 'PACE', 'from this plan’s history')}
      <Box flexDirection="row" gap={1} alignItems="flex-end">
        {bars}
        <Text dimColor wrap="wrap">
          {facts}
        </Text>
      </Box>
    </Box>
  )
}

function runsEl(el: Els, runs: { text: string; tone: Tone }[]) {
  const { Box, Text } = el
  return (
    <Box flexDirection="row">
      {runs.map(r => (
        <Text color={COLOR[r.tone]}>{r.text}</Text>
      ))}
    </Box>
  )
}

async function whereOf($: EngineInterface, surface: string): Promise<Where> {
  if (surface !== 'terminal') return 'desktop'
  return (await read($, env)).isTermLogical ? 'terminal-logical' : 'terminal'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    root = e.cwd
    await $.tool.register({
      name: 'progress',
      description:
        'plan-progress: read and update the progress of the pinned plan, a plain Markdown block between <!-- plan-progress --> and <!-- /plan-progress --> whose lines are "- [state] id · title · note". ' +
        'Call read when you pick up a build. Call set as you start a step or sub-step (state "doing") and as you finish it (state "done", with the commit or PR as its note), and "waits" for a decision or gate that needs the person. ' +
        'Name the step in each commit message, e.g. "(step 3d)": the mod attaches the commit to it. ' +
        'add puts a missing item after another (after) or as the last sub-step of one (under). pin names the plan file; show opens the pane beside the conversation, hide hides it and the band, unpin pins nothing. ' +
        'A write changes only that item\'s line; pass the version read returned and it refuses if the file changed since.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['read', 'set', 'add', 'pin', 'show', 'hide', 'unpin'] },
          item: { type: 'string', description: 'set: the item\'s id (e.g. "2d"), or a gate\'s title' },
          state: { type: 'string', enum: ['todo', 'doing', 'done', 'waits', 'blocked', 'dropped'] },
          note: { type: 'string', description: 'set/add: replaces the fields after the title, e.g. a commit `abc1234` or a PR link; "" removes them' },
          id: { type: 'string', description: 'add: the new item\'s id' },
          title: { type: 'string', description: 'add: the new item\'s title' },
          after: { type: 'string', description: 'add: put it after this item, at its depth' },
          under: { type: 'string', description: 'add: make it the last sub-step of this step' },
          path: { type: 'string', description: 'pin: the Markdown file holding the block' },
          version: { type: 'number', description: 'set/add: the version read returned; the write is refused if the file changed since' },
        },
        required: ['action'],
      },
    })
    const version = await $.session.version().catch(() => null)
    const term = (await $.env.get('TERM_PROGRAM')) ?? ''
    const wt = (await $.env.get('WT_SESSION')) ?? ''
    const os = (await $.env.get('OS')) ?? ''
    const home = (await $.env.get('HOME')) ?? ''
    const opener = os === 'Windows_NT' ? 'explorer' : home.startsWith('/Users/') ? 'open' : 'xdg-open'
    const known: Env = { engine: version?.base ?? '', isTermLogical: term === 'vscode' || wt !== '', opener }
    await update($, env, () => known)
    const kept = await $.store.get(pinKey())
    const wasHidden = (await $.store.get(hideKey())) === true
    if (typeof kept === 'string' && (await read($, pinned)) === null) await update($, pinned, () => kept)
    await update($, isHidden, () => wasHidden)
    await load($)
    $.clock.every(POLL_MS, () => {
      poll($).catch(() => undefined)
    })
    const s = await read($, snap)
    if (s?.plan && !wasHidden) $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    return next(e)
  })

  // /progress: a command file (commands/progress.md) so every surface lists it, answered here
  // without a model turn. Either spelling, /progress or /plan-progress:progress.
  on('command.run', { command: /^(?:plan-progress:)?progress$/ }, async ($, e) => ({ text: await runCommand($, e.args) })).catch(
    () => ({ text: 'plan-progress could not answer /progress. Ask Claude to use the plan-progress tool instead.' }),
  )

  // Where a command file arrives as a prompt (headless, the desktop app), answer it here and drop it, so
  // no turn runs; the drop's text is what the person reads.
  on('prompt.submit', async ($, e, next) => {
    const asked = progressArgs(e.text, e.command)
    if (asked === null) return next(e)
    return { drop: await runCommand($, asked) }
  }).catch(($, e, next) => next(e))

  // The agent's tool; what the agent is doing (the live line); an edit to the pinned file shown at
  // once; and a commit that names a step, attached to it. One hook: the session's tool union does
  // not name a plugin's own tool at type time.
  on('tool.call', async ($, e, next) => {
    const tool: string = e.tool
    const input = e as unknown as Record<string, unknown>
    if (e.agentId === undefined) {
      const at = await $.clock.now()
      await update($, live, () => ({ text: describe(tool, input), at })).catch(() => undefined)
    }
    if (tool === TOOL) return answer(await runTool($, input))
    const ran = await next(e)
    if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') {
      const path = await read($, pinned)
      const target = input.file_path
      if (path && typeof target === 'string' && (target === path || path.endsWith(`/${target.replace(/^\.\//, '')}`))) await load($).catch(() => undefined)
      return ran
    }
    if (tool !== 'Bash' || !('result' in ran) || ran.result === undefined) return ran
    const sha = (ran.result as { gitOperation?: { commit?: { sha?: string } } }).gitOperation?.commit?.sha
    if (!sha) return ran
    const told = await onCommit($, sha, typeof input.command === 'string' ? input.command : '').catch(() => [] as string[])
    return told.length ? { ...ran, context: [...(ran.context ?? []), ...told] } : ran
  }).catch(($, e, next) => {
    const tool: string = e.tool
    return tool === TOOL ? answer('plan-progress failed before writing anything. Read the plan again and retry.') : next(e)
  })

  // The turn ended: no live line until the agent works again.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, live, () => null)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The band: where the build is, in one quiet line, and a second only when something needs you.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    if (e.props.hasSurvey || !s?.plan || (await read($, isHidden))) return next(e)
    const plan = s.plan
    const n = findNow(plan)
    const done = count(plan)
    const hs = (await read($, hist)) ?? emptyHistory()
    const clock = await $.clock.now()
    const where = await whereOf($, e.surface)
    const t = n ? hs.items[n.step.id] : undefined
    const lead = n ? `${done.done}/${done.total} done` : 'Done'
    const rest = n ? ` · ${n.step.id ? `${n.step.id} ` : ''}${bidi(n.step.title, where)}${t?.startedAt !== undefined ? ` · ${since(t.startedAt, clock)}` : ''}` : ` · every step of ${bidi(plan.title || 'the plan', where)}`
    const need = waiting(plan)[0]
    const lag = lags(plan, hs)[0]
    const below = await next(e)
    const openPane = () => {
      show($).catch(() => undefined)
    }
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const extra = (
      <Box flexDirection="column">
        {need ? (
          <Box flexDirection="row" gap={1}>
            <Text color={COLOR.blue}>◆</Text>
            <Text weight="semibold" wrap="truncate-end">{`${bidi(need.title, where)} ${need.isGate ? 'needs your word' : 'needs you'}`}</Text>
          </Box>
        ) : null}
        {lag ? <Text dimColor wrap="truncate-end">{`⟳ the plan is behind: ${lag.item} looks done (work moved to ${lag.movedTo})`}</Text> : null}
      </Box>
    )
    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap="sm" alignItems="center">
            <Svg source={bandSvg(plan)} alt={altOf(plan)} width={120} height={12} />
            <Button key="open" plain onPress={openPane}>
              <Text weight="semibold">{lead}</Text>
              <Text dimColor>{rest}</Text>
            </Button>
          </Box>
          {extra}
          {below}
        </Box>
      )
    }
    const barCells = Math.max(8, Math.min(30, Math.floor(e.props.bodyColumns / 4)))
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {runsEl(els, barRuns(plan, barCells))}
          <Text weight="semibold">{lead}</Text>
          <Box flexShrink={1}>
            <Text wrap="truncate-end" dimColor>
              {rest}
            </Text>
          </Box>
        </Box>
        {extra}
        {below}
      </Box>
    )
  })

  // The pane: the brief. Where the build is, what needs you, what is happening now, what comes next.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = await read($, snap)
    const els = $.ui.resolve(e)
    const { Box, Button, Link, Text } = els
    const el: Els = { Box, Button, Link, Text }
    const Input = 'Input' in els ? els.Input : null
    const isAll = await read($, showAll)
    const pinningNow = await read($, isPinning)
    const m = await read($, moment)
    const hs = (await read($, hist)) ?? emptyHistory()
    const lv = await read($, live)
    await read($, minute)
    const clock = await $.clock.now()
    const cols = e.props.bodyColumns
    const where = await whereOf($, e.surface)

    const pinBox = pinningNow && Input ? (
      <Input
        key="pin-path"
        label="Plan file"
        placeholder="path/to/plan.md"
        value={s?.path ?? ''}
        submitLabel="pin"
        autoFocus
        onSubmit={(value: string) => {
          pin($, value)
            .then(msg => $.ui.toast(msg))
            .catch(() => undefined)
        }}
      />
    ) : null
    const buttons = (
      <Box flexDirection="row" gap="sm" flexWrap="wrap">
        {s?.plan && (
          <Button key="all" label={isAll ? 'Fewer steps' : 'Every step'} onPress={() => update($, showAll, v => !v).catch(() => undefined)} />
        )}
        <Button key="hide" label="Hide" onPress={() => hide($).catch(() => undefined)} />
        <Button key="pin" label={pinningNow ? 'Cancel' : 'Pin another plan'} onPress={() => update($, isPinning, v => !v).catch(() => undefined)} />
        {s && e.surface === 'terminal' && <Link href={`file://${encodeURI(s.path)}`} label="Open the file" />}
        {s && e.surface !== 'terminal' && <Button key="open-file" label="Open the file" onPress={() => openFile($, s.path).catch(() => undefined)} />}
      </Box>
    )

    if (!s || !s.plan) {
      return (
        <Box flexDirection="column" gap="md">
          <Text size="heading" weight="semibold">
            {s ? 'This file has no plan' : 'No plan is pinned'}
          </Text>
          <Text dimColor>{s?.error ?? 'Pin a Markdown file that holds a <!-- plan-progress --> block: /progress pin path/to/plan.md, or the button below.'}</Text>
          {pinBox}
          {buttons}
        </Box>
      )
    }
    const plan = s.plan
    const v: View = {
      plan,
      hs,
      now: clock,
      path: s.path,
      liveText: lv && clock - lv.at < LIVE_MS ? lv.text : null,
      where,
      width: cols,
      isAll,
      surface: e.surface,
    }
    const meta = (
      <Box key="meta" flexDirection="column">
        <Text mono size="caption" dimColor wrap="wrap">
          {shown(s.path)}
        </Text>
        <Text size="caption" dimColor>{`changed ${since(s.mtimeMs, clock)}${since(s.mtimeMs, clock) === 'just now' ? '' : ' ago'}`}</Text>
      </Box>
    )
    const n = findNow(plan)
    const pc = pace(plan, hs)

    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      const width = Math.max(180, Math.min(1100, Math.round(cols * 7)))
      const isMoment = m !== null && m.until > clock
      const svg = briefSvg(plan, {
        width,
        settleLine: isMoment && m?.kind === 'step' ? Number(m.id) : undefined,
        isWipe: isMoment && m?.kind === 'plan',
      })
      const paceGraph = pc ? <Svg source={paceSvg(pc.minutes, n?.step.id ?? null)} alt={`Minutes per step: ${pc.minutes.map(x => `${x.id} ${x.min}`).join(', ')}`} isInteractive /> : null
      return (
        <Box flexDirection="column" gap="md">
          <Svg source={svg} alt={`${altOf(plan)} ${COUNT_RULE}`} isInteractive />
          {lagPart($, el, v)}
          {needsPart($, el, v)}
          {nowPart(el, v)}
          {nextPart(el, v)}
          {donePart(el, v)}
          {pacePart(e, el, v, paceGraph)}
          {pinBox}
          {meta}
          {buttons}
        </Box>
      )
    }

    // The terminal: the same brief in characters.
    const c = count(plan)
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text dimColor wrap="truncate-end">
            {bidi((plan.title || 'Plan').toUpperCase(), where)}
          </Text>
          <Box flexDirection="row" justifyContent="space-between">
            <Text weight="bold">{n ? `${c.done} of ${c.total} done` : `Done · ${c.total} of ${c.total}`}</Text>
            <Text dimColor>{`${c.pct}%`}</Text>
          </Box>
          {runsEl(el, barRuns(plan, Math.max(12, cols - 2)))}
        </Box>
        {lagPart($, el, v)}
        {needsPart($, el, v)}
        {nowPart(el, v)}
        {nextPart(el, v)}
        {donePart(el, v)}
        {pacePart(e, el, v, null)}
        {pinBox}
        {meta}
        {buttons}
      </Box>
    )
  })
}
