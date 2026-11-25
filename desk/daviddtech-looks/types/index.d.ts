export type LookName = 'winter' | 'weather' | 'pine'
export type Mood = 'clear' | 'windy' | 'storm'
export type Pulse = { kind: 'red' | 'green'; at: number }

declare module 'claude-code' {
  interface PluginState {
    'daviddtech-looks': { look: LookName | null; mood: Mood; pulse: Pulse | null; phase: number }
  }
}
