// Pure helpers: no `$` here, so every function is unit-testable on its own.

import type { Family, GateName } from '../types'

export const TAPE_SIZE = 150
export const FIELD_LIMIT = 2048
export const ENTRY_LIMIT = 8192

// Best-effort secret scrubbing before anything is stored in session state.
const SECRETS: [RegExp, string][] = [
  [/sk-[A-Za-z0-9_-]{16,}/g, 'sk-…[redacted]'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, 'gh_…[redacted]'],
  [/Bearer\s+[A-Za-z0-9._~+/-]{10,}=*/gi, 'Bearer …[redacted]'],
  [/((?:token|key|secret|password|passwd)=)[^&\s"']+/gi, '$1…[redacted]'],
]

export const redact = (text: string) =>
  SECRETS.reduce((out, [pattern, swap]) => out.replace(pattern, swap), text)

// JSON of a payload: each string field cut at FIELD_LIMIT, the whole at ENTRY_LIMIT.
export const clip = (value: unknown) => {
  let json: string
  try {
    json = JSON.stringify(
      value,
      (_key, v: unknown) =>
        typeof v === 'string' && v.length > FIELD_LIMIT
          ? `${v.slice(0, FIELD_LIMIT)}…[cut ${v.length - FIELD_LIMIT} chars]`
          : v,
      2,
    ) ?? 'undefined'
  } catch {
    json = '"[not serializable]"'
  }
  const safe = redact(json)
  return safe.length > ENTRY_LIMIT ? `${safe.slice(0, ENTRY_LIMIT)}\n…[cut]` : safe
}

const FAMILY: [RegExp, Family][] = [
  [/^tool\./, 'tools'],
  [/^(prompt|turn)\./, 'turns'],
  [/^session\./, 'session'],
  [/^ui\./, 'ui'],
  [/^plugin\./, 'plugins'],
  [/^command\./, 'commands'],
  [/^agent\./, 'agents'],
]

export const familyOf = (event: string): Family =>
  FAMILY.find(([re]) => re.test(event))?.[1] ?? 'session'

export const FAMILY_COLOR: Record<Family, string> = {
  tools: '#ff8a3d',
  turns: '#4c8dff',
  session: '#8a94a6',
  ui: '#a66bff',
  plugins: '#2fbf71',
  commands: '#19b8c7',
  agents: '#ff5fa2',
}

const str = (e: Record<string, unknown>, key: string) =>
  typeof e[key] === 'string' ? (e[key] as string) : ''

const oneLine = (text: string, max = 60) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const toolLabel = (e: Record<string, unknown>) => {
  const path = str(e, 'file_path') || str(e, 'notebook_path') || str(e, 'path')
  if (path) return path.split('/').filter(Boolean).pop() ?? path
  return oneLine(str(e, 'command') || str(e, 'pattern') || str(e, 'url') || str(e, 'query') || str(e, 'description'), 40)
}

// One line per tape row.
export const summarize = (event: string, e: Record<string, unknown>) => {
  switch (event) {
    case 'tool.call': {
      const label = toolLabel(e)
      return redact(label ? `${str(e, 'tool')} ${label}` : str(e, 'tool'))
    }
    case 'prompt.submit':
      return redact(`"${oneLine(str(e, 'text'))}"`)
    case 'turn.start':
      return `turn ${str(e, 'turnId').slice(0, 8)}`
    case 'turn.complete': {
      const ms = typeof e.durationMs === 'number' ? ` ${(e.durationMs / 1000).toFixed(1)}s` : ''
      const who = typeof e.agentId === 'string' ? ` (agent ${e.agentId.slice(0, 6)})` : ''
      return `${str(e, 'reason') || 'done'}${ms}${who}`
    }
    case 'plugin.register':
      return `${str(e, 'provenance') || str(e, 'name')} · ${str(e, 'tier')}`
    case 'ui.press':
    case 'ui.input':
    case 'ui.select':
      return `${str(e, 'plugin')}:${str(e, 'element')} in ${str(e, 'component')}`
    case 'command.run':
      return oneLine(`/${str(e, 'command')} ${str(e, 'args')}`)
    case 'session.start':
      return `${str(e, 'surface') || 'headless'} · ${str(e, 'cwd')}`
    case 'session.end':
      return str(e, 'reason')
    case 'agent.spawn':
      return oneLine(str(e, 'subagentType') || str(e, 'description') || 'agent')
    default:
      return Object.keys(e).slice(0, 5).join(', ')
  }
}

// `claude plugin validate` output: green, the footprint lines, and any warnings.
export const parseValidate = (exitCode: number, out: string) => {
  const lines = out.split('\n')
  const pick = (label: string) =>
    lines
      .filter(l => l.includes(` ${label}: `) && l.includes('❯'))
      .flatMap(l => (l.split(` ${label}: `)[1] ?? '').split(',').map(s => s.trim()).filter(Boolean))
  const warnings = lines.filter(l => /⚠|warning/i.test(l) && !/passed/i.test(l))
  const hasPassed = /Validation passed/.test(out) && !/with warnings/.test(out)
  return {
    isGreen: exitCode === 0 && hasPassed && warnings.length === 0,
    hooks: pick('hooks'),
    calls: pick('calls'),
    warnings,
  }
}

// tsc output: errors outside tests/ are the gate; test stubs may not type-check.
export const parseTsc = (out: string) => {
  const errors = out.split('\n').filter(l => /error TS\d+/.test(l))
  const outside = errors.filter(l => !/(^|\/)tests\//.test(l))
  return { isGreen: outside.length === 0, outside, inTests: errors.length - outside.length }
}

export const tail = (text: string, lines = 15) =>
  redact(text.trimEnd().split('\n').slice(-lines).join('\n'))

// "2.1.288 (Claude Code)" -> [2, 1, 288]
export const versionOf = (text: string) =>
  (text.match(/\d+\.\d+\.\d+/)?.[0] ?? '0.0.0').split('.').map(Number)

export const isOlder = (a: string, b: string) => {
  const [x, y] = [versionOf(a), versionOf(b)]
  for (let i = 0; i < 3; i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d < 0
  }
  return false
}

// The README's footprint names every hook and call validate found.
export const staleFootprint = (readme: string, hooks: readonly string[], calls: readonly string[]) => {
  const bare = (s: string) => s.replace(/\{.*\}$/, '').replace(/^\$\./, '').replace(/ \(via .*\)$/, '')
  return [...hooks, ...calls].map(bare).filter(name => name && !readme.includes(name))
}

export const GATE_NAMES: GateName[] = ['validate', 'types', 'tests']

export const isGateName = (s: string): s is GateName => (GATE_NAMES as string[]).includes(s)

const MARK = { idle: '·', running: '…', pass: '✓', fail: '✗' } as const
export const markOf = (status: keyof typeof MARK) => MARK[status]

// Text for /gates and the gates tool.
export const formatGates = (
  dir: string,
  results: Partial<Record<GateName, { status: keyof typeof MARK; ms?: number; tail: string; note?: string }>>,
  notes: readonly string[],
) => {
  const lines = [`modsmith gates on ${dir}`]
  for (const name of GATE_NAMES) {
    const g = results[name]
    if (!g) continue
    const time = g.ms === undefined ? '' : ` ${(g.ms / 1000).toFixed(1)}s`
    lines.push(`${markOf(g.status)} ${name}${time}${g.note ? `: ${g.note}` : ''}`)
    if (g.status === 'fail' && g.tail) lines.push(g.tail.split('\n').map(l => `    ${l}`).join('\n'))
  }
  for (const note of notes) lines.push(`! ${note}`)
  return lines.join('\n')
}

export const resolveDir = (dir: string, cwd: string, home: string) => {
  const trimmed = dir.trim().replace(/(\/\.)+$/, '').replace(/\/+$/, '')
  if (trimmed === '' || trimmed === '.') return cwd
  if (trimmed.startsWith('./')) return resolveDir(trimmed.slice(2), cwd, home)
  if (trimmed.startsWith('~/')) return `${home}/${trimmed.slice(2)}`
  if (trimmed.startsWith('/')) return trimmed
  return cwd ? `${cwd}/${trimmed}` : trimmed
}

export const baseName = (path: string) => path.split('/').filter(Boolean).pop() ?? path

export const clockTime = (at: number) => new Date(at).toTimeString().slice(0, 8)
