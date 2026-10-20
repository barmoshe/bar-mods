// plan-progress: a plan's progress, read from a plain Markdown block, drawn above the prompt and
// beside the conversation, and kept current by a tool the agent calls as it works.
//
// Only this file touches `$`. The grammar, the writer and the drawing are pure files in lib/.

import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { Env, Item, ItemState, Moment, Plan, Snapshot } from '../types'
import { bidi } from './lib/bidi'
import type { Where } from './lib/bidi'
import { altOf, bandSvg, noteText, pressSvg } from './lib/draw'
import {
  addItem,
  blocked,
  count,
  COUNT_RULE,
  fillOf,
  findNow,
  label,
  parse,
  setItem,
  summary,
  upNext,
  waiting,
} from './lib/grammar'
import type { Edit } from './lib/grammar'
import { barRuns } from './lib/term'
import type { Tone } from './lib/term'

const NAME = 'plan-progress'
const PANE = 'plan-progress'
const TITLE = 'Plan progress'
const POLL_MS = 2000
const TOOL = 'mcp__plan-progress__progress'

const pinned = atom({ plugin: 'plan-progress', key: 'pinned' } as const, null)
const snap = atom({ plugin: 'plan-progress', key: 'snap' } as const, null)
const isHidden = atom({ plugin: 'plan-progress', key: 'isHidden' } as const, false)
const showAll = atom({ plugin: 'plan-progress', key: 'showAll' } as const, false)
const isPinning = atom({ plugin: 'plan-progress', key: 'isPinning' } as const, false)
const minute = atom({ plugin: 'plan-progress', key: 'minute' } as const, 0)
const env = atom({ plugin: 'plan-progress', key: 'env' } as const, { engine: '', isTermLogical: false, opener: 'open' })
const moment = atom({ plugin: 'plan-progress', key: 'moment' } as const, null)

// The project this session works in; pins and Hide are remembered per project.
let root = ''
const pinKey = () => `pin:${root}`
const hideKey = () => `hidden:${root}`

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
  const next: Snapshot = {
    path,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    plan,
    error: plan ? null : `${path} has no <!-- plan-progress --> block.`,
  }
  await update($, snap, () => next)
  if (!plan || !before || before.path !== path) return
  const { step, isPlanDone } = moved(before.plan, plan)
  if (!step && !isPlanDone) return
  const c = count(plan)
  const until = (await $.clock.now()) + 6000
  const m: Moment = isPlanDone ? { kind: 'plan', id: '', until } : { kind: 'step', id: String(step?.line ?? ''), until }
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
  return `Pinned ${plan.title || stat.realPath}: ${c.pct}%, ${c.done} of ${c.total} steps.`
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

// ---------- the tool ----------

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

async function runTool($: EngineInterface, input: Record<string, unknown>): Promise<string> {
  const action = str(input.action) ?? 'read'
  if (action === 'pin') return pin($, str(input.path) ?? '')
  const version = typeof input.version === 'number' ? input.version : undefined
  if (action === 'read') {
    await load($)
    const s = await read($, snap)
    if (!s) return 'No plan is pinned. Call this tool with action "pin" and the plan file\'s path.'
    if (!s.plan) return s.error ?? 'No plan.'
    return `${summary(s.plan, s.path)}\n\nversion: ${Math.round(s.mtimeMs)}`
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
    return write(
      $,
      text => addItem(text, { id: str(input.id), title, state, note: str(input.note), after: str(input.after), under: str(input.under) }),
      version,
    )
  }
  return `No action "${action}". The actions are read, set, add and pin.`
}

// ---------- drawing ----------

type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Link'>

const GLYPH: Record<ItemState, string> = { x: '●', '~': '◐', ' ': '○', '?': '◆', '!': '✕', '-': '–' }
const toneOf = (st: ItemState, isNow: boolean): Tone =>
  isNow ? 'now' : st === 'x' || st === '~' ? 'ink' : st === ' ' || st === '?' ? 'blue' : 'dim'
const COLOR: Record<Tone, string> = { ink: 'text', dim: 'inactive', blue: '#4C8DFF', now: '#F2621B' }

function ago(ms: number, now: number): string {
  const min = Math.max(0, Math.round((now - ms) / 60000))
  if (min < 1) return 'changed just now'
  if (min < 60) return `changed ${min} min ago`
  const hours = Math.round(min / 60)
  return hours < 48 ? `changed ${hours} h ago` : `changed ${Math.round(hours / 24)} days ago`
}

function noteEls(el: Els, notes: string[]) {
  const { Link, Text } = el
  return notes.map(note => {
    const link = /^\[([^\]]+)\]\((https?:[^)\s]+)\)$/.exec(note.trim())
    if (link && link[1] && link[2]) return <Link href={link[2]} label={link[1]} />
    return <Text mono dimColor wrap="truncate-end">{noteText(note)}</Text>
  })
}

function rowOf(el: Els, it: Item, isNow: boolean, where: Where, width: number) {
  const { Box, Text } = el
  const tone = toneOf(it.state, isNow)
  const id = it.isGate ? 'gate' : it.id
  const idCells = Math.max(3, id.length)
  return (
    <Box key={`row-${it.line}`} flexDirection="row" gap={1}>
      <Text color={COLOR[tone]}>{isNow ? '◉' : GLYPH[it.state]}</Text>
      <Box width={idCells} flexShrink={0}>
        <Text mono dimColor={!isNow}>{id}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text weight={isNow ? 'semibold' : 'regular'} strikethrough={it.state === '-'} dimColor={it.state === '-'} wrap={width < 60 ? 'truncate-end' : 'wrap'}>
          {bidi(it.title, where)}
        </Text>
      </Box>
      {it.notes.length > 0 && <Box flexShrink={0} gap={1}>{noteEls(el, it.notes)}</Box>}
    </Box>
  )
}

function caption(el: Els, text: string) {
  const { Text } = el
  return (
    <Text size="caption" weight="semibold" dimColor>
      {text}
    </Text>
  )
}

function lists(el: Els, plan: Plan, where: Where, width: number, isAll: boolean) {
  const { Box, Text } = el
  const now = findNow(plan)
  const w = waiting(plan)
  const b = blocked(plan)
  const parts = [] as ReturnType<typeof caption>[]
  if (w.length) {
    parts.push(
      <Box key="waits" flexDirection="column">
        {caption(el, `WAITS ON YOU · ${w.length}`)}
        {w.map(it => rowOf(el, it, false, where, width))}
      </Box>,
    )
  }
  if (b.length) {
    parts.push(
      <Box key="blocked" flexDirection="column">
        {caption(el, `BLOCKED · ${b.length}`)}
        {b.map(it => rowOf(el, it, false, where, width))}
      </Box>,
    )
  }
  if (now) {
    const s = now.step
    const kids = s.children.filter(k => k.state !== '-')
    const share = kids.length ? ` · ${kids.filter(k => k.state === 'x').length} OF ${kids.length}` : ''
    parts.push(
      <Box key="now" flexDirection="column">
        {caption(el, `NOW · STEP ${s.id || ''}${share}`)}
        <Text size="heading" weight="semibold">
          {bidi(s.title, where)}
        </Text>
        {s.children.length ? s.children.map(k => rowOf(el, k, k === now.item, where, width)) : rowOf(el, s, true, where, width)}
      </Box>,
    )
  } else {
    parts.push(
      <Text key="done" size="heading" weight="semibold">
        Every step is done.
      </Text>,
    )
  }
  const next = isAll ? plan.items.filter(i => !i.isGate) : upNext(plan, 4)
  if (next.length) {
    parts.push(
      <Box key="next" flexDirection="column">
        {caption(el, isAll ? 'EVERY STEP' : 'NEXT')}
        {next.map(it => rowOf(el, it, false, where, width))}
      </Box>,
    )
  }
  return parts
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    root = e.cwd
    await $.command.register({
      name: 'progress',
      description: 'Show the pinned plan\'s progress beside the conversation (pin <file>, hide, unpin)',
      argumentHint: '[pin <file> | hide | unpin]',
    })
    await $.tool.register({
      name: 'progress',
      description:
        'plan-progress: read and update the progress of the pinned plan, a plain Markdown block between <!-- plan-progress --> and <!-- /plan-progress --> whose lines are "- [state] id · title · note". ' +
        'Call read when you pick up a build. Call set as you start a step or sub-step (state "doing") and as you finish it (state "done", with the commit or PR as its note), and "waits" for a decision or gate that needs the person. ' +
        'add puts a missing item after another (after) or as the last sub-step of one (under). pin names the plan file. ' +
        'A write changes only that item\'s line; pass the version read returned and it refuses if the file changed since.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['read', 'set', 'add', 'pin'] },
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

  on('command.run', { command: 'progress' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    if (verb === 'pin') return { text: await pin($, rest.join(' ')) }
    if (verb === 'hide') {
      await hide($)
      return { text: 'Plan progress hidden. /progress brings it back.' }
    }
    if (verb === 'unpin') {
      await update($, pinned, () => null)
      await $.store.delete(pinKey())
      await load($)
      await $.ui.close({ id: PANE }).catch(() => undefined)
      return { text: 'No plan is pinned now.' }
    }
    if (verb && verb !== 'show') return { text: `/progress takes pin <file>, hide or unpin; "${verb}" is none of them.` }
    await show($)
    const s = await read($, snap)
    if (!s) return { text: 'No plan is pinned. /progress pin path/to/plan.md pins one.' }
    return { text: s.plan ? altOf(s.plan) : (s.error ?? 'No plan.') }
  })

  // The agent's tool, and an edit to the pinned file showing at once rather than on the next poll.
  // One hook for both: the session's tool union does not name a plugin's own tool at type time.
  on('tool.call', async ($, e, next) => {
    const tool: string = e.tool
    if (tool === TOOL) return answer(await runTool($, e as unknown as Record<string, unknown>))
    const ran = await next(e)
    if (tool !== 'Edit' && tool !== 'Write' && tool !== 'MultiEdit') return ran
    const path = await read($, pinned)
    const target = (e as unknown as { file_path?: unknown }).file_path
    if (path && typeof target === 'string' && (target === path || path.endsWith(`/${target.replace(/^\.\//, '')}`))) {
      await load($).catch(() => undefined)
    }
    return ran
  }).catch(($, e, next) => {
    const tool: string = e.tool
    return tool === TOOL ? answer('plan-progress failed before writing anything. Read the plan again and retry.') : next(e)
  })

  // The band: one quiet line above the prompt. A press opens the pane.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    if (e.props.hasSurvey || !s?.plan || (await read($, isHidden))) return next(e)
    const plan = s.plan
    const c = count(plan)
    const now = findNow(plan)
    const w = waiting(plan).length
    const where: Where = e.surface === 'terminal' ? ((await read($, env)).isTermLogical ? 'terminal-logical' : 'terminal') : 'desktop'
    const cols = e.props.bodyColumns
    const title = bidi((plan.title || 'Plan').split(' · ')[0] ?? 'Plan', where)
    const nowText = now ? ` · now ${now.item.id || ''} ${bidi(now.item.title, where)}` : ' · every step done'
    const waitText = w ? ` · ◆ ${w} ${w === 1 ? 'waits' : 'wait'} on you` : ''
    const below = await next(e)
    const openPane = () => {
      show($).catch(() => undefined)
    }
    if (e.surface === 'desktop') {
      const { Box, Button, Svg, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap="sm" alignItems="center">
            <Svg source={bandSvg(plan)} alt={altOf(plan)} width={120} height={12} />
            <Button key="open" plain onPress={openPane}>
              <Text weight="semibold">{title}</Text>
              <Text dimColor>{` ${c.pct}%${nowText}`}</Text>
              {w > 0 && <Text color={COLOR.blue}>{waitText}</Text>}
            </Button>
          </Box>
          {below}
        </Box>
      )
    }
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const barCells = Math.max(8, Math.min(34, Math.floor(cols / 4)))
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text weight="semibold">{title}</Text>
          {runsEl(els, barRuns(plan, barCells))}
          <Box flexShrink={1}>
            <Text wrap="truncate-end">{`${c.pct}%${nowText}`}</Text>
          </Box>
          {w > 0 && <Text color={COLOR.blue}>{waitText.replace(/^ · /, '')}</Text>}
        </Box>
        {below}
      </Box>
    )
  })

  // The pane: the press line, what waits on you, the step in progress, what comes next.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = await read($, snap)
    const els = $.ui.resolve(e)
    const { Box, Button, Link, Text } = els
    const el: Els = { Box, Button, Link, Text }
    const Input = 'Input' in els ? els.Input : null
    const isAll = await read($, showAll)
    const pinningNow = await read($, isPinning)
    const m = await read($, moment)
    await read($, minute)
    const now = await $.clock.now()
    const cols = e.props.bodyColumns
    const where: Where = e.surface === 'terminal' ? ((await read($, env)).isTermLogical ? 'terminal-logical' : 'terminal') : 'desktop'

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
        <Button key="hide" label="Hide" onPress={() => hide($).catch(() => undefined)} />
        <Button key="pin" label={pinningNow ? 'Cancel' : 'Pin another plan'} onPress={() => update($, isPinning, v => !v).catch(() => undefined)} />
        {s?.plan && (
          <Button key="all" label={isAll ? 'Fewer steps' : `Every step (${s.plan.items.length})`} onPress={() => update($, showAll, v => !v).catch(() => undefined)} />
        )}
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
    const c = count(plan)
    const fileName = s.path.split('/').pop() ?? s.path
    const meta = (
      <Text mono size="caption" dimColor wrap="truncate-start">
        {`${s.path} · ${ago(s.mtimeMs, now)}`}
      </Text>
    )

    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      const width = Math.max(300, Math.min(1100, Math.round(cols * 7.2)))
      const isLive = m !== null && m.until > now
      const svg = pressSvg(plan, {
        width,
        fileName,
        settleLine: isLive && m?.kind === 'step' ? Number(m.id) : undefined,
        isWipe: isLive && m?.kind === 'plan',
      })
      return (
        <Box flexDirection="column" gap="md">
          <Svg source={svg} alt={`${altOf(plan)} ${COUNT_RULE}`} isInteractive />
          {lists(el, plan, where, cols, isAll)}
          {pinBox}
          {meta}
          {buttons}
        </Box>
      )
    }

    // The terminal: the same story in characters.
    const now2 = findNow(plan)
    const barCells = Math.max(12, cols - 2)
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text weight="semibold" wrap="truncate-end">
              {bidi(plan.title || 'Plan', where)}
            </Text>
            <Text weight="semibold">{`${c.pct}%`}</Text>
          </Box>
          {runsEl(el, barRuns(plan, barCells))}
          <Text dimColor>{`${c.done} of ${c.total} steps done${now2 ? ` · now ${now2.item.id || bidi(now2.item.title, where)}` : ''}`}</Text>
        </Box>
        {lists(el, plan, where, cols, isAll)}
        {pinBox}
        {meta}
        {buttons}
      </Box>
    )
  })
}

