export type Turn = { seconds: number; byTool: Record<string, number> }
export type Live = { tools: number; current: string | null }

declare module 'claude-code' {
  interface PluginState {
    'turn-meter': { last: Turn | null; live: Live | null; isHidden: boolean }
  }
}
