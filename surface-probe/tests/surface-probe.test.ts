import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'surface-probe',
  component: 'Pane',
  requestId: 'surface-probe',
  viewport: { columns: 120, rows: 40 },
  props: { title: 'surface-probe', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('the pane reports the surface and draws the SVG only where there is one', async ($, on) => {
  mock.clock(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: `surface ${surface} · placement dock · bodyColumns 80 · viewport 120x40` })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'send' })).toBeDefined()
    const noSvg = await ui.find({ type: 'Text', text: `no Svg on ${surface}` })
    if (surface === 'terminal') expect(noSvg).toBeDefined()
    else expect(noSvg).toBeUndefined()
    await ui.unmount()
  }
})

test('a press sends Claude one message, and a second press while sending is ignored', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const sent: string[] = []
  let release: () => void = () => undefined
  on('prompt.submit', async (_$: unknown, e: { text: string }) => {
    sent.push(e.text)
    await new Promise<void>(resolve => {
      release = resolve
    })
    return { text: e.text }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const first = ui.press({ key: 'send' })
  const second = ui.press({ key: 'send' })
  await clock.settle()
  release()
  await Promise.all([first, second])
  expect(sent.length).toBe(1)
  expect(sent[0]).toContain('surface-probe: a button press reached the conversation.')
  expect(await ui.find({ type: 'Text', text: 'second press ignored while the first is sending' })).toBeDefined()
})

test('/surface-probe opens the pane without taking the keyboard', async ($, on) => {
  mock.clock(on)
  const opens: Record<string, unknown>[] = []
  on('ui.open', (_$: unknown, e: Record<string, unknown>) => {
    opens.push(e)
    return { value: { isPlaced: true } }
  })
  const r = await $.command.run({ command: 'surface-probe', args: '' } as never)
  expect((r as { text?: string }).text).toBe('surface-probe is open.')
  expect(opens[0]?.focus).toBeUndefined()
})
