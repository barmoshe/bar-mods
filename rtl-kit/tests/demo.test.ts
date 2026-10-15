import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'rtl-kit',
  component: 'Pane',
  requestId: 'rtl-kit',
  viewport: { columns: 120, rows: 40 },
  props: { title: 'rtl-kit', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const RLE = '‫'

function stub(on: any) {
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: 'dark', provider: { kind: 'engine' }, isLocked: false }] }))
}

const texts = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text as string)

test('the gallery draws every section on both surfaces, in the order each surface needs', async ($, on) => {
  mock.clock(on)
  stub(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const first = await texts(ui)
    if (surface === 'desktop') expect(first).toContain(`${RLE}לבקש מ-Claude: 3 בקשות, 10:00–12:00‬`)
    else expect(first).toContain('10:00–12:00 ,תושקב Claude: 3-מ שקבל')
    for (const s of ['parts', 'md', 'svg', 'terminal', 'ruler', 'text']) {
      await ui.press({ key: `tabs:${s}` })
      expect((await texts(ui)).length).toBeGreaterThan(0)
    }
    await ui.press({ key: 'tabs:svg' })
    const svg = await ui.find({ type: 'Svg' })
    if (surface === 'desktop') expect(svg).toBeDefined()
    else expect(svg).toBeUndefined()
    await ui.press({ key: 'tabs:parts' })
    await ui.press({ key: 'p:approve' })
    expect((await texts(ui)).some((t: string) => t.includes('approve'))).toBe(true)
    await ui.press({ key: 'tabs:text' })
    await ui.unmount()
  }
})

test('a long paragraph is drawn one right-aligned line at a time, none longer than the width', async ($, on) => {
  mock.clock(on)
  stub(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const lines = (await texts(ui)).filter((t: string) => t.includes('פסקה ארוכה') || t.includes('בלי הערכה') || t.includes('שורה'))
  expect(lines.length).toBeGreaterThan(1)
  for (const l of lines) expect(Array.from(l.replace(/[‪-‮]/g, '')).length).toBeLessThanOrEqual(54)
})

// Claude Code reorders right-to-left text itself where WT_SESSION is set or TERM_PROGRAM is vscode,
// so the gallery hands the terminal the stored order there, and the visual order everywhere else.
const STORED = 'לבקש מ-Claude: 3 בקשות, 10:00–12:00'
const VISUAL = '10:00–12:00 ,תושקב Claude: 3-מ שקבל'

async function start($: any, on: any, env: Record<string, string>) {
  mock.clock(on)
  mock.env(on, env)
  stub(on)
  on('command.register', () => ({ value: undefined }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  return $.ui.mount({ ...PANE, surface: 'terminal' })
}

test("in VS Code's terminal the gallery sends the stored order, which Claude Code reorders", async ($, on) => {
  const ui = await start($, on, { TERM_PROGRAM: 'vscode' })
  const shown = await texts(ui)
  expect(shown).toContain(STORED)
  expect(shown).not.toContain(VISUAL)
  await ui.press({ key: 'tabs:terminal' })
  expect(await texts(ui)).toContain(STORED)
  await ui.unmount()
})

test('in Windows Terminal the gallery sends the stored order too', async ($, on) => {
  const ui = await start($, on, { WT_SESSION: '0b2c1f6e-1a2b-4c3d-9e8f-000000000000' })
  expect(await texts(ui)).toContain(STORED)
  await ui.unmount()
})

test('on a terminal that prints stored order (TERM_PROGRAM unset) the gallery sends the visual order', async ($, on) => {
  const ui = await start($, on, {})
  const shown = await texts(ui)
  expect(shown).toContain(VISUAL)
  expect(shown).not.toContain(STORED)
  await ui.press({ key: 'tabs:terminal' })
  expect(await texts(ui)).toContain(VISUAL)
  await ui.unmount()
})
