export type Family = 'tools' | 'turns' | 'session' | 'ui' | 'plugins' | 'commands' | 'agents'
export type GateName = 'validate' | 'types' | 'tests'
export type GateStatus = 'idle' | 'running' | 'pass' | 'fail'

export type Entry = {
  id: string
  at: number
  event: string
  family: Family
  summary: string
  payload: string
  outcome?: string
}

export type Mod = {
  name: string
  version?: string
  root: string
  tier: string
  provenance: string
  events: string[]
  calls: string[]
  reloads: number
  lastLoad: number
  source: 'seen' | 'installed' | 'disk'
}

export type Gate = { status: GateStatus; ms?: number; tail: string; note?: string }
export type Eyes = { terminal: boolean; desktop: boolean; narrow: boolean }
export type Versions = { cli: string; engine: string; isCliOlder: boolean }
export type Reload = { name: string; root: string; hooks: number; validate: GateStatus; at: number }

declare module 'claude-code' {
  interface PluginState {
    modsmith: {
      tape: Entry[]
      selected: string | null
      filter: Family | 'all'
      isPaused: boolean
      mods: Mod[]
      target: string | null
      gates: Record<GateName, Gate>
      eyes: Eyes
      versions: Versions | null
      lastReload: Reload | null
      ship: string[]
    }
  }
}
