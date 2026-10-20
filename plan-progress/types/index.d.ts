// plan-progress: the state contract, and the plan's shape the pure files share.

// [ ] to do, [x] done, [~] in progress, [?] waits on you, [!] blocked, [-] dropped.
export type ItemState = ' ' | 'x' | '~' | '?' | '!' | '-'

export type Item = {
  state: ItemState
  // '' when the line has a title and no id
  id: string
  title: string
  // the fields after the title: a commit, a PR, a date, as written
  notes: string[]
  isGate: boolean
  // 0-based line in the file
  line: number
  children: Item[]
}

export type Plan = {
  title: string
  items: Item[]
}

// The pinned file as last read. `error` says why there is no plan (missing file, no block).
export type Snapshot = {
  path: string
  mtimeMs: number
  size: number
  plan: Plan | null
  error: string | null
}

// What the host told us once at session start.
export type Env = {
  // the engine's base release, e.g. '2.1.299'
  engine: string
  // the terminal reorders right-to-left text itself (VS Code, Windows Terminal)
  isTermLogical: boolean
  // what opens a file on this machine: open (macOS), explorer (Windows), xdg-open
  opener: string
}

// A short moment after a step or the whole plan is done: the pane draws it while it lasts.
export type Moment = { kind: 'step' | 'plan'; id: string; until: number }

// A commit seen in a session, and the plan items its message names ("(3.1 step 3d)").
export type Commit = {
  sha: string
  at: number
  items: string[]
  // "wip", "started": work began, nothing finished
  isWip: boolean
}

// When an item was first seen under way and first seen done, and the commits that name it.
export type ItemTimes = {
  startedAt?: number
  doneAt?: number
  commits: string[]
}

// One plan file's history, kept in the mod's store so every session reads the same.
export type History = {
  items: Record<string, ItemTimes>
  commits: Commit[]
  // lags the agent was told about, and the ones the person waved off ("3d>S")
  nudged: string[]
  dismissed: string[]
}

// An item still open after the commits moved on to a later one: inferred, never written.
export type Lag = {
  item: string
  title: string
  movedTo: string
  lastSha: string
  // when the work moved on
  since: number
  isNudged: boolean
}

// What the agent is doing now, from its own tool calls in this session.
export type Live = { text: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'plan-progress': {
      pinned: string | null
      snap: Snapshot | null
      isHidden: boolean
      showAll: boolean
      isPinning: boolean
      minute: number
      env: Env
      moment: Moment | null
      hist: History | null
      live: Live | null
    }
  }
}
