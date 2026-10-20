import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'turn-meter',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 120, rows: 30 },
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

const ENGINE_DRAWS = { type: 'Text', props: {}, children: ['drawn by Claude Code'] }

test('the band sums up the last turn by tool', async ($, on) => {
  const clock = mock.clock(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ENGINE_DRAWS)

  await $.prompt.submit({ text: 'go', wait: false })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Read', file_path: '/work/README.md' })
  await $.tool.call({ tool: 'Bash', command: 'pwd' })
  await clock.advance(42_000)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 42_000, isAborted: false, reason: 'answer' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: 'Last turn: 42s, 3 tool calls (Bash 2, Read 1)' })).toBeDefined()
    // the bands beneath still draw, under this one
    expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
    await ui.unmount()
  }
})

test('a subagent ending does not replace the main turn', async ($, on) => {
  const clock = mock.clock(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ENGINE_DRAWS)

  await $.prompt.submit({ text: 'go', wait: false })
  await $.tool.call({ tool: 'Grep', pattern: 'x' })
  await clock.advance(5_000)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 5_000, isAborted: false, reason: 'answer' })
  await clock.advance(1_000)
  await $.turn.complete({ turnId: 's1', agentId: 'sub', answer: '', durationMs: 1_000, isAborted: false, reason: 'answer' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'Last turn: 5s, 1 tool calls (Grep 1)' })).toBeDefined()
})

test('Hide yields the band to Claude Code, and /turn-meter brings it back', async ($, on) => {
  const clock = mock.clock(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ENGINE_DRAWS)

  await $.prompt.submit({ text: 'hi', wait: false })
  await clock.advance(1_000)
  await $.turn.complete({ turnId: 't1', answer: 'hello', durationMs: 1_000, isAborted: false, reason: 'answer' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'hide' })
  expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()

  const shown = await $.command.run({ command: 'turn-meter', args: '' })
  expect(shown.text).toBe('Turn meter shown.')
})
