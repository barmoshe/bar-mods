import { expect, test } from 'claude-code/testing'

import { bidi, cells, escapeXml, hasRtl, inline, parseMd, schemeOf, stripMarks, svgHeader, svgTimeline, visual, wrap } from '../hooks/rtl'

const RLE = '‫'
const PDF = '‬'

test('bidi: an embedding on drawn surfaces, the visual order on the terminal, Latin untouched', () => {
  expect(hasRtl('שלום')).toBe(true)
  expect(hasRtl('مرحبا')).toBe(true)
  expect(hasRtl('hello 42')).toBe(false)
  expect(bidi('לבקש מ-Claude', 'desktop')).toBe(`${RLE}לבקש מ-Claude${PDF}`)
  expect(bidi('לבקש מ-Claude', 'vscode')).toBe(`${RLE}לבקש מ-Claude${PDF}`)
  expect(bidi(`${RLE}כבר עטוף${PDF}`, 'desktop')).toBe(`${RLE}כבר עטוף${PDF}`)
  expect(bidi('hello', 'desktop')).toBe('hello')
  expect(bidi('שלום', 'terminal')).toBe('םולש')
  expect(bidi('שלום', 'terminal', { terminal: 'logical' })).toBe('שלום')
  expect(bidi('שורה\nאחרת', 'terminal')).toBe('הרוש\nתרחא')
  expect(stripMarks(`${RLE}א${PDF}`)).toBe('א')
})

test('visual: words reverse, Latin and numbers stay whole, brackets mirror', () => {
  expect(visual('שלום עולם')).toBe('םלוע םולש')
  expect(visual('לבקש מ-Claude: 3')).toBe('Claude: 3-מ שקבל')
  expect(visual('סוגריים (בתוך)')).toBe('(ךותב) םיירגוס')
  expect(visual('10:00–12:00 שעה')).toBe('העש 10:00–12:00')
  expect(visual('Room חדר 4')).toBe('Room רדח 4')
  expect(visual('no hebrew here (ok)')).toBe('no hebrew here (ok)')
  expect(visual('مرحبا 3')).toBe('3 ابحرم')
})

test('wrap: by words, a long word is cut, an empty line stays', () => {
  expect(wrap('one two three four five', 10)).toEqual(['one two', 'three four', 'five'])
  expect(wrap('abcdefghijklmnopqrstuvwxyz', 10)).toEqual(['abcdefghij', 'klmnopqrst', 'uvwxyz'])
  expect(wrap('שורה\n\nאחרי ריקה', 20)).toEqual(['שורה', '', 'אחרי ריקה'])
})

test('markdown: front matter off, headings, nested and numbered items, a quote, a table with an escaped pipe', () => {
  const blocks = parseMd(`---
name: x
---

# כותרת

פסקה **מודגשת** עם [קישור](https://example.com)
שממשיכה בשורה הבאה.

1. ראשון
2. שני:
   - מקונן
     עם המשך
> ציטוט
> בשתי שורות

| א | ב |
|---|---|
| תא \\| עם פייפ | \`a | b\` |
|---|---|
`)
  expect(blocks.map(b => b.kind)).toEqual(['heading', 'para', 'item', 'item', 'item', 'quote', 'table'])
  expect(blocks[1]).toEqual({ kind: 'para', text: 'פסקה מודגשת עם קישור שממשיכה בשורה הבאה.' })
  expect(blocks[3]).toEqual({ kind: 'item', depth: 0, marker: '2.', text: 'שני:' })
  expect(blocks[4]).toEqual({ kind: 'item', depth: 1, marker: '•', text: 'מקונן עם המשך' })
  expect(blocks[5]).toEqual({ kind: 'quote', text: 'ציטוט בשתי שורות' })
  expect(blocks[6]).toEqual({ kind: 'table', headers: ['א', 'ב'], rows: [['תא | עם פייפ', 'a | b']] })
  expect(cells('| a | | c |')).toEqual(['a', '', 'c'])
  expect(inline('**a** *b* `c` ~~d~~')).toBe('a b c d')
})

test('svg: text is escaped, widths clamp, blocks outside the day are clipped, the scheme follows the theme', () => {
  const head = svgHeader({ title: '<b>כותרת & "שם"</b>', chips: [{ label: '3 ממתינות', tone: 'warn' }], width: 2000 })
  expect(head.width).toBe(720)
  expect(head.source).toContain('&lt;b&gt;כותרת &amp; &quot;שם&quot;&lt;/b&gt;')
  expect(head.source).not.toContain('<b>')
  expect(head.source).toContain('direction="rtl"')
  const day = svgTimeline({
    width: 100, from: 8, to: 12,
    lanes: [{ id: 'a', label: 'חדר א' }],
    blocks: [{ lane: 'a', start: '06:00', end: '07:00' }, { lane: 'nope', start: '09:00', end: '10:00' }, { lane: 'a', start: '09:00', end: '10:00', label: 'x<y' }],
  })
  expect(day.width).toBe(280)
  expect(day.source.match(/<rect class="f-accent"/g)?.length).toBe(1)
  expect(day.source).toContain('x&lt;y')
  expect(escapeXml(`'`)).toBe('&apos;')
  expect(schemeOf('dark-daltonized')).toBe('dark')
  expect(schemeOf('light')).toBe('light')
  expect(schemeOf(undefined)).toBe('auto')
})
