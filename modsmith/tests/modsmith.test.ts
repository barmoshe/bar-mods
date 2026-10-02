import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'modsmith',
  component: 'Pane',
  requestId: 'modsmith',
  viewport: { columns: 180, rows: 50 },
  props: {
    title: 'modsmith',
    isFocused: false,
    bodyColumns: 90,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'modsmith',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 120, rows: 30 },
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

const VALIDATE_OK = [
  '  ❯ ./register.tsx hooks: session.start, tool.call',
  '  ❯ ./register.tsx calls: $.ui.toast',
  '',
  '✔ Validation passed',
].join('\n')

// Answers every $ call the gates make, keyed on argv.
const stubGates = (on: any, opts: { testsExit: number; readme: string; typesExist?: boolean }) => {
  on('process.run', ($: any, e: any) => {
    const argv: string[] = e.argv
    if (argv[1] === '--version') return { value: { exitCode: 0, stdout: '2.1.288 (Claude Code)', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv[1] === 'plugin' && argv[2] === 'validate') return { value: { exitCode: 0, stdout: VALIDATE_OK, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv.includes('tsc')) return { value: { exitCode: 2, stdout: "tests/x.test.ts(1,1): error TS2322: loose stub", stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv[1] === 'plugin' && argv[2] === 'test') return { value: { exitCode: opts.testsExit, stdout: opts.testsExit === 0 ? ' 3 pass\n 0 fail' : '(fail) draws the band\n 1 fail', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 127, stdout: '', stderr: 'unexpected', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.version', () => ({ value: { version: '2.1.288' } }))
  on('fs.exists', () => ({ value: opts.typesExist !== false }))
  on('fs.read', ($: any, e: any) => ({
    value: e.path.endsWith('README.md') ? opts.readme : JSON.stringify({ name: 'my-mod', version: '0.1.0' }),
  }))
}

test('a tool call is recorded and its result passes through unchanged', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  on('tool.call', () => ({ result: 'ran for real' }))

  const out = await $.tool.call({ tool: 'Bash', command: 'ls -la' })
  expect(out).toEqual({ result: 'ran for real' })

  const events: any = await $.tool.call({ tool: 'mcp__modsmith__events', event: 'tool.' } as any)
  const body: string = events.result[0].text
  expect(body).toContain('## tool.call · Bash ls -la · ok')
  expect(body).toContain('"command": "ls -la"')
})

test('secrets in a payload never reach the tape', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.tool.call({ tool: 'Bash', command: 'curl -H "Authorization: Bearer abcdef1234567890xyz" https://x' })
  const events: any = await $.tool.call({ tool: 'mcp__modsmith__events' } as any)
  expect(events.result[0].text).not.toContain('abcdef1234567890xyz')
})

const other = {
  name: 'other',
  register(on: any) {
    on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any) => {
      const { Button } = $.ui.resolve(e)
      return h(Button, { key: 'go', label: 'Go', onPress: () => undefined })
    })
  },
}

test("another mod's load and button press reach the roster and the tape", { plugins: [other] }, async ($, on) => {
  mock.clock(on)
  on('session.id', () => ({ value: 'abc' }))
  on('settings.read', () => ({ value: { enabledPlugins: { 'turn-meter@bar-mods': true, 'off@x': false } } }))

  const band = await $.ui.mount({ ...BAND, plugin: 'other', surface: 'terminal' })
  await band.press({ key: 'go' })

  const mods: any = await $.tool.call({ tool: 'mcp__modsmith__mods' } as any)
  const roster = JSON.parse(mods.result[0].text)
  expect(roster.map((m: any) => `${m.name}:${m.source}`)).toEqual(['other:seen', 'turn-meter:installed'])
  expect(roster[0].events).toEqual(['ui.render'])

  const events: any = await $.tool.call({ tool: 'mcp__modsmith__events', event: 'ui.press' } as any)
  expect(events.result[0].text).toContain('other:go in AbovePrompt')
})

test('/gates reports each gate, ignores tsc errors in tests/, and flags a stale README', async ($, on) => {
  mock.clock(on)
  stubGates(on, { testsExit: 1, readme: '# my-mod\nhooks: `session.start`' })

  const answer = await $.command.run({ command: 'gates', args: '/work/my-mod' } as any)
  expect(answer.text).toContain('✓ validate')
  expect(answer.text).toContain('✓ types')
  expect(answer.text).toContain('1 error(s) in tests/ ignored')
  expect(answer.text).toContain('✗ tests')
  expect(answer.text).toContain('(fail) draws the band')
  expect(answer.text).toContain('! README footprint is stale: tool.call, ui.toast')
})

test('the gates tool tells you how to get types when none were generated', async ($, on) => {
  mock.clock(on)
  stubGates(on, { testsExit: 0, readme: 'session.start tool.call ui.toast', typesExist: false })

  const out: any = await $.tool.call({ tool: 'mcp__modsmith__gates', dir: '/work/my-mod', only: ['types'] } as any)
  expect(out.result[0].text).toContain('✗ types: no generated types yet; load the mod once')
})

test('the pane draws gates, tape and the picked payload on both surfaces, and a narrow view', async ($, on) => {
  mock.clock(on)
  stubGates(on, { testsExit: 0, readme: 'session.start tool.call ui.toast' })
  on('tool.call', () => ({ result: 'ok' }))
  await $.tool.call({ tool: 'Read', file_path: '/work/README.md' })
  await $.command.run({ command: 'gates', args: '/work/my-mod' } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'Gates · my-mod' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^✓ tests/ })).toBeDefined()
    // The first recorded entry: clock at 0, sequence 1.
    expect(await ui.find({ key: 'row-0-1' })).toBeDefined()
    await ui.press({ key: 'row-0-1' })
    expect(await ui.find({ key: 'payload' })).toBeDefined()
    await ui.press({ key: 'row-0-1' })
    await ui.unmount()
  }

  const narrow = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 40 } })
  expect(await narrow.find({ type: 'Text', text: 'Gates · my-mod' })).toBeDefined()
  expect(await narrow.find({ key: 'pause' })).toBeUndefined()
})

const devMod = {
  name: 'my-mod',
  register(on: any) {
    on('session.start', async ($: any, e: any, next: any) => next(e))
    on('tool.call', async ($: any, e: any, next: any) => next(e))
  },
}

test('the band shows a dev mod reload until the next prompt, above any other band', { plugins: [devMod] }, async ($, on) => {
  const clock = mock.clock(on)
  stubGates(on, { testsExit: 0, readme: '' })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['the band beneath'] }))

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.unmount()
  await clock.advance(10)
  await clock.settle()

  const shown = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await shown.find({ type: 'Text', text: '↻ my-mod reloaded · 2 hooks · validate ✓' })).toBeDefined()
  expect(await shown.find({ type: 'Text', text: 'the band beneath' })).toBeDefined()
  await shown.unmount()

  await $.prompt.submit({ text: 'next', wait: false } as any)
  const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /reloaded/ })).toBeUndefined()
  expect(await after.find({ type: 'Text', text: 'the band beneath' })).toBeDefined()
})
