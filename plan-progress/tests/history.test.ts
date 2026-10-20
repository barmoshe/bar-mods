import { expect, test } from 'claude-code/testing'

import { parse } from '../hooks/lib/grammar'
import { addCommit, addTransitions, commitMessage, emptyHistory, isWipMessage, lags, mergeHistory, nudgeText, pace, stepRefs } from '../hooks/lib/history'
import { PLAN_3_1 } from './fixture'

const plan = parse(PLAN_3_1)
if (!plan) throw new Error('no plan')
const MIN = 60_000

test('the 3.1 build\'s commit messages name their steps, and only ids the plan has count', () => {
  expect(stepRefs('feat(exceptions): the editor\'s lines are a draft until שמור (3.1 step 2d)', plan)).toEqual(['2d'])
  expect(stepRefs('feat(exceptions): template.save, its undo and a decision (3.1 steps 2b, 2c)', plan)).toEqual(['2b', '2c'])
  expect(stepRefs('feat(exceptions): pushes and exceptions stored (3.1 step 2a, 2b part)', plan)).toEqual(['2a', '2b'])
  expect(stepRefs('feat(ladders): a ladder of positions is a named list (3.1 step S)', plan)).toEqual(['S'])
  // this plan has no 3d, and "3.1" before "step" is never an id
  expect(stepRefs('test(drafts): step 3\'s checks (3.1 step 3d)', plan)).toEqual([])
  expect(stepRefs('chore: staging-days.py\'s backups are git-ignored', plan)).toEqual([])
  expect(isWipMessage('wip(days): the program view (3.1 step 1c, started)')).toBe(true)
  expect(isWipMessage('feat(drafts): drafts in the picker (3.1 steps 3b, 3c)')).toBe(false)
})

test('a commit message is read from -m and from a heredoc', () => {
  expect(commitMessage('git commit -m "feat(x): a thing (3.1 step 3d)"')).toBe('feat(x): a thing (3.1 step 3d)')
  const heredoc = "cd ../poc && git add -A && git commit -q -F - <<'EOF'\nfeat(ladders): shared ladders (3.1 step S)\n\nbody line\nEOF"
  expect(commitMessage(heredoc)).toContain('(3.1 step S)')
})

test('a commit attaches to what it names and starts it at its time', () => {
  const hs = addCommit(emptyHistory(), { sha: '214a7ab', at: 100 * MIN, items: ['S'], isWip: false })
  expect(hs.items.S).toEqual({ startedAt: 100 * MIN, commits: ['214a7ab'] })
  // the same commit twice is one commit
  expect(addCommit(hs, { sha: '214a7ab', at: 101 * MIN, items: ['S'], isWip: false })).toBe(hs)
})

test('reads of the file record first seen under way and first seen done, never on the first read', () => {
  const first = addTransitions(emptyHistory(), null, plan, 10 * MIN)
  expect(first.items['2d']).toBeUndefined()
  const after = parse(PLAN_3_1.replace('  - [~] 2d ·', '  - [x] 2d ·').replace('  - [ ] 2e ·', '  - [~] 2e ·'))
  if (!after) throw new Error('no plan')
  const next = addTransitions(first, plan, after, 20 * MIN)
  expect(next.items['2d']?.doneAt).toBe(20 * MIN)
  expect(next.items['2e']?.startedAt).toBe(20 * MIN)
  // reopened: the finish is forgotten
  const back = addTransitions(next, after, plan, 30 * MIN)
  expect(back.items['2d']?.doneAt).toBeUndefined()
})

test('an open item is behind once a commit names a later one; a dismissal or the item\'s own commit clears it', () => {
  let hs = addCommit(emptyHistory(), { sha: '3e11fec', at: 10 * MIN, items: ['2d'], isWip: false })
  expect(lags(plan, hs)).toEqual([])
  hs = addCommit(hs, { sha: '788f152', at: 20 * MIN, items: ['2e'], isWip: false })
  const [l] = lags(plan, hs)
  expect(l).toEqual({ item: '2d', title: "The editor's draft and the save's list", movedTo: '2e', lastSha: '3e11fec', since: 20 * MIN, isNudged: false })
  if (!l) throw new Error('no lag')
  expect(nudgeText(l, 'progress-3-1.md')).toContain('mark it with mcp__plan-progress__progress (action "set", item "2d", state "done", note "`3e11fec`")')
  expect(lags(plan, { ...hs, dismissed: ['2d>2e'] })).toEqual([])
  // a later commit on 2d itself means it is still being worked
  const still = addCommit(hs, { sha: '5a78272', at: 25 * MIN, items: ['2d'], isWip: false })
  expect(lags(plan, still)).toEqual([])
})

test('pace needs two measured steps, and gives a range, never a point', () => {
  const at = (h: number, m: number) => (h * 60 + m) * MIN
  const hs = emptyHistory()
  hs.items['1'] = { startedAt: at(19, 35), doneAt: at(20, 58), commits: [] }
  expect(pace(plan, hs)).toBeNull()
  hs.items['F'] = { startedAt: at(17, 45), doneAt: at(19, 15), commits: [] }
  hs.items['K'] = { startedAt: at(18, 24), doneAt: at(19, 15), commits: [] }
  const pc = pace(plan, hs)
  expect(pc?.minutes.map(m => m.min)).toEqual([90, 51, 83])
  expect(pc?.perStep).toEqual([51, 90])
  expect(pc?.stepsLeft).toBe(12)
  expect(pc?.left).toEqual([10, 18])
})

test('two sessions\' copies merge: commits by sha, the earliest start', () => {
  const a = addCommit(emptyHistory(), { sha: 'aaa', at: 5, items: ['3a'], isWip: false })
  const b = addCommit(emptyHistory(), { sha: 'bbb', at: 3, items: ['3a'], isWip: false })
  const m = mergeHistory(a, { ...b, nudged: ['3a>3b'] })
  expect(m.commits.map(c => c.sha)).toEqual(['aaa', 'bbb'])
  expect(m.items['3a']?.startedAt).toBe(3)
  expect(m.items['3a']?.commits).toEqual(['aaa', 'bbb'])
  expect(m.nudged).toEqual(['3a>3b'])
})
