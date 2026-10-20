import { expect, test } from 'claude-code/testing'

import { addItem, count, findNow, parse, resolve, setItem, summary, upNext, waiting } from '../hooks/lib/grammar'
import { visual } from '../hooks/lib/bidi'
import { barRuns, runsText } from '../hooks/lib/term'
import { pressSvg } from '../hooks/lib/draw'
import { PLAN_3_1 } from './fixture'

const lines = (s: string) => s.split('\n')
const changed = (a: string, b: string) => lines(b).map((l, i) => (l === lines(a)[i] ? null : i)).filter(i => i !== null)

test('reads the 3.1 block: steps, sub-steps, gates and Hebrew', () => {
  const plan = parse(PLAN_3_1)
  expect(plan).not.toBeNull()
  if (!plan) return
  expect(plan.title).toBe('Version 3.1 · trainer studio')
  expect(plan.items).toHaveLength(18)
  expect(plan.items.filter(i => i.isGate)).toHaveLength(3)
  const two = plan.items.find(i => i.id === '2')
  expect(two?.title).toBe('Exceptions and "שמור"')
  expect(two?.children.map(k => k.id)).toEqual(['2a', '2b', '2c', '2d', '2e', '2f'])
  expect(two?.children[0]?.notes).toEqual(['`df82ea1`'])
  expect(plan.items[0]?.notes).toEqual(['POC #64'])
})

test('counts each step as one, a step with sub-steps by its share, gates never', () => {
  const plan = parse(PLAN_3_1)
  if (!plan) throw new Error('no plan')
  expect(count(plan)).toEqual({ pct: 23, sum: 3.5, done: 3, total: 15 })
  expect(findNow(plan)?.item.id).toBe('2d')
  expect(waiting(plan).map(i => i.title)).toEqual(['terraform apply', 'The merge', 'staging-days.py --apply, the epoch'])
  expect(upNext(plan, 2).map(i => i.id)).toEqual(['3', 'S'])
})

test('a step in progress with no sub-steps counts nothing until done; dropped steps leave the count', () => {
  const plan = parse('<!-- plan-progress -->\n- [x] a · A\n- [~] b · B\n- [-] c · C\n- [ ] d · D\n<!-- /plan-progress -->')
  if (!plan) throw new Error('no plan')
  expect(count(plan)).toEqual({ pct: 33, sum: 1, done: 1, total: 3 })
  expect(findNow(plan)?.item.id).toBe('b')
})

test('with nothing in progress, now is the first item not done; with all done, nothing', () => {
  const idle = parse('<!-- plan-progress -->\n- [x] a · A\n- [ ] b · B\n  - [x] b1 · B one\n  - [ ] b2 · B two\n<!-- /plan-progress -->')
  if (!idle) throw new Error('no plan')
  expect(findNow(idle)?.item.id).toBe('b2')
  const done = parse('<!-- plan-progress -->\n- [x] a · A\n- [?] gate · Ship it\n<!-- /plan-progress -->')
  if (!done) throw new Error('no plan')
  expect(findNow(done)).toBeNull()
  expect(count(done).pct).toBe(100)
})

test('set writes only that item\'s line; everything else stays byte for byte', () => {
  const r = setItem(PLAN_3_1, '2d', 'x', '`abc1234`')
  if ('error' in r) throw new Error(r.error)
  expect(changed(PLAN_3_1, r.text)).toEqual([r.line])
  expect(lines(r.text)[r.line]).toBe("  - [x] 2d · The editor's draft and the save's list · `abc1234`")
  expect(r.text.length - PLAN_3_1.length).toBe(' · `abc1234`'.length)
  const back = setItem(r.text, '2d', '~', '')
  if ('error' in back) throw new Error(back.error)
  expect(back.text).toBe(PLAN_3_1)
})

test('a note replaces the fields after the title, and keeps the id and title as written', () => {
  const r = setItem(PLAN_3_1, 'F', 'x', 'POC #64, merged')
  if ('error' in r) throw new Error(r.error)
  expect(lines(r.text)[r.line]).toBe('- [x] F · The feedback button inside open windows · POC #64, merged')
})

test('Windows line endings survive a write', () => {
  const crlf = PLAN_3_1.replace(/\n/g, '\r\n')
  const r = setItem(crlf, '3', '~')
  if ('error' in r) throw new Error(r.error)
  expect(r.text.split('\r\n')[r.line]).toBe('- [~] 3 · An exercise not on the list')
  expect(r.text.length).toBe(crlf.length)
})

test('a gate is named by its title; "gate" alone is refused with the choices', () => {
  const plan = parse(PLAN_3_1)
  if (!plan) throw new Error('no plan')
  const many = resolve(plan, 'gate')
  expect(typeof many === 'string' && many.includes('matches 3 items')).toBe(true)
  const r = setItem(PLAN_3_1, 'The merge', 'x')
  if ('error' in r) throw new Error(r.error)
  expect(lines(r.text)[r.line]).toBe("- [x] gate · The merge · Bar's word")
  const none = setItem(PLAN_3_1, 'zz', 'x')
  expect('error' in none && none.error.startsWith('No item called "zz"')).toBe(true)
})

test('add places a sub-step after its sibling, a step after a step, and a sub-step under a step', () => {
  const sub = addItem(PLAN_3_1, { id: '2g', title: 'A late sub-step', after: '2f' })
  if ('error' in sub) throw new Error(sub.error)
  expect(lines(sub.text)[sub.line]).toBe('  - [ ] 2g · A late sub-step')
  expect(lines(sub.text)[sub.line - 1]).toBe('  - [ ] 2f · The checks')

  const step = addItem(PLAN_3_1, { id: '12', title: 'After eleven', after: '11' })
  if ('error' in step) throw new Error(step.error)
  expect(lines(step.text)[step.line - 1]).toBe('- [ ] 11 · Identity and share previews')
  expect(lines(step.text)[step.line]).toBe('- [ ] 12 · After eleven')

  const under = addItem(PLAN_3_1, { id: '3a', title: 'First of three', under: '3', state: '~' })
  if ('error' in under) throw new Error(under.error)
  expect(lines(under.text)[under.line]).toBe('  - [~] 3a · First of three')
  expect(parse(under.text)?.items.find(i => i.id === '3')?.children).toHaveLength(1)
})

test('nothing outside the block is read or changed', () => {
  const doc = `${PLAN_3_1}\n- [ ] x · A list item below the block\n`
  expect(parse(doc)?.items).toHaveLength(18)
  const r = setItem(doc, '2e', '~')
  if ('error' in r) throw new Error(r.error)
  expect(r.text.endsWith('- [ ] x · A list item below the block\n')).toBe(true)
  expect(parse('# no block here\n- [ ] a · A')).toBeNull()
})

test('the agent\'s read is compact and names now and what waits', () => {
  const plan = parse(PLAN_3_1)
  if (!plan) throw new Error('no plan')
  const s = summary(plan, 'progress-3-1.md')
  expect(s.split('\n')[0]).toBe('Version 3.1 · trainer studio: 23%, 3 of 15 steps done (progress-3-1.md).')
  expect(s).toContain('Now: 2d · The editor\'s draft and the save\'s list (in step 2 · Exceptions and "שמור").')
  expect(s).toContain('Waits on the person: gate · terraform apply; gate · The merge;')
})

test('the terminal gets Hebrew in visual order, Latin left alone', () => {
  expect(visual('Exceptions and "שמור"')).toBe('Exceptions and "רומש"')
  expect(visual('שמור את הטיוטה')).toBe('הטויטה תא רומש')
  expect(visual('The checks')).toBe('The checks')
})

test('the terminal bar: ink, dots at the front with the now mark, blueprint ahead, gates last', () => {
  const plan = parse(PLAN_3_1)
  if (!plan) throw new Error('no plan')
  const runs = barRuns(plan, 40)
  expect(runsText(runs)).toBe('██████⣿⣀▏╶╴╶╴╶╴╶╴╶╴╶╴╶╴╶╴╶╴╶╴╶╴ ◆◆◆')
  expect(runs.find(r => r.tone === 'now')?.text).toBe('▏')
})

test('the press line carries its fonts, a hover title per step, and the counting rule', () => {
  const plan = parse(PLAN_3_1)
  if (!plan) throw new Error('no plan')
  const svg = pressSvg(plan, { width: 560, fileName: 'progress-3-1.md' })
  expect(svg.length < 131072).toBe(true)
  expect(svg).toContain("font-family:'pp-heebo'")
  expect(svg).toContain('<title>2 · Exceptions and &quot;שמור&quot; · in progress · 3 of 6 sub-steps done</title>')
  expect(svg).toContain('Each step weighs one.')
  expect(svg).toContain('>NOW · 2d<')
  expect(svg).toContain('>3 DONE<')
  expect(svg).toContain('>11 AHEAD<')
})
