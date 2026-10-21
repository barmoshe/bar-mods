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
const DOCK = { ...PANE, props: { ...PANE.props, bodyColumns: 41 } } as const

type Disk = { text: string; mtimeMs: number; writes: number; toasts: string[]; opened: string[]; ran: string[][]; filled: string[] }

// A file system of one file, a store, a clock, git commits from Bash, and the engine's own drawing beneath.
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
  on('prompt.fill', ($: any, e: any) => {
    disk.filled.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
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
  // Bash: a `git commit` comes back with the engine's own record of the commit
  on('tool.call', ($: any, e: any) => {
    if (e.tool !== 'Bash') return { result: 'ok' }
    const m = /#sha:(\w+)/.exec(e.command)
    return { result: { stdout: '', stderr: '', interrupted: false, ...(m ? { gitOperation: { commit: { sha: `${m[1]}0000000000`, kind: 'committed' } } } : {}) } }
  })
  return clock
}

const fresh = (text = PLAN_3_1): Disk => ({ text, mtimeMs: 500_000, writes: 0, toasts: [], opened: [], ran: [], filled: [] })
const start = ($: any) => $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
const tool = async ($: any, input: Record<string, unknown>): Promise<string> => {
  const out: any = await $.tool.call({ tool: 'mcp__plan-progress__progress', ...input })
  return out.result[0].text
}
const commit = ($: any, sha: string, message: string) =>
  $.tool.call({ tool: 'Bash', command: `git commit -m "${message}" #sha:${sha}`, description: 'Commit the step' })
const lineOf = (text: string, id: string) => text.split('\n').find(l => new RegExp(`\\] ${id} ·`).test(l)) ?? ''

test('a session with a pinned plan reads it, opens the pane, and its read says the gates are ahead', async ($, on) => {
  const disk = fresh()
  rig(on, disk)
  await start($)
  expect(disk.opened).toEqual(['plan-progress'])
  const text = await tool($, { action: 'read' })
  expect(text.split('\n')[0]).toBe('Version 3.1 · trainer studio: 23%, 3 of 15 steps done (/work/progress-3-1.md).')
  expect(text).toContain('Gates ahead, not yet due: terraform apply')
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
  expect(disk.text.split('\n').filter((l, i) => l !== before[i])).toHaveLength(3)
  expect(disk.toasts).toEqual(['Step 2 done · 4 of 15'])
})

test('a write is refused when the file changed since the agent read it', async ($, on) => {
  const disk = fresh()
  rig(on, disk)
  await start($)
  const version = Number(/version: (\d+)/.exec(await tool($, { action: 'read' }))?.[1])
  disk.text = disk.text.replace('- [ ] 9 · The look', '- [ ] 9 · The look, again')
  disk.mtimeMs += 7000
  expect(await tool($, { action: 'set', item: '3', state: 'doing', version })).toContain('The file changed since you read it')
  expect(disk.writes).toBe(0)
  await tool($, { action: 'set', item: '3', state: 'doing' })
  expect(disk.text).toContain('- [ ] 9 · The look, again')
  expect(disk.text).toContain('- [~] 3 · An exercise not on the list')
})

test('a commit that names a step not started marks it in progress, and its time is the start', async ($, on) => {
  const disk = fresh()
  const clock = rig(on, disk)
  await start($)
  await clock.advance(5 * 60_000)
  const ran: any = await commit($, '69b4cc8', 'feat(drafts): an exercise not on the list (3.1 step 3)')
  expect(ran.context).toBeUndefined()
  expect(lineOf(disk.text, '3')).toBe('- [~] 3 · An exercise not on the list')
  // a commit that names nothing in the plan changes nothing
  const writes = disk.writes
  await commit($, '85e7646', 'chore: backups are git-ignored')
  expect(disk.writes).toBe(writes)
})

test('when the commits move past an open item the agent is told once, and the pane offers to close it', async ($, on) => {
  const disk = fresh()
  const clock = rig(on, disk)
  await start($)
  await commit($, '3e11fec', 'feat(exceptions): the editor draft (3.1 step 2d)')
  await clock.advance(10 * 60_000)
  const ran: any = await commit($, '788f152', 'feat(exceptions): lines waiting (3.1 step 2e)')
  expect(ran.context).toHaveLength(1)
  expect(ran.context[0]).toContain('still has 2d · The editor\'s draft and the save\'s list in progress, but your commits have moved on to 2e')
  // 2e was not started: the commit started it
  expect(lineOf(disk.text, '2e')).toContain('[~] 2e')
  // told once
  await clock.advance(60_000)
  const again: any = await commit($, '5a78272', 'test(exceptions): checks (3.1 step 2e)')
  expect(again.context).toBeUndefined()

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...DOCK, surface })
    expect(await ui.find({ type: 'Text', text: 'THE PLAN IS BEHIND' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2d looks done: the commits moved on to 2e 1 min ago. Claude was told.' })).toBeDefined()
    await ui.unmount()
  }
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: '⟳ the plan is behind: 2d looks done (work moved to 2e)' })).toBeDefined()
  const pane = await $.ui.mount({ ...DOCK, surface: 'desktop' })
  await pane.press({ key: 'close-2d>2e' })
  expect(lineOf(disk.text, '2d')).toContain('[x] 2d')
  expect(await pane.find({ type: 'Text', text: 'THE PLAN IS BEHIND' })).toBeUndefined()
})

test('"Not yet" waves a lag off for good', async ($, on) => {
  const disk = fresh()
  const clock = rig(on, disk)
  await start($)
  await commit($, '3e11fec', 'feat: the draft (3.1 step 2d)')
  await clock.advance(60_000)
  await commit($, '788f152', 'feat: lines (3.1 step 2e)')
  const pane = await $.ui.mount({ ...DOCK, surface: 'desktop' })
  await pane.press({ key: 'keep-2d>2e' })
  expect(await pane.find({ type: 'Text', text: 'THE PLAN IS BEHIND' })).toBeUndefined()
  expect(lineOf(disk.text, '2d')).toContain('[~] 2d')
})

test('the brief, in the dock, on both surfaces: where, the gates ahead quietly, now, next, done', async ($, on) => {
  const disk = fresh()
  rig(on, disk)
  await start($)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...DOCK, surface })
    await ui.drawn()
    expect(await ui.find({ type: 'Text', text: 'NEEDS YOU NOW' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '◇ 3 gates ahead, after PR: terraform apply, The merge, staging-days.py --apply, the epoch' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'NOW · 3 OF 6' })).toBeDefined()
    // the macOS terminals get Hebrew in visual order
    expect(await ui.find({ type: 'Text', text: surface === 'desktop' ? '2 · Exceptions and "שמור"' : '2 · Exceptions and "רומש"' })).toBeDefined()
    // done sub-steps leave the now block; the open ones stay
    expect(await ui.find({ type: 'Text', text: 'Tables, codec, rules' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'The checks' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'NEXT' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'DONE · 3' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'F  K  1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'progress-3-1.md' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'changed 8 min ago' })).toBeDefined()
    if (surface === 'desktop') expect(JSON.stringify(await ui.drawn())).toContain('>3<tspan class=\\"i2\\" font-size=\\"20\\" dx=\\"6\\" letter-spacing=\\"-.4\\">of 15 done<')
    else expect(await ui.find({ type: 'Text', text: '3 of 15 done' })).toBeDefined()
    await ui.press({ key: 'all' })
    expect(await ui.find({ type: 'Text', text: 'EVERY STEP' })).toBeDefined()
    await ui.press({ key: 'all' })
    await ui.unmount()
  }
})

test('once the gates are due they need you, in the pane and the band, with the word one press away', async ($, on) => {
  const due = PLAN_3_1.replace(/^- \[[ ~]\] (?!gate)/gm, '- [x] ').replace(/^(\s+)- \[[ ~]\] /gm, '$1- [x] ')
  const disk = fresh(due)
  rig(on, disk)
  await start($)
  const ui = await $.ui.mount({ ...DOCK, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'NEEDS YOU NOW · 3' })).toBeDefined()
  await ui.press({ key: `word-${due.split('\n').findIndex(l => l.includes('gate · terraform apply'))}` })
  expect(disk.filled).toEqual(['Go ahead with terraform apply.'])
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: 'terraform apply needs your word' })).toBeDefined()
})

test('a note in prose reads in the app\'s font; a commit or a PR in mono', async ($, on) => {
  const disk = fresh(PLAN_3_1.replace('  - [ ] 2e · Exceptions on the trainee page, "היום", the workout window', '  - [ ] 2e · Exceptions on the trainee page · the add at 150×26 stopped at 900 of 9483'))
  rig(on, disk)
  await start($)
  const ui = await $.ui.mount({ ...DOCK, surface: 'desktop' })
  expect(JSON.stringify(await ui.drawn())).toContain('{"type":"Text","props":{"dimColor":true,"wrap":"wrap"},"children":["the add at 150×26 stopped at 900 of 9483"]}')
  await ui.press({ key: 'all' })
  expect(JSON.stringify(await ui.drawn())).toContain('{"type":"Text","props":{"mono":true,"dimColor":true,"wrap":"wrap"},"children":["POC #64"]}')
})

test('the live line says what the agent is doing while it works, and leaves when the turn ends', async ($, on) => {
  const disk = fresh()
  rig(on, disk)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'npm run check', description: 'Run the emulator and browser suites' } as any)
  const ui = await $.ui.mount({ ...DOCK, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Claude · Run the emulator and browser suites' })).toBeDefined()
  await $.tool.call({ tool: 'Read', file_path: '/work/src/codec.ts' } as any)
  expect(await ui.find({ type: 'Text', text: 'Claude · reading codec.ts' })).toBeDefined()
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 1000, isAborted: false, reason: 'answer' } as any)
  expect(await ui.find({ type: 'Text', text: /^Claude · / })).toBeUndefined()
})

test('the band: step and time on the desktop and the terminal, yielding when hidden', async ($, on) => {
  const disk = fresh()
  rig(on, disk)
  await start($)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.drawn()
    expect(await ui.find({ type: 'Text', text: '3/15 done' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: surface === 'desktop' ? ' · 2 Exceptions and "שמור"' : ' · 2 Exceptions and "רומש"' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
    await ui.unmount()
  }
  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await desk.find({ type: 'Svg' })).toBeDefined()
  await $.command.run({ command: 'progress', args: 'hide' })
  expect(await desk.find({ type: 'Text', text: '3/15 done' })).toBeUndefined()
  const shown = await $.command.run({ command: 'progress', args: '' })
  expect(shown.text).toContain('3 of 15 done (23%), now 2d')
})

test('pace shows once two steps were seen start and finish, as a range', async ($, on) => {
  const disk = fresh()
  const clock = rig(on, disk)
  await start($)
  const advance = async (min: number, from: RegExp | string, to: string) => {
    await clock.advance(min * 60_000)
    disk.text = disk.text.replace(from, to)
    disk.mtimeMs += 1000
    await clock.advance(2100)
  }
  await advance(1, '- [ ] 3 · An exercise', '- [~] 3 · An exercise')
  await advance(40, '- [~] 3 · An exercise', '- [x] 3 · An exercise')
  await advance(1, '- [ ] S · Ladders', '- [~] S · Ladders')
  await advance(60, '- [~] S · Ladders', '- [x] S · Ladders')
  const ui = await $.ui.mount({ ...DOCK, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'PACE' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'a step takes 40-60 min · 10 left: about 7-10 h' })).toBeDefined()
})

test('a hand edit shows within a poll', async ($, on) => {
  const disk = fresh()
  const clock = rig(on, disk)
  await start($)
  disk.text = disk.text.replace('  - [~] 2d ·', '  - [x] 2d ·').replace('  - [ ] 2e ·', '  - [~] 2e ·')
  disk.mtimeMs += 3000
  await clock.advance(2100)
  const ui = await $.ui.mount({ ...DOCK, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'NOW · 4 OF 6' })).toBeDefined()
})

test('a /progress that arrives as a prompt is answered and dropped, with no turn; other prompts pass', async ($, on) => {
  const disk = fresh()
  rig(on, disk)
  await start($)
  const hid: any = await $.prompt.submit({ text: '/progress hide', wait: false } as any)
  expect(hid.drop).toBe('Plan progress hidden. /progress brings it back.')
  const shown: any = await $.prompt.submit({ text: '/plan-progress:progress', wait: false } as any)
  expect(shown.drop).toContain('Version 3.1 · trainer studio: 3 of 15 done')
  const other: any = await $.prompt.submit({ text: 'what is the progress here?', wait: false } as any)
  expect(other.drop).toBeUndefined()
})

test('Open the file runs the opener on the desktop; the terminal gets a link', async ($, on) => {
  const disk = fresh()
  rig(on, disk)
  await start($)
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await desk.press({ key: 'open-file' })
  expect(disk.ran).toEqual([['open', PATH]])
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Link', text: 'Open the file' })).toBeDefined()
})
