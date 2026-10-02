import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'mission-control',
  component: 'Pane',
  requestId: 'mission-control',
  viewport: { columns: 160, rows: 40 },
  props: {
    title: 'Mission Control',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const USAGE = {
  value: {
    startedAt: 0,
    context: { window: 200_000, tokens: 50_000, percent: 25 },
    rateLimits: [],
    cost: { usd: 1.5 },
  },
}

const NO_USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

test('/mission opens the pane, and session start registers the command', async ($, on) => {
  const opened: string[] = []
  const registered: string[] = []
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => {
    registered.push(e.name)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })

  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  const answer = await $.command.run({ command: 'mission', args: '' })

  expect(registered).toEqual(['mission'])
  expect(opened).toEqual(['mission-control', 'mission-control'])
  expect(answer.text).toBe('Mission Control is open.')
})

test('tool calls, edits and cost reach the pane on both surfaces', async ($, on) => {
  on('session.usage', () => USAGE)
  on('tool.call', ($, e) => (e.tool === 'Bash' && e.command === 'false' ? { result: 'exit 1', isError: true } : { result: 'ok' }))

  await $.tool.call({ tool: 'Read', file_path: '/work/src/app.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/src/app.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'false' })

  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desktop.find({ type: 'Text', text: '3 tool calls · 0 turns · 1 files edited · 1 errors' })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: '✎ app.ts' })).toBeDefined()
  expect(await desktop.find({ type: 'Svg' })).toBeDefined()
  await desktop.unmount()

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.find({ type: 'Text', text: '$1.50 spent' })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /^context █+░+ 25%$/ })).toBeDefined()
})

test('the commentator calls the turn after it ends, and Mute stops it', async ($, on) => {
  const clock = mock.clock(on)
  const prompts: string[] = []
  on('session.usage', () => USAGE)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  on('model.complete', ($, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, text: 'What a play — Bash from deep!', usage: NO_USAGE } }
  })

  await $.prompt.submit({ text: 'fix it', wait: false })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.advance(3_000)
  await $.turn.complete({ turnId: 't1', answer: 'Fixed.', durationMs: 3_000, isAborted: false, reason: 'answer' })
  await clock.advance(50)
  await clock.settle()

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('Bash(npm test)')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // The narrator's em dash is rewritten to a comma.
  expect(await ui.find({ type: 'Text', text: 'T1  What a play, Bash from deep!' })).toBeDefined()

  await ui.press({ key: 'toggle' })
  await $.prompt.submit({ text: 'again', wait: false })
  await $.turn.complete({ turnId: 't2', answer: 'Done.', durationMs: 10, isAborted: false, reason: 'answer' })
  await clock.advance(50)
  await clock.settle()
  expect(prompts.length).toBe(1)
})
