import { expect, test } from 'claude-code/testing'

import {
  ENTRY_LIMIT,
  clip,
  formatGates,
  isOlder,
  parseTsc,
  parseValidate,
  redact,
  resolveDir,
  staleFootprint,
  summarize,
} from '../hooks/lib'

test('redact scrubs key-shaped secrets', async () => {
  const out = redact('sk-ant-abcdefghijklmnop1234 ghp_abcdefghijklmnopqrstuvwx Bearer abc.def.ghi.jkl token=s3cr3t&x=1')
  expect(out).not.toContain('abcdefghijklmnop1234')
  expect(out).not.toContain('ghp_abcdefghijklmnopqrstuvwx')
  expect(out).not.toContain('abc.def.ghi.jkl')
  expect(out).toContain('token=…[redacted]&x=1')
})

test('clip cuts long fields and the whole entry', async () => {
  const one = clip({ text: 'x'.repeat(5000) })
  expect(one).toContain('[cut 2952 chars]')
  const many = clip({ a: 'y'.repeat(2000), b: 'y'.repeat(2000), c: 'y'.repeat(2000), d: 'y'.repeat(2000), e: 'y'.repeat(2000) })
  expect(many.length).toBe(ENTRY_LIMIT + '\n…[cut]'.length)
})

test('summarize names the tool and its target', async () => {
  expect(summarize('tool.call', { tool: 'Edit', file_path: '/work/src/app.ts' })).toBe('Edit app.ts')
  expect(summarize('ui.press', { plugin: 'turn-meter', element: 'hide', component: 'AbovePrompt' })).toBe(
    'turn-meter:hide in AbovePrompt',
  )
})

test('parseValidate: green, footprint, and warnings fail the gate', async () => {
  const ok = parseValidate(
    0,
    '  ❯ ./register.tsx hooks: session.start, tool.call\n  ❯ ./register.tsx calls: $.ui.toast, $.fs.read (via load)\n\n✔ Validation passed',
  )
  expect(ok.isGreen).toBe(true)
  expect(ok.hooks).toEqual(['session.start', 'tool.call'])
  expect(ok.calls).toEqual(['$.ui.toast', '$.fs.read (via load)'])
  expect(parseValidate(0, '⚠ Found 1 warning\n✔ Validation passed with warnings').isGreen).toBe(false)
  expect(parseValidate(1, '✘ Validation failed').isGreen).toBe(false)
})

test('parseTsc: only errors outside tests/ fail', async () => {
  const out = [
    "tests/a.test.ts(3,1): error TS2322: Type 'x' is not assignable",
    "hooks/register.tsx(9,2): error TS2769: No overload matches this call.",
  ].join('\n')
  expect(parseTsc(out).isGreen).toBe(false)
  expect(parseTsc(out).inTests).toBe(1)
  expect(parseTsc("tests/a.test.ts(3,1): error TS2322: nope").isGreen).toBe(true)
})

test('isOlder compares versions', async () => {
  expect(isOlder('2.1.263 (Claude Code)', '2.1.286')).toBe(true)
  expect(isOlder('2.1.288', '2.1.286')).toBe(false)
  expect(isOlder('2.1.286', '2.1.286')).toBe(false)
})

test('staleFootprint names what the README is missing', async () => {
  const readme = 'hooks: `session.start` ... calls: `$.ui.toast`'
  expect(staleFootprint(readme, ['session.start', 'ui.render{component=Pane}'], ['$.ui.toast', '$.fs.read (via load)'])).toEqual([
    'ui.render',
    'fs.read',
  ])
})

test('resolveDir and formatGates', async () => {
  expect(resolveDir('~/bar-mods/x/', '/work', '/Users/me')).toBe('/Users/me/bar-mods/x')
  expect(resolveDir('x', '/work', '/Users/me')).toBe('/work/x')
  expect(resolveDir('.', '/work', '/Users/me')).toBe('/work')
  expect(resolveDir('./x/.', '/work', '/Users/me')).toBe('/work/x')
  const text = formatGates('/m', { validate: { status: 'pass', ms: 1200, tail: '' }, tests: { status: 'fail', tail: 'boom' } }, ['bump it'])
  expect(text).toBe('modsmith gates on /m\n✓ validate 1.2s\n✗ tests\n    boom\n! bump it')
})
