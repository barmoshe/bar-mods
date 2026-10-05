export type RtlKitDemo = { section: string; pressed: string | null }

declare module 'claude-code' {
  interface PluginState {
    'rtl-kit': { demo: RtlKitDemo }
  }
}
