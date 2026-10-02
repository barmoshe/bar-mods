import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Call, Gauge } from '../types'

const PANE = 'mission-control'

const calls = atom({ plugin: 'mission-control', key: 'calls' } as const, [])
const files = atom({ plugin: 'mission-control', key: 'files' } as const, [])
const gauge = atom({ plugin: 'mission-control', key: 'gauge' } as const, null)
const lines = atom({ plugin: 'mission-control', key: 'lines' } as const, [])
const turns = atom({ plugin: 'mission-control', key: 'turns' } as const, 0)
const working = atom({ plugin: 'mission-control', key: 'isWorking' } as const, false)
const narrating = atom({ plugin: 'mission-control', key: 'isNarrating' } as const, false)
const commentary = atom({ plugin: 'mission-control', key: 'isCommentaryOn' } as const, true)

// Tool families, each with one color that reads on light and dark.
type Family = [name: string, color: string, match: RegExp]
const OTHER: Family = ['other', '#8a94a6', /./]
const FAMILIES: Family[] = [
  ['read', '#4c8dff', /^(Read|Grep|Glob|LS|NotebookRead)$/],
  ['edit', '#2fbf71', /^(Edit|Write|MultiEdit|NotebookEdit)$/],
  ['shell', '#ff8a3d', /^(Bash|BashOutput|KillShell|Monitor)$/],
  ['web', '#a66bff', /^(WebFetch|WebSearch)$|Browser|chrome/],
  ['agent', '#ff5fa2', /^(Agent|Task|SendMessage|Workflow)$/],
  ['mcp', '#19b8c7', /^mcp__/],
  OTHER,
]

const familyOf = (tool: string) => FAMILIES.find(([, , re]) => re.test(tool)) ?? OTHER

const basename = (path: string) => path.split('/').filter(Boolean).pop() ?? path

const labelOf = (input: Record<string, unknown>) => {
  const pick = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const path = pick('file_path') || pick('notebook_path') || pick('path')
  if (path) return basename(path)
  const text = pick('command') || pick('pattern') || pick('url') || pick('query') || pick('description')
  return text.replace(/\s+/g, ' ').slice(0, 48)
}

const ring = (percent: number, usd: number, isBusy: boolean) => {
  const c = 2 * Math.PI * 34
  const p = Math.max(0, Math.min(100, percent))
  const color = p < 50 ? '#2fbf71' : p < 80 ? '#ffb020' : '#ff4d4f'
  const spinner = isBusy
    ? `<circle cx="50" cy="50" r="44" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="3 9" opacity="0.8">
         <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="2.4s" repeatCount="indefinite"/>
       </circle>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100">
    ${spinner}
    <circle cx="50" cy="50" r="34" fill="none" stroke="#8a94a6" stroke-opacity="0.25" stroke-width="9"/>
    <circle cx="50" cy="50" r="34" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${((c * p) / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)">
      <animate attributeName="stroke-dasharray" from="0 ${c.toFixed(1)}" to="${((c * p) / 100).toFixed(1)} ${c.toFixed(1)}" dur="0.9s" fill="freeze"/>
    </circle>
    <text x="50" y="49" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="19" font-weight="700" fill="${color}">${Math.round(p)}%</text>
    <text x="50" y="66" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="9" fill="#8a94a6">context</text>
    <text x="118" y="44" font-family="ui-sans-serif,system-ui" font-size="30" font-weight="800" fill="${color}">$${usd.toFixed(2)}</text>
    <text x="120" y="64" font-family="ui-sans-serif,system-ui" font-size="11" fill="#8a94a6">spent this session</text>
  </svg>`
}

const timeline = (list: Call[]) => {
  const shown = list.slice(-80)
  const perRow = 20
  const cell = 15
  const rows = Math.max(1, Math.ceil(shown.length / perRow))
  const cells = shown
    .map((call, i) => {
      const [, color] = familyOf(call.tool)
      const x = (i % perRow) * cell + 2
      const y = Math.floor(i / perRow) * cell + 2
      const stroke = call.state === 'err' ? ` stroke="#ff4d4f" stroke-width="2.5"` : ''
      const pulse =
        call.state === 'run'
          ? `<animate attributeName="opacity" values="1;0.25;1" dur="0.9s" repeatCount="indefinite"/>`
          : `<animate attributeName="opacity" from="0" to="1" dur="0.4s" fill="freeze"/>`
      const tip = `<title>${call.tool}${call.label ? `: ${call.label.replace(/[<&>"]/g, '')}` : ''}</title>`
      return call.isSub
        ? `<circle cx="${x + 5.5}" cy="${y + 5.5}" r="5.5" fill="${color}"${stroke}>${pulse}${tip}</circle>`
        : `<rect x="${x}" y="${y}" width="11" height="11" rx="2.5" fill="${color}"${stroke}>${pulse}${tip}</rect>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${perRow * cell + 4}" height="${rows * cell + 4}" viewBox="0 0 ${perRow * cell + 4} ${rows * cell + 4}">${cells}</svg>`
}

const bar = (percent: number, width: number) => {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

async function refresh($: EngineInterface) {
  const usage = await $.session.usage()
  const { tokens, window, percent } = usage.context
  const value: Gauge = {
    percent: percent ?? (tokens && window ? (tokens / window) * 100 : 0),
    usd: usage.cost?.usd ?? 0,
  }
  await update($, gauge, () => value)
}

async function narrate(
  $: EngineInterface,
  n: number,
  seconds: number,
  moves: string,
  answer: string,
) {
  await update($, narrating, () => true)

  try {
    const reply = await $.model.complete({
    model: 'haiku',
    effort: 'low',
    maxTokens: 120,
    timeoutMs: 15000,
    system:
      "You are an over-the-top live sports commentator narrating an AI coding agent's last turn as if it were a championship match. " +
      'Exactly one sentence, at most 28 words. Name the real moves (tools, files). Never use em dashes. No quotes, no emoji.',
    prompt: `Turn ${n}, ${seconds}s on the clock. Moves in order: ${moves}. The agent's final words began: ${answer}`,
    })

    if (reply.isAnswered) {
      const line = `T${n}  ${reply.text.trim().replace(/\s*—\s*/g, ', ')}`
      await update($, lines, list => [line, ...list].slice(0, 4))
    }
  } finally {
    await update($, narrating, () => false)
  }
}

export const register: Register = on => {
  let turnMoves: string[] = []
  let turnStartedAt = 0
  let seq = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mission',
      description: 'Open the Mission Control pane',
    })
    // Opened unasked, so it seats only where there is room (144+ columns).
    $.ui.open({ id: PANE, title: 'Mission Control' }).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'mission' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Mission Control' })

    return { text: 'Mission Control is open.' }
  })

  on('prompt.submit', async ($, e, next) => {
    turnMoves = []
    turnStartedAt = await $.clock.now()
    await update($, working, () => true)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const isSub = e.agentId !== undefined
    const label = labelOf(e as unknown as Record<string, unknown>)
    const call: Call = { id: e.tool_use_id ?? `${e.tool}-${(seq += 1)}`, tool: e.tool, label, state: 'run', isSub }
    if (!isSub) turnMoves.push(label ? `${e.tool}(${label})` : e.tool)
    const size = (await update($, calls, list => [...list, call].slice(-300))).length

    if (size % 50 === 0) {
      $.ui.toast(`🏆 Tool call #${size} this session`)
    }

    const ran = await next(e)
    const failed = ran.deny !== undefined || ran.isError === true

    await update($, calls, list =>
      list.map(one => (one.id === call.id ? { ...one, state: failed ? 'err' : 'ok' } : one)),
    )

    if (!failed && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(e.tool) && label) {
      await update($, files, list => [label, ...list.filter(f => f !== label)].slice(0, 10))
    }

    await refresh($)

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)

    if (e.agentId !== undefined) {
      return ran
    }

    const n = await update($, turns, t => t + 1)
    await update($, working, () => false)
    await refresh($)

    if (await read($, commentary)) {
      const seconds = Math.round(((await $.clock.now()) - turnStartedAt) / 1000)
      const moves = turnMoves.slice(0, 30).join(', ') || 'no tools, pure talk'
      const answer = e.answer.slice(0, 400)
      // Narrate after this dispatch, so the turn ends without waiting on a model call.
      $.clock.after(10, () => {
        narrate($, n, seconds, moves, answer).catch(() => undefined)
      })
    }

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await read($, calls)
    const touched = await read($, files)
    const g = (await read($, gauge)) ?? { percent: 0, usd: 0 }
    const said = await read($, lines)
    const n = await read($, turns)
    const isBusy = await read($, working)
    const isTalking = await read($, narrating)
    const isOn = await read($, commentary)
    const errors = list.filter(c => c.state === 'err').length
    const counts = FAMILIES.map(([name, color, re]) => ({
      name,
      color,
      count: list.filter(c => familyOf(c.tool)[0] === name).length,
    })).filter(f => f.count > 0)
    const stats =
      `${list.length} tool calls · ${n} turns · ${touched.length} files edited` +
      (errors > 0 ? ` · ${errors} errors` : '')
    const toggle = () => update($, commentary, was => !was)
    const reset = async () => {
      await update($, calls, () => [])
      await update($, files, () => [])
      await update($, lines, () => [])
    }

    if (e.surface === 'terminal') {
      const { Box, Text, Button } = $.ui.resolve(e)
      const width = Math.max(10, Math.min(30, (e.props.bodyColumns ?? 40) - 14))
      return (
        <Box flexDirection="column" gap={1}>
          <Text>{`context ${bar(g.percent, width)} ${Math.round(g.percent)}%`}</Text>
          <Text bold>{`$${g.usd.toFixed(2)} spent`}</Text>
          <Text dimColor>{stats}</Text>
          <Text wrap="wrap">
            {list.slice(-120).map(c => (
              <Text color={c.state === 'err' ? '#ff4d4f' : familyOf(c.tool)[1]}>{c.isSub ? '●' : '■'}</Text>
            ))}
          </Text>
          {said.map(line => (
            <Text italic wrap="wrap">{`🎙 ${line}`}</Text>
          ))}
          <Box gap={1}>
            <Button key="toggle" label={isOn ? 'Mute commentator' : 'Unmute commentator'} onPress={toggle} />
            <Button key="reset" label="Reset" onPress={reset} />
          </Box>
        </Box>
      )
    }

    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Svg
          source={ring(g.percent, g.usd, isBusy)}
          alt={`Context ${Math.round(g.percent)}% full, $${g.usd.toFixed(2)} spent`}
          isInteractive
        />
        <Text dimColor>{stats}</Text>
        <Box flexDirection="column">
          <Text bold>Timeline</Text>
          {list.length === 0 ? (
            <Text dimColor>Waiting for the first move…</Text>
          ) : (
            <Svg source={timeline(list)} alt={`${list.length} tool calls, colored by kind`} isInteractive />
          )}
          <Box flexWrap="wrap" columnGap={2}>
            {counts.map(f => (
              <Text>
                <Text color={f.color}>■</Text>
                {` ${f.name} ${f.count}`}
              </Text>
            ))}
          </Box>
        </Box>
        <Box flexDirection="column">
          <Text bold>{`🎙 Commentary${isTalking ? ' …' : ''}`}</Text>
          {said.length === 0 ? (
            <Text dimColor>{isOn ? 'The commentator calls the next turn.' : 'Muted.'}</Text>
          ) : (
            said.map((line, i) => (
              <Text italic dimColor={i > 0} wrap="wrap">
                {line}
              </Text>
            ))
          )}
        </Box>
        {touched.length > 0 && (
          <Box flexDirection="column">
            <Text bold>Files edited</Text>
            {touched.map(f => (
              <Text color="#2fbf71">{`✎ ${f}`}</Text>
            ))}
          </Box>
        )}
        <Box gap={1}>
          <Button key="toggle" label={isOn ? 'Mute commentator' : 'Unmute commentator'} onPress={toggle} />
          <Button key="reset" label="Reset" onPress={reset} />
        </Box>
      </Box>
    )
  })
}
