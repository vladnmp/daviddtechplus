// The values lab-desk keeps in $.state, and the market data they hold.

/** One candle, numbers parsed from Hyperliquid's strings; `t` is the open time in ms. */
export type Candle = {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
  /** The history lab only: funding over this candle's hours as %/yr (the hourly rate x 24 x 365), null where unread. */
  f?: number | null
  /** The history lab only: open interest (one side, in coins) known at this candle's close; Bybit. */
  oi?: number | null
  /** The history lab only: Deribit's DVOL (the crypto fear gauge) known at this candle's close. */
  dv?: number | null
  /** The history lab only: the VIX (the stock fear gauge) known at this candle's close; FRED. */
  vx?: number | null
}

/** One perp's live context from metaAndAssetCtxs. `funding` is the hourly rate. */
export type CoinCtx = {
  coin: string
  price: number
  prevDay: number | null
  funding: number | null
  openInterest: number | null
  dayVolume: number | null
}

/** The last metaAndAssetCtxs read: every perp by its exact Hyperliquid name. */
export type Market = { at: number; coins: Record<string, CoinCtx> }

/** The coin laid over the chart by Compare, with its candles on the chart's interval. */
export type CompareView = {
  coin: string
  interval: string
  candles: Candle[]
  /** The anchor candle's time (ms): both lines start there, and every % is measured from it. */
  from: number
}

/** What the chart pane shows. */
export type ChartView = {
  coin: string
  interval: string
  candles: Candle[]
  at: number
  error: string | null
}

/** One step of the DaviddTech+ forecast path, % from its reference close. */
export type FanPoint = { step: number; p10: number; p25: number; p50: number; p75: number; p90: number }

export type Fan = {
  symbol: string
  steps: number
  unit: string
  /** The reference close's date (ISO), when given. */
  asOf: string | null
  /** The reference close, when the server shows prices; else the chart anchors at the last price. */
  referencePrice: number | null
  /** The live price sent as price_now and echoed by the server (at_your_price); the fan starts there. Absent on older copies. */
  livePrice?: number | null
  /** The server's 80% range at the horizon as prices at livePrice. */
  range80?: [number, number] | null
  /** The server's middle (p50) at the horizon as a price at livePrice. */
  middle?: number | null
  points: FanPoint[]
}

export type ForecastView = {
  coin: string
  /** The horizon asked for (5 or 20); a change of setting asks again. */
  horizon: number
  /** When this view was made (ms); a 'missing' or 'error' view is retried after a minute. */
  at: number
  /** 'ask': a guest account; the range waits for the person to press its button (it costs a daily request). */
  status: 'ok' | 'missing' | 'error' | 'off' | 'ask'
  fan: Fan | null
  note: string
}

/**
 * Something drawn on the chart by the person or Claude: a price level, a zone between two prices, a note on a
 * candle, a trend line through two candles (extended right), or a Fibonacci retracement from one price to another.
 */
export type Mark = {
  coin: string
  kind: 'level' | 'zone' | 'note' | 'trend' | 'fib' | 'pin' | 'span'
  /** The level, the zone's low edge, the note's price, the trend line's first point, the fib's start (level 1). */
  price: number
  /** The zone's high edge, the trend line's second point, the fib's end (level 0). */
  price2?: number
  /** Note: the candle's open time (ms); trend line: its first point's candle. */
  t?: number
  /** Trend line: its second point's candle (ms). */
  t2?: number
  label: string
  /** Pins and spans (from layers only, never stored as marks): their layer's color. */
  ink?: string
  /** A pin: an arrow under the candle pointing up, over it pointing down, or a dot at its price. */
  dir?: 'up' | 'down' | 'dot'
}

/** A pin on a candle in a layer: `t` is any time inside the candle (ms). */
export type LayerPin = { t: number; dir: 'up' | 'down' | 'dot'; price?: number; label?: string }

/** A shaded time span in a layer, from `t` to `t2` (ms). */
export type LayerSpan = { t: number; t2: number; label?: string }

/**
 * Claude's own result painted on a coin's chart under a name: a line (time, value points), pins on candles and
 * shaded spans. Saved across sessions; the same name replaces it.
 */
export type Layer = {
  coin: string
  name: string
  pane: 'price' | 'lower'
  ink?: string
  points?: [number, number][]
  pins?: LayerPin[]
  spans?: LayerSpan[]
  /**
   * Paths drawn ahead of a candle (`t`, its open time): each a list of moves from its close as fractions, one per
   * candle after it, and their middle. Moments like now puts what came after each look-alike here.
   */
  ahead?: { t: number; paths: number[][]; median: number[] }
  /** When it was painted (ms). */
  at: number
}

/** A price alert: the desk tells the person once when `coin` trades at or past `price`. */
export type PriceAlert = {
  coin: string
  dir: 'above' | 'below'
  price: number
  /** The person's own words after the price, up to 40 characters. */
  note: string
  /** When it was set (ms). */
  at: number
  /** A condition alert instead of a price: the scan text ("ta.rsi(close, 14) < 30") checked on the latest candle. */
  when?: string
  /** A condition alert's interval. */
  interval?: string
}

declare module 'claude-code' {
  interface PluginState {
    'lab-desk': {
      market: Shaped<Market | null>
      chart: Shaped<ChartView | null>
      forecast: Shaped<ForecastView | null>
      watch: Shaped<string[] | null>
      /** Candles back from the last one that the readout shows; 0 is the last. */
      cursor: number
      /** When the last refresh was tried (ms), worked or not; 0 before any. Data age is measured against it. */
      checked: number
      /** The indicators on the chart as typed specs ("ema 50", "rsi 14"), in the order added; null before any. */
      studies: Shaped<string[] | null>
      /** Levels, zones and notes drawn on the chart, every coin's, in the order drawn; null before any. */
      marks: Shaped<Mark[] | null>
      /** Price alerts waiting to be reached, every coin's; null before any. */
      alerts: Shaped<PriceAlert[] | null>
      /** The desktop chart's zoom step, an index into the pane's candle widths; 2 is the default. */
      zoom: number
      /** Bar replay: the time (ms) of the last candle shown, later ones hidden; 0 is off (live). */
      replay: number
      /** Compare: another coin's candles on the chart's interval, drawn as a % line; null when off. */
      compare: Shaped<CompareView | null>
      /** The /lab tour: the step waited for, 1-based; 0 is off. */
      tour: number
      /** Claude's layers (lines, pins, spans), every coin's; null before any. */
      layers: Shaped<Layer[] | null>
    }
  }
}
