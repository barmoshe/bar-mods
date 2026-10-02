import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Entry, Family, Gate, GateName, GateStatus, Mod } from '../types'
import {
  FAMILY_COLOR,
  GATE_NAMES,
  TAPE_SIZE,
  baseName,
  clip,
  clockTime,
  familyOf,
  formatGates,
  isGateName,
  isOlder,
  markOf,
  parseTsc,
  parseValidate,
  resolveDir,
  staleFootprint,
  summarize,
  tail,
} from './lib'

const ME = 'modsmith'
const PANE = 'modsmith'
const TOOL_PREFIX = 'mcp__modsmith__'
// A dev mod: loaded by --plugin-dir or hot reload (@inline), or by claude plugin test.
const isDev = (provenance: string) => /@(inline|claude-plugin-test)$/.test(provenance)
const IDLE: Gate = { status: 'idle', tail: '' }
const FAMILIES: Family[] = ['tools', 'turns', 'session', 'ui', 'plugins', 'commands', 'agents']

const tape = atom({ plugin: 'modsmith', key: 'tape' } as const, [])
const selected = atom({ plugin: 'modsmith', key: 'selected' } as const, null)
const filter = atom({ plugin: 'modsmith', key: 'filter' } as const, 'all')
const paused = atom({ plugin: 'modsmith', key: 'isPaused' } as const, false)
const mods = atom({ plugin: 'modsmith', key: 'mods' } as const, [])
const target = atom({ plugin: 'modsmith', key: 'target' } as const, null)
const gates = atom({ plugin: 'modsmith', key: 'gates' } as const, { validate: IDLE, types: IDLE, tests: IDLE })
const eyes = atom({ plugin: 'modsmith', key: 'eyes' } as const, { terminal: false, desktop: false, narrow: false })
const versions = atom({ plugin: 'modsmith', key: 'versions' } as const, null)
const lastReload = atom({ plugin: 'modsmith', key: 'lastReload' } as const, null)
const ship = atom({ plugin: 'modsmith', key: 'ship' } as const, [])

type Config = { tools: boolean; autoValidate: boolean; recordAppends: boolean; cli: string; npx: string }

// Module variables reset on reload; session.start sets them again.
let config: Config = { tools: true, autoValidate: true, recordAppends: false, cli: 'claude', npx: 'npx' }
let cwd = ''
let home = ''
let seq = 0

const text = (body: string) => ({ result: [{ type: 'text', text: body }] })

const withNote = (gate: Gate, note: string | undefined): Gate => (note ? { ...gate, note } : gate)

async function record($: EngineInterface, event: string, e: unknown, outcome?: string) {
  try {
    if (await read($, paused)) return
    const at = await $.clock.now()
    seq += 1
    const fields = (e ?? {}) as Record<string, unknown>
    const base: Entry = { id: `${at}-${seq}`, at, event, family: familyOf(event), summary: summarize(event, fields), payload: clip(e) }
    const entry: Entry = outcome ? { ...base, outcome } : base
    await update($, tape, list => [...list, entry].slice(-TAPE_SIZE))
  } catch {
    // Recording never breaks the event it watches.
  }
}

async function run($: EngineInterface, argv: string[], dir?: string) {
  const started = await $.clock.now()
  try {
    const where = dir ?? cwd
    const r = await $.process.run(argv, where ? { cwd: where, timeoutMs: 180_000 } : { timeoutMs: 180_000 })
    return { code: r.exitCode, out: `${r.stdout}\n${r.stderr}`, ms: (await $.clock.now()) - started }
  } catch (err) {
    return { code: 127, out: `could not run ${argv[0] ?? '?'}: ${String(err)}`, ms: (await $.clock.now()) - started }
  }
}

async function setGate($: EngineInterface, name: GateName, gate: Gate) {
  await update($, gates, all => ({ ...all, [name]: gate }))
}

async function checkVersions($: EngineInterface) {
  const engine = (await $.session.version()).version
  const r = await run($, [config.cli, '--version'])
  const cli = r.code === 0 ? (r.out.match(/\d+\.\d+\.\d+/)?.[0] ?? '?') : 'not found'
  await update($, versions, () => ({ cli, engine, isCliOlder: cli === 'not found' || isOlder(cli, engine) }))
}

async function shipCheck($: EngineInterface, dir: string, hooks: string[], calls: string[]) {
  const notes: string[] = []
  if (hooks.length > 0) {
    try {
      const readme = await $.fs.read(`${dir}/README.md`)
      const missing = typeof readme === 'string' ? staleFootprint(readme, hooks, calls) : []
      if (missing.length > 0) notes.push(`README footprint is stale: ${missing.slice(0, 6).join(', ')}`)
    } catch {
      notes.push('No README.md to carry the footprint')
    }
  }
  try {
    const raw = await $.fs.read(`${dir}/.claude-plugin/plugin.json`)
    const manifest = JSON.parse(typeof raw === 'string' ? raw : '{}') as { name?: string; version?: string }
    const installed = (await read($, mods)).find(
      m => m.name === manifest.name && m.source !== 'disk' && !isDev(m.provenance),
    )
    if (installed?.version !== undefined && installed.version === manifest.version) {
      notes.push(`Installed ${installed.provenance} is also ${installed.version}: bump the version before reinstalling`)
    }
  } catch {
    // No manifest: validate already says so.
  }
  await update($, ship, () => notes)
}

async function runGates($: EngineInterface, dir: string, only: GateName[]) {
  await checkVersions($)
  const results: Partial<Record<GateName, Gate>> = {}
  for (const name of only) await setGate($, name, { status: 'running', tail: '' })
  let hooks: string[] = []
  let calls: string[] = []

  if (only.includes('validate')) {
    const r = await run($, [config.cli, 'plugin', 'validate', dir])
    const v = parseValidate(r.code, r.out)
    hooks = v.hooks
    calls = v.calls
    const warned = v.warnings.length > 0 ? `${v.warnings.length} warning line(s)` : undefined
    results.validate = withNote({ status: v.isGreen ? 'pass' : 'fail', ms: r.ms, tail: tail(r.out) }, warned)
    await setGate($, 'validate', results.validate)
  }

  if (only.includes('types')) {
    if (await $.fs.exists(`${dir}/.claude-plugin/types`)) {
      const r = await run($, [config.npx, '-y', '-p', 'typescript@5', 'tsc', '-p', '.'], dir)
      const t = parseTsc(r.out)
      const ignored = t.inTests > 0 ? `${t.inTests} error(s) in tests/ ignored` : undefined
      const shown = t.outside.length > 0 ? t.outside.join('\n') : r.code === 0 ? '' : r.out
      results.types = withNote({ status: t.isGreen ? 'pass' : 'fail', ms: r.ms, tail: tail(shown) }, ignored)
    } else {
      results.types = {
        status: 'fail',
        tail: '',
        note: `no generated types yet; load the mod once: claude -p "/<its command>" --plugin-dir ${dir}`,
      }
    }
    await setGate($, 'types', results.types)
  }

  if (only.includes('tests')) {
    const r = await run($, [config.cli, 'plugin', 'test'], dir)
    results.tests = { status: r.code === 0 ? 'pass' : 'fail', ms: r.ms, tail: tail(r.out) }
    await setGate($, 'tests', results.tests)
  }

  await shipCheck($, dir, hooks, calls)
  return results
}

async function autoValidate($: EngineInterface, name: string, root: string) {
  const r = await run($, [config.cli, 'plugin', 'validate', root])
  const v = parseValidate(r.code, r.out)
  const status: GateStatus = v.isGreen ? 'pass' : 'fail'
  await update($, lastReload, was => (was && was.name === name ? { ...was, validate: status } : was))
  if ((await read($, target)) === root) {
    await setGate($, 'validate', { status, ms: r.ms, tail: tail(r.out) })
  }
}

async function refreshRoster($: EngineInterface) {
  const others: Mod[] = []
  const blank = { tier: 'user', events: [], calls: [], reloads: 0, lastLoad: 0 }
  try {
    const id = await $.session.id()
    const dir = `${home}/.claude/dev-mods/${id}`
    if (home && (await $.fs.exists(dir))) {
      for (const entry of await $.fs.list(dir)) {
        if (entry.kind === 'dir') {
          others.push({ ...blank, name: entry.name, root: `${dir}/${entry.name}`, provenance: `${entry.name}@inline`, source: 'disk' })
        }
      }
    }
  } catch {
    // No dev-mods folder this session.
  }
  try {
    const settings = await $.settings.read()
    const enabled = (settings.enabledPlugins ?? {}) as Record<string, unknown>
    for (const [key, isOn] of Object.entries(enabled)) {
      if (isOn === true) others.push({ ...blank, name: key.split('@')[0] ?? key, root: '', provenance: key, source: 'installed' })
    }
  } catch {
    // Settings unreadable: the roster keeps what it saw load.
  }
  await update($, mods, list => {
    const seen = list.filter(m => m.source === 'seen')
    const known = new Set(seen.map(m => m.provenance))
    return [...seen, ...others.filter(m => !known.has(m.provenance) && !(known.add(m.provenance) && false))]
  })
}

async function answerTool($: EngineInterface, name: string, input: Record<string, unknown>) {
  if (name === 'events') {
    const limit = Math.min(100, Math.max(1, typeof input.limit === 'number' ? input.limit : 20))
    const want = typeof input.event === 'string' ? input.event : ''
    const list = (await read($, tape)).filter(x => !want || x.event.startsWith(want)).slice(-limit)
    const body = list
      .map(x => `## ${x.event} · ${x.summary}${x.outcome ? ` · ${x.outcome}` : ''}\n${x.payload}`)
      .join('\n\n')
    return text(body || 'No events recorded yet. The tape fills as the session runs.')
  }
  if (name === 'gates') {
    const asked = typeof input.dir === 'string' && input.dir ? resolveDir(input.dir, cwd, home) : null
    const dir = asked ?? (await read($, target))
    if (!dir) return text('No target mod. Pass dir: the folder holding .claude-plugin/plugin.json.')
    await update($, target, () => dir)
    const picked = Array.isArray(input.only) ? input.only.filter((s): s is GateName => typeof s === 'string' && isGateName(s)) : []
    const results = await runGates($, dir, picked.length > 0 ? picked : GATE_NAMES)
    return text(formatGates(dir, results, await read($, ship)))
  }
  if (name === 'mods') {
    await refreshRoster($)
    const list = await read($, mods)
    return text(JSON.stringify(list, null, 2))
  }
  return text(`modsmith has no tool named ${name}.`)
}

export const register: Register = (on, options) => {
  config = {
    tools: options.tools !== false,
    autoValidate: options.autoValidate !== false,
    recordAppends: options.recordAppends === true,
    cli: typeof options.cliPath === 'string' && options.cliPath ? options.cliPath : 'claude',
    npx: typeof options.npxPath === 'string' && options.npxPath ? options.npxPath : 'npx',
  }

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    home = (await $.env.get('HOME')) ?? ''
    await $.command.register({ name: 'modsmith', description: 'Open the modsmith workbench pane' })
    await $.command.register({
      name: 'gates',
      description: 'Run the four ship gates on a mod folder (default: the current target)',
      argumentHint: '[mod folder]',
    })
    if (config.tools) {
      await $.tool.register({
        name: 'events',
        description:
          'modsmith: recent hook events from this live session with their real payloads (the `e` a hook receives), newest last. Read this instead of guessing an event shape from the .d.ts while building a Claude Code mod. `event` filters by name or prefix ("tool.call", "ui."); `limit` defaults to 20.',
        inputSchema: {
          type: 'object',
          properties: { event: { type: 'string' }, limit: { type: 'number' } },
        },
      })
      await $.tool.register({
        name: 'gates',
        description:
          'modsmith: run the ship gates on a Claude Code mod folder (claude plugin validate; tsc against the generated types, zero errors outside tests/; claude plugin test) and return pass/fail with trimmed output per gate, plus ship notes.',
        inputSchema: {
          type: 'object',
          properties: {
            dir: { type: 'string', description: 'The mod folder; default: the current target' },
            only: { type: 'array', items: { type: 'string', enum: ['validate', 'types', 'tests'] } },
          },
        },
      })
      await $.tool.register({
        name: 'mods',
        description: 'modsmith: the mods this session saw load (with the events they hook and the $ calls they make), installed plugins, and dev mods on disk.',
      })
    }
    const ran = await next(e)
    await record($, 'session.start', e)
    return ran
  })

  on('session.end', async ($, e, next) => {
    await record($, 'session.end', e)
    return next(e)
  })

  on('plugin.register', async ($, e, next) => {
    const result = await next(e)
    if (e.name === ME) return result
    await record($, 'plugin.register', e, result.refuse === undefined ? 'allowed' : `refused: ${result.refuse}`)
    const now = await $.clock.now()
    const base: Mod = {
      name: e.name,
      root: e.root,
      tier: e.tier,
      provenance: e.provenance,
      events: [...e.uses.events],
      calls: [...e.uses.calls],
      reloads: 0,
      lastLoad: now,
      source: 'seen',
    }
    const mod: Mod = e.version === undefined ? base : { ...base, version: e.version }
    await update($, mods, list => {
      const old = list.find(m => m.provenance === mod.provenance && m.source === 'seen')
      return [{ ...mod, reloads: old ? old.reloads + 1 : 0 }, ...list.filter(m => m.provenance !== mod.provenance)]
    })

    if (isDev(e.provenance)) {
      await update($, lastReload, () => ({
        name: e.name,
        root: e.root,
        hooks: e.uses.events.length,
        validate: config.autoValidate ? 'running' : 'idle',
        at: now,
      }))
      if ((await read($, target)) === null) await update($, target, () => e.root)
      // A dev mod is loading: open the workbench where there is room for it (144+ columns).
      $.ui.open({ id: PANE, title: 'modsmith' }).catch(() => undefined)
      if (config.autoValidate) {
        $.clock.after(0, () => {
          autoValidate($, e.name, e.root).catch(() => undefined)
        })
      }
    }
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, lastReload, () => null)
    await record($, 'prompt.submit', e)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const ran = await next(e)
    await record($, 'turn.start', e)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    await record($, 'turn.complete', e)
    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    await record($, 'agent.spawn', e)
    return ran
  })

  on('session.compact', async ($, e, next) => {
    const ran = await next(e)
    await record($, 'session.compact', e)
    return ran
  })

  // One hook serves modsmith's own tools and records everyone else's calls.
  on('tool.call', async ($, e, next) => {
    if (e.tool.startsWith(TOOL_PREFIX)) {
      return answerTool($, e.tool.slice(TOOL_PREFIX.length), e as unknown as Record<string, unknown>)
    }
    const started = await $.clock.now()
    const ran = await next(e)
    const ms = (await $.clock.now()) - started
    const outcome = ran.deny !== undefined ? 'denied' : ran.isError === true ? 'error' : 'ok'
    await record($, 'tool.call', e, `${outcome} · ${ms}ms`)
    return ran
  })

  on('command.run', async ($, e, next) => {
    if (e.command === 'modsmith') {
      await $.ui.open({ id: PANE, title: 'modsmith' })
      await refreshRoster($)
      await checkVersions($)
      return { text: 'modsmith is open.' }
    }
    if (e.command === 'gates') {
      const dir = e.args.trim() ? resolveDir(e.args, cwd, home) : await read($, target)
      if (!dir) return { text: 'No target mod. Run /gates <mod folder>, or open /modsmith and pick one.' }
      await update($, target, () => dir)
      const results = await runGates($, dir, GATE_NAMES)
      return { text: formatGates(dir, results, await read($, ship)) }
    }
    const ran = await next(e)
    await record($, 'command.run', e)
    return ran
  })

  on('ui.press', async ($, e, next) => {
    if (e.plugin !== ME) await record($, 'ui.press', e)
    return next(e)
  })

  on('ui.input', async ($, e, next) => {
    if (e.plugin !== ME) await record($, 'ui.input', e)
    return next(e)
  })

  on('ui.select', async ($, e, next) => {
    if (e.plugin !== ME) await record($, 'ui.select', e)
    return next(e)
  })

  if (config.recordAppends) {
    on('session.append', async ($, e, next) => {
      const ran = await next(e)
      await record($, 'session.append', e)
      return ran
    })
  }

  // The band: only right after a dev mod reloads, until the next prompt; stacks above any other band.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await read($, lastReload)
    if (r === null || e.props.hasSurvey) return next(e)
    const g = await read($, gates)
    const isTarget = (await read($, target)) === r.root
    const parts = [`↻ ${r.name} reloaded`, `${r.hooks} hooks`]
    if (r.validate !== 'idle') parts.push(`validate ${markOf(r.validate)}`)
    if (isTarget && g.types.status !== 'idle') parts.push(`types ${markOf(g.types.status)}`)
    if (isTarget && g.tests.status !== 'idle') parts.push(`tests ${markOf(g.tests.status)}`)
    const { Box, Text } = $.ui.resolve(e)
    const mine = <Text color={r.validate === 'fail' ? '#ff4d4f' : '#2fbf71'}>{parts.join(' · ')}</Text>
    const below = await next(e)
    return (
      <Box flexDirection="column">
        {mine}
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await read($, tape)
    const pick = await read($, selected)
    const only = await read($, filter)
    const isPaused = await read($, paused)
    const roster = await read($, mods)
    const dir = await read($, target)
    const g = await read($, gates)
    const seen = await read($, eyes)
    const v = await read($, versions)
    const notes = await read($, ship)
    const cols = e.props.bodyColumns
    const isNarrow = cols < 50
    const rows = list.filter(x => only === 'all' || x.family === only)
    const chosen = rows.find(x => x.id === pick) ?? null
    const present = FAMILIES.filter(f => list.some(x => x.family === f))
    const devs = roster.filter(m => isDev(m.provenance) && m.root)

    const runAll = () => {
      if (dir) runGates($, dir, GATE_NAMES).catch(() => undefined)
    }
    const runOne = (name: GateName) => () => {
      if (dir) runGates($, dir, [name]).catch(() => undefined)
    }
    const flip = (k: 'terminal' | 'desktop' | 'narrow') => () => update($, eyes, was => ({ ...was, [k]: !was[k] }))
    const line = (x: Entry) => `${clockTime(x.at)}  ${x.event}  ${x.summary}${x.outcome ? ` · ${x.outcome}` : ''}`
    const gateLine = (name: GateName) => {
      const it = g[name]
      const time = it.ms === undefined ? '' : ` ${(it.ms / 1000).toFixed(1)}s`
      return `${markOf(it.status)} ${name}${time}${it.note ? `: ${it.note}` : ''}`
    }
    const failing = GATE_NAMES.find(n => g[n].status === 'fail' && g[n].tail)
    const banner = v
      ? `CLI ${v.cli} · engine ${v.engine}${v.isCliOlder ? ' · CLI is older than the engine: validate may fail correct code' : ''}`
      : 'Versions unchecked'

    const { Box, Text, Button, Markdown } = $.ui.resolve(e)

    const gatesSection = (
      <Box flexDirection="column">
        <Text bold>{`Gates · ${dir ? baseName(dir) : 'no target'}`}</Text>
        {GATE_NAMES.map(n => (
          <Text color={g[n].status === 'pass' ? '#2fbf71' : g[n].status === 'fail' ? '#ff4d4f' : undefined}>{gateLine(n)}</Text>
        ))}
        <Text>{`${seen.terminal && seen.desktop && seen.narrow ? '✓' : '·'} eyes`}</Text>
        <Box flexWrap="wrap" columnGap={1}>
          <Button key="run-all" label="Run all" variant="primary" onPress={runAll} />
          <Button key="run-validate" label="validate" onPress={runOne('validate')} />
          <Button key="run-types" label="types" onPress={runOne('types')} />
          <Button key="run-tests" label="tests" onPress={runOne('tests')} />
        </Box>
        <Box flexWrap="wrap" columnGap={1}>
          <Button key="eye-terminal" plain label={`${seen.terminal ? '☑' : '☐'} terminal`} onPress={flip('terminal')} />
          <Button key="eye-desktop" plain label={`${seen.desktop ? '☑' : '☐'} desktop`} onPress={flip('desktop')} />
          <Button key="eye-narrow" plain label={`${seen.narrow ? '☑' : '☐'} narrow`} onPress={flip('narrow')} />
        </Box>
        {notes.map(n => (
          <Text color="#ffb020">{`! ${n}`}</Text>
        ))}
        {failing && <Markdown key="gate-tail" text={`\`\`\`\n${g[failing].tail}\n\`\`\``} />}
      </Box>
    )

    if (isNarrow) {
      return (
        <Box flexDirection="column" gap={1}>
          {gatesSection}
          <Box flexDirection="column">
            {rows.slice(-8).map(x => (
              <Text color={FAMILY_COLOR[x.family]} wrap="truncate-end">{line(x)}</Text>
            ))}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Text dimColor={!v?.isCliOlder} color={v?.isCliOlder ? '#ffb020' : undefined}>{banner}</Text>

        <Box flexDirection="column">
          <Text bold>{`Mods (${roster.length})`}</Text>
          {roster.length === 0 && <Text dimColor>None seen loading yet. /modsmith refreshes the list.</Text>}
          {roster.slice(0, 12).map((m, i) => (
            <Box columnGap={1}>
              <Text color={m.source === 'seen' ? '#2fbf71' : undefined} dimColor={m.source !== 'seen'} wrap="truncate-end">
                {`${m.provenance}${m.version ? ` ${m.version}` : ''} · ${m.source}${m.source === 'seen' ? ` · ${m.events.length} hooks · ${m.calls.length} calls · ↻${m.reloads}` : ''}`}
              </Text>
              {m.root && m.root !== dir && (isDev(m.provenance) || devs.length === 0) && (
                <Button key={`target-${i}`} plain label="target" onPress={() => update($, target, () => m.root)} />
              )}
            </Box>
          ))}
        </Box>

        {gatesSection}

        <Box flexDirection="column">
          <Text bold>{`Tape (${list.length}/${TAPE_SIZE})${isPaused ? ' · paused' : ''}`}</Text>
          <Box flexWrap="wrap" columnGap={1}>
            <Button key="filter-all" plain label={only === 'all' ? '[all]' : 'all'} onPress={() => update($, filter, () => 'all')} />
            {present.map(f => (
              <Button key={`filter-${f}`} plain label={only === f ? `[${f}]` : f} onPress={() => update($, filter, () => f)} />
            ))}
            <Button key="pause" label={isPaused ? 'Resume' : 'Pause'} onPress={() => update($, paused, was => !was)} />
            <Button
              key="clear"
              label="Clear"
              onPress={async () => {
                await update($, tape, () => [])
                await update($, selected, () => null)
              }}
            />
          </Box>
          {rows.length === 0 && <Text dimColor>Nothing recorded yet.</Text>}
          {rows.slice(-30).map(x => (
            <Button
              key={`row-${x.id}`}
              plain
              label={line(x)}
              dimColor={x.id !== pick}
              onPress={() => update($, selected, was => (was === x.id ? null : x.id))}
            />
          ))}
        </Box>

        {chosen && (
          <Box flexDirection="column">
            <Text bold>{`${chosen.event} · e`}</Text>
            <Markdown key="payload" text={`\`\`\`json\n${chosen.payload}\n\`\`\``} />
            <Button
              key="copy"
              label="Copy payload"
              onPress={press => $.ui.copy({ text: chosen.payload, surface: press.surface })}
            />
          </Box>
        )}
      </Box>
    )
  })
}
