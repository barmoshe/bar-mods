export type Call = {
  id: string
  tool: string
  label: string
  state: 'run' | 'ok' | 'err'
  isSub: boolean
}
export type Gauge = { percent: number; usd: number }

declare module 'claude-code' {
  interface PluginState {
    'mission-control': {
      calls: Call[]
      files: string[]
      gauge: Gauge | null
      lines: string[]
      turns: number
      isWorking: boolean
      isNarrating: boolean
      isCommentaryOn: boolean
    }
  }
}
