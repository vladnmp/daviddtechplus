// lab-desk: the Lab's desk, read-only. A live Hyperliquid candle chart in a
// pane (/lab-chart), a watchlist band above the prompt (/lab-watch), the chart
// coin's price and funding in the status line, and the DaviddTech+ forecast
// range drawn to the right of the last candle. Public market data only:
// nothing here places orders or reads keys or wallets.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Candle, ChartView, CompareView, ForecastView, Layer, Mark, Market, PriceAlert } from '../types'
import {
  CANDLES_WANTED,
  CTX_BODY,
  DATA_LINE,
  ageOf,
  ageText,
  DEFAULT_WATCH,
  INFO_URL,
  INTERVALS,
  candleBody,
  chartDataAt,
  changePct,
  coinLine,
  fmtPct,
  fmtClock,
  fmtPrice,
  fmtUsd,
  fundingText,
  intervalOf,
  isStale,
  parseCandles,
  parseMarket,
  refreshMs,
  resolveCoin,
  statusText,
  watchArgs,
  watchNames,
} from './data'
import { buttonRows, chartAlt, chartCells, chartSize, chartSvg, LINE_BELOW, lineCells, lineReadout, packCells, PALETTES, readout, textRows, timeAxis } from './draw'
import type { PaletteName } from './draw'
import { splitTop } from './formula'
import { LEARN } from './learn'
import { TOUR, TOUR_QUIZ, nextSuggestion, tourText } from './tour'
import { NAMED_SCANS, SCAN_EXAMPLES, SCAN_MAX, fmtScan, parseScan, scanCandles, scanText, scanWarmup } from './scan'
import type { ScanHit } from './scan'
import { KINDS, MAX_LOWER, MAX_STUDIES, PRESETS, changeList, compareStudy, compute, example, fmtStudy, helpLines, listText, parseSpec, specId, specLabel, specsOf, valuesAt, warmup } from './indicators'
import type { Kind, Spec } from './indicators'
import type { Change, Study } from './indicators'
import { deskCells } from './cells'
import { MAX_MARKS, addMarks, markFrom, markText, parseMark } from './marks'
import { EXPORT_SPLIT, exportFile, pineScript, pythonScript } from './export'
import type { ExportLang } from './export'
import { MAX_ALERTS, MAX_WHEN, alertText, hitAlerts, hitText, parseAlert, parseWhenAlert, whenHitText, whenScanText } from './alerts'
import { deskAlt, deskSvg, shareCard } from './svg'
import { addLayers, layerGhost, layerMarks, layerStudies, layersFromStore, layersLine, removeLayers } from './layers'
import { AHEAD_DEFAULT, AHEAD_MAX, LIKE_WINDOW, afterStudy, afterText, likeNow, likeText, parseCondition, pct } from './history'
import { FEE_DEFAULT, MAX_TRIES_KEPT, MIN_UNSEEN, SEEN_SHARE, acrossText, cutIndex, honestTest, parseTest, specKey, testText } from './honest'
import type { CoinRow, Funding, TestSpec } from './honest'
import type { Theme } from './svg'
import {
  FORECAST_TTL_MS,
  MISSING_HINT,
  MISSING_SHORT,
  MISSING_LINES,
  SOURCE_LINE,
  fanCaption,
  fanFrom,
  firstText,
  guestNote,
  nextQuestion,
  serverCandidates,
  symbolFor,
  tierFrom,
} from './forecast'

export const PANE_ID = 'lab-desk-chart'
export const CHART_COMMAND = 'lab-chart'
export const WATCH_COMMAND = 'lab-watch'
export const IND_COMMAND = 'lab-ind'
export const MENU_COMMAND = 'lab'
export const MARK_COMMAND = 'lab-mark'
export const SCAN_COMMAND = 'lab-scan'
export const AFTER_COMMAND = 'lab-after'
export const LIKE_COMMAND = 'lab-like'
export const TEST_COMMAND = 'lab-test'
export const ALERT_COMMAND = 'lab-alert'
/** The most candles a chart asks for: the shown 300 plus the longest indicator's warm-up. */
const MAX_CANDLES = 1500
export const BAND_MS = 30_000
/** A market read younger than this is reused by the chart and the band alike. */
const MARKET_FRESH_MS = 10_000
/** A chart refresh older than this is taken as hung, so the next tick may start a new one. */
const CHART_BUSY_MS = 45_000
/** A 'missing' or 'error' forecast is asked again after this, when the chart is shown again. */
const FORECAST_RETRY_MS = 60_000
const PANE_INTERVALS = ['5m', '15m', '1h', '4h', '1d'] as const
/** Below this many chart rows the terminal pane goes compact. */
const COMPACT_BELOW = 14
/** One-press indicator sets under the chart: label and PRESETS key. A lit chip takes its set off again. */
const PRESET_CHIPS = [
  ['Trend', 'trend'],
  ['Momentum', 'momentum'],
  ['Volatility', 'volatility'],
  ['Breakout', 'breakout'],
  ['Supertrend', 'supertrend'],
  ['Strength', 'strength'],
] as const
/**
 * Stale data wears a grey outline round plain words, never a color of its own: an amber mark would read like the
 * colorblind palette's orange down candles (#d68000). `inactive` is the theme's grey, so it follows light and dark.
 */
const STALE_BOX = { borderStyle: 'round', borderColor: 'inactive', paddingX: 1 } as const

const market = atom({ plugin: 'lab-desk', key: 'market' } as const, null, { shape: 'market-1' })
const chart = atom({ plugin: 'lab-desk', key: 'chart' } as const, null, { shape: 'chart-1' })
const forecast = atom({ plugin: 'lab-desk', key: 'forecast' } as const, null, { shape: 'forecast-1' })
const watch = atom({ plugin: 'lab-desk', key: 'watch' } as const, null, { shape: 'watch-1' })
const cursor = atom({ plugin: 'lab-desk', key: 'cursor' } as const, 0)
/** Desktop zoom: candle widths in SVG units, narrow (more candles) to wide. */
const ZOOM_PITCH = [3, 5, 8, 13] as const
const zoom = atom({ plugin: 'lab-desk', key: 'zoom' } as const, 2)
const replay = atom({ plugin: 'lab-desk', key: 'replay' } as const, 0)
const compare = atom({ plugin: 'lab-desk', key: 'compare' } as const, null, { shape: 'compare-1' })
/** When the last refresh was tried (chart or band, worked or not): data age is measured against it. */
const checked = atom({ plugin: 'lab-desk', key: 'checked' } as const, 0)
const studies = atom({ plugin: 'lab-desk', key: 'studies' } as const, null, { shape: 'studies-1' })
/** Levels, zones and notes drawn on the chart, every coin's, saved across sessions. */
const marks = atom({ plugin: 'lab-desk', key: 'marks' } as const, null, { shape: 'marks-1' })

/** The /lab tour: the step waited for, 1-based; 0 is off. */
const tour = atom({ plugin: 'lab-desk', key: 'tour' } as const, 0)

/** Whether tour step `i` (0-based) shows on the desk now, after its command ran and answered `text`. */
async function tourHolds($: EngineInterface, i: number, text: string, args: string): Promise<boolean> {
  const view = await read($, chart)
  const ids = (await read($, studies)) ?? []
  switch (i) {
    case 0:
      return view !== null
    case 1:
      return ids.length > 0
    case 2:
      return ((await read($, marks)) ?? []).some(m => m.kind === 'fib' && m.coin === view?.coin)
    case 3: {
      const typed = parseSpec(args)
      return !('error' in typed) && ids.includes(specId(typed))
    }
    case 4:
      return text.startsWith('Scan:')
    case 5:
      return (await read($, replay)) > 0
    default:
      return false
  }
}

/** Step `i` of the tour: its command (or the last question) in the prompt box, and the words for it. */
async function tourFill($: EngineInterface, i: number): Promise<string> {
  const filled = await $.prompt.fill({ text: TOUR[i]?.fill ?? TOUR_QUIZ }).catch(() => ({ isFilled: false }))
  return tourText(i, filled.isFilled)
}

/** Price alerts waiting, every coin's, saved across sessions. */
const alerts = atom({ plugin: 'lab-desk', key: 'alerts' } as const, null, { shape: 'alerts-1' })

/** Changes the alert list, saves it, and runs the 30 s check while any wait. */
async function setAlerts($: EngineInterface, fn: (all: PriceAlert[]) => PriceAlert[]): Promise<PriceAlert[]> {
  const next = fn((await read($, alerts)) ?? [])
  await update($, alerts, () => next)
  await $.store.set('alerts', next).catch(() => undefined)
  if (next.length > 0 && !desk.alertTimer) desk.alertTimer = $.clock.every(BAND_MS, () => void alertTick($))
  if (next.length === 0) {
    desk.alertTimer?.cancel()
    desk.alertTimer = null
  }
  return next
}

/** One check: each alert the market reached is said once (toast and notification) and dropped. */
async function alertTick($: EngineInterface): Promise<void> {
  const waiting = (await read($, alerts)) ?? []
  if (waiting.length === 0) return void (await setAlerts($, () => []))
  // A live alert would give a replay away; they wait until the chart is live again.
  if ((await read($, replay)) > 0) return
  const m = waiting.some(a => !a.when) ? await marketNow($).catch(() => null) : null
  const said: { alert: PriceAlert; text: string }[] = m ? hitAlerts(waiting, m).hit.map(({ alert, price }) => ({ alert, text: hitText(alert, price) })) : []
  // Condition alerts read the latest candles (kept a minute), one coin at a time.
  for (const a of waiting.filter(x => x.when)) {
    const scan = parseScan(whenScanText(a))
    if ('error' in scan) continue
    const candles = await cachedCandles($, a.coin, scan.interval ?? '1h', Math.min(MAX_CANDLES, 50 + scanWarmup(scan)), await $.clock.now())
    const hit = candles && candles.length > 1 ? scanCandles(scan, candles) : null
    if (hit?.match) said.push({ alert: a, text: whenHitText(a, hit) })
  }
  if (said.length === 0) return
  // State reads are copies, so alerts are matched by value.
  const key = (a: PriceAlert) => `${a.coin}|${a.dir}|${a.price}|${a.at}|${a.when ?? ''}`
  const gone = new Set(said.map(x => key(x.alert)))
  await setAlerts($, all => all.filter(a => !gone.has(key(a))))
  for (const { text } of said) {
    $.ui.toast(`Alert: ${text}`)
    await $.ui.notify(text, { title: 'Lab desk alert' }).catch(() => undefined)
  }
}

/**
 * A condition alert from the person's words, or null for a plain price alert. It is refused when it is already
 * true now (like a price already past), and when MAX_WHEN condition alerts wait.
 */
async function addWhenAlert($: EngineInterface, text: string, m: Market | null, coin: string | null, interval: string | null): Promise<string | null> {
  const a = parseWhenAlert(text, m, coin, interval, await $.clock.now())
  if (a === null) return null
  if ('error' in a) return a.error
  const list = (await read($, alerts)) ?? []
  if (list.filter(x => x.when).length >= MAX_WHEN) return `${MAX_WHEN} condition alerts at most; /${ALERT_COMMAND} remove 1 makes room.`
  if (list.length >= MAX_ALERTS) return `${MAX_ALERTS} alerts at most. /${ALERT_COMMAND} remove 1 makes room.`
  const scan = parseScan(whenScanText(a))
  if ('error' in scan) return scan.error
  const candles = await cachedCandles($, a.coin, a.interval ?? '1h', Math.min(MAX_CANDLES, 50 + scanWarmup(scan)), await $.clock.now())
  if (!candles || candles.length < 2) return `No candles for ${a.coin} ${a.interval}; check the coin name.`
  const now = scanCandles(scan, candles)
  if (now?.match) return `${a.coin}: ${a.when} on ${a.interval} is already true (${fmtScan(now.left)} vs ${fmtScan(now.right)}). /${SCAN_COMMAND} ${a.when} checks it on every coin.`
  await setAlerts($, all => [...all, a])
  const where = now ? ` Now ${fmtScan(now.left)} vs ${fmtScan(now.right)}.` : ''
  return `Alert set: ${alertText(a)}.${where} Checked every 30 s on the latest candle while Claude Code is open; the desk tells you once.`
}

/** Changes the marks list and saves it. */
async function setMarks($: EngineInterface, fn: (all: Mark[]) => Mark[]): Promise<Mark[]> {
  const next = fn((await read($, marks)) ?? [])
  await update($, marks, () => next)
  await $.store.set('marks', next).catch(() => undefined)
  return next
}

/** Claude's layers (lines, pins, spans), every coin's, saved across sessions. */
const layerList = atom({ plugin: 'lab-desk', key: 'layers' } as const, null, { shape: 'layers-1' })

async function setLayers($: EngineInterface, next: Layer[]): Promise<void> {
  await update($, layerList, () => next)
  await $.store.set('layers', next).catch(() => undefined)
}

/** The indicators over the shown candles, then Claude's line layers on this coin. */
async function chartStudies($: EngineInterface, view: ChartView): Promise<Study[]> {
  return [...studiesFor(await read($, studies), view.candles), ...layerStudies((await read($, layerList)) ?? [], view.coin, view.candles)]
}

/** Candles to ask for: enough that every indicator has settled before the first candle shown. */
function candlesWanted(ids: readonly string[] | null): number {
  return Math.min(MAX_CANDLES, CANDLES_WANTED + Math.max(0, ...specsOf(ids).map(warmup)))
}

export const CHART_TOOL_NAME = 'mcp__lab-desk__chart'
export const READ_TOOL_NAME = 'mcp__lab-desk__chart_read'
export const HISTORY_TOOL_NAME = 'mcp__lab-desk__chart_history'
export const TEST_TOOL_NAME = 'mcp__lab-desk__chart_test'
const CHART_TOOL = {
  name: 'chart',
  description:
    'Opens or changes the Lab desk chart the person sees beside the chat (live Hyperliquid perps, read-only) and paints indicators on it, like TradingView. ' +
    'Use it whenever the person asks to see, open, switch or paint a chart. All fields optional: coin (BTC, ETH, SOL, HYPE, any Hyperliquid perp), ' +
    'interval (1m 5m 15m 1h 4h 1d 1w), add (indicators as typed text: "ema 50", "sma 200", "hma 9", "bb 20 2", "keltner 20 2 10", "vwap", "donchian 20", ' +
    '"supertrend 10 3", "rsi 14", "stochrsi 3 3 14 14", "stoch 14 1 3", "macd 12 26 9", "adx 14 14" (with +DI and -DI), "atr 14", "obv", ' +
    'or a set: "trend", "momentum", "volatility", "breakout", "strength"), remove (same text, or a kind like "ema" for all of them), clear, ' +
    'marks (draw levels, zones, candle notes, trend lines and Fibonacci retracements, e.g. support at 58000, "draw a fib on the last swing"), clear_marks, ' +
    'alerts (said once when reached: "tell me when SOL gets to 200", "tell me when ETH RSI goes under 30"), remove_alerts (by coin), clear_alerts, ' +
    'layout / save_layout (the person\'s named indicator layouts: "load my swing layout", "save these as scalp"), ' +
    'compare (another coin as a % line over the chart: "how did ETH do against BTC this week?"), ' +
    'replay (bar replay: "quiz me on BTC 1h from 3 days ago"; hides the later candles so the person practises reading the chart, never reveal what came next), ' +
    'save (write the chart as an SVG picture and a CSV of its numbers into lab-charts/, for sharing or a notebook), ' +
    'layers (paint your own results: a line of values you worked out, pins on candles, shaded time spans; e.g. a model you computed, the candles where a pattern happened, the hours of a news event; remove_layers / clear_layers take them off). ' +
    'Returns what the chart shows with the latest values. Up to 6 indicators, 2 lower panes, 12 marks and 8 layers per coin. It never places orders.',
  inputSchema: {
    type: 'object',
    properties: {
      coin: { type: 'string', description: 'Hyperliquid perp name, e.g. BTC' },
      interval: { type: 'string', enum: ['1m', '5m', '15m', '1h', '4h', '1d', '1w'] },
      add: { type: 'array', items: { type: 'string' }, description: 'Indicators or sets to paint, e.g. ["ema 50", "rsi"], or your own formula in Pine: ["plot ta.ema(close, 20) - ta.ema(close, 50)"] (series close/open/high/low/volume/hl2/hlc3/ohlc4, + - * /, ta.ema/sma/rma/wma/hma/rsi/atr/stdev/highest/lowest/change, math.abs/max/min)' },
      remove: { type: 'array', items: { type: 'string' }, description: 'Indicators to take off, e.g. ["ema 50"] or ["ema"]' },
      clear: { type: 'boolean', description: 'Take every indicator off first' },
      marks: {
        type: 'array',
        description:
          'Draw on the chart for this coin: a level {price, label}, a zone {price, to, label}, a note on a candle {time (ISO UTC), label}, ' +
          'a trend line {kind: "trend", time, price, time2, to} or {kind: "trend", swing: "lows"} (through the last two swing lows; "highs" for tops), ' +
          'or a Fibonacci retracement {kind: "fib", price (start, level 1), to (end, level 0)} or {kind: "fib"} alone for the recent swing. ' +
          'Use for support and resistance, ranges, demand or supply zones, trends, pullback levels, and to point at a candle when explaining it.',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['level', 'zone', 'note', 'trend', 'fib'], description: 'Optional: read from the other fields when left out' },
            price: { type: 'number' },
            to: { type: 'number', description: 'Second price: makes a zone; the end of a fib; the second point of a trend line' },
            label: { type: 'string', description: 'Up to 40 characters' },
            time: { type: 'string', description: 'Candle time for a note or a trend line\'s first point, e.g. 2026-11-24T08:00' },
            time2: { type: 'string', description: 'Candle time of a trend line\'s second point' },
            swing: { type: 'string', enum: ['lows', 'highs'], description: 'Trend line through the last two swing lows or highs' },
          },
        },
      },
      clear_marks: { type: 'boolean', description: 'Remove the drawn marks on this coin first' },
      remove_alerts: { type: 'array', items: { type: 'string' }, description: 'Coins whose waiting alerts to remove, e.g. ["SOL"] when the person cancels the SOL alert' },
      clear_alerts: { type: 'boolean', description: 'Remove every waiting alert, all coins' },
      layout: { type: 'string', description: 'Load a saved indicator layout by name first (replaces the indicators); unknown names list the saved ones' },
      save_layout: { type: 'string', description: 'After the changes, save the indicators on the chart as a layout under this name' },
      compare: { type: 'string', description: 'Lay another coin over the chart as a % line (TradingView Compare), e.g. "ETH"; "off" removes it' },
      replay: {
        type: 'string',
        description:
          'Bar replay for practice: "100" (candles back), an ISO UTC time to start from, "next" or "next 5" to walk forward, "off" to go live. Later candles are hidden from you as well',
      },
      save: { type: 'boolean', description: 'After the changes, save the chart as SVG and its candles with indicator columns as CSV into lab-charts/ in the working folder' },
      layers: {
        type: 'array',
        description:
          'Your own drawings on this coin\'s chart, kept until removed; the same name replaces a layer. Each: name, and any of: values (numbers, one per candle, lined up with the LAST candles shown, oldest first; null for a gap), ' +
          'points ([{time, value}] by time, for data on other times or from a file), pins ([{time, dir: "up" (arrow under the candle) | "down" (over it) | "dot", label?}]), spans ([{from, to, label?}] shaded across the chart). ' +
          'A line draws on the price chart when its values are prices, else in its own pane (pane overrides). Lines get a legend entry and a CSV column like indicators. Up to 2000 points, 200 pins, 20 spans.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Up to 24 characters; shows in the legend' },
            color: { type: 'string', description: 'Hex like #ff9800, or blue, orange, green, red, purple, yellow, gray, teal, pink' },
            pane: { type: 'string', enum: ['price', 'lower'], description: 'Optional: price chart, or a pane of its own' },
            values: { type: 'array', items: { type: ['number', 'null'] } },
            points: { type: 'array', items: { type: 'object', properties: { time: { type: 'string', description: 'ISO UTC or ms' }, value: { type: 'number' } } } },
            pins: {
              type: 'array',
              items: { type: 'object', properties: { time: { type: 'string' }, dir: { type: 'string', enum: ['up', 'down', 'dot'] }, price: { type: 'number', description: 'Only for a dot' }, label: { type: 'string' } } },
            },
            spans: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } } } },
          },
        },
      },
      remove_layers: { type: 'array', items: { type: 'string' }, description: 'Layer names to take off this coin\'s chart' },
      clear_layers: { type: 'boolean', description: 'Take every layer off this coin\'s chart first' },
      alerts: {
        type: 'array',
        description: 'Price alerts: {price, coin?, direction? ("above" or "below", else from where price is now), note?}, or condition alerts: {when: "rsi < 30" or "ema 20 crosses above ema 50 on 4h", coin?} (same words as a scan; up to 3). Checked every 30 s while Claude Code is open; up to 10.',
        items: {
          type: 'object',
          properties: {
            price: { type: 'number' },
            when: { type: 'string', description: 'A condition instead of a price, e.g. "rsi < 30", "close > ema 200 on 4h"' },
            coin: { type: 'string', description: 'Defaults to the chart coin' },
            direction: { type: 'string', enum: ['above', 'below'] },
            note: { type: 'string', description: 'Up to 40 characters' },
          },
        },
      },
    },
  },
  isDeferred: false,
} as const
const READ_TOOL = {
  name: 'chart_read',
  description:
    'Reads the numbers behind the Lab desk chart the person sees: coin, interval, latest price, 24h change, funding, each indicator\'s latest value, ' +
    'and the last N candles (default 30, max 300) as CSV with every indicator column. Use it to talk about what is on the chart. ' +
    'With export "pine" or "python" it returns the chart\'s indicators as code (Pine v6 for TradingView, Python with pandas) to save or build on.',
  inputSchema: {
    type: 'object',
    properties: {
      candles: { type: 'number', description: 'How many recent candles, 1 to 300' },
      scan: {
        type: 'string',
        description: `Instead: check one condition on the latest candle of every watchlist coin (up to ${SCAN_MAX}), e.g. ${SCAN_EXAMPLES.map(x => `"${x}"`).join(', ')}. Sides are Pine formulas or short words (rsi, ema 50, atr, price). By name: ${Object.keys(NAMED_SCANS).join(', ')}.`,
      },
      export: { type: 'string', enum: ['pine', 'python'], description: 'Return the chart\'s indicators and marks as Pine Script v6 or Python code instead' },
    },
  },
  isDeferred: false,
} as const
const HISTORY_TOOL = {
  name: 'chart_history',
  description:
    'Asks the past of a Hyperliquid perp (up to 5000 closed candles, read once and kept in memory) and pins the answer on the Lab desk chart. ' +
    'mode "after": what happened after a condition turned true ("what happens after BTC RSI drops under 30?", "after a golden cross on 1d?"): every case, the move N candles later as a median, middle half and share up with its 95% range, ' +
    'compared with any candle, the first and second half of the cases, and the cases pinned on the chart. Under 10 cases it gives no numbers. ' +
    'mode "like": moments like now ("when did the chart last look like this, and what came next?"): the closest past shapes of the last 20 closes and what came after each. ' +
    'Say the result in plain words with its range and the any-candle comparison; never call it a prediction. In bar replay it only reads up to the replay point. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['after', 'like'] },
      when: { type: 'string', description: 'For "after": the condition in scan words, e.g. "rsi < 30", "close crosses above ema 200", "rsi < 30 and close > ema 200", optional "on 4h"' },
      coin: { type: 'string', description: 'Defaults to the chart coin' },
      interval: { type: 'string', enum: ['1m', '5m', '15m', '1h', '4h', '1d', '1w'], description: 'Defaults to the condition\'s "on 4h", else the chart\'s. 1h reaches about 7 months back, 4h about 2 years, 1d all of it' },
      ahead: { type: 'number', description: 'Candles to look ahead, default 10' },
      window: { type: 'number', description: 'For "like": closes in the shape compared, default 20' },
      mark: { type: 'boolean', description: 'Pin the cases on the chart (default true)' },
    },
    required: ['mode'],
  },
  isDeferred: false,
} as const
const TEST_TOOL = {
  name: 'chart_test',
  description:
    'The honest test of a trading idea on a Hyperliquid perp, run on the person\'s PC over up to 5000 closed candles: enter when a condition holds, exit when another holds or after N candles, long or short, ' +
    'with Hyperliquid\'s taker fee (0.045% a side unless given) and the real hourly funding. It splits history into the seen part (first 70%) and the unseen part (last 30%), checks nearby settings on the seen part, ' +
    'counts every different test tried on the coin, and ends with a plain line on how likely luck alone is. Unseen trades are pinned on the chart. ' +
    'Report the unseen part first, the luck line word for word, and never promise future results. Use when the person asks "would this have worked", "test this", "backtest". ' +
    'coins (2 to 5) runs the same test on each and says on how many it held and how likely luck gives that: the fairest check of an idea; the first read of a coin\'s funding can take half a minute. Read-only: it never places orders.',
  inputSchema: {
    type: 'object',
    properties: {
      enter: { type: 'string', description: 'When to enter, in scan words: "rsi < 30", "ema 20 crosses above ema 50", "close > ema 200 and rsi < 40"' },
      exit: { type: 'string', description: 'When to exit, same words (optional when hold is given)' },
      hold: { type: 'number', description: 'Exit after this many candles at most (default 10 when there is no exit condition)' },
      side: { type: 'string', enum: ['long', 'short'] },
      fee: { type: 'number', description: 'Fee per side in %, e.g. 0.045' },
      coin: { type: 'string', description: 'Defaults to the chart coin' },
      coins: { type: 'array', items: { type: 'string' }, description: 'The same test across 2 to 5 coins, e.g. ["BTC", "ETH", "SOL"]; nothing is pinned' },
      interval: { type: 'string', enum: ['1m', '5m', '15m', '1h', '4h', '1d', '1w'] },
      mark: { type: 'boolean', description: 'Pin the unseen trades on the chart (default true)' },
    },
    required: ['enter'],
  },
  isDeferred: false,
} as const

/** "/lab-ind what rsi": what it measures, how people read it, one thing to watch, and its value on the chart now. */
async function learnText($: EngineInterface, name: string): Promise<string> {
  const kinds = Object.keys(KINDS) as Kind[]
  if (name.trim() === '') return `Ask about one: /${IND_COMMAND} what rsi. Any of: ${kinds.map(k => KINDS[k].name).join(', ')}.`
  const parsed = parseSpec(name)
  const spec: Spec | null = 'error' in parsed ? (/^\s*plot\b/i.test(name) ? { kind: 'plot', params: [] } : null) : parsed
  if (!spec) return 'error' in parsed ? parsed.error : ''
  const info = KINDS[spec.kind]
  const learn = LEARN[spec.kind]
  const view = await seenChart($)
  const ids = (await read($, studies)) ?? []
  const isPainted = spec.kind !== 'plot' || spec.expr ? ids.includes(specId(spec)) : false
  const lines = [`${spec.kind === 'plot' && !spec.expr ? 'Plot' : specLabel(spec)}: ${info.what}.`, `How people read it: ${learn.reads}`, `Watch: ${learn.watch}`]
  if (view && view.candles.length > 0 && (spec.kind !== 'plot' || spec.expr)) {
    const study = compute(spec, view.candles)
    lines.push(`${view.coin} ${view.interval} now: ${valuesAt(study, 0, n => fmtStudy(study, n, fmtPrice))}${isPainted ? ' (on the chart)' : ''}.`)
  }
  const id = spec.kind === 'plot' && !spec.expr ? example('plot') : specId(spec)
  lines.push(isPainted ? `Next: ask Claude "explain ${specLabel(spec)} on this chart".` : `Next: /${IND_COMMAND} ${id} paints it.`)
  return lines.join('\n')
}

/** Scan candles kept a minute per coin and interval, so a second scan does not ask again. */
const scanCache = new Map<string, { at: number; candles: Candle[] }>()
const SCAN_FRESH_MS = 60_000

/** One condition over the chart coin and the watchlist (up to SCAN_MAX), one request at a time. */
async function runScan($: EngineInterface, raw: string): Promise<string> {
  const scan = parseScan(raw)
  if ('error' in scan) return scan.error
  // The scan reads live candles: in bar replay it would give the replay away.
  if ((await read($, replay)) > 0) return `The scan waits while bar replay is on (it reads live candles). Live (x) or /${CHART_COMMAND} replay off, then scan again.`
  const view = await read($, chart)
  const interval = scan.interval ?? view?.interval ?? '1h'
  const coins = [...new Set([...(view ? [view.coin] : []), ...((await read($, watch)) ?? DEFAULT_WATCH)])].slice(0, SCAN_MAX)
  const now = await $.clock.now()
  const count = Math.min(MAX_CANDLES, 50 + scanWarmup(scan))
  const rows: { coin: string; hit: ScanHit | 'error' }[] = []
  for (const coin of coins) {
    const candles = await cachedCandles($, coin, interval, count, now)
    rows.push({ coin, hit: !candles || candles.length < 2 ? 'error' : scanCandles(scan, candles) })
  }
  return scanText(scan, interval, rows)
}

// The history lab and the honest test: up to 5000 closed candles and the funding paid, read once a session per
// coin and interval, kept in memory (nothing written to the person's folder), math on their PC.
const HISTORY_CANDLES = 5000
const historyCache = new Map<string, { at: number; candles: Candle[] }>()
const fundingCache = new Map<string, { from: number; rows: Funding[] }>()
/** Funding pages read for one history at most (500 hours each, about 3.4 years). */
const FUNDING_PAGES = 60

/** Where history ends: bar replay's last shown candle closes it, so no answer gives what came next away. */
async function historyEnd($: EngineInterface): Promise<number> {
  const at = await read($, replay)
  const view = await read($, chart)
  return at > 0 ? at + (INTERVALS[view?.interval ?? '1h'] ?? 3_600_000) : await $.clock.now()
}

/** Closed candles only (the forming one is left out), cut at bar replay's point; null when the read fails. */
async function historyCandles($: EngineInterface, coin: string, interval: string): Promise<Candle[] | null> {
  const now = await $.clock.now()
  const key = `${coin} ${interval}`
  const got = historyCache.get(key)
  let all = got && now - got.at < refreshMs(interval) ? got.candles : null
  if (!all) {
    all = await post($, candleBody(coin, interval, now, HISTORY_CANDLES))
      .then(parseCandles)
      .catch(() => null)
    if (!all) return null
    historyCache.set(key, { at: now, candles: all })
    if (historyCache.size > 12) historyCache.delete(historyCache.keys().next().value as string)
  }
  const step = INTERVALS[interval] ?? 3_600_000
  const end = await historyEnd($)
  return all.filter(c => c.t + step <= Math.min(now, end))
}

/**
 * Hourly funding from `from` to now, one page at a time. When a page fails (Hyperliquid busy), what was read so far
 * with isComplete false; the next ask goes on from there.
 */
async function fundingRows($: EngineInterface, coin: string, from: number, quiet = false): Promise<{ rows: Funding[]; isComplete: boolean }> {
  const now = await $.clock.now()
  const got = fundingCache.get(coin)
  let rows = got && got.from <= from ? got.rows : []
  let start = rows.length > 0 ? (rows.at(-1) as Funding).t + 1 : from
  // A long first read (about half a second a page) says so, so a quiet half minute does not look stuck.
  const pages = Math.ceil((now - start) / (500 * 3_600_000))
  if (pages > 8 && !quiet) $.ui.toast(`Reading ${coin}'s funding since ${utcText(start).slice(0, 10)}, about ${Math.max(5, Math.round(pages / 2 / 5) * 5)} s the first time, then kept for this session.`)
  let isComplete = true
  for (let page = 0; page < FUNDING_PAGES && start < now - 3_600_000; page++) {
    const raw = await post($, JSON.stringify({ type: 'fundingHistory', coin, startTime: start })).catch(() => null)
    if (!Array.isArray(raw)) {
      isComplete = false
      break
    }
    const list = raw as { time?: unknown; fundingRate?: unknown }[]
    const add = list.map(x => ({ t: Number(x.time), rate: Number(x.fundingRate) })).filter(x => Number.isFinite(x.t) && Number.isFinite(x.rate))
    if (add.length === 0) break
    rows = [...rows, ...add.filter(x => x.t >= start)]
    start = (add.at(-1) as Funding).t + 1
    if (list.length < 500) break
  }
  fundingCache.set(coin, { from: Math.min(from, got?.from ?? from), rows })
  const end = await historyEnd($)
  return { rows: rows.filter(x => x.t >= from && x.t <= end), isComplete }
}

/** The coin and interval a history question is about: as asked, else the chart's. */
async function historyTarget($: EngineInterface, coinRaw: unknown, intervalRaw: unknown, fromCondition: string | null): Promise<{ coin: string; interval: string } | { error: string }> {
  const view = await read($, chart)
  let coin = view?.coin ?? 'BTC'
  if (typeof coinRaw === 'string' && coinRaw.trim() !== '') {
    const found = resolveCoin(await marketNow($).catch(() => null), coinRaw)
    if (!found) return { error: `No Hyperliquid perp named ${coinRaw}.` }
    coin = found
  }
  const iv = typeof intervalRaw === 'string' ? intervalOf(intervalRaw) : null
  if (typeof intervalRaw === 'string' && intervalRaw.trim() !== '' && !iv) return { error: `Unknown interval ${intervalRaw}. Intervals: 1m 5m 15m 1h 4h 1d 1w.` }
  return { coin, interval: iv ?? fromCondition ?? view?.interval ?? '1h' }
}

/**
 * Puts a fixed-name layer of pins (and spans) on the chart for this coin and interval, opening it there unless bar
 * replay holds the chart; says how many fall on the candles shown.
 */
async function pinLayer($: EngineInterface, coin: string, interval: string, name: string, item: Record<string, unknown>): Promise<number> {
  const view = await read($, chart)
  if ((await read($, replay)) > 0 && (view?.coin !== coin || view.interval !== interval)) return 0
  if (!view || view.coin !== coin || view.interval !== interval) await showChart($, coin, interval, false)
  const shown = await seenChart($)
  const candles = shown?.candles ?? []
  const all = ((await read($, layerList)) ?? []).filter(l => !(l.coin === coin && l.name === name))
  const r = addLayers(all, coin, { ...item, name }, candles, await $.clock.now())
  await setLayers($, r.next)
  return layerMarks(r.next.filter(l => l.name === name), coin, candles).filter(m => m.kind === 'pin').length
}

async function runAfter($: EngineInterface, input: { when?: unknown; coin?: unknown; interval?: unknown; ahead?: unknown; mark?: unknown }): Promise<string> {
  if (typeof input.when !== 'string' || input.when.trim() === '') return 'Say the condition, e.g. "rsi < 30", "close crosses above ema 200 on 4h", or two joined by "and".'
  const cond = parseCondition(input.when)
  if ('error' in cond) return cond.error
  const target = await historyTarget($, input.coin, input.interval, cond.interval)
  if ('error' in target) return target.error
  const { coin, interval } = target
  const a = Number(input.ahead)
  const ahead = Number.isFinite(a) && a >= 1 ? Math.min(AHEAD_MAX, Math.round(a)) : AHEAD_DEFAULT
  const candles = await historyCandles($, coin, interval)
  if (!candles || candles.length < 50) return `Could not read ${coin} ${interval} history from Hyperliquid just now; try again in a minute.`
  const study = afterStudy(cond, candles, ahead)
  let onChart = 0
  if (input.mark !== false && study.cases.length > 0) {
    const pins = study.cases.slice(-200).map(x => ({ time: x.t, dir: x.ret >= 0 ? 'up' : 'down', label: pct(x.ret, 1) }))
    onChart = await pinLayer($, coin, interval, 'cases', { pins, color: '#ff9800' })
  }
  const next = `Next: /${TEST_COMMAND} ${cond.said} hold ${ahead} turns it into a test with fees and funding, or /${LIKE_COMMAND} finds moments like now.`
  return `${afterText(cond, coin, interval, ahead, study, onChart)}\n${next}\n${DATA_LINE}`
}

/** The next shorter interval: more candles over the same months. */
const SHORTER: Record<string, string> = { '1w': '1d', '1d': '4h', '4h': '1h', '1h': '15m', '15m': '5m', '5m': '1m', '1m': '1m' }

async function runLike($: EngineInterface, input: { coin?: unknown; interval?: unknown; ahead?: unknown; window?: unknown; mark?: unknown }): Promise<string> {
  const target = await historyTarget($, input.coin, input.interval, null)
  if ('error' in target) return target.error
  const { coin, interval } = target
  const a = Number(input.ahead)
  const ahead = Number.isFinite(a) && a >= 1 ? Math.min(AHEAD_MAX, Math.round(a)) : AHEAD_DEFAULT
  const w = Number(input.window)
  const window = Number.isFinite(w) && w >= 5 ? Math.min(200, Math.round(w)) : LIKE_WINDOW
  const candles = await historyCandles($, coin, interval)
  if (!candles) return `Could not read ${coin} ${interval} history from Hyperliquid just now; try again in a minute.`
  if (candles.length < window * 3 + ahead) return `Moments like now: ${coin} ${interval} has only ${candles.length} closed candles so far, too few to compare shapes (${window * 3 + ahead} needed). Next: a shorter interval has more candles, e.g. /lab-like ${coin} ${SHORTER[interval] ?? '1h'}.`
  const like = likeNow(candles, window, ahead)
  let onChart = 0
  if (input.mark !== false && like.matches.length > 0) {
    const pins = like.matches.map(m => ({ time: m.t, dir: 'dot', price: (candles[m.i] as Candle).c, label: pct(m.path[ahead - 1] as number, 1) }))
    const spans = like.matches.map(m => ({ from: (candles[m.i - window + 1] as Candle).t, to: m.t }))
    // What came after each look-alike, drawn ahead of the last closed candle (unless the DaviddTech+ range shows).
    const paths = { t: (candles.at(-1) as Candle).t, paths: like.matches.map(m => m.path), median: like.median }
    onChart = await pinLayer($, coin, interval, 'like now', { pins, spans, color: '#00bcd4', ahead: paths })
  }
  const next = `Next: ask Claude "what happened after rsi < 30 on ${coin}?", or /${AFTER_COMMAND} close crosses above ema 200.`
  const view = await read($, chart)
  const isDrawn = input.mark !== false && like.matches.length > 0 && view?.coin === coin && view.interval === interval
  return `${likeText(coin, interval, like, onChart, isDrawn)}\n${next}\n${DATA_LINE}`
}

/** "/lab-test rsi < 30 exit rsi > 50 hold 20 short fee 0.02 on 4h" as the test tool's input; null when empty. */
export function parseTestWords(args: string): { enter: string; exit?: string; hold?: number; side?: string; fee?: number; interval?: string; coins?: string[] } | null {
  let text = ` ${args.trim()} `
  const out: { enter: string; exit?: string; hold?: number; side?: string; fee?: number; interval?: string; coins?: string[] } = { enter: '' }
  const iv = /\s(?:on\s+)?(1m|5m|15m|1h|4h|1d|1w)\s*$/i.exec(text)
  if (iv) {
    out.interval = (iv[1] ?? '').toLowerCase()
    text = text.slice(0, iv.index) + ' '
  }
  const side = /\s(long|short)\s/i.exec(text)
  if (side) {
    out.side = (side[1] ?? '').toLowerCase()
    text = text.slice(0, side.index) + ' ' + text.slice(side.index + side[0].length)
  }
  const fee = /\sfee\s+([\d.]+)%?\s/i.exec(text)
  if (fee) {
    out.fee = Number(fee[1])
    text = text.slice(0, fee.index) + ' ' + text.slice(fee.index + fee[0].length)
  }
  const hold = /\s(?:hold|after)\s+(\d+)(?:\s+candles?)?\s/i.exec(text)
  if (hold) {
    out.hold = Number(hold[1])
    text = text.slice(0, hold.index) + ' ' + text.slice(hold.index + hold[0].length)
  }
  // "across BTC ETH SOL" at the end (after side, fee and hold are taken out): the same test on each coin.
  const across = /\sacross\s+([A-Za-z0-9][A-Za-z0-9,\s]*?)\s*$/i.exec(text)
  if (across) {
    out.coins = (across[1] ?? '').split(/[\s,]+/).filter(w => w !== '')
    text = text.slice(0, across.index) + ' '
  }
  const ex = /\sexit(?:\s+when)?\s/i.exec(text)
  const enter = (ex ? text.slice(0, ex.index) : text).replace(/^\s*(?:enter(?:\s+when)?|when)\s+/i, '').trim()
  if (ex) out.exit = text.slice(ex.index + ex[0].length).trim()
  if (enter === '') return null
  out.enter = enter
  return out
}

/** The try counter: each different test on a coin and interval counts once, kept across sessions. */
async function countTry($: EngineInterface, where: string, key: string): Promise<number> {
  const saved = (await $.store.get('tries').catch(() => undefined)) as Record<string, unknown> | undefined
  const all: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(saved && typeof saved === 'object' ? saved : {})) if (Array.isArray(v)) all[k] = v.filter((x): x is string => typeof x === 'string')
  const list = all[where] ?? []
  if (!list.includes(key)) all[where] = [...list, key].slice(-MAX_TRIES_KEPT)
  await $.store.set('tries', all).catch(() => undefined)
  return (all[where] ?? []).length
}

/** A test as /lab-test words again: entry, exit, hold, side and a fee other than the default. */
export function testWords(spec: TestSpec): string {
  const fee = spec.fee !== FEE_DEFAULT ? ` fee ${Number((spec.fee * 100).toFixed(4))}` : ''
  return `${spec.enter.said}${spec.exit ? ` exit ${spec.exit.said}` : ''}${spec.hold !== null ? ` hold ${spec.hold}` : ''}${spec.side === 'short' ? ' short' : ''}${fee}`
}

/** Most coins in one test across coins: each may need its funding read first. */
const ACROSS_MAX = 5

async function runTestTool($: EngineInterface, input: { enter?: unknown; exit?: unknown; hold?: unknown; side?: unknown; fee?: unknown; coin?: unknown; coins?: unknown; interval?: unknown; mark?: unknown }): Promise<string> {
  const spec = parseTest(input)
  if ('error' in spec) return spec.error
  const asked = Array.isArray(input.coins) ? input.coins.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : typeof input.coins === 'string' ? input.coins.split(/[\s,]+/).filter(w => w !== '') : []
  if (asked.length >= 2) return runAcross($, spec, input, asked)
  const target = await historyTarget($, input.coin, input.interval, spec.enter.interval ?? spec.exit?.interval ?? null)
  if ('error' in target) return target.error
  const { coin, interval } = target
  const candles = await historyCandles($, coin, interval)
  if (!candles) return `Could not read ${coin} ${interval} history from Hyperliquid just now; try again in a minute.`
  if (candles.length < 200) return `Test: ${coin} ${interval} has only ${candles.length} closed candles so far, too few for seen and unseen parts (200 needed). Next: a shorter interval has more candles, e.g. on ${SHORTER[interval] ?? '1h'}.`
  const read = await fundingRows($, coin, Math.max((candles[0] as Candle).t, (await $.clock.now()) - 3 * 365 * 86_400_000))
  const tries = await countTry($, `${coin} ${interval}`, specKey(spec))
  const result = honestTest(spec, { enter: String(input.enter), ...(typeof input.exit === 'string' ? { exit: input.exit } : {}) }, candles, read.rows, tries)
  result.isFundingShort = !read.isComplete
  let onChart = 0
  if (input.mark !== false && result.unseen.n > 0) {
    const trades = result.unseen.trades
    const pins = trades.slice(-200).map(t => ({ time: t.t, dir: spec.side === 'long' ? 'up' : 'down', label: pct(t.ret, 1) }))
    const spans = trades.slice(-20).map(t => ({ from: t.t, to: t.t2 }))
    onChart = await pinLayer($, coin, interval, 'test', { pins, spans, color: '#8bc34a' })
  }
  const next =
    result.unseen.n < MIN_UNSEEN
      ? `Next: ask Claude "loosen the entry a little so the test has more unseen trades" (each change counts as a try).`
      : `Next: the fairest check is other coins: /${TEST_COMMAND} ${testWords(spec)} across ${coin === 'BTC' ? 'ETH SOL' : `BTC ${coin === 'ETH' ? 'SOL' : 'ETH'}`} on ${interval} (each coin counts as a try).`
  return `${testText(result, coin, interval, onChart)}\n${next}\n${DATA_LINE}`
}

/** The same test on 2 to 5 coins: each coin's unseen part, how many held, and how likely luck gives that. */
async function runAcross($: EngineInterface, spec: TestSpec, input: { enter?: unknown; exit?: unknown; interval?: unknown }, asked: readonly string[]): Promise<string> {
  const target = await historyTarget($, undefined, input.interval, spec.enter.interval ?? spec.exit?.interval ?? null)
  if ('error' in target) return target.error
  const { interval } = target
  const market = await marketNow($).catch(() => null)
  const coins: string[] = []
  const rows: CoinRow[] = []
  for (const typed of asked) {
    const coin = resolveCoin(market, typed)
    if (!coin) rows.push({ coin: typed.toUpperCase(), r: null, note: 'no Hyperliquid perp by that name' })
    else if (!coins.includes(coin)) coins.push(coin)
  }
  const left = coins.slice(ACROSS_MAX)
  const now = await $.clock.now()
  const fresh = coins.slice(0, ACROSS_MAX).filter(c => !fundingCache.has(c)).length
  // About half a second per page of 500 funding hours over the unseen 30% of what 5000 candles cover, and the candles.
  const span = Math.min(HISTORY_CANDLES * (INTERVALS[interval] ?? 3_600_000), 3 * 365 * 86_400_000) * (1 - SEEN_SHARE)
  const secs = Math.max(5, Math.round((fresh * (span / (500 * 3_600_000) / 2 + 2)) / 5) * 5)
  if (fresh > 0) $.ui.toast(`Testing ${Math.min(coins.length, ACROSS_MAX)} coins: reading history and funding for ${fresh} of them first, about ${secs} s, then kept for this session.`)
  for (const coin of coins.slice(0, ACROSS_MAX)) {
    const candles = await historyCandles($, coin, interval)
    if (!candles) rows.push({ coin, r: null, note: 'could not read its history just now' })
    else if (candles.length < 200) rows.push({ coin, r: null, note: `only ${candles.length} closed candles, too few (200 needed)` })
    else {
      // Only the unseen part is shown across coins, so funding is read from its start: a quarter of the pages.
      const cutT = (candles[cutIndex(spec, candles.length)] as Candle).t
      const read = await fundingRows($, coin, Math.max(cutT, now - 3 * 365 * 86_400_000), true)
      if (!read.isComplete) {
        rows.push({ coin, r: null, note: 'Hyperliquid was busy and its funding could not all be read; ask again in a minute' })
        continue
      }
      const tries = await countTry($, `${coin} ${interval}`, specKey(spec))
      rows.push({ coin, r: honestTest(spec, { enter: String(input.enter), ...(typeof input.exit === 'string' ? { exit: input.exit } : {}) }, candles, read.rows, tries) })
    }
  }
  const more = left.length > 0 ? `\n${left.join(', ')} left out: ${ACROSS_MAX} coins at most in one test.` : ''
  const next = `Next: one coin on its own pins its unseen trades on the chart: /${TEST_COMMAND} ${testWords(spec)} on ${interval}.`
  return `${acrossText(rows, interval)}${more}\n${next}\n${DATA_LINE}`
}

/** The next step as the prompt box's dim suggestion; while the command's own turn still holds the box, once more a moment later. */
async function suggestSoon($: EngineInterface, text: string): Promise<void> {
  const first = await $.prompt.suggest({ text }).catch(() => ({ isShown: true }))
  if (first.isShown) return
  await $.clock.sleep(1500).catch(() => undefined)
  await $.prompt.suggest({ text }).catch(() => undefined)
}

/** A coin's latest candles for a scan or a condition alert, kept a minute; null when the read fails. */
async function cachedCandles($: EngineInterface, coin: string, interval: string, count: number, now: number): Promise<Candle[] | null> {
  const key = `${coin} ${interval} ${count}`
  const got = scanCache.get(key)
  if (got && now - got.at < SCAN_FRESH_MS) return got.candles
  const candles = await post($, candleBody(coin, interval, now, count))
    .then(parseCandles)
    .catch(() => null)
  if (candles) scanCache.set(key, { at: now, candles })
  return candles
}

/** Candles up to and including time `at`; never fewer than two, so a chart still draws. */
export function candlesUpTo<T extends { t: number }>(candles: readonly T[], at: number): T[] {
  const kept = candles.filter(c => c.t <= at)
  return kept.length >= 2 ? kept : candles.slice(0, 2)
}

/** The chart as the person sees it: in bar replay the candles after the replay point are cut, everywhere. */
async function seenChart($: EngineInterface): Promise<ChartView | null> {
  const view = await read($, chart)
  const at = await read($, replay)
  if (!view || at <= 0) return view
  return { ...view, candles: candlesUpTo(view.candles, at) }
}

const utcText = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ')

/** How many candles bar replay starts back from the last one when no point is given. */
const REPLAY_BACK = 100

/**
 * Starts bar replay: `back` candles before the last, or the candle that holds an ISO time. The later candles are hidden
 * on both charts, in Claude's reads and in saves, until Next walks forward or replay is turned off.
 */
async function startReplay($: EngineInterface, where: string): Promise<string> {
  const view = await read($, chart)
  if (!view || view.candles.length < 30) return `Open a chart first: /${CHART_COMMAND} BTC 1h, then /${CHART_COMMAND} replay.`
  const c = view.candles
  let i = c.length - 1 - REPLAY_BACK
  const w = where.trim()
  if (/^\d+$/.test(w)) i = c.length - 1 - Number(w)
  else if (w !== '') {
    const t = Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(w) ? w : w.replace(' ', 'T') + 'Z')
    if (!Number.isFinite(t)) return `Replay from where? /${CHART_COMMAND} replay (100 candles back), replay 50, or replay 2026-11-20 08:00 (UTC).`
    i = c.findLastIndex(k => k.t <= t)
  }
  i = Math.max(20, Math.min(c.length - 2, i))
  const at = (c[i] as { t: number }).t
  await update($, replay, () => at)
  await update($, cursor, () => 0)
  await showStatus($)
  return `Bar replay from ${utcText(at)} UTC: ${c.length - 1 - i} later candles hidden. Next (n) shows one more, /${CHART_COMMAND} next 10 jumps, /${CHART_COMMAND} replay off goes live. Read the chart, say what you expect, then press Next.`
}

/** Walks bar replay `n` candles forward (back when negative); reaching the live candle turns replay off. */
async function stepReplay($: EngineInterface, n: number): Promise<string> {
  const view = await read($, chart)
  const at = await read($, replay)
  if (!view || at <= 0) return `Replay is off. /${CHART_COMMAND} replay starts it.`
  const c = view.candles
  const i = Math.max(1, Math.min(c.length - 1, c.findLastIndex(k => k.t <= at) + n))
  if (i >= c.length - 1) {
    await update($, replay, () => 0)
    await showStatus($)
    return 'Replay reached the live candle; the chart is live again.'
  }
  const k = c[i] as { t: number; c: number }
  await update($, replay, () => k.t)
  await showStatus($)
  return `Replay at ${utcText(k.t)} UTC, close ${fmtPrice(k.c)}; ${c.length - 1 - i} candles still hidden.`
}

async function stopReplay($: EngineInterface): Promise<string> {
  const was = await read($, replay)
  await update($, replay, () => 0)
  await showStatus($)
  return was > 0 ? 'Replay off: the chart is live again.' : 'Replay was already off.'
}

/** The Compare coin for the chart on screen, or null (off, the same coin, or still loading another interval). */
function compareFor(cmp: CompareView | null, view: ChartView): { coin: string; candles: CompareView['candles']; from: number } | null {
  if (!cmp || cmp.coin === view.coin || cmp.interval !== view.interval || cmp.candles.length < 2) return null
  // In replay the anchor may sit after the last candle shown; then it measures over the candles shown instead.
  const last = view.candles.at(-1)
  const from = last && cmp.from <= last.t ? cmp.from : compareAnchor(view.candles)
  return { coin: cmp.coin, candles: cmp.candles, from }
}

/** How far back Compare is anchored: about one screen of candles. */
const COMPARE_SPAN = 100

/** The anchor time COMPARE_SPAN candles before the last (or the first candle). */
function compareAnchor(candles: readonly { t: number }[]): number {
  return candles[Math.max(0, candles.length - 1 - COMPARE_SPAN)]?.t ?? 0
}

/** "Compare: ETH +2.31% vs BTC +1.05% over the last 100 candles (since 2026-11-21 08:00 UTC)." */
function compareLine(cmp: { coin: string; candles: CompareView['candles']; from: number } | null, view: ChartView): string {
  if (!cmp) return ''
  const s = compareStudy(cmp.coin, view.candles, cmp.candles, cmp.from)
  const vals = s?.series[0]?.values ?? []
  const lastV = vals.at(-1)
  const first = vals.findIndex(v => v !== null)
  const anchor = view.candles[first]
  const last = view.candles.at(-1)
  if (!s || !s.pctOf || lastV === null || lastV === undefined || !anchor || !last) return ''
  const n = view.candles.length - first
  return `Compare: ${cmp.coin} ${fmtStudy(s, lastV, fmtPrice)} vs ${view.coin} ${fmtPct(((last.c - anchor.c) / anchor.c) * 100)} over the last ${n} candles (since ${utcText(anchor.t)} UTC).`
}

/** Lays another coin over the chart as a % line (TradingView's Compare), fetched on the chart's interval. */
async function startCompare($: EngineInterface, typed: string): Promise<string> {
  const view = await read($, chart)
  if (!view) return `Open a chart first: /${CHART_COMMAND} BTC 1h, then /${CHART_COMMAND} compare ETH.`
  const m = await marketNow($).catch(() => null)
  const coin = resolveCoin(m, typed)
  if (!coin) return `No perp named ${typed} on Hyperliquid. Try ETH, SOL or HYPE.`
  if (coin === view.coin) return `That is the chart's own coin; compare another one, e.g. /${CHART_COMMAND} compare ${view.coin === 'ETH' ? 'BTC' : 'ETH'}.`
  try {
    const now = await $.clock.now()
    const candles = parseCandles(await post($, candleBody(coin, view.interval, now, candlesWanted(await read($, studies)))))
    await update($, compare, (): CompareView => ({ coin, interval: view.interval, candles, from: compareAnchor(view.candles) }))
  } catch (err) {
    return `Could not load ${coin} candles (${err instanceof Error ? err.message : String(err)}).`
  }
  const line = compareLine(compareFor(await read($, compare), view), view)
  return `${coin} is on the ${view.coin} chart as a % line, both starting ${COMPARE_SPAN} candles back. ${line} /${CHART_COMMAND} compare off takes it away.`.replace(/\s+/g, ' ').trim()
}

async function stopCompare($: EngineInterface): Promise<string> {
  const was = await read($, compare)
  await update($, compare, () => null)
  return was ? `Compare off: ${was.coin} taken off the chart.` : 'Compare was already off.'
}

/** What the chart shows, for Claude: a summary and, with `rows` > 0, the last candles as CSV with indicator columns. */
async function chartReport($: EngineInterface, note: string, rows: number): Promise<string> {
  const view = await seenChart($)
  if (!view) return `${note} No chart is open. Call chart with a coin to open one.`.trim()
  const m = await read($, market)
  const ctx = m?.coins[view.coin]
  const ids = await read($, studies)
  const list = await chartStudies($, view)
  const at = await read($, replay)
  const last = view.candles.at(-1)
  const lines = [
    note,
    `Chart: ${view.coin} ${view.interval}, ${view.candles.length} candles${view.error ? ` (last refresh failed: ${view.error})` : ''}.`,
    at > 0 && last
      ? `Bar replay is on at ${utcText(last.t)} UTC (close ${fmtPrice(last.c)}): the person is practising, so the later candles are hidden from you too. Do not say or guess what came next; ask what they expect, then they press Next.`
      : ctx
        ? `Price ${fmtPrice(ctx.price)}, 24h ${fmtPct(changePct(ctx))}, ${fundingText(ctx.funding)}.`
        : '',
    `Indicators: ${listText(ids)}.`,
    ...valueLines(list),
    compareLine(compareFor(await read($, compare), view), view),
    marksLine(await coinMarks($, view.coin), view.candles.at(-1)?.t),
    layersLine((await read($, layerList)) ?? [], view.coin, list),
    ((await read($, alerts)) ?? []).length > 0 ? `Alerts waiting: ${((await read($, alerts)) ?? []).map(alertText).join(' · ')}.` : '',
  ]
  if (rows > 0 && view.candles.length > 0) {
    const csv = chartCsv(view, list, rows)
    lines.push(`Last ${csv.length - 1} candles:`, ...csv)
  }
  lines.push(DATA_LINE)
  return lines.filter(x => x !== '').join('\n')
}

/** The last `rows` candles with every indicator column, as CSV lines (header first). */
function chartCsv(view: ChartView, list: readonly Study[], rows: number): string[] {
  const cols = list.flatMap(st => st.series.map(se => (st.series.length === 1 ? st.label : `${st.label} ${se.name}`)))
  const n = Math.min(rows, view.candles.length)
  const csv = [`time_utc,open,high,low,close,volume${cols.map(c => ',' + c).join('')}`]
  for (let back = n - 1; back >= 0; back--) {
    const i = view.candles.length - 1 - back
    const k = view.candles[i]
    if (!k) continue
    const vals = list.flatMap(st =>
      st.series.map(se => {
        const v = se.values[i]
        return v === null || v === undefined ? '' : String(Number(v.toPrecision(8)))
      }),
    )
    csv.push([new Date(k.t).toISOString().slice(0, 16), k.o, k.h, k.l, k.c, k.v, ...vals].join(','))
  }
  return csv
}

/**
 * The person's marks on this coin, with each waiting alert as a level (TradingView's alert lines), and the pins and
 * spans of Claude's layers on the candles shown.
 */
async function shownMarks($: EngineInterface, coin: string, candles: readonly Candle[]): Promise<Mark[]> {
  const alertLines = ((await read($, alerts)) ?? [])
    .filter(a => a.coin === coin && !a.when)
    .map((a): Mark => ({ coin: a.coin, kind: 'level', price: a.price, label: `alert ${a.dir}` }))
  return [...layerMarks((await read($, layerList)) ?? [], coin, candles), ...(await coinMarks($, coin)), ...alertLines]
}

/** This coin's marks, without those on candles bar replay hides (a note or trend line drawn later). */
async function coinMarks($: EngineInterface, coin: string): Promise<Mark[]> {
  const at = await read($, replay)
  return ((await read($, marks)) ?? []).filter(x => x.coin === coin && (at <= 0 || ((x.t ?? 0) <= at && (x.t2 ?? 0) <= at)))
}

/** "next 5d" or "next 5 sessions": the DaviddTech+ range's caption on the chart. */
function fanLabelOf(fan: { steps: number; unit: string } | null): string | null {
  return fan ? `next ${fan.steps}${fan.unit.startsWith('trading') ? ' sessions' : 'd'}` : null
}

/**
 * Saves the chart into lab-charts/ in the working folder: the picture as SVG (as the desktop pane draws it, the
 * app's theme and zoom) and every candle with its indicator columns as CSV. Files the person keeps and shares.
 */
async function saveChart($: EngineInterface): Promise<string> {
  const view = await seenChart($)
  if (!view || view.candles.length === 0) return `Open a chart first: /${CHART_COMMAND} BTC 1h, then /${CHART_COMMAND} save.`
  const list = await chartStudies($, view)
  const fc = await read($, forecast)
  const fan = fc && fc.coin === view.coin && fc.status === 'ok' ? fc.fan : null
  const svg = deskSvg(
    {
      candles: view.candles,
      cursor: 0,
      fan,
      palette: PALETTES[desk.options.palette],
      studies: list,
      marks: await shownMarks($, view.coin, view.candles),
      theme: desk.theme,
      pitch: ZOOM_PITCH[await read($, zoom)] ?? 8,
      compare: compareFor(await read($, compare), view),
      ghost: fan ? null : layerGhost((await read($, layerList)) ?? [], view.coin, view.candles),
    },
    view.interval,
    view.coin,
    fanLabelOf(fan),
  )
  const iso = new Date(await $.clock.now()).toISOString()
  const at = iso.slice(0, 16).replace('T', '_').replace(':', '')
  const file = `lab-charts/${view.coin.toLowerCase().replace(/[^a-z0-9]/g, '')}_${view.interval}_${at}`
  const csv = chartCsv(view, list, view.candles.length)
  const card = shareCard(svg, view.candles, view.coin, view.interval, iso.slice(0, 16).replace('T', ' '), desk.theme, PALETTES[desk.options.palette])
  try {
    await $.fs.write(`${file}.svg`, svg)
    await $.fs.write(`${file}_card.svg`, card)
    await $.fs.write(`${file}.csv`, csv.join('\n') + '\n')
  } catch (err) {
    return `Could not save the chart (${err instanceof Error ? err.message : String(err)}).`
  }
  return (
    `Saved ${file}.svg (the chart as drawn), ${file}_card.svg (a card to post, 1200 x 675) and ${file}.csv (${csv.length - 1} candles, ${list.length === 0 ? 'no indicators' : list.map(s => s.label).join(' · ')}). ` +
    `Open the card in a browser to share it, or ask Claude: "read ${file}.csv and tell me where RSI last crossed 70".`
  )
}

function marksLine(mine: readonly Mark[], now?: number): string {
  return mine.length > 0 ? `Marks: ${mine.map(m => markText(m, now)).join(' · ')}.` : ''
}

/** The DaviddTech Aid connector's check_pine, when the session has it: one line on every exported script. */
async function aidCheck($: EngineInterface, pine: string): Promise<string> {
  const tools = await $.tool.list().catch(() => [])
  const servers = tools.map(t => /^mcp__(.+)__check_pine$/.exec(t.name)?.[1]).filter((x): x is string => !!x)
  const server = servers.find(x => /aid/i.test(x)) ?? servers[0]
  if (!server) return 'With the DaviddTech Aid connector added (davidd.link/daviddtechaid), the export is checked by it too.'
  const scripts = pine.split(EXPORT_SPLIT).map(x => x.trim())
  const scores: string[] = []
  for (const code of scripts) {
    const r = await $.mcp.call(server, 'check_pine', { code }).catch(() => null)
    const sc = r && !r.isError ? (r.structuredContent as { score?: unknown; counts?: { red?: unknown; orange?: unknown } } | undefined) : undefined
    if (typeof sc?.score !== 'number') return 'DaviddTech Aid could not check it right now.'
    const red = Number(sc.counts?.red ?? 0)
    const orange = Number(sc.counts?.orange ?? 0)
    scores.push(red + orange > 0 ? `${sc.score}/100 (${red} red, ${orange} orange)` : `${sc.score}/100`)
  }
  return `DaviddTech Aid check: ${scores.length === 1 ? scores[0] : scores.map((x, i) => `script ${i + 1} ${x}`).join(' · ')}.`
}

/** The chart's indicators (and this coin's marks, for Pine) as code. */
async function exportText($: EngineInterface, lang: ExportLang): Promise<string | null> {
  const view = await read($, chart)
  if (!view) return null
  const ids = (await read($, studies)) ?? []
  const mine = await coinMarks($, view.coin)
  return lang === 'pine' ? pineScript(ids, view.coin, view.interval, mine) : pythonScript(ids, view.coin, view.interval)
}

/** The studies over these candles, in the order added. */
function studiesFor(ids: readonly string[] | null, candles: ChartView['candles']): Study[] {
  return candles.length === 0 ? [] : specsOf(ids).map(spec => compute(spec, candles))
}

type Options = { forecast: 'on' | 'off'; horizon: number; palette: PaletteName }

function optionsOf(raw: unknown): Options {
  const o = (raw ?? {}) as Record<string, unknown>
  return {
    forecast: o.forecast === 'off' ? 'off' : 'on',
    horizon: o.forecastHorizon === '20' ? 20 : 5,
    palette: o.palette === 'colorblind' ? 'colorblind' : 'classic',
  }
}

async function post($: EngineInterface, body: string): Promise<unknown> {
  const r = await $.http.fetch(INFO_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  if (!r.ok) throw new Error(`Hyperliquid answered ${r.status}`)
  return JSON.parse(r.text) as unknown
}

/** What the module keeps between calls; it starts over on a reload, and the engine drops the old timers then too. */
const desk: {
  options: Options
  chartTimer: Timer | null
  bandTimer: Timer | null
  marketRead: { at: number; value: Promise<Market | null> } | null
  /** When the running chart refresh started, or null; older than CHART_BUSY_MS counts as hung. */
  chartBusyAt: number | null
  /** A refresh was asked for while one ran; it runs again when that one ends. */
  isChartRerun: boolean
  /** The app's light or dark theme, read from /config at start and on each chart refresh; dark until known. */
  theme: Theme
  /** The 30 s alert check, while any alert waits. */
  alertTimer: Timer | null
} = { options: optionsOf({}), chartTimer: null, bandTimer: null, marketRead: null, chartBusyAt: null, isChartRerun: false, theme: 'dark', alertTimer: null }

/** Light when the person's theme says so ("light", "light-daltonized", ...), else dark. */
async function readTheme($: EngineInterface): Promise<void> {
  const rows = await $.config.list().catch(() => [])
  const row = rows.find(r => r.key === 'theme')
  desk.theme = typeof row?.value === 'string' && row.value.includes('light') ? 'light' : 'dark'
}

/** The market, read at most once per MARKET_FRESH_MS however many parts ask. */
async function marketNow($: EngineInterface): Promise<Market | null> {
  const now = await $.clock.now()
  if (!desk.marketRead || now - desk.marketRead.at >= MARKET_FRESH_MS) {
    const value = post($, CTX_BODY).then(raw => parseMarket(raw, now))
    desk.marketRead = { at: now, value }
    value.catch(() => {
      if (desk.marketRead?.value === value) desk.marketRead = null
    })
  }
  const m = await desk.marketRead.value
  if (m) await update($, market, () => m)
  return m
}

function stopChart($: EngineInterface) {
  desk.chartTimer?.cancel()
  desk.chartTimer = null
  $.ui.status(undefined)
}

function startChartTimer($: EngineInterface, interval: string) {
  desk.chartTimer?.cancel()
  desk.chartTimer = $.clock.every(refreshMs(interval), () => void chartTick($))
}

/** One refresh while the pane is placed; the timer stops once the pane is gone. */
async function chartTick($: EngineInterface) {
  const panes = await $.ui.panes().catch(() => [])
  const pane = panes.find(p => p.id === PANE_ID)
  if (!pane) return stopChart($)
  if (!pane.isPlaced) return
  await refreshChart($)
}

/** The status line from what the desk holds now: plain text, so "stale" is said in words. */
async function showStatus($: EngineInterface): Promise<void> {
  const view = await read($, chart)
  if (!view) return
  const at = await read($, replay)
  if (at > 0) return void $.ui.status(`Lab desk READ-ONLY · bar replay · ${view.coin} ${view.interval} at ${utcText(at)} UTC`)
  const m = await read($, market)
  $.ui.status(statusText(view.coin, m?.coins[view.coin], chartDataAt(view.at, m), await read($, checked), refreshMs(view.interval)))
}

async function refreshChart($: EngineInterface): Promise<void> {
  const view = await read($, chart)
  if (!view) return
  const now = await $.clock.now()
  await update($, checked, () => now)
  if (desk.chartBusyAt !== null && now - desk.chartBusyAt < CHART_BUSY_MS) {
    desk.isChartRerun = true
    await showStatus($)
    return
  }
  const startedAt = now
  desk.chartBusyAt = startedAt
  void readTheme($)
  desk.isChartRerun = false
  try {
    const [, raw] = await Promise.all([marketNow($).catch(() => null), post($, candleBody(view.coin, view.interval, now, candlesWanted(await read($, studies))))])
    const candles = parseCandles(raw)
    await update($, chart, v => (v && v.coin === view.coin && v.interval === view.interval ? { ...v, candles, at: now, error: null } : v))
    // The Compare coin follows the chart's interval; its failure never marks the chart stale.
    const cmp = await read($, compare)
    if (cmp && cmp.coin !== view.coin) {
      const other = await post($, candleBody(cmp.coin, view.interval, now, candlesWanted(await read($, studies))))
        .then(parseCandles)
        .catch(() => null)
      // A new interval gets a new anchor, the same number of candles back.
      if (other) await update($, compare, c => (c && c.coin === cmp.coin ? { ...c, interval: view.interval, candles: other, from: c.interval === view.interval ? c.from : compareAnchor(candles) } : c))
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await update($, chart, v => (v ? { ...v, error: message } : v))
  } finally {
    await showStatus($).catch(() => undefined)
    // Only the refresh that still owns the flag clears it (a hung one may have been passed over).
    if (desk.chartBusyAt === startedAt) {
      desk.chartBusyAt = null
      if (desk.isChartRerun) {
        desk.isChartRerun = false
        const next = await read($, chart)
        if (next && (next.coin !== view.coin || next.interval !== view.interval || next.at === 0)) await refreshChart($)
      }
    }
  }
}

/** Whether the forecast shown fits this coin and the current settings; a 'missing' or 'error' one goes stale after a minute. */
function isForecastCurrent(fc: ForecastView | null, coin: string, now: number): boolean {
  if (!fc || fc.coin !== coin) return false
  if ((fc.status === 'off') !== (desk.options.forecast === 'off')) return false
  if (fc.status === 'off') return true
  if (fc.horizon !== desk.options.horizon) return false
  if (fc.status === 'ask') return true
  if (fc.status === 'missing' || fc.status === 'error') return now - fc.at < FORECAST_RETRY_MS
  return true
}

/**
 * Asks DaviddTech+ for the coin's forecast at the live price (price_now). A guest account is asked first: the
 * range waits for its button (`isAsked`), since it costs one of the guest's few daily requests.
 */
async function loadForecast($: EngineInterface, coin: string, isAsked = false): Promise<void> {
  const horizon = desk.options.horizon
  const now = await $.clock.now()
  if (desk.options.forecast === 'off') {
    await update($, forecast, (): ForecastView => ({ coin, horizon, at: now, status: 'off', fan: null, note: '' }))
    return
  }
  const key = `forecast:${coin}:${horizon}`
  const saved = (await $.store.get(key).catch(() => undefined)) as { at?: number; view?: ForecastView } | undefined
  if (saved?.view && typeof saved.at === 'number' && now - saved.at < FORECAST_TTL_MS && saved.view.status === 'ok') {
    const kept: ForecastView = { ...saved.view, coin, horizon, at: saved.at }
    await update($, forecast, () => kept)
    return
  }
  const tools = await $.tool.list().catch(() => [])
  const price = (await read($, market))?.coins[coin]?.price ?? null
  const args = price !== null && price > 0 ? { symbol: symbolFor(coin), horizon, price_now: price } : { symbol: symbolFor(coin), horizon }
  let view: ForecastView = { coin, horizon, at: now, status: 'missing', fan: null, note: MISSING_HINT }
  for (const server of serverCandidates(tools)) {
    let answer: Awaited<ReturnType<EngineInterface['mcp']['call']>>
    if (!isAsked) {
      // get_usage is free; only its tier and counts are read. No answer or no tier: as for a member.
      const usage = await $.mcp.call(server, 'get_usage', {}).catch(() => null)
      const tier = usage && !usage.isError ? tierFrom(usage.structuredContent) : null
      if (tier?.tier === 'guest') {
        const isOut = tier.left !== null && tier.left <= 0
        view = { coin, horizon, at: now, status: isOut ? 'error' : 'ask', fan: null, note: guestNote(tier) }
        break
      }
    }
    try {
      answer = await $.mcp.call(server, 'analyze_asset', args)
    } catch {
      continue
    }
    if (answer.isError) {
      const why = firstText(answer.content as { type: string; text?: string }[])
      view = { coin, horizon, at: now, status: 'error', fan: null, note: `DaviddTech+ has no range for ${args.symbol} right now${why ? `: ${why}` : '.'}` }
      break
    }
    const fan = fanFrom(answer.structuredContent)
    view = fan
      ? { coin, horizon, at: now, status: 'ok', fan, note: '' }
      : { coin, horizon, at: now, status: 'error', fan: null, note: 'DaviddTech+ answered without a forecast path.' }
    break
  }
  await update($, forecast, () => view)
  if (view.status === 'ok') await $.store.set(key, { at: now, view }).catch(() => undefined)
}

/** Points the chart at a coin and interval, opens the pane and starts its refresh. */
async function showChart($: EngineInterface, coin: string, interval: string, focus: boolean): Promise<{ text: string }> {
  const before = await read($, chart)
  const isSwitch = !before || before.coin !== coin || before.interval !== interval
  const endsReplay = isSwitch && (await read($, replay)) > 0
  if (endsReplay) await update($, replay, () => 0)
  await update($, chart, () => ({ coin, interval, candles: before?.coin === coin && before.interval === interval ? before.candles : [], at: 0, error: null }))
  await update($, cursor, () => 0)
  const opened = await $.ui
    .open(focus ? { id: PANE_ID, title: `${coin} ${interval}`, focus: true } : { id: PANE_ID, title: `${coin} ${interval}` })
    .catch((err: unknown) => ({ isPlaced: false as const, reason: err instanceof Error ? err.message : String(err) }))
  await refreshChart($)
  startChartTimer($, interval)
  const fc = await read($, forecast)
  if (!isForecastCurrent(fc, coin, await $.clock.now())) await loadForecast($, coin)
  const m = await read($, market)
  const ctx = m?.coins[coin]
  const facts =
    (await read($, replay)) > 0
      ? `${coin} in bar replay`
      : ctx
        ? `${coin} ${fmtPrice(ctx.price)} · 24h ${fmtPct(changePct(ctx))} · ${fundingText(ctx.funding)}`
        : `${coin}`
  const placed = opened.isPlaced ? `${coin} ${interval} chart open, refreshing every ${refreshMs(interval) / 1000} s.` : `The chart pane could not open here (${opened.reason}).`
  return { text: `${placed} ${facts}.${endsReplay ? ' Bar replay ended with the switch.' : ''}` }
}

/** The indicators' values at the last candle, one line each: "EMA 50 64,210". */
function valueLines(list: readonly Study[], back = 0): string[] {
  return list.map(st => `${st.label}: ${valuesAt(st, back, n => fmtStudy(st, n, fmtPrice))}`)
}

/**
 * Changes the indicators on the chart and saves the list; opens a BTC 1h chart when none is up, and asks for
 * more candles when a new indicator needs a longer warm-up.
 */
async function applyChange($: EngineInterface, change: Change): Promise<{ text: string; ids: string[] }> {
  const before = (await read($, studies)) ?? []
  const result = changeList(before, change)
  await update($, studies, () => result.ids)
  await $.store.set('studies', result.ids).catch(() => undefined)
  const view = await read($, chart)
  const panes = await $.ui.panes().catch(() => [])
  let opened = ''
  if (!view || !panes.some(p => p.id === PANE_ID)) {
    const m = await marketNow($).catch(() => null)
    const coin = view?.coin ?? resolveCoin(m, 'BTC') ?? 'BTC'
    await showChart($, coin, view?.interval ?? '1h', true)
    opened = `Opened the ${coin} ${view?.interval ?? '1h'} chart. `
  } else if (view.candles.length < candlesWanted(result.ids)) {
    await refreshChart($)
  }
  const parts = [
    result.added.length > 0 ? `Added ${listText(result.added)}.` : '',
    result.removed.length > 0 ? `Removed ${listText(result.removed)}.` : '',
    ...result.notes,
    `On the chart: ${listText(result.ids)}.`,
  ].filter(x => x !== '')
  return { text: opened + parts.join(' '), ids: result.ids }
}

/** At most this many saved layouts. */
const MAX_LAYOUTS = 20

/** Saved indicator layouts by name (TradingView calls them indicator templates); bad entries are dropped. */
async function layoutsOf($: EngineInterface): Promise<Record<string, string[]>> {
  const saved = await $.store.get('layouts').catch(() => undefined)
  const out: Record<string, string[]> = {}
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return out
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string')
  return out
}

/** "Swing Setup!" → "swing setup": lower case, letters, digits, space, - and _, up to 24 characters. */
function layoutName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
}

function layoutsText(all: Record<string, string[]>): string {
  const names = Object.keys(all)
  if (names.length === 0) return `No layouts saved yet. Paint some indicators, then /${IND_COMMAND} save swing.`
  return [`Layouts (/${IND_COMMAND} load <name>):`, ...names.map(n => `· ${n}: ${listText(all[n])}`)].join('\n')
}

/** Saves what is on the chart now under a name; the same name updates it. */
async function saveLayout($: EngineInterface, raw: string): Promise<string> {
  const name = layoutName(raw)
  if (name === '') return `Give it a name: /${IND_COMMAND} save swing.`
  const ids = (await read($, studies)) ?? []
  if (ids.length === 0) return `Nothing to save yet: add indicators first, e.g. /${IND_COMMAND} ema 50, rsi.`
  const all = await layoutsOf($)
  const isNew = !(name in all)
  if (isNew && Object.keys(all).length >= MAX_LAYOUTS) return `${MAX_LAYOUTS} layouts at most; /${IND_COMMAND} forget <name> makes room.`
  all[name] = [...ids]
  try {
    await $.store.set('layouts', all)
  } catch (err) {
    return `Could not save the layout (${err instanceof Error ? err.message : String(err)}).`
  }
  return `${isNew ? 'Saved' : 'Updated'} layout "${name}": ${listText(ids)}. Put it on any chart: /${IND_COMMAND} load ${name}.`
}

/** Swaps the chart's indicators for a saved layout's. */
async function loadLayout($: EngineInterface, raw: string): Promise<string> {
  const name = layoutName(raw)
  const all = await layoutsOf($)
  const ids = all[name]
  if (!ids) {
    const names = Object.keys(all)
    return names.length > 0 ? `No layout called "${name}". Yours: ${names.join(', ')}.` : layoutsText(all)
  }
  const done = await applyChange($, { clear: true, add: ids })
  return `Loaded "${name}". ${done.text}`
}

async function bandTick($: EngineInterface) {
  const coins = await read($, watch)
  if (!coins) {
    desk.bandTimer?.cancel()
    desk.bandTimer = null
    return
  }
  const now = await $.clock.now()
  await update($, checked, () => now)
  await marketNow($).catch(() => null)
}

function startBand($: EngineInterface) {
  desk.bandTimer?.cancel()
  desk.bandTimer = $.clock.every(BAND_MS, () => void bandTick($))
  void bandTick($)
}

export const register: Register = (on, rawOptions) => {
  desk.options = optionsOf(rawOptions)
  desk.chartTimer = null
  desk.bandTimer = null
  desk.marketRead = null
  desk.chartBusyAt = null
  desk.isChartRerun = false
  desk.alertTimer = null

  on('session.start', async ($, e, next) => {
    await $.command
      .register({ name: 'lab-chart', description: 'Live Hyperliquid candle chart in a pane', argumentHint: '[coin] [interval] | close | reset' })
      .catch(() => undefined)
    await $.command
      .register({ name: 'lab-watch', description: 'Watchlist of up to 6 coins above the prompt', argumentHint: '[coins] | off' })
      .catch(() => undefined)
    await $.command
      .register({ name: IND_COMMAND, description: 'Indicators on the chart: ema 50, bb, rsi, stoch rsi, macd, adx, vwap, or a set: trend, momentum', argumentHint: '[indicator] | remove [indicator] | clear | help' })
      .catch(() => undefined)
    await $.command
      .register({ name: MENU_COMMAND, description: 'Lab desk: open the chart and see everything it can do; /lab tour for a guided try-out', argumentHint: '[tour]' })
      .catch(() => undefined)
    await $.command
      .register({ name: ALERT_COMMAND, description: 'Alert, said once: BTC above 65000, or a condition: SOL rsi < 30', argumentHint: '[coin] [above|below] [price] | [coin] [condition] | remove [n] | clear' })
      .catch(() => undefined)
    await $.command
      .register({ name: AFTER_COMMAND, description: 'What happened after a condition, over years of candles: rsi < 30, golden cross on 1d', argumentHint: '[condition] [on 4h] [ahead 10]' })
      .catch(() => undefined)
    await $.command
      .register({ name: LIKE_COMMAND, description: 'Moments like now: the closest past shapes and what came after them', argumentHint: '[coin] [interval] [ahead 10]' })
      .catch(() => undefined)
    await $.command
      .register({ name: TEST_COMMAND, description: 'Honest test: enter when A, exit when B, fees and funding, seen and unseen parts, a luck check', argumentHint: '[enter] exit [exit] | hold [N] [short] [across BTC ETH SOL] [on 4h]' })
      .catch(() => undefined)
    await $.command
      .register({ name: SCAN_COMMAND, description: 'Check the watchlist for one condition: oversold, uptrend, golden cross, rsi < 30, close > ema 200', argumentHint: '[condition or name] [on 4h]' })
      .catch(() => undefined)
    await $.command
      .register({ name: MARK_COMMAND, description: 'Draw on the chart: 65000 resistance, 58000 60000 demand, trend lows, fib', argumentHint: '[price] [label] | [price] [price] [label] | trend lows|highs | fib [from to] | clear' })
      .catch(() => undefined)
    await $.tool.register(CHART_TOOL).catch(() => undefined)
    await $.tool.register(READ_TOOL).catch(() => undefined)
    await $.tool.register(HISTORY_TOOL).catch(() => undefined)
    await $.tool.register(TEST_TOOL).catch(() => undefined)
    // The indicators come back as the person left them.
    if ((await read($, studies)) === null) {
      const saved = await $.store.get('studies').catch(() => undefined)
      if (Array.isArray(saved) && saved.every(c => typeof c === 'string')) {
        const ids = specsOf(saved as string[]).length > 0 ? (saved as string[]) : []
        await update($, studies, () => ids)
      }
    }
    if ((await read($, marks)) === null) {
      const saved = await $.store.get('marks').catch(() => undefined)
      if (Array.isArray(saved)) {
        const ok = (saved as unknown[]).filter((x): x is Mark => {
          const o = x as Partial<Mark> | null
          return (
            !!o &&
            typeof o.coin === 'string' &&
            typeof o.price === 'number' &&
            typeof o.label === 'string' &&
            (o.kind === 'level' || o.kind === 'zone' || o.kind === 'note' || o.kind === 'trend' || o.kind === 'fib')
          )
        })
        await update($, marks, () => ok)
      }
    }
    if ((await read($, layerList)) === null) {
      const saved = await $.store.get('layers').catch(() => undefined)
      await update($, layerList, () => layersFromStore(saved))
    }
    if ((await read($, alerts)) === null) {
      const saved = await $.store.get('alerts').catch(() => undefined)
      const ok = Array.isArray(saved)
        ? (saved as unknown[]).filter((x): x is PriceAlert => {
            const o = x as Partial<PriceAlert> | null
            return !!o && typeof o.coin === 'string' && typeof o.price === 'number' && (o.dir === 'above' || o.dir === 'below') && typeof o.note === 'string'
          })
        : []
      await update($, alerts, () => ok)
    }
    // Alerts set in an earlier session keep being checked.
    if (((await read($, alerts)) ?? []).length > 0) await setAlerts($, all => all)
    // The watchlist is the person's choice from an earlier /lab-watch: it comes back on.
    if ((await read($, watch)) === null) {
      const saved = await $.store.get('watch').catch(() => undefined)
      if (Array.isArray(saved) && saved.every(c => typeof c === 'string') && saved.length > 0) {
        const coins = saved as string[]
        await update($, watch, () => coins.slice(0, 6))
      }
    }
    if ((await read($, watch)) !== null) startBand($)
    // A reload with the pane still up picks its refresh back up.
    const view = await read($, chart)
    const panes = await $.ui.panes().catch(() => [])
    if (view && panes.some(p => p.id === PANE_ID)) startChartTimer($, view.interval)
    return next(e)
  })

  // The tour: after a command that counts as the step waited for, the next step's words and command.
  on('command.run', async ($, e, next) => {
    const r = await next(e)
    const at = await read($, tour)
    // Off the tour: the reply's "Next:" step goes in the empty prompt box as a dim suggestion, Tab takes it.
    if (at === 0 && e.command.startsWith('lab')) {
      const text = nextSuggestion(r.text ?? '')
      if (text && text !== `/${e.command} ${e.args}`.trim()) void suggestSoon($, text)
      return r
    }
    const step = at > 0 ? TOUR[at - 1] : undefined
    if (!step || !step.done(e.command, e.args)) return r
    // Move on only when the step worked (a refused coin, a full chart or a scan in replay leaves the tour where it is).
    if (!(await tourHolds($, at - 1, r.text ?? '', e.args))) return r
    await update($, tour, () => (at >= TOUR.length ? 0 : at + 1))
    const say = await tourFill($, at)
    return { ...r, text: `${r.text ?? ''}\n\n${say}`.trim() }
  })

  on('command.run', { command: 'lab-chart' }, async ($, e) => {
    const words = e.args.trim().split(/\s+/).filter(w => w !== '')
    if (words[0]?.toLowerCase() === 'close') {
      await $.ui.close({ id: PANE_ID }).catch(() => undefined)
      stopChart($)
      return { text: 'Chart pane closed.' }
    }
    if (words[0]?.toLowerCase() === 'save') return { text: await saveChart($) }
    if (words[0]?.toLowerCase() === 'replay') {
      const rest = words.slice(1).join(' ')
      if (/^(off|stop|live|exit)$/i.test(rest)) return { text: await stopReplay($) }
      return { text: await startReplay($, rest) }
    }
    if (words[0]?.toLowerCase() === 'compare') {
      const what = words.slice(1).join(' ')
      if (what === '') return { text: `Compare with which coin? /${CHART_COMMAND} compare ETH lays it over the chart as a % line; /${CHART_COMMAND} compare off.` }
      if (/^(off|none|clear|stop)$/i.test(what)) return { text: await stopCompare($) }
      return { text: await startCompare($, what) }
    }
    if (words[0]?.toLowerCase() === 'next') {
      const n = Number(words[1] ?? 1)
      return { text: await stepReplay($, Number.isFinite(n) && n !== 0 ? Math.round(n) : 1) }
    }
    if (words[0]?.toLowerCase() === 'reset') {
      // Undo everything the desk keeps: the pane, both refreshes, and every saved key (watchlist, forecast copies).
      await $.ui.close({ id: PANE_ID }).catch(() => undefined)
      stopChart($)
      desk.bandTimer?.cancel()
      desk.bandTimer = null
      await update($, watch, () => null)
      await update($, chart, () => null)
      await update($, forecast, () => null)
      await update($, studies, () => null)
      await update($, marks, () => null)
      await update($, alerts, () => null)
      await update($, replay, () => 0)
      await update($, compare, () => null)
      await update($, layerList, () => null)
      desk.alertTimer?.cancel()
      desk.alertTimer = null
      const keys = await $.store.keys().catch((): string[] => [])
      for (const key of keys) await $.store.delete(key).catch(() => undefined)
      const wiped = keys.length === 1 ? '1 saved item wiped' : `${keys.length} saved items wiped`
      return { text: `Desk reset: chart closed, watchlist off, ${wiped}. The desk keeps nothing now.` }
    }
    let typedCoin: string | null = null
    let interval: string | null = null
    for (const w of words) {
      const iv = intervalOf(w)
      if (iv && interval === null) interval = iv
      else if (typedCoin === null) typedCoin = w
      else return { text: `Usage: /${CHART_COMMAND} [coin] [interval], e.g. /${CHART_COMMAND} BTC 1h. Intervals: 1m 5m 15m 1h 4h 1d 1w.` }
    }
    const previous = await read($, chart)
    interval = interval ?? previous?.interval ?? '1h'
    let m: Market | null
    try {
      m = await marketNow($)
    } catch (err) {
      return { text: `Hyperliquid could not be reached (${err instanceof Error ? err.message : String(err)}). Try again in a moment.` }
    }
    const coin = resolveCoin(m, typedCoin ?? previous?.coin ?? 'BTC')
    if (!coin) return { text: `No perp named ${typedCoin} on Hyperliquid. Try BTC, ETH, SOL or HYPE.` }
    const shown = await showChart($, coin, interval, true)
    const isWatchOn = (await read($, watch)) !== null
    const tip = isWatchOn
      ? `Next: the interval buttons in the pane switch candles, or /${CHART_COMMAND} ETH 15m opens another coin.`
      : `Next: /${WATCH_COMMAND} puts ${DEFAULT_WATCH.join(' ')} above the prompt.`
    return { text: `${shown.text} ${tip}` }
  })

  on('command.run', { command: 'lab-watch' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg.toLowerCase() === 'off') {
      desk.bandTimer?.cancel()
      desk.bandTimer = null
      await update($, watch, () => null)
      await $.store.delete('watch').catch(() => undefined)
      return { text: `Watchlist off. /${WATCH_COMMAND} brings it back.` }
    }
    const typed = watchArgs(arg)
    const current = await read($, watch)
    const coins = typed.length > 0 ? typed : current ?? DEFAULT_WATCH
    let m: Market | null = null
    try {
      m = await marketNow($)
    } catch {
      m = await read($, market)
    }
    const names = watchNames(coins, m)
    const unknown = m ? names.filter(c => !m?.coins[c]) : []
    await update($, watch, () => names)
    await $.store.set('watch', names).catch(() => undefined)
    startBand($)
    const missing = unknown.length > 0 ? ` Not on Hyperliquid perps: ${unknown.join(', ')}.` : ''
    return {
      text: `Watchlist above the prompt: ${names.join(', ')} (refreshes every ${BAND_MS / 1000} s).${missing} Next: press a coin in it to open its chart, or /${WATCH_COMMAND} off hides it.`,
    }
  })

  on('command.run', { command: MENU_COMMAND }, async ($, e) => {
    const sub = e.args.trim().toLowerCase()
    if (/^tour\s+(off|stop|end)$/.test(sub)) {
      await update($, tour, () => 0)
      return { text: `Tour off. /${MENU_COMMAND} tour starts it again.` }
    }
    if (sub === 'tour') {
      // The tour reads live candles (the scan step), so it starts live.
      if ((await read($, replay)) > 0) await stopReplay($)
      await update($, tour, () => 1)
      return { text: await tourFill($, 0) }
    }
    const view = await read($, chart)
    const panes = await $.ui.panes().catch(() => [])
    let opened = ''
    if (!view || !panes.some(p => p.id === PANE_ID)) {
      let m: Market | null = null
      try {
        m = await marketNow($)
      } catch (err) {
        return { text: `Hyperliquid could not be reached (${err instanceof Error ? err.message : String(err)}). Try /${MENU_COMMAND} again in a moment.` }
      }
      const coin = view?.coin ?? resolveCoin(m, 'BTC') ?? 'BTC'
      await showChart($, coin, view?.interval ?? '1h', true)
      opened = `${coin} ${view?.interval ?? '1h'} chart open. `
    }
    const ids = (await read($, studies)) ?? []
    return {
      text: [
        `Lab desk, read-only. ${opened}Indicators: ${listText(ids)}.`,
        `· /${MENU_COMMAND} tour: a 2-minute guided try-out, one command at a time`,
        `· /${CHART_COMMAND} ETH 4h: another coin or interval (buttons in the pane too)`,
        `· /${IND_COMMAND} ema 50, rsi: paint indicators; sets: ${Object.keys(PRESETS).join(', ')} (chips under the chart)`,
        `· /${SCAN_COMMAND} oversold (or uptrend, golden cross, rsi < 30): check every watchlist coin for one condition`,
        `· /${AFTER_COMMAND} rsi < 30: what happened after it, over years of candles, against any candle`,
        `· /${LIKE_COMMAND}: moments like now, the closest past shapes and what came after them, drawn ahead`,
        `· /${TEST_COMMAND} rsi < 30 exit rsi > 50: the honest test, with fees, funding, an unseen part and a luck check; add across BTC ETH SOL for several coins`,
        `· /${MARK_COMMAND} 65000 resistance: draw a level; two prices draw a zone; trend lows, fib: drawing tools`,
        `· /${IND_COMMAND} export pine (or python): take the indicators to TradingView or a notebook`,
        `· /${CHART_COMMAND} save: the chart as a picture (SVG) and its numbers (CSV) in lab-charts/`,
        `· /${CHART_COMMAND} compare ETH: another coin over the chart as a % line`,
        `· /${CHART_COMMAND} replay: bar replay, the later candles hidden; Next (n) shows one more, practise reading the chart`,
        `· /${ALERT_COMMAND} BTC above 65000 or /${ALERT_COMMAND} SOL rsi < 30: told once when it happens`,
        `· /${WATCH_COMMAND}: live prices above the prompt`,
        '· Or just ask: "show SOL 4h with RSI and the 200 EMA", "what happened after a golden cross on BTC 1d?", "test going long at RSI under 30"',
      ].join('\n'),
    }
  })

  on('command.run', { command: IND_COMMAND }, async ($, e) => {
    const arg = e.args.trim()
    const lower = arg.toLowerCase()
    if (arg === '' || lower === 'list' || lower === 'help') {
      const ids = (await read($, studies)) ?? []
      const view = await seenChart($)
      const values = view && ids.length > 0 ? valueLines(studiesFor(ids, view.candles)) : []
      return {
        text: [
          `On the chart: ${listText(ids)}.${values.length > 0 ? ' ' + values.join(' · ') + '.' : ''}`,
          `Add one: /${IND_COMMAND} ema 50 · /${IND_COMMAND} bb · /${IND_COMMAND} rsi. Sets: ${Object.keys(PRESETS).join(', ')}.`,
          `Your own, in Pine: /${IND_COMMAND} plot ta.ema(close, 20) - ta.ema(close, 50) (a price level draws on the chart, anything else in a pane).`,
          `Remove: /${IND_COMMAND} remove ema (all EMAs) or /${IND_COMMAND} clear. Up to ${MAX_STUDIES}, ${MAX_LOWER} lower panes.`,
          `New to one? /${IND_COMMAND} what rsi says what it measures and how people read it.`,
          `Take them with you: /${IND_COMMAND} export pine (TradingView) or /${IND_COMMAND} export python.`,
          `Keep a setup: /${IND_COMMAND} save swing, then /${IND_COMMAND} load swing on any chart; /${IND_COMMAND} layouts lists them.`,
          ...(lower === 'help' ? helpLines() : []),
          'Or ask Claude: "paint the 200 EMA and RSI on SOL 4h".',
        ].join('\n'),
      }
    }
    if (lower === 'clear' || lower === 'off') return { text: (await applyChange($, { clear: true })).text }
    if (lower === 'layouts' || lower === 'load') return { text: layoutsText(await layoutsOf($)) }
    const learnAsk = /^(what|explain|learn)(?:\s+(?:is\s+)?(.+?))?\??$/.exec(lower)
    if (learnAsk) return { text: await learnText($, learnAsk[2] ?? '') }
    const lay = /^(save|load|forget)(?:\s+(.+))?$/.exec(lower)
    if (lay) {
      const what = lay[2] ?? ''
      if (lay[1] === 'save') return { text: await saveLayout($, what) }
      if (lay[1] === 'load') return { text: await loadLayout($, what) }
      const all = await layoutsOf($)
      const name = layoutName(what)
      if (!(name in all)) return { text: `No layout called "${name}". ${layoutsText(all)}` }
      delete all[name]
      await $.store.set('layouts', all).catch(() => undefined)
      return { text: `Forgot layout "${name}".` }
    }
    const ex = /^export(?:\s+(pine|python|py))?$/.exec(lower)
    if (ex) {
      const lang: ExportLang = ex[1] === 'python' || ex[1] === 'py' ? 'python' : 'pine'
      const view = await read($, chart)
      const code = await exportText($, lang)
      if (!view || code === null) return { text: `Open a chart first: /${CHART_COMMAND} BTC 1h, then /${IND_COMMAND} export.` }
      const how =
        lang === 'pine'
          ? 'Pine Script v6, written with the DaviddTech Aid rules. Paste each script into TradingView\'s Pine editor and add it to the chart.'
          : 'Python 3.9+ with pandas. It fetches the same Hyperliquid candles and adds every indicator as a column.'
      return {
        text: [
          `${view.coin} ${view.interval}: ${listText((await read($, studies)) ?? [])} as ${lang === 'pine' ? 'Pine' : 'Python'}. ${how}`,
          '```' + (lang === 'pine' ? 'pine' : 'python'),
          code,
          '```',
          ...(lang === 'pine' ? [await aidCheck($, code)] : []),
          `Save it as ${exportFile(lang, view.coin, view.interval)}, or ask Claude: "save this as a file and add a 200 EMA cross alert". Other language: /${IND_COMMAND} export ${lang === 'pine' ? 'python' : 'pine'}.`,
        ].join('\n'),
      }
    }
    const m = /^(remove|rm|del|delete|-)\s+(.+)$/.exec(lower)
    // Commas inside a formula's brackets stay with it: "ema 20, plot ta.ema(close, 20) - close".
    const items = splitTop(m ? m[2] ?? '' : arg.replace(/^(add|\+)\s+/i, ''))
    const done = await applyChange($, m ? { remove: items } : { add: items })
    return { text: `${done.text} Next: /${IND_COMMAND} lists values, /${IND_COMMAND} clear removes all.` }
  })

  on('command.run', { command: SCAN_COMMAND }, async ($, e) => ({ text: await runScan($, e.args) }))

  on('command.run', { command: AFTER_COMMAND }, async ($, e) => {
    const m = /\s+ahead\s+(\d+)\s*$/i.exec(e.args)
    const when = m ? e.args.slice(0, m.index) : e.args
    if (when.trim() === '') return { text: `Try: /${AFTER_COMMAND} rsi < 30 · /${AFTER_COMMAND} golden cross on 1d · /${AFTER_COMMAND} close crosses above ema 200 on 4h ahead 20` }
    return { text: await runAfter($, { when, ahead: m ? Number(m[1]) : undefined }) }
  })

  on('command.run', { command: LIKE_COMMAND }, async ($, e) => {
    const words = e.args.trim().split(/\s+/).filter(w => w !== '')
    let coin: string | undefined
    let interval: string | undefined
    let ahead: number | undefined
    for (let k = 0; k < words.length; k++) {
      const w = words[k] as string
      if (/^ahead$/i.test(w) && words[k + 1]) ahead = Number(words[++k])
      else if (intervalOf(w)) interval = w
      else coin = w
    }
    return { text: await runLike($, { coin, interval, ahead }) }
  })

  on('command.run', { command: TEST_COMMAND }, async ($, e) => {
    const t = parseTestWords(e.args)
    if (!t) return { text: `Try: /${TEST_COMMAND} rsi < 30 exit rsi > 50 · /${TEST_COMMAND} ema 20 crosses above ema 50 exit ema 20 crosses below ema 50 on 4h · /${TEST_COMMAND} rsi > 70 hold 12 short · /${TEST_COMMAND} rsi < 30 exit rsi > 50 across BTC ETH SOL` }
    return { text: await runTestTool($, t) }
  })

  on('tool.run', { tool: HISTORY_TOOL_NAME }, async ($, e) => {
    const input = e as unknown as { mode?: unknown; when?: unknown; coin?: unknown; interval?: unknown; ahead?: unknown; window?: unknown; mark?: unknown }
    return { result: input.mode === 'like' || (input.mode !== 'after' && typeof input.when !== 'string') ? await runLike($, input) : await runAfter($, input) }
  })

  on('tool.run', { tool: TEST_TOOL_NAME }, async ($, e) => {
    const input = e as unknown as { enter?: unknown; exit?: unknown; hold?: unknown; side?: unknown; fee?: unknown; coin?: unknown; interval?: unknown; mark?: unknown }
    return { result: await runTestTool($, input) }
  })

  on('command.run', { command: ALERT_COMMAND }, async ($, e) => {
    const arg = e.args.trim()
    const lower = arg.toLowerCase()
    const list = (await read($, alerts)) ?? []
    const usage = `Set: /${ALERT_COMMAND} BTC above 65000 · /${ALERT_COMMAND} SOL 200 · condition: /${ALERT_COMMAND} SOL rsi < 30 · remove: /${ALERT_COMMAND} remove 1 · /${ALERT_COMMAND} clear. Up to ${MAX_ALERTS}, checked every 30 s while Claude Code is open.`
    if (arg === '' || lower === 'list') {
      const lines = list.map((a, i) => `${i + 1}. ${alertText(a)}`)
      return { text: [list.length > 0 ? `Alerts waiting:` : 'No alerts set.', ...lines, usage].join('\n') }
    }
    if (lower === 'clear' || lower === 'off') {
      await setAlerts($, () => [])
      return { text: list.length > 0 ? `${list.length === 1 ? '1 alert' : `${list.length} alerts`} cleared.` : 'No alerts set.' }
    }
    const rm = /^(remove|rm|del|delete|-)\s+(\d+)$/.exec(lower)
    if (rm) {
      const k = Number(rm[2]) - 1
      const gone = list[k]
      if (!gone) return { text: `No alert ${k + 1}. /${ALERT_COMMAND} lists them.` }
      await setAlerts($, all => all.filter((_, i) => i !== k))
      return { text: `Removed ${alertText(gone)}.` }
    }
    if (list.length >= MAX_ALERTS) return { text: `${MAX_ALERTS} alerts at most. /${ALERT_COMMAND} remove 1 makes room.` }
    const m = await marketNow($).catch(() => null)
    const view = await read($, chart)
    // "SOL rsi < 30": a condition alert, read like /lab-scan.
    const when = await addWhenAlert($, arg, m, view?.coin ?? null, view?.interval ?? null)
    if (when !== null) return { text: `${when} /${ALERT_COMMAND} lists them.` }
    const a = parseAlert(arg, m, view?.coin ?? null, await $.clock.now())
    if ('error' in a) return { text: a.error }
    await setAlerts($, all => [...all, a])
    return { text: `Alert set: ${alertText(a)}. The desk tells you once when it gets there. /${ALERT_COMMAND} lists them.` }
  })

  on('command.run', { command: MARK_COMMAND }, async ($, e) => {
    const arg = e.args.trim()
    const lower = arg.toLowerCase()
    const view = await read($, chart)
    if (!view) return { text: `Open a chart first: /${CHART_COMMAND} BTC 1h, then /${MARK_COMMAND} 65000 resistance.` }
    if (arg === '' || lower === 'list') {
      const list = await coinMarks($, view.coin)
      const lastT = ((await seenChart($)) ?? view).candles.at(-1)?.t
      return {
        text: [
          list.length > 0 ? `${view.coin} marks: ${list.map(m => markText(m, lastT)).join(' · ')}.` : `No marks on ${view.coin} yet.`,
          `Level: /${MARK_COMMAND} 65000 resistance · zone: /${MARK_COMMAND} 58000 60000 demand · /${MARK_COMMAND} clear. Up to ${MAX_MARKS} per coin.`,
          `Trend line: /${MARK_COMMAND} trend lows (or highs) · Fibonacci: /${MARK_COMMAND} fib (the recent swing) or /${MARK_COMMAND} fib 58000 65000.`,
          'Or ask Claude: "mark the support and resistance on this chart".',
        ].join('\n'),
      }
    }
    if (lower === 'clear' || lower === 'off') {
      await setMarks($, all => all.filter(x => x.coin !== view.coin))
      return { text: `Marks cleared on ${view.coin}.` }
    }
    const seen = (await seenChart($)) ?? view
    const m = parseMark(view.coin, arg, seen.candles)
    if ('error' in m) return { text: m.error }
    await setMarks($, all => addMarks(all, [m]))
    return { text: `Drew ${markText(m, view.candles.at(-1)?.t)} on ${view.coin}. /${MARK_COMMAND} lists them, /${MARK_COMMAND} clear removes them.` }
  })

  on('tool.run', { tool: CHART_TOOL_NAME }, async ($, e) => {
    const input = e as unknown as { coin?: unknown; interval?: unknown; add?: unknown; remove?: unknown; clear?: unknown; marks?: unknown; clear_marks?: unknown; alerts?: unknown; remove_alerts?: unknown; clear_alerts?: unknown; save?: unknown; layout?: unknown; save_layout?: unknown; replay?: unknown; compare?: unknown; layers?: unknown; remove_layers?: unknown; clear_layers?: unknown }
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : [])
    const notes: string[] = []
    const view = await read($, chart)
    let coin = view?.coin ?? 'BTC'
    let interval = view?.interval ?? '1h'
    if (typeof input.interval === 'string') {
      const iv = intervalOf(input.interval)
      if (iv) interval = iv
      else notes.push(`Unknown interval ${input.interval}; kept ${interval}. Intervals: 1m 5m 15m 1h 4h 1d 1w.`)
    }
    if (typeof input.coin === 'string') {
      const m = await marketNow($).catch(() => null)
      const found = resolveCoin(m, input.coin)
      if (found) coin = found
      else notes.push(`No Hyperliquid perp named ${input.coin}; kept ${coin}.`)
    }
    const panes = await $.ui.panes().catch(() => [])
    if (!view || view.coin !== coin || view.interval !== interval || !panes.some(p => p.id === PANE_ID)) await showChart($, coin, interval, true)
    if (typeof input.layout === 'string' && input.layout.trim() !== '') notes.push(await loadLayout($, input.layout))
    if (typeof input.compare === 'string' && input.compare.trim() !== '') {
      notes.push(/^(off|none|clear|stop)$/i.test(input.compare.trim()) ? await stopCompare($) : await startCompare($, input.compare.trim()))
    }
    if (typeof input.replay === 'string' && input.replay.trim() !== '') {
      const r = input.replay.trim().toLowerCase()
      const step = /^next(?:\s+(-?\d+))?$/.exec(r)
      notes.push(
        /^(off|stop|live|exit)$/.test(r) ? await stopReplay($) : step ? await stepReplay($, Number(step[1] ?? 1) || 1) : await startReplay($, input.replay),
      )
    }
    const change: Change = { add: strings(input.add), remove: strings(input.remove), clear: input.clear === true }
    const changed = change.clear || (change.add?.length ?? 0) > 0 || (change.remove?.length ?? 0) > 0 ? await applyChange($, change) : null
    // Marks go on the coin now shown, snapped to the candles the person sees.
    const shown = await seenChart($)
    if (input.clear_marks === true) {
      await setMarks($, all => all.filter(x => x.coin !== coin))
      notes.push(`Marks cleared on ${coin}.`)
    }
    if (Array.isArray(input.marks) && input.marks.length > 0) {
      const made = (input.marks as unknown[]).map(raw => markFrom(coin, raw, shown?.candles ?? []))
      const good = made.filter((x): x is Mark => x !== null)
      if (good.length > 0) await setMarks($, all => addMarks(all, good))
      if (good.length < made.length) notes.push(`${made.length - good.length} mark(s) skipped: each needs a price, or a time inside the chart for a note.`)
    }
    // Layers: clearing and removing first, so one call can redraw a layer from scratch.
    if (input.clear_layers === true) {
      const had = ((await read($, layerList)) ?? []).filter(l => l.coin === coin).length
      await setLayers($, ((await read($, layerList)) ?? []).filter(l => l.coin !== coin))
      notes.push(had > 0 ? `Layers cleared on ${coin}.` : `No layers were on ${coin}.`)
    }
    const rmLayers = strings(input.remove_layers)
    if (rmLayers.length > 0) {
      const r = removeLayers((await read($, layerList)) ?? [], coin, rmLayers)
      await setLayers($, r.next)
      notes.push(...r.notes)
    }
    if (input.layers !== undefined && input.layers !== null) {
      const before = (await read($, layerList)) ?? []
      const r = addLayers(before, coin, input.layers, shown?.candles ?? [], await $.clock.now())
      if (r.next !== before) await setLayers($, r.next)
      const added = r.next.filter(l => l.coin === coin && !before.includes(l))
      if (added.length > 0) notes.push(`Painted ${added.map(l => l.name).join(', ')} on ${coin}.`)
      notes.push(...r.notes)
      // Only two lower panes show; indicators come first.
      const view = await seenChart($)
      if (view) {
        const lowers = (await chartStudies($, view)).filter(s => s.pane === 'lower')
        const hidden = lowers.slice(2).filter(s => s.id.startsWith('layer ')).map(s => s.label)
        if (hidden.length > 0) notes.push(`Not shown: ${hidden.join(', ')} (2 lower panes at most; take an indicator off or use pane "price").`)
      }
    }
    // Removing comes before setting, so "move my SOL alert to 150" works in one call.
    if (input.clear_alerts === true) {
      const n = ((await read($, alerts)) ?? []).length
      await setAlerts($, () => [])
      notes.push(n > 0 ? `${n === 1 ? '1 alert' : `${n} alerts`} cleared.` : 'No alerts were set.')
    }
    const rmCoins = strings(input.remove_alerts).map(x => x.trim().toUpperCase()).filter(x => x !== '')
    if (rmCoins.length > 0) {
      const before = (await read($, alerts)) ?? []
      const gone = before.filter(a => rmCoins.includes(a.coin.toUpperCase()))
      await setAlerts($, all => all.filter(a => !rmCoins.includes(a.coin.toUpperCase())))
      notes.push(gone.length > 0 ? `Removed ${gone.map(alertText).join(', ')}.` : `No alerts on ${rmCoins.join(', ')}.`)
    }
    if (Array.isArray(input.alerts) && input.alerts.length > 0) {
      const m = await marketNow($).catch(() => null)
      const now = await $.clock.now()
      for (const raw of input.alerts as unknown[]) {
        const o = (raw ?? {}) as { price?: unknown; coin?: unknown; direction?: unknown; note?: unknown; when?: unknown }
        if ((((await read($, alerts)) ?? []).length) >= MAX_ALERTS) {
          notes.push(`${MAX_ALERTS} alerts at most; the rest were not set.`)
          break
        }
        if (typeof o.when === 'string' && o.when.trim() !== '') {
          const c = typeof o.coin === 'string' ? o.coin : coin
          const view = await read($, chart)
          notes.push((await addWhenAlert($, `${c} ${o.when}`, m, c, view?.interval ?? null)) ?? `Alert: "${o.when}" needs a comparison, e.g. rsi < 30.`)
          continue
        }
        const words = [
          typeof o.coin === 'string' ? o.coin : coin,
          o.direction === 'above' || o.direction === 'below' ? o.direction : '',
          typeof o.price === 'number' || typeof o.price === 'string' ? String(o.price) : '',
          typeof o.note === 'string' ? o.note : '',
        ].join(' ')
        const a = parseAlert(words, m, coin, now)
        if ('error' in a) notes.push(a.error)
        else {
          await setAlerts($, all => [...all, a])
          notes.push(`Alert set: ${alertText(a)}.`)
        }
      }
    }
    if (typeof input.save_layout === 'string') notes.push(await saveLayout($, input.save_layout))
    if (input.save === true) notes.push(await saveChart($))
    return { result: await chartReport($, [changed?.text ?? '', ...notes].filter(x => x !== '').join(' '), 0) }
  })

  on('tool.run', { tool: READ_TOOL_NAME }, async ($, e) => {
    const input = e as unknown as { candles?: unknown; export?: unknown; scan?: unknown }
    if (typeof input.scan === 'string') return { result: await runScan($, input.scan) }
    if (input.export === 'pine' || input.export === 'python') {
      const code = await exportText($, input.export)
      if (code === null) return { result: 'No chart is open. Call chart with a coin to open one.' }
      const view = await read($, chart)
      return { result: `Suggested file name: ${exportFile(input.export, view?.coin ?? 'BTC', view?.interval ?? '1h')}\n${code}` }
    }
    const n = typeof input.candles === 'number' && Number.isFinite(input.candles) ? Math.max(1, Math.min(300, Math.round(input.candles))) : 30
    return { result: await chartReport($, '', n) }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE_ID) stopChart($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const live = await read($, chart)
    const view = await seenChart($)
    const replayAt = await read($, replay)
    const m = await read($, market)
    const fc = await read($, forecast)
    const back = await read($, cursor)
    const tried = await read($, checked)
    if (!view) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No chart yet. /{CHART_COMMAND} BTC 1h opens one.</Text>
          <Text dimColor>READ-ONLY · {DATA_LINE}</Text>
        </Box>
      )
    }
    const ctx = m?.coins[view.coin]
    // The DaviddTech+ range is about now, so replay leaves it off.
    const fan = replayAt === 0 && fc && fc.coin === view.coin && fc.status === 'ok' ? fc.fan : null
    // The forecast notes are about now too: in replay they step aside.
    const fcNow = replayAt === 0 ? fc : null
    const hidden = replayAt > 0 && live ? live.candles.length - view.candles.length : 0
    const period = refreshMs(view.interval)
    const dataAt = chartDataAt(view.at, m)
    const age = ageOf(dataAt, tried)
    const isOld = isStale(age, period)
    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="column">
          <Text bold>{replayAt > 0 ? `${view.coin} replay` : coinLine(view.coin, ctx)}</Text>
          {isOld ? (
            <Box key="stale" {...STALE_BOX} alignSelf="flex-start">
              <Text>stale {ageText(age ?? 0)}</Text>
            </Box>
          ) : (
            <Text dimColor>{fundingText(ctx?.funding ?? null)}</Text>
          )}
        </Box>
      )
    }
    const dayChange = changePct(ctx)
    // In replay the live price would give the answer away, so the header shows the coin alone.
    // The header's dim tail (funding, OI, volume) takes whole pieces only, as many as fit: no cut-off "…".
    const headCols = Math.max(1, Math.floor(e.props.bodyColumns))
    const headTail = (() => {
      if (!ctx) return ''
      const lead = `${view.coin}-PERP ${fmtPrice(ctx.price)}  24h ${fmtPct(dayChange)}`.length
      let out = ''
      for (const piece of [fundingText(ctx.funding), `OI ${fmtUsd(ctx.openInterest === null ? null : ctx.openInterest * ctx.price)}`, `vol ${fmtUsd(ctx.dayVolume)}`]) {
        if (lead + out.length + 2 + piece.length > headCols) break
        out += `  ${piece}`
      }
      return out
    })()
    const header = ctx && replayAt === 0 ? (
      <Text bold wrap="truncate-end">
        {`${view.coin}-PERP ${fmtPrice(ctx.price)}  `}
        <Text color={dayChange === null ? 'inactive' : dayChange >= 0 ? 'success' : 'error'}>{`24h ${fmtPct(dayChange)}`}</Text>
        {headTail !== '' && <Text dimColor>{headTail}</Text>}
      </Text>
    ) : (
      <Text bold wrap="truncate-end">{`${view.coin}-PERP`}</Text>
    )
    const ids = (await read($, studies)) ?? []
    const input = { candles: view.candles, cursor: back, fan, palette: PALETTES[desk.options.palette], compare: compareFor(await read($, compare), view), ghost: fan ? null : layerGhost((await read($, layerList)) ?? [], view.coin, view.candles) }
    const fanLabel = fanLabelOf(fan)
    // Lines around the picture: header, readout, time axis, buttons, forecast lines, footer, source and its button.
    const fcLines = !fcNow || fcNow.coin !== view.coin || fcNow.status === 'off' ? 0 : fcNow.status === 'ok' ? 2 : 3
    // The stale row is one line of words inside a grey outline: three rows.
    // The buttons wrap in a narrow pane; count their real rows so nothing below the chart is cut off.
    const ids0 = (await read($, studies)) ?? []
    const cols = Math.max(1, Math.floor(e.props.bodyColumns))
    const navLabels = [...PANE_INTERVALS, '<', '>', 'Last', ...(replayAt > 0 ? ['Next', 'Live'] : ['Replay'])]
    const sourceLabels = ['Explain chart', replayAt > 0 ? 'Quiz me' : `Ask about ${view.coin}`]
    const navRows = buttonRows(navLabels, cols)
    const setRows = buttonRows([...PRESET_CHIPS.map(([label]) => label), ...(ids0.length > 0 ? ['Clear'] : [])], cols)
    const sourceRows = buttonRows(sourceLabels, cols, SOURCE_LINE.length)
    // Compact, live: Last steps aside (the chart sits at the last candle unless moved) and Replay joins Explain/Ask.
    const compactNavRows = replayAt > 0 ? navRows : buttonRows(navLabels.filter(l => l !== 'Last' && l !== 'Replay'), cols)
    const compactSourceRows = replayAt > 0 ? sourceRows : buttonRows([...sourceLabels, 'Replay'], cols, SOURCE_LINE.length)
    const isMissing = fcNow !== null && fcNow.coin === view.coin && fcNow.status === 'missing'
    const hintRows = isMissing
        ? MISSING_LINES.reduce((n, l) => n + textRows(l, cols), 0)
        : fcNow && fcNow.coin === view.coin && (fcNow.status === 'error' || fcNow.status === 'ask')
          ? textRows(fcNow.note, cols) + (fcNow.status === 'ask' ? 1 : 0)
          : fcLines === 2
            ? 2
            : 0
    const fullAround = 4 + navRows + setRows + sourceRows + hintRows + (isOld ? 3 : 0) + (replayAt > 0 ? 1 : 0)
    // A cramped terminal pane keeps the chart big: the set chips step aside (/lab-ind still adds them) and the
    // connector hint takes two short lines.
    const isCompact = e.surface === 'terminal' && Math.floor(e.props.scroll.bodyRows) - fullAround < COMPACT_BELOW
    const around =
      e.surface !== 'terminal'
        ? 8 + fcLines + (isOld ? 3 : 0) + (replayAt > 0 ? 1 : 0)
        : isCompact
          ? fullAround - setRows - (isMissing ? hintRows - MISSING_SHORT.length : 0) - (navRows - compactNavRows) - (sourceRows - compactSourceRows)
          : fullAround
    const size = chartSize(e.props.bodyColumns, e.props.scroll.bodyRows, around)
    const isLine = e.surface === 'terminal' && size !== null && size.columns < LINE_BELOW
    const list = await chartStudies($, view)
    const mine = await shownMarks($, view.coin, view.candles)
    let picture = null
    let axis = null
    if (view.candles.length === 0) {
      picture = <Text dimColor>{view.error ? `Could not load candles: ${view.error}` : 'Loading candles…'}</Text>
    } else if (e.surface === 'terminal') {
      if (size) {
        const { Raster } = $.ui.resolve(e)
        const cells = isLine ? lineCells(input, size.columns, size.rows) : deskCells({ ...input, studies: list, marks: mine }, size.columns, size.rows)
        picture = <Raster key="chart" columns={size.columns} rows={size.rows} cells={packCells(cells)} />
        axis = <Text dimColor>{timeAxis(input, view.interval, size.columns, fanLabel, isLine)}</Text>
      } else {
        picture = <Text dimColor>The pane is too small for the chart; widen it to see candles.</Text>
      }
    } else {
      const { Svg } = $.ui.resolve(e)
      picture = (
        <Svg
          source={deskSvg({ ...input, studies: list, marks: mine, theme: desk.theme, pitch: ZOOM_PITCH[await read($, zoom)] ?? 8 }, view.interval, view.coin, fanLabel)}
          alt={deskAlt(view.coin, view.interval, view.candles, fan !== null, list)}
          isInteractive
        />
      )
    }
    const lastPrice = view.candles[view.candles.length - 1]?.c ?? ctx?.price ?? 0
    const caption = fan ? fanCaption(fan, lastPrice, fmtPrice, Math.max(20, Math.floor(e.props.bodyColumns))) : null
    const question = nextQuestion(view.coin, desk.options.horizon, ctx?.price ?? null, fmtPrice)
    const ask = async (text: string = question) => {
      const filled = await $.prompt.fill({ text }).catch(() => ({ isFilled: false }))
      if (!filled.isFilled) $.ui.toast(`Type this in the chat: ${text}`)
    }
    // A plain question about what is on screen; Claude answers it from chart_read's numbers.
    const explain =
      list.length > 0
        ? `Read the Lab desk chart (chart_read) and explain in plain words what ${listText(ids)} show on ${view.coin} ${view.interval} right now. Then add one indicator that would help and say why.`
        : `Read the Lab desk chart (chart_read) for ${view.coin} ${view.interval} and explain the recent price action in plain words. Then paint the indicators that fit it best.`
    const quiz = `Quiz me on this bar replay: read the Lab desk chart (chart_read) for ${view.coin} ${view.interval}, ask me one question about what the chart shows and what I expect next, and don't say what came next. After I answer, step the replay forward with the chart tool and tell me how it went.`
    const moveCursor = (by: number) => update($, cursor, n => Math.max(0, Math.min(view.candles.length - 1, n + by)))
    const staleRow = isOld ? `Stale ${ageText(age ?? 0)}${view.error ? ` · ${view.error}` : ''} · retrying every ${period / 1000} s` : null
    return (
      <Box flexDirection="column">
        {header}
        {replayAt > 0 && (
          <Text key="replay" color="warning" wrap="truncate-end">
            {`REPLAY ${utcText(view.candles.at(-1)?.t ?? replayAt)} UTC · ${hidden} candles hidden · what comes next?`}
          </Text>
        )}
        {picture}
        {axis}
        {e.surface === 'terminal' && (
          <Text key="readout" wrap="truncate-end">
            {isLine ? lineReadout(view.candles, back, view.interval) : readout(view.candles, back, view.interval, headCols)}
          </Text>
        )}
        {staleRow && (
          <Box key="stale" {...STALE_BOX} alignSelf="flex-start">
            <Text wrap="truncate-end">{staleRow}</Text>
          </Box>
        )}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {PANE_INTERVALS.map((iv, i) => (
            <Button
              key={`iv-${iv}`}
              label={iv}
              hotkey={String(i + 1)}
              variant={iv === view.interval ? 'primary' : 'secondary'}
              onPress={() => void showChart($, view.coin, iv, false)}
            />
          ))}
          <Button key="back" label="<" hotkey="h" onPress={() => void moveCursor(1)} />
          <Button key="fwd" label=">" hotkey="l" onPress={() => void moveCursor(-1)} />
          {!(isCompact && replayAt === 0) && <Button key="last" label="Last" onPress={() => void update($, cursor, () => 0)} />}
          {replayAt > 0 ? (
            <Button key="replay-next" label="Next" hotkey="n" variant="primary" onPress={() => void stepReplay($, 1)} />
          ) : (
            !isCompact && <Button key="replay" label="Replay" hotkey="r" onPress={() => void startReplay($, '')} />
          )}
          {replayAt > 0 && <Button key="replay-off" label="Live" hotkey="x" onPress={() => void stopReplay($)} />}
          {e.surface !== 'terminal' && (
            <Button key="zoom-out" label="−" hotkey="o" onPress={() => void update($, zoom, z => Math.max(0, z - 1))} />
          )}
          {e.surface !== 'terminal' && (
            <Button key="zoom-in" label="+" hotkey="i" onPress={() => void update($, zoom, z => Math.min(ZOOM_PITCH.length - 1, z + 1))} />
          )}
        </Box>
        {!isCompact && (
        <Box key="sets" flexDirection="row" flexWrap="wrap" columnGap={1}>
          {PRESET_CHIPS.map(([label, set]) => {
            const members = PRESETS[set] ?? []
            const isOn = members.length > 0 && members.every(id => ids.includes(id))
            return (
              <Button
                key={`set-${set}`}
                label={label}
                variant={isOn ? 'primary' : 'secondary'}
                onPress={() => void applyChange($, isOn ? { remove: members } : { add: [set] })}
              />
            )
          })}
          {ids.length > 0 && <Button key="set-clear" label="Clear" onPress={() => void applyChange($, { clear: true })} />}
        </Box>
        )}
        {caption && (
          <Text key="caption-a" wrap="truncate-end">
            {caption.lineA}
          </Text>
        )}
        {caption &&
          (caption.isLegend ? (
            <Text key="caption-b" dimColor wrap="truncate-end">
              {caption.lineB}
            </Text>
          ) : (
            <Text key="caption-b" wrap="truncate-end">
              {caption.lineB}
            </Text>
          ))}
        {isMissing &&
          (isCompact ? MISSING_SHORT : MISSING_LINES).map((line, i) => (
            <Text key={`hint-${i}`} dimColor wrap={isCompact ? 'truncate-end' : 'wrap'}>
              {line}
            </Text>
          ))}
        {fcNow && fcNow.coin === view.coin && fcNow.status === 'error' && (
          <Text dimColor wrap="wrap">
            {fcNow.note}
          </Text>
        )}
        {fcNow && fcNow.coin === view.coin && fcNow.status === 'ask' && (
          <Box key="ask" flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Text dimColor wrap="wrap">
              {fcNow.note}
            </Text>
            <Button key="range" label="Show range (1 request)" onPress={() => void loadForecast($, view.coin, true)} />
          </Box>
        )}
        <Text dimColor wrap="truncate-end">
          READ-ONLY · {dataAt === null ? 'loading' : `as of ${fmtClock(dataAt)} UTC`} · {DATA_LINE}
        </Text>
        <Box key="source-row" flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button key="explain" label="Explain chart" onPress={() => void ask(explain)} />
          {replayAt > 0 ? (
            <Button key="quiz" label="Quiz me" onPress={() => void ask(quiz)} />
          ) : (
            <Button key="next" label={`Ask about ${view.coin}`} onPress={() => void ask()} />
          )}
          {isCompact && replayAt === 0 && <Button key="replay" label="Replay" hotkey="r" onPress={() => void startReplay($, '')} />}
          <Text key="source" dimColor wrap="truncate-end">
            {SOURCE_LINE}
          </Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const coins = await read($, watch)
    if (!coins || e.props.hasSurvey) return next(e)
    const live = await read($, market)
    const view = await read($, chart)
    const interval = view?.interval ?? '1h'
    // In bar replay the chart coin's live price would give it away.
    const hide = (await read($, replay)) > 0 ? view?.coin : undefined
    const m = live && hide ? { ...live, coins: Object.fromEntries(Object.entries(live.coins).filter(([c]) => c !== hide)) } : live
    const age = ageOf(m ? m.at : null, await read($, checked))
    const stale = isStale(age, BAND_MS) ? `stale ${ageText(age ?? 0)}` : null
    const { Box, Button, Text } = $.ui.resolve(e)
    if (e.props.bodyColumns < 40) {
      return (
        <Box flexDirection="row" alignItems="center" columnGap={1} width={e.props.bodyColumns}>
          <Box flexShrink={1}>
            <Text wrap="truncate-end">{coins.map(c => coinLine(c, m?.coins[c])).join(' · ')}</Text>
          </Box>
          {stale && (
            <Box key="stale" {...STALE_BOX} flexShrink={0}>
              <Text>{stale}</Text>
            </Box>
          )}
        </Box>
      )
    }
    return (
      <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={2} width={e.props.bodyColumns}>
        {coins.map(c => {
          const ctx = m?.coins[c]
          const ch = changePct(ctx)
          return (
            <Button key={`coin-${c}`} plain onPress={() => void showChart($, c, interval, true)}>
              {c} {ctx ? fmtPrice(ctx.price) : '-'} <Text color={ch === null ? 'inactive' : ch >= 0 ? 'success' : 'error'}>{fmtPct(ch, 1)}</Text>
            </Button>
          )
        })}
        {stale && (
          <Box key="stale" {...STALE_BOX}>
            <Text>{stale}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
