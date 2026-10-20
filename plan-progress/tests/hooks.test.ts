import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PLAN_3_1 } from './fixture'

const PATH = '/work/progress-3-1.md'
const ENGINE_DRAWS = { type: 'Text', props: {}, children: ['drawn by Claude Code'] }
const VIEW = { columns: 160, rows: 48 }
const BAND = {
  plugin: 'plan-progress',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: VIEW,
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 110, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const
const PANE = {
  plugin: 'plan-progress',
  component: 'Pane',
  requestId: 'plan-progress',
  viewport: VIEW,
  props: { title: 'Plan progress', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

type Disk = { text: string; mtimeMs: number; writes: number; toasts: string[]; opened: string[]; ran: string[][] }

// A file system of one file, a store, a clock, and the engine's own drawing beneath the plugin.
function rig(on: On, disk: Disk) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, { 'pin:/work': PATH })
  mock.env(on, { HOME: '/Users/bar', TERM_PROGRAM: 'Apple_Terminal' })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.version', () => ({ value: { version: '2.1.299', base: '2.1.299', builtAt: '' } }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('ui.open', ($, e) => {
    disk.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    disk.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => ENGINE_DRAWS)
  on('fs.stat', ($, e) => {
    if (e.path !== PATH) throw new Error(`ENOENT: ${e.path}`)
    return { value: { kind: 'file', size: disk.text.length, mtimeMs: disk.mtimeMs, isLink: false, ...(e.resolve ? { realPath: PATH } : {}) } }
  })
  on('fs.read', ($, e) => {
    if (e.path !== PATH) throw new Error(`ENOENT: ${e.path}`)
    return { value: disk.text }
  })
  on('fs.write', ($, e) => {
    disk.text = e.text
    disk.mtimeMs += 1000
    disk.writes += 1
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    disk.ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return clock
}

const fresh = (): Disk => ({ text: PLAN_3_1, mtimeMs: 500_000, writes: 0, toasts: [], opened: [], ran: [] })
const start = ($: any) => $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
const tool = async ($: any, input: Record<string, unknown>): Promise<string> => {
  const out: any = await $.tool.call({ tool: 'mcp__plan-progress__progress', ...input })
  return out.result[0].text
}

test('a session in a project with a pinned plan reads it and opens the pane', async ($, on) => {
  const disk = fresh()
  rig(on, disk)
  await start($)
  expect(disk.opened).toEqual(['plan-progress'])
  const text = await tool($, { action: 'read' })
  expect(text.split('\n')[0]).toBe('Version 3.1 · trainer studio: 23%, 3 of 15 steps done (/work/progress-3-1.md).')
  expect(text).toContain('version: 500000')
})

test('set writes one line, and a step turning done raises one toast', async ($, on) => {
  const disk = fresh()
  rig(on, disk)
  await start($)
  const before = disk.text.split('\n')
  for (const id of ['2d', '2e']) await tool($, { action: 'set', item: id, state: 'done' })
  expect(disk.toasts).toEqual([])
  const out = await tool($, { action: 'set', item: '2f', state: 'done', note: '`abc1234`' })
  expect(out).toContain('Wrote line 15:   - [x] 2f · The checks · `abc1234`')
  const after = disk.text.split('\n')
  expect(after.filter((l, i) => l !== before[i])).toHaveLength(3)
  // the step's own line still says [~]: its sub-steps fill it, and the toast says so
  expect(disk.toasts).toEqual(['Step 2 done · 4 of 15'])
})

test('a write is refused when the file changed since the agent read it', async ($, on) => {
  const disk = fresh()
  rig(on, disk)
  await start($)
  const read = await tool($, { action: 'read' })
  const version = Number(/version: (\d+)/.exec(read)?.[1])
  // Bar edits the file by hand
  disk.text = disk.text.replace('- [ ] 9 · The look', '- [ ] 9 · The look, again')
  disk.mtimeMs += 7000
  const out = await tool($, { action: 'set', item: '3', state: 'doing', version })
  expect(out).toContain('The file changed since you read it')
  expect(disk.writes).toBe(0)
  // without a version the edit goes onto the file as it is now, the hand edit kept
  await tool($, { action: 'set', item: '3', state: 'doing' })
  expect(disk.text).toContain('- [ ] 9 · The look, again')
  expect(disk.text).toContain('- [~] 3 · An exercise not on the list')
})

test('add and pin answer in plain words', async ($, on) => {
  const disk = fresh()
  rig(on, disk)
  await start($)
  const added = await tool($, { action: 'add', id: '2g', title: 'A late sub-step', after: '2f' })
  expect(added).toContain('Wrote line 16:   - [ ] 2g · A late sub-step')
  const bad = await tool($, { action: 'set', item: 'gate', state: 'done' })
  expect(bad).toContain('"gate" matches 3 items')
  const pinned = await tool($, { action: 'pin', path: '/nowhere.md' })
  expect(pinned).toBe('/nowhere.md is not a file.')
})

test('the band draws on the desktop and the terminal, and yields when hidden', async ($, on) => {
  const disk = fresh()
  rig(on, disk)
  await start($)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.drawn()
    expect(await ui.find({ type: 'Text', text: 'Version 3.1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: "23% · now 2d The editor's draft and the save's list" })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '3 wait on you' })).toBeDefined()
    await ui.unmount()
  }
  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await desk.find({ type: 'Svg' })).toBeDefined()
  await $.command.run({ command: 'progress', args: 'hide' })
  expect(await desk.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  const shown = await $.command.run({ command: 'progress', args: '' })
  expect(shown.text).toContain('Version 3.1 · trainer studio: 23%')
})

test('the pane draws on both surfaces: the press line, what waits on you, now, next', async ($, on) => {
  const disk = fresh()
  rig(on, disk)
  await start($)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.drawn()
    expect(await ui.find({ type: 'Text', text: 'WAITS ON YOU · 3' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'NOW · STEP 2 · 3 OF 6' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: "The editor's draft and the save's list" })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'NEXT' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'progress-3-1.md' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'changed 8 min ago' })).toBeDefined()
    if (surface === 'desktop') expect(await ui.find({ type: 'Svg' })).toBeDefined()
    else expect(await ui.find({ type: 'Text', text: 'Version 3.1 · trainer studio' })).toBeDefined()
    await ui.press({ key: 'all' })
    expect(await ui.find({ type: 'Text', text: 'EVERY STEP' })).toBeDefined()
    await ui.press({ key: 'all' })
    await ui.unmount()
  }
})

test('Open the file runs the opener on the desktop; the terminal gets a link', async ($, on) => {
  const disk = fresh()
  rig(on, disk)
  await start($)
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await desk.press({ key: 'open-file' })
  expect(disk.ran).toEqual([['open', PATH]])
  await desk.unmount()
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Link', text: 'Open the file' })).toBeDefined()
  expect(await term.find({ type: 'Button', key: 'open-file' })).toBeUndefined()
})

test('a hand edit shows within a poll', async ($, on) => {
  const disk = fresh()
  const clock = rig(on, disk)
  await start($)
  disk.text = disk.text.replace('  - [~] 2d ·', '  - [x] 2d ·').replace('  - [ ] 2e ·', '  - [~] 2e ·')
  disk.mtimeMs += 3000
  await clock.advance(2100)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'NOW · STEP 2 · 4 OF 6' })).toBeDefined()
})

test('in the desktop dock (about 45 cells) the title wraps and notes sit under their titles', async ($, on) => {
  const disk = fresh()
  rig(on, disk)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 41 } })
  const tree = JSON.stringify(await ui.drawn())
  // the SVG's title: two lines, nothing cut
  expect(tree).toContain('>Version 3.1 ·<')
  expect(tree).toContain('>trainer studio<')
  // 2b's commit is a line under its title, inside the title's column
  const row = (await ui.drawn()) as any
  const find = (n: any): any => (n?.props?.key === 'row-10' ? n : (n?.children ?? []).map(find).find(Boolean))
  const r = find(row)
  expect(r.children).toHaveLength(3)
  expect(JSON.stringify(r.children[2])).toContain('576579b')
})

test('a step with no sub-steps in progress: its title is the heading once, then its mark and notes', async ($, on) => {
  const disk = fresh()
  disk.text = PLAN_3_1.replace(/^(\s*)- \[[ ~]\] (2[a-f]?) ·/gm, '$1- [x] $2 ·').replace('- [ ] 3 · An exercise not on the list', '- [~] 3 · An exercise not on the list · `abc1234`, checks running')
  rig(on, disk)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'NOW · STEP 3' })).toBeDefined()
  // once, as the heading: no row repeats it under the heading
  expect(await ui.findAll({ type: 'Text', text: 'An exercise not on the list' })).toHaveLength(1)
  expect(await ui.find({ key: 'row-15' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'abc1234, checks running' })).toBeDefined()
})

test('a /progress that arrives as a prompt is answered and dropped, with no turn; other prompts pass', async ($, on) => {
  const disk = fresh()
  rig(on, disk)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await start($)
  const hid: any = await $.prompt.submit({ text: '/progress hide', wait: false } as any)
  expect(hid.drop).toBe('Plan progress hidden. /progress brings it back.')
  const shown: any = await $.prompt.submit({ text: '/plan-progress:progress', wait: false } as any)
  expect(shown.drop).toContain('Version 3.1 · trainer studio: 23%')
  const other: any = await $.prompt.submit({ text: 'what is the progress here?', wait: false } as any)
  expect(other.drop).toBeUndefined()
  expect(other.text).toBe('what is the progress here?')
})

test('/plan-progress:progress answers like /progress, and the tool shows, hides and unpins', async ($, on) => {
  const disk = fresh()
  rig(on, disk)
  await start($)
  const long = await $.command.run({ command: 'plan-progress:progress', args: '' } as any)
  expect(long.text).toContain('Version 3.1 · trainer studio: 23%')
  expect(await tool($, { action: 'hide' })).toBe('Plan progress hidden. /progress brings it back.')
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  expect(await tool($, { action: 'show' })).toContain('23%')
  expect(await band.find({ type: 'Text', text: 'Version 3.1' })).toBeDefined()
  expect(await tool($, { action: 'unpin' })).toBe('No plan is pinned now.')
  expect(await tool($, { action: 'read' })).toContain('No plan is pinned')
})
