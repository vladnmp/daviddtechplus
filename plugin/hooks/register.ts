import type { EngineInterface, On, PluginOptions } from 'claude-code'

/**
 * DaviddTech+ market weather: the storm levels of eight reference markets in the status line, and the
 * daily units left, through the member's own DaviddTech+ connector (added once in claude.ai, it reaches
 * Claude Code too; this plugin brings no connector of its own). Read-only and small on purpose:
 * it calls two free tools (market_backdrop, get_usage), keeps the last weather line in the plugin's
 * store and writes no files. Nothing polls: one read when a session starts (band "auto", at most once
 * per WEATHER_TTL_MS, one retry while the connector is still connecting) and one per command.
 */

/** Names tried after the servers found by their tools: the claude.ai connector as the guide names it, one added
 * with `claude mcp add daviddtechplus`, and the connector of a local copy of this plugin. */
export const SERVERS = ['claude.ai DaviddTech+', 'daviddtechplus', 'plugin:daviddtechplus:daviddtechplus']
export const CONNECTOR_URL = 'https://vlad-64070--daviddtech-plus.modal.run/mcp'
export const WEATHER_TTL_MS = 6 * 60 * 60 * 1000
export const RETRY_MS = 20_000
export const WEATHER_KEY = 'weather'
export const NOT_CONNECTED =
  `DaviddTech+ is not connected yet: add it once in claude.ai under Settings > Connectors > Add custom connector (name DaviddTech+, URL ${CONNECTOR_URL}), sign in with your membership email, then open a new session.`
export const DISCLAIMER = 'Source: DaviddTech+ (skool.com/daviddtech/about) — Informational only, not financial advice.'
export const LEVELS = ['calm', 'normal', 'choppy', 'stormy', 'very stormy']
export const MEANING =
  'Storm level: the chance of bigger-than-usual moves over the next 5 sessions (days for crypto) against its usual rate, up or down alike; 1 calm to 5 very stormy.'
export const NEXT =
  "Next: /daviddtechplus:storm puts your own symbols next to this · /daviddtechplus:desk after each close · /daviddtechplus-units for today's units."
export const SUGGESTIONS = { weather: 'Run a storm check on my watchlist', units: 'Show the DaviddTech+ ready routines' }
const STORM_LINE = /Storm levels: ([^\n]+?)\.(?:\n|$)/
const BACKDROP_TOOL = /^mcp__(.+)__market_backdrop$/
const CELL = /^[A-Z0-9./]+ [1-5]$/

export type Band = 'auto' | 'command' | 'off'
/** The status line, the report a command prints and the backdrop text the model reads after it. */
export type Weather = { line: string; report: string; context: string; at: number }
type Market = { name: string; label: string | null; level: number; asof: string | null; isCrypto: boolean }
type Answer = { content?: { type: string; text?: string }[]; isError?: boolean; structuredContent?: unknown }
/** A tool's answer: its text and, when the tool declares one, its structured result. */
export type Reading = { text: string; data: unknown }

export function bandOf(raw: PluginOptions): Band {
  const value = (raw as Record<string, unknown>).band

  return value === 'command' || value === 'off' ? value : 'auto'
}

/** "SPY 3 · QQQ 3 · BTC 4" from the backdrop text's "Storm levels: SPY 3, QQQ 3, BTC/USD 4." line, else null. */
export function weatherOf(text: string): string | null {
  const found = STORM_LINE.exec(text)
  const cells = (found?.[1] ?? '').split(', ').map(cell => cell.trim()).filter(cell => CELL.test(cell))

  return cells.length > 0 ? cells.map(cell => cell.replace('/USD ', ' ')).join(' · ') : null
}

/** The markets with a storm level in the backdrop's structured result. */
function marketsOf(data: unknown): Market[] {
  const markets = (data as { markets?: unknown } | null)?.markets
  type Raw = { symbol?: unknown; label?: unknown; asof?: unknown; swing_5d?: { storm_level?: unknown } }

  return (Array.isArray(markets) ? markets : []).flatMap((market: Raw) => {
    const level = market?.swing_5d?.storm_level

    return typeof market?.symbol === 'string' && typeof level === 'number' && level >= 1 && level <= 5
      ? [{
          name: market.symbol.replace('/USD', ''),
          label: typeof market.label === 'string' ? market.label : null,
          level,
          asof: typeof market.asof === 'string' ? market.asof : null,
          isCrypto: market.symbol.includes('/'),
        }]
      : []
  })
}

/** The same line from the backdrop's structured result (markets[].swing_5d.storm_level), else null. */
export function stormOf(data: unknown): string | null {
  const markets = marketsOf(data)

  return markets.length > 0 ? markets.map(market => `${market.name} ${market.level}`).join(' · ') : null
}

const latest = (markets: Market[]): string | null =>
  markets.map(market => market.asof).filter((asof): asof is string => asof !== null).sort().at(-1) ?? null

/** The weather as a short report: the markets by storm level, stormiest first, what the level means and what to try next. */
export function reportOf(data: unknown, line: string): string {
  const markets = marketsOf(data)
  const rows = [5, 4, 3, 2, 1].flatMap(level => {
    const named = markets.filter(market => market.level === level)
      .map(market => (market.label === null ? market.name : `${market.name} (${market.label})`))

    return named.length > 0 ? [`${LEVELS[level - 1]} ${level}: ${named.join(', ')}`] : []
  })
  const stocks = latest(markets.filter(market => !market.isCrypto))
  const crypto = latest(markets.filter(market => market.isCrypto))
  const asOf = stocks === null ? '' : ` · end-of-day data as of ${stocks}${crypto !== null && crypto !== stocks ? ` (crypto ${crypto})` : ''}`
  const disclaimer = (data as { disclaimer?: unknown } | null)?.disclaimer

  return [
    ...(rows.length > 0 ? [`DaviddTech+ weather${asOf}`, ...rows] : [`DaviddTech+ weather: ${line}`]),
    MEANING,
    NEXT,
    typeof disclaimer === 'string' ? disclaimer : DISCLAIMER,
  ].join('\n')
}

/** What the model reads after the report: the backdrop behind it, for questions that follow. */
export function contextOf(text: string): string {
  return `The member just ran /daviddtechplus-weather. The DaviddTech+ market backdrop behind it (free, end-of-day):\n\n${text.slice(0, 6000)}`
}

export function statusOf(weather: string): string {
  return `DaviddTech+ weather: ${weather} (storm 1 calm to 5 very stormy)`
}

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** One line from get_usage (its structured result or JSON text): units left today, the reset and what stays free. */
export function unitsOf(value: unknown): string | null {
  const usage = (typeof value === 'string' ? parsed(value) : value) as Record<string, unknown> | null

  if (usage === null || typeof usage !== 'object' || typeof usage.remaining_today !== 'number' || typeof usage.daily_limit !== 'number') {
    return null
  }

  const free = typeof usage.still_free === 'string' ? ` ${usage.still_free}` : ''

  return `DaviddTech+: ${usage.remaining_today} of ${usage.daily_limit} units left today (resets 00:00 UTC).${free}`
}

const textOf = (answer: Answer): string => (answer.content ?? []).map(block => block.text ?? '').join('\n')
const short = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 160)
const messageOf = (error: unknown): string => short(error instanceof Error ? error.message : String(error))

/** The connector name that answered last (null until one has), and why the last read gave nothing. */
export type State = { server: string | null; why: string | null }

/** What a command says when the connector gave nothing usable, with the engine's reason. */
export function failureOf(state: State, what: string): string {
  const why = state.why === null ? '' : ` (${state.why})`

  return state.server === null ? `${NOT_CONNECTED}${why}` : `DaviddTech+ answered, but the ${what} could not be read${why}.`
}

/**
 * The servers that carry DaviddTech+'s tools (market_backdrop and get_usage), in the tool-name spelling calls
 * accept (`claude_ai_DaviddTech_`), whatever the member named the connector.
 */
export function serversOf(tools: readonly { name: string }[]): string[] {
  const names = new Set(tools.map(tool => tool.name))
  const found = tools.flatMap(tool => BACKDROP_TOOL.exec(tool.name)?.[1] ?? [])

  return [...new Set(found)].filter(server => names.has(`mcp__${server}__get_usage`))
}

/** The servers found by their tools first, then the fixed names. */
async function namesOf($: EngineInterface): Promise<string[]> {
  const found = serversOf(await $.tool.list().catch(() => []))

  return [...found, ...SERVERS.filter(name => !found.includes(name))]
}

/** A free tool's answer through the first connector name that answers, else null (never throws). */
export async function read($: EngineInterface, state: State, tool: string): Promise<Reading | null> {
  const reasons: string[] = []

  state.why = null
  for (const name of state.server === null ? await namesOf($) : [state.server]) {
    try {
      const answer = (await $.mcp.call(name, tool, {})) as Answer

      state.server = name
      if (answer.isError === true) {
        state.why = `${tool}: ${short(textOf(answer)) || 'an error'}`

        return null
      }

      return { text: textOf(answer), data: answer.structuredContent }
    } catch (error) {
      // not connected under this name (or the call was refused): try the next one
      reasons.push(`${name}: ${messageOf(error)}`)
      if (state.server === name) {
        state.server = null
      }
    }
  }

  state.why = reasons[0] ?? null

  return null
}

/** The weather: the saved one while it is fresh, else read from the backdrop and saved. */
export async function weather($: EngineInterface, state: State, isFresh: boolean): Promise<Weather | null> {
  if (!isFresh) {
    const saved = (await $.store.get(WEATHER_KEY).catch(() => undefined)) as Weather | undefined

    if (typeof saved?.report === 'string' && typeof saved.line === 'string' && (await $.clock.now()) - saved.at < WEATHER_TTL_MS) {
      return saved
    }
  }

  const reading = await read($, state, 'market_backdrop')

  if (reading === null) {
    return null
  }

  const data = stormOf(reading.data) === null ? parsed(reading.text) : reading.data
  const line = stormOf(data) ?? weatherOf(reading.text)

  if (line === null) {
    state.why = 'no storm levels in the answer'

    return null
  }

  const found: Weather = { line, report: reportOf(data, line), context: contextOf(reading.text), at: await $.clock.now() }

  await $.store.set(WEATHER_KEY, found).catch(() => undefined)

  return found
}

/** Shows the weather line in the status line; false when there is none to show yet. */
async function show($: EngineInterface, state: State): Promise<boolean> {
  const found = await weather($, state, false)

  if (found !== null) {
    $.ui.status(statusOf(found.line))
  }

  return found !== null
}

/** At the start the connector may still be connecting: one retry, then the commands. */
export async function showAtStart($: EngineInterface, state: State): Promise<void> {
  if (!(await show($, state).catch(() => false))) {
    $.clock.after(RETRY_MS, () => void retry($, state))
  }
}

async function retry($: EngineInterface, state: State): Promise<void> {
  await show($, state).catch(() => false)
}

export function register(on: On, raw: PluginOptions) {
  const band = bandOf(raw)
  const state: State = { server: null, why: null }

  on('session.start', async ($, e, next) => {
    await Promise.all([
      $.command
        .register({ name: 'daviddtechplus-weather', description: 'DaviddTech+ market weather: storm levels of eight reference markets (free)', argumentHint: '[refresh]', immediate: true })
        .catch(() => undefined),
      $.command
        .register({ name: 'daviddtechplus-units', description: 'DaviddTech+ daily units left today, and what stays free', immediate: true })
        .catch(() => undefined),
    ])

    if (band === 'auto' && e.isInteractive !== false) {
      void showAtStart($, state)
    }

    return next(e)
  })

  on('command.run', { command: 'daviddtechplus-weather' }, async ($, e) => {
    const found = await weather($, state, e.args.trim().toLowerCase() === 'refresh')

    if (found === null) {
      return { text: failureOf(state, 'weather') }
    }

    if (band !== 'off') {
      $.ui.status(statusOf(found.line))
    }

    void $.prompt.suggest({ text: SUGGESTIONS.weather }).catch(() => undefined)

    return { text: found.report, context: [found.context] }
  })

  on('command.run', { command: 'daviddtechplus-units' }, async ($) => {
    const reading = await read($, state, 'get_usage')
    const line = reading === null ? null : (unitsOf(reading.data) ?? unitsOf(reading.text))

    if (line === null && reading !== null) {
      state.why = 'no units in the answer'
    }

    if (line === null) {
      return { text: failureOf(state, 'units') }
    }

    void $.prompt.suggest({ text: SUGGESTIONS.units }).catch(() => undefined)

    return { text: line }
  })
}
