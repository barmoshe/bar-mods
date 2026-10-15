// rtl-kit's demo: /rtl-gallery opens a gallery of every piece of the kit on this surface, and a ruler
// to measure how many characters fit a line. The kit itself is ./rtl.tsx, the file a mod copies.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { RtlKitDemo, RtlKitTerminal } from '../types'
import { asStored, kit, schemeOf, svgHeader, svgTimeline, visual } from './rtl'

const PANE = 'rtl-kit'
const demo = atom({ plugin: 'rtl-kit', key: 'demo' } as const, { section: 'text', pressed: null } as RtlKitDemo)
// Who orders right-to-left text on the terminal: the kit ('visual') or Claude Code ('logical').
const terminal = atom({ plugin: 'rtl-kit', key: 'terminal' } as const, 'visual' as RtlKitTerminal)

const SECTIONS = [
  { id: 'text', label: 'טקסט' },
  { id: 'parts', label: 'רכיבים' },
  { id: 'md', label: 'Markdown' },
  { id: 'svg', label: 'SVG' },
  { id: 'terminal', label: 'טרמינל' },
  { id: 'ruler', label: 'סרגל' },
]

// Invented sample text only.
const MIXED = 'לבקש מ-Claude: 3 בקשות, 10:00–12:00'
const LONG = 'פסקה ארוכה בעברית שעוברת כמה שורות: כל שורה צריכה להתחיל בצד ימין, גם כשיש בה מילה באנגלית כמו Claude, תאריך כמו 7.10.2026, או מספר כמו 42. בלי הערכה, השורה השנייה מתחילה משמאל.'
const ARABIC = 'مرحبا: هذا سطر بالعربية مع Claude و 3 أرقام.'
const SAMPLE_MD = `# נוהל לדוגמה

פסקה ראשונה עם **הדגשה**, [קישור](https://example.com) ו-\`קוד\`, שמספיק ארוכה כדי לעבור שורה בחלונית צרה.

## שלבים

1. לפתוח את החדר
2. לבדוק את הציוד:
   - מגבות
   - חיטוי
3. לסגור ביומן

> הערה: זה ציטוט, והוא נראה ככרטיס.

| פריט | מחיר | הערות |
|---|---|---|
| טיפול לדוגמה | 100 ₪ | כולל מע"מ |
| מוצר \\| מיוחד | 25 ₪ | |
`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Not /rtl-kit: the plugin's skill, rtl-kit, holds that name (a register refuses it).
    await $.command.register({ name: 'rtl-gallery', description: 'Open the RTL kit gallery: every piece of the kit on this surface' })
    // Claude Code's own test (2.1.300): it reorders in Windows Terminal and VS Code's terminal, so
    // the kit computing the visual order there too would reverse it twice.
    const engineOrders = (await $.env.get('WT_SESSION')) !== undefined || (await $.env.get('TERM_PROGRAM')) === 'vscode'
    await update($, terminal, () => (engineOrders ? 'logical' : 'visual'))
    return next(e)
  })

  // Opened without `focus`: a pane holding the keyboard can hold back queued prompts.
  on('command.run', { command: 'rtl-gallery' }, async $ => {
    const r = await $.ui.open({ id: PANE, title: 'rtl-kit', columns: 200 })
    return { text: r.isPlaced ? 'rtl-kit is open.' : `rtl-kit did not open: ${r.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const order = await read($, terminal)
    const k = kit(el, e, { terminal: order })
    const d = await read($, demo)
    // The theme setting is the terminal's; the desktop follows the system's colour scheme.
    const scheme = e.surface === 'terminal' ? schemeOf((await $.config.list()).find(r => r.key === 'theme')?.value) : 'auto'
    const pick = (id: string) => update($, demo, x => ({ ...x, section: id }))
    const pressed = (what: string) => update($, demo, x => ({ ...x, pressed: what }))
    const { Box, Text } = el

    let body
    if (d.section === 'text') {
      body = k.col('text', [
        k.heading('t:h', 'שורות מעורבות'),
        k.text(MIXED),
        k.text(ARABIC),
        k.heading('t:h2', 'פסקה ארוכה', 2),
        k.para('t:long', LONG),
        k.heading('t:h3', 'כפתורים', 2),
        k.row('t:btns', [
          k.primary('t:primary', 'פעולה ראשית', () => pressed('primary')),
          k.action('t:action', 'לבקש מ-Claude', () => pressed('action')),
          k.quiet('t:quiet', 'ביטול', () => pressed('quiet')),
        ]),
        d.pressed ? k.muted('t:pressed', `נלחץ: ${d.pressed}`) : null,
      ])
    } else if (d.section === 'parts') {
      body = k.col('parts', [
        k.row('p:stats', [
          k.stat('p:s1', 3, 'בקשות ממתינות', 'warn'),
          k.stat('p:s2', 9, 'הזמנות היום', 'info'),
          k.stat('p:s3', 2, 'באיחור', 'bad'),
        ]),
        k.card('p:card', {
          title: 'חדר 4 · יום שני 5.10 · 10:00–12:00',
          meta: 'בקשה של מטפלת לדוגמה. מתנגשת עם הזמנה אחת קיימת.',
          tone: 'warn',
          actions: [
            k.primary('p:approve', 'לאשר', () => pressed('approve')),
            k.action('p:decline', 'לדחות', () => pressed('decline')),
          ],
        }, [k.chips('p:chips', [{ label: 'בקשה', tone: 'warn' }, { label: 'מייל לשוכר', tone: 'info' }])]),
        k.card('p:card2', { title: 'כרטיס שקט', meta: 'גבול עדין, ומודגש במעבר עכבר.' }),
        k.heading('p:list', 'רשימה', 2),
        k.list('p:l', ['פריט ראשון', { text: 'פריט מקונן עם Claude', depth: 1 }, 'פריט שלישי ארוך מספיק כדי לעבור שורה ולהראות שהשורה השנייה מיושרת לימין גם היא']),
        k.heading('p:items', 'שורות ללחיצה', 2),
        k.item('p:i1', 'הכנת שישי', () => pressed('item 1'), 'שבעה שלבים · נשמר להיום'),
        k.item('p:i2', 'קביעת תור', () => pressed('item 2'), 'workflows/booking.md'),
        k.heading('p:table', 'טבלה', 2),
        k.table('p:t', ['שירות', 'מחיר', 'הערות'], [['טיפול לדוגמה', '100 ₪', 'כולל מע"מ'], ['ייעוץ', '180 ₪', 'הערה ארוכה שעוברת שורה בתוך התא']], { widths: [40, 20, 40] }),
        d.pressed ? k.muted('p:pressed', `נלחץ: ${d.pressed}`) : null,
      ])
    } else if (d.section === 'md') {
      body = k.md('md', SAMPLE_MD)
    } else if (d.section === 'svg') {
      if (k.isTerminal) {
        body = k.para('svg:none', 'בטרמינל אין SVG: הכותרת והציר נשארים לחלונית בדסקטופ.')
      } else {
        const head = svgHeader({
          title: 'חדרים · יום שני 5.10', subtitle: '3 בקשות ממתינות · 9 הזמנות · ניסוי', scheme, width: k.svgWidth,
          chips: [{ label: '3 ממתינות', tone: 'warn' }, { label: '9 היום', tone: 'info' }, { label: '1 התנגשות', tone: 'bad' }],
        })
        const day = svgTimeline({
          scheme, width: k.svgWidth, from: 8, to: 21, now: '13:20',
          lanes: [{ id: 'r1', label: 'חדר 1' }, { id: 'r2', label: 'חדר 2' }, { id: 'r4', label: 'חדר 4' }, { id: 'hall', label: 'החלל הקהילתי' }],
          blocks: [
            { lane: 'r1', start: '09:00', end: '11:00', label: 'מטפלת א', tone: 'info' },
            { lane: 'r2', start: '13:00', end: '14:00', label: 'מטפל ב', tone: 'info' },
            { lane: 'r4', start: '10:00', end: '12:00', label: 'בקשה', tone: 'warn' },
            { lane: 'r4', start: '16:00', end: '18:00', label: 'סגור: ניקיון', tone: 'muted' },
            { lane: 'hall', start: '16:00', end: '20:00', label: 'קהילתי', tone: 'ok' },
          ],
        })
        body = k.col('svg', [
          k.svg('svg:head', head, 'כותרת: חדרים, יום שני'),
          <Box key="svg:gap" height={1} />,
          k.svg('svg:day', day, 'ציר זמן של החדרים היום'),
          k.muted('svg:scheme', `ערכת צבעים: ${scheme} (לפי ערכת הצבעים של המערכת)`),
        ])
      }
    } else if (d.section === 'terminal') {
      const lines = [MIXED, ARABIC, 'סוגריים (בתוך) משפט · 10:00–12:00']
      body = k.col('term', [
        k.isTerminal && order === 'logical'
          ? k.para('term:what', 'בטרמינל הזה Claude Code מסדר את הטקסט מימין לשמאל בעצמו, אז הוא נשלח בסדר השמור.')
          : k.para('term:what', 'כך נשלח לטרמינל: הסדר החזותי מחושב, כי הטרמינל מדפיס תווים לפי הסדר השמור. כאן זה מוצג בדיוק כפי שהטרמינל ידפיס, ובטרמינל זה ייקרא נכון.'),
        ...lines.map((l, i) => <Text key={`term:${i}`}>{k.isTerminal ? k.bidi(l) : asStored(visual(l))}</Text>),
      ])
    } else {
      const ruler = (n: number) => Array.from({ length: n }, (_, i) => String((i + 1) % 10)).join('')
      body = k.col('ruler', [
        k.para('r:what', `bodyColumns ${k.cols} · רוחב השבירה ${k.width} תווים. השורה הארוכה ביותר שלא נשברת היא היחס הנכון.`),
        <Text key="r:w">{ruler(k.width)}</Text>,
        <Text key="r:c">{ruler(k.cols)}</Text>,
        <Text key="r:c11">{ruler(Math.round(k.cols * 1.1))}</Text>,
        <Text key="r:he">{k.bidi('א'.repeat(k.cols))}</Text>,
      ])
    }

    return (
      <Box flexDirection="column">
        {k.tabs('tabs', SECTIONS, d.section, pick)}
        {body}
      </Box>
    )
  })
}
