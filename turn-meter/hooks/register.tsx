import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Live, Turn } from '../types'

const last = atom({ plugin: 'turn-meter', key: 'last' } as const, null)
const live = atom({ plugin: 'turn-meter', key: 'live' } as const, null)
const isHidden = atom({ plugin: 'turn-meter', key: 'isHidden' } as const, false)

const LONG_TURN_SECONDS = 120

const total = (byTool: Record<string, number>) =>
  Object.values(byTool).reduce((sum, n) => sum + n, 0)

const breakdown = (byTool: Record<string, number>) =>
  Object.entries(byTool)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([tool, n]) => `${tool} ${n}`)
    .join(', ')

const summary = (turn: Turn) => {
  const count = total(turn.byTool)
  const kinds = count > 0 ? ` (${breakdown(turn.byTool)})` : ''
  return `Last turn: ${turn.seconds}s, ${count} tool calls${kinds}`
}

export const register: Register = on => {
  let startedAt = 0
  let byTool: Record<string, number> = {}

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'turn-meter',
      description: 'Show or hide the turn meter band',
    })

    return next(e)
  })

  on('command.run', { command: 'turn-meter' }, async $ => {
    const hidden = await update($, isHidden, was => !was)

    return { text: hidden ? 'Turn meter hidden.' : 'Turn meter shown.' }
  })

  on('prompt.submit', async ($, e, next) => {
    startedAt = await $.clock.now()
    byTool = {}
    await update($, live, (): Live => ({ tools: 0, current: null }))

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    byTool[e.tool] = (byTool[e.tool] ?? 0) + 1
    await update($, live, (): Live => ({ tools: total(byTool), current: e.tool }))

    try {
      return await next(e)
    } finally {
      await update($, live, was => (was ? { ...was, current: null } : was))
    }
  })

  on('turn.complete', async ($, e, next) => {
    // A subagent's turn ends too; only the main loop's end is "the turn".
    if (e.agentId !== undefined) {
      return next(e)
    }

    const seconds = Math.round(((await $.clock.now()) - startedAt) / 1000)
    const turn: Turn = { seconds, byTool: { ...byTool } }
    await update($, last, () => turn)
    await update($, live, () => null)

    if (seconds > LONG_TURN_SECONDS) {
      $.ui.toast(`Long turn: ${seconds}s, ${total(turn.byTool)} tool calls`)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) {
      return next(e)
    }

    const now = await read($, live)
    const turn = await read($, last)
    const { Box, Button, Text } = $.ui.resolve(e)

    if (e.props.isWorking && now) {
      const doing = now.current ? `, now: ${now.current}` : ''
      return (
        <Box>
          <Text color="cyan">● working </Text>
          <Text dimColor>{`${now.tools} tool calls${doing}`}</Text>
        </Box>
      )
    }

    if (turn === null) {
      return next(e)
    }

    return (
      <Box gap={1}>
        <Text dimColor wrap="truncate-end">
          {summary(turn)}
        </Text>
        <Button
          key="hide"
          label="Hide"
          onPress={() => update($, isHidden, () => true)}
        />
      </Box>
    )
  })
}
