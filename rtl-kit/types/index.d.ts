export type RtlKitDemo = { section: string; pressed: string | null }
export type RtlKitTerminal = 'visual' | 'logical'

declare module 'claude-code' {
  interface PluginState {
    'rtl-kit': { demo: RtlKitDemo; terminal: RtlKitTerminal }
  }
}
