// The values daviddtech-charts keeps in $.state, and the chart they hold.

/** A level on the chart: % from the reference close, its touch chance (0..1) when known. */
export type ChartLevel = {
  name: string
  pct: number
  price: number | null
  touch: number | null
  kind: 'resistance' | 'support' | 'break' | 'level'
  major: boolean
}

/** One step of the forecast path, % from the reference close; step 0 is the reference close itself. */
export type ChartPoint = {
  step: number
  session: string
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
  probUp: number
}

/** One level of a level_odds answer: its touch chance by step, step 0 first. */
export type ChartOddsLine = { name: string; values: number[] }

/** One row of a scan: middle and 80% range at the end, % from that symbol's close. */
export type ChartScanRow = { symbol: string; middle: number; range80: [number, number]; storm: number | null }

export type ChartPlanExit = { name: string; pct: number; reached: number | null; reachedIfOpened: number | null }

export type ChartPlan = {
  plan: number
  direction: 'up' | 'down'
  openAt: string
  profitFirstIfOpened: number | null
  lossFirstIfOpened: number | null
  neitherIfOpened: number | null
  exits: ChartPlanExit[]
  loss: { name: string; pct: number }
}

export type Chart = {
  kind: 'brief' | 'odds' | 'plan' | 'scan'
  tool: string
  symbol: string
  assetClass: string | null
  /** The reference close's date (ISO), when known. */
  asOf: string | null
  /** The last step's date (ISO), when known. */
  endDate: string | null
  /** "14 Nov": the reference close as people read it. */
  fromLabel: string | null
  /** "28 Nov": the end date as people read it. */
  endLabel: string | null
  steps: number
  stepUnit: string
  path: ChartPoint[]
  levels: ChartLevel[]
  odds: ChartOddsLine[]
  range80: [number, number] | null
  middle: number | null
  chanceHigher: number | null
  rows: ChartScanRow[]
  plans: ChartPlan[]
  summary: string
  from: 'structured' | 'text'
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'daviddtech-charts': { last: Shaped<Chart | null>; isNew: boolean; isBandHidden: boolean }
  }
}
