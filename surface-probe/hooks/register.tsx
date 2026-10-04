// surface-probe: open it on a surface before designing a big UI for it. It shows what the surface
// reports (surface, placement, body width, viewport), which elements it draws, how it lays out
// right-to-left text, an SVG where the surface has one, and whether a button can hand Claude a
// message, with how long that message waited.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const PANE = 'surface-probe'
const MESSAGE = 'surface-probe: a button press reached the conversation. (הלחיצה הגיעה לשיחה.)'

const log = atom({ plugin: 'surface-probe', key: 'log' } as const, [] as string[])

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="84" viewBox="0 0 360 84">
  <rect width="360" height="84" rx="12" fill="#4c8dff"/>
  <text x="340" y="36" direction="rtl" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#ffffff">שלום מה-SVG</text>
  <text x="340" y="64" direction="rtl" font-family="Arial, sans-serif" font-size="14" fill="#ffffff">3 פריטים · 1 באיחור · v2.1</text>
</svg>`

// One press can fire twice (seen 2026-10-04: two copies 0.4 s apart). This flag is set before the
// first await, so the second press sees it; a flag in $.state would be read by both first.
let isSending = false

async function note($: EngineInterface, line: string): Promise<void> {
  await update($, log, l => [...l, line].slice(-6))
}

async function send($: EngineInterface): Promise<void> {
  if (isSending) {
    await note($, 'second press ignored while the first is sending')
    return
  }
  isSending = true
  try {
    const pressed = await $.clock.now()
    await note($, 'pressed: sending')
    await $.prompt.submit({ text: MESSAGE })
    await note($, `entered the conversation after ${(await $.clock.now()) - pressed} ms`)
  } finally {
    isSending = false
  }
}

async function fill($: EngineInterface): Promise<void> {
  await $.prompt.fill({ text: MESSAGE })
  await note($, 'put in the prompt box: press Enter to send')
}

// Opened without `focus`: a pane that holds the keyboard can keep a queued prompt from going in
// when the running turn ends (seen 2026-10-04).
async function open($: EngineInterface): Promise<string> {
  const opened = await $.ui.open({ id: PANE, title: 'surface-probe', columns: 200 })
  return opened.isPlaced ? 'surface-probe is open.' : `surface-probe did not open: ${opened.reason}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'surface-probe', description: 'Open a pane that shows what this surface draws and reports' })
    return next(e)
  })

  on('command.run', { command: 'surface-probe' }, async $ => ({ text: await open($) }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    const lines = await read($, log)
    const v = e.viewport
    const facts = `surface ${e.surface} · placement ${e.props.placement} · bodyColumns ${e.props.bodyColumns} · viewport ${v ? `${v.columns}x${v.rows}` : 'not measured'}${v?.isFullscreen === undefined ? '' : ` · isFullscreen ${v.isFullscreen}`}`
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>surface-probe</Text>
        <Text>{facts}</Text>
        <Text>שלום, זו שורה בעברית בלבד.</Text>
        <Text>{'Mixed: המשימה t03 נפתחה ב-4.10.2026 (Claude)'}</Text>
        <Box flexDirection="row-reverse" gap={1} flexWrap="wrap">
          <Text>שורה מימין לשמאל:</Text>
          <Button key="send" label="לשלוח ל-Claude" variant="primary" onPress={() => send($).catch(err => note($, `send failed: ${String(err)}`))} />
          <Button key="fill" label="לתיבת ההודעה" onPress={() => fill($).catch(err => note($, `fill failed: ${String(err)}`))} />
          <Button key="clear" label="לנקות" dimColor onPress={() => update($, log, () => [])} />
          <Button key="close" label="לסגור" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        <Box flexDirection="column" alignItems="flex-end" borderStyle="round" paddingX={1}>
          <Text>מיושר לימין</Text>
          <Text dimColor>שורה שנייה, ארוכה יותר מהראשונה</Text>
        </Box>
        {lines.length > 0 && (
          <Box flexDirection="column">
            {lines.map((line, i) => <Text key={`log:${i}`} dimColor>{line}</Text>)}
          </Box>
        )}
        {/* Branch on the surface, not on the table: resolve()'s table names Svg on the terminal too
            (seen 2026-10-04), and a terminal pane that returns an Svg draws nothing. */}
        {e.surface !== 'terminal' && 'Svg' in el
          ? <el.Svg source={SVG} alt="An SVG with Hebrew text in it" width={360} height={84} />
          : <Text dimColor>{`no Svg on ${e.surface}`}</Text>}
      </Box>
    )
  })
}
