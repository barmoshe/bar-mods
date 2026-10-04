export type ProbeLog = string[]

declare module 'claude-code' {
  interface PluginState {
    'surface-probe': { log: ProbeLog }
  }
}
