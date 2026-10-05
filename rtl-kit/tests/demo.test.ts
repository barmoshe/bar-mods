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
