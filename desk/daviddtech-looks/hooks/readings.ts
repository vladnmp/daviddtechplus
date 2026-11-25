import type { Mood } from '../types'

const BACKDROP_TOOL = /^mcp__(.+)__market_backdrop$/
const AID_TOOL = /^mcp__(.+)__check_pine$/
const OURS = /daviddtech/i
const STORM_LINE = /Storm levels: ([^\n]+?)\.(?:\n|$)/
const CELL = /^[A-Z0-9./]+ [1-5]$/

/** The server name of a DaviddTech connector's tool, or null for anyone else's tool. */
function serverOf(pattern: RegExp, tool: string): string | null {
  const server = pattern.exec(tool)?.[1]

  return server !== undefined && OURS.test(server) ? server : null
}

/** The DaviddTech+ server behind a `market_backdrop` tool name, or null. */
export function backdropServer(tool: string): string | null {
  return serverOf(BACKDROP_TOOL, tool)
}

/** The DaviddTech Aid server behind a `check_pine` tool name, or null. */
export function aidServer(tool: string): string | null {
  return serverOf(AID_TOOL, tool)
}

/** The mood from storm levels 1 to 5: two or more at 4+, or any 5, is a storm; any 3+ is windy; else clear. */
export function moodOfLevels(levels: readonly number[]): Mood | null {
  if (levels.length === 0) {
    return null
  }
  const max = Math.max(...levels)

  if (max === 5 || levels.filter(level => level >= 4).length >= 2) {
    return 'storm'
  }

  return max >= 3 ? 'windy' : 'clear'
}

/** Storm levels from `market_backdrop`'s structured result: `markets[].swing_5d.storm_level`. */
export function levelsOf(data: unknown): number[] {
  const markets = (data as { markets?: unknown } | null | undefined)?.markets

  return (Array.isArray(markets) ? markets : []).flatMap((market: { swing_5d?: { storm_level?: unknown } } | null) => {
    const level = market?.swing_5d?.storm_level

    return typeof level === 'number' && level >= 1 && level <= 5 ? [level] : []
  })
}

/** Storm levels from the text line "Storm levels: SPY 3, QQQ 3, BTC/USD 4." */
export function levelsOfText(text: string): number[] {
  const found = STORM_LINE.exec(text)

  return (found?.[1] ?? '')
    .split(', ')
    .map(cell => cell.trim())
    .filter(cell => CELL.test(cell))
    .map(cell => Number(cell.slice(cell.lastIndexOf(' ') + 1)))
}

/** One reference market as the weather reads it: its storm level, volatility regime and 20-session change. */
export type Market = { level: number | null; regime: Regime | null; move20: number | null }
export type Regime = 'calm' | 'normal' | 'elevated' | 'stressed'

const REGIMES: readonly string[] = ['calm', 'normal', 'elevated', 'stressed']
const ROW = /^\|\s*[^|]+\|\s*([A-Z0-9./]+)\s*\|.*?\/\s*([+-]?\d+(?:\.\d+)?)%\s*\|\s*(calm|normal|elevated|stressed)\s*\(\d+\)\s*\|.*?storm ([1-5])\s*\|\s*$/

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** The markets in `market_backdrop`'s structured result. */
export function marketsOf(data: unknown): Market[] {
  const markets = (data as { markets?: unknown } | null | undefined)?.markets

  return (Array.isArray(markets) ? markets : []).flatMap(
    (market: { swing_5d?: { storm_level?: unknown } | null; volatility_regime?: unknown; change_20_pct?: unknown } | null) => {
      if (market === null || typeof market !== 'object') {
        return []
      }
      const level = num(market.swing_5d?.storm_level)
      const regime = typeof market.volatility_regime === 'string' && REGIMES.includes(market.volatility_regime)
        ? (market.volatility_regime as Regime)
        : null

      return [{ level: level !== null && level >= 1 && level <= 5 ? level : null, regime, move20: num(market.change_20_pct) }]
    },
  )
}

/** The markets in the backdrop's markdown table; falls back to the "Storm levels:" line when no row reads. */
export function marketsOfText(text: string): Market[] {
  const rows = text.split(/\r?\n/).flatMap(line => {
    const found = ROW.exec(line.trim())

    return found === null
      ? []
      : [{ level: Number(found[4]), regime: found[3] as Regime, move20: Number(found[2]) }]
  })

  return rows.length > 0 ? rows : levelsOfText(text).map(level => ({ level, regime: null, move20: null }))
}

/**
 * The weather now, not only the storm odds. Storm levels say whether the next 5 sessions may get rougher than the
 * past 20, so in a market that is already rough they read low. Storm: any level 5, two levels at 4+, or half the
 * markets (at least 3) in stressed volatility. Windy: any level 3+, two markets elevated or stressed, or a market
 * that moved 15% or more over 20 sessions. Else clear.
 */
export function moodOfMarkets(markets: readonly Market[]): Mood | null {
  if (markets.length === 0) {
    return null
  }
  const levels = markets.flatMap(market => (market.level === null ? [] : [market.level]))
  const byLevels = levels.length > 0 ? moodOfLevels(levels) : null
  const stressed = markets.filter(market => market.regime === 'stressed').length
  const rough = markets.filter(market => market.regime === 'stressed' || market.regime === 'elevated').length
  const bigMove = markets.some(market => market.move20 !== null && Math.abs(market.move20) >= 15)

  if (byLevels === 'storm' || stressed >= Math.max(3, Math.ceil(markets.length / 2))) {
    return 'storm'
  }
  if (byLevels === 'windy' || rough >= 2 || bigMove) {
    return 'windy'
  }

  return byLevels ?? 'clear'
}

/** The storm levels kept with a reading. */
export function levelsOfMarkets(markets: readonly Market[]): number[] {
  return markets.flatMap(market => (market.level === null ? [] : [market.level]))
}

export function moodOf(data: unknown): Mood | null {
  return moodOfMarkets(marketsOf(data))
}

export function moodOfText(text: string): Mood | null {
  return moodOfMarkets(marketsOfText(text))
}

/** The member's word for a mood. */
export function word(mood: Mood): string {
  return mood === 'storm' ? 'stormy' : mood === 'windy' ? 'windy' : 'calm'
}

/** The first JSON object in a text, or undefined. */
export function parseJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')

  if (start < 0 || end <= start) {
    return undefined
  }
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

/** The text blocks of a tool's result joined, for when core's own `text` is absent. */
export function textOf(result: unknown): string {
  const blocks = Array.isArray(result) ? result : (result as { content?: unknown } | null | undefined)?.content

  return (Array.isArray(blocks) ? blocks : [])
    .flatMap((block: { type?: unknown; text?: unknown } | null) =>
      block?.type === 'text' && typeof block.text === 'string' ? [block.text] : [],
    )
    .join('\n')
}

export type AidWord = 'red' | 'orange' | 'yellow' | 'clean'
export type Aid = { word: AidWord; score: number; red: number; orange: number; yellow: number }

/** A `check_pine` answer: its worst severity and score, or null for an error answer or anything else. */
export function aidOf(text: string): Aid | null {
  const data = parseJson(text) as
    | { error?: unknown; score?: unknown; counts?: { red?: unknown; orange?: unknown; yellow?: unknown } }
    | undefined

  if (data === undefined || data === null || data.error !== undefined || typeof data.score !== 'number') {
    return null
  }
  const count = (value: unknown): number => (typeof value === 'number' && value >= 0 ? value : 0)
  const red = count(data.counts?.red)
  const orange = count(data.counts?.orange)
  const yellow = count(data.counts?.yellow)
  const level: AidWord = red > 0 ? 'red' : orange > 0 ? 'orange' : yellow > 0 ? 'yellow' : 'clean'

  return { word: level, score: Math.round(data.score), red, orange, yellow }
}

/** A reading this soon after a waiting one is the same reading, not a second one. */
export const GAP_MS = 6 * 60 * 60 * 1000
/** A sky not confirmed for this long stands no more: the next reading sets it at once, and a session starts calm. */
export const STAND_MS = 36 * 60 * 60 * 1000

/**
 * The saved weather. `mood` is the sky shown; `seenAt` is when a reading last set or agreed with it; `at` and
 * `levels` are the latest reading's; `pending` is a reading that differs from the sky and waits for a second one.
 */
export type WeatherRecord = { mood: Mood; seenAt: number; at: number; levels: number[]; pending: { mood: Mood; at: number } | null }

function isMoodValue(value: unknown): value is Mood {
  return value === 'clear' || value === 'windy' || value === 'storm'
}

/** A saved record, or null. An old `{ mood, levels, at }` reads as seen at `at`, with nothing waiting. */
export function weatherRecord(raw: unknown): WeatherRecord | null {
  const r = raw as { mood?: unknown; seenAt?: unknown; at?: unknown; levels?: unknown; pending?: unknown } | null | undefined

  if (r === null || r === undefined || typeof r !== 'object' || !isMoodValue(r.mood) || typeof r.at !== 'number') {
    return null
  }
  const p = r.pending as { mood?: unknown; at?: unknown } | null | undefined
  const pending = p !== null && p !== undefined && isMoodValue(p.mood) && typeof p.at === 'number' ? { mood: p.mood, at: p.at } : null
  const levels = Array.isArray(r.levels) ? r.levels.filter((level): level is number => typeof level === 'number') : []

  return { mood: r.mood, seenAt: typeof r.seenAt === 'number' ? r.seenAt : r.at, at: r.at, levels, pending }
}

const RANK: Record<Mood, number> = { clear: 0, windy: 1, storm: 2 }

/**
 * The sky after reading `r` at `t`: it changes only when two readings agree.
 * 1. No record, or a sky not seen for 36 h: the reading sets the sky at once.
 * 2. The reading matches the sky: the sky is seen again and nothing waits.
 * 3. A waiting reading under 6 h old: the same reading; it keeps its time and takes the newer mood.
 * 4. A waiting reading 6 h to 36 h old on the same side of the sky (both rougher or both calmer): the sky moves
 *    to the one nearer it; if `r` still differs, it waits next. Two stormy readings move a calm sky straight to
 *    stormy (and two calm ones a stormy sky straight to calm): there is no forced stop at windy.
 * 5. Else `r` waits and the sky stays.
 */
export function nextWeather(prev: WeatherRecord | null, r: Mood, levels: number[], t: number): WeatherRecord {
  if (prev === null || t - prev.seenAt >= STAND_MS) {
    return { mood: r, seenAt: t, at: t, levels, pending: null }
  }
  if (r === prev.mood) {
    return { mood: r, seenAt: t, at: t, levels, pending: null }
  }
  const waiting = prev.pending
  if (waiting !== null && t - waiting.at < GAP_MS) {
    return { ...prev, at: t, levels, pending: { mood: r, at: waiting.at } }
  }
  if (waiting !== null && t - waiting.at < STAND_MS) {
    const sky = RANK[prev.mood]
    const a = RANK[waiting.mood] - sky
    const b = RANK[r] - sky
    if (a !== 0 && Math.sign(a) === Math.sign(b)) {
      const mood = Math.abs(a) <= Math.abs(b) ? waiting.mood : r

      return { mood, seenAt: t, at: t, levels, pending: r === mood ? null : { mood: r, at: t } }
    }
  }

  return { ...prev, at: t, levels, pending: { mood: r, at: t } }
}

/** The sky to show at `now`: the saved one while it was seen in the last 36 h, else calm. */
export function shownMood(record: WeatherRecord | null, now: number): Mood {
  return record !== null && now - record.seenAt < STAND_MS ? record.mood : 'clear'
}
