import { describe, expect, test } from 'claude-code/testing'

import {
  DISCLAIMER,
  MEANING,
  NEXT,
  NOT_CONNECTED,
  RETRY_MS,
  SERVERS,
  WEATHER_KEY,
  WEATHER_TTL_MS,
  bandOf,
  contextOf,
  failureOf,
  read,
  reportOf,
  serversOf,
  showAtStart,
  statusOf,
  stormOf,
  unitsOf,
  weather,
  weatherOf,
  type State,
} from '../hooks/register'

const SESSION = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }
const command = (name: string, args = '') => ({
  command: name,
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
})

// As the live backdrop renders it (server/backdrop.py storm_line), table rows elided.
const BACKDROP = [
  '## DaviddTech+ Market backdrop: 8 reference markets',
  '| Market | Symbol | As of | Change 1 / 5 / 20 | Volatility (1y pct) | 200-row trend | Swing 5 (x usual), storm |',
  'Storm levels: SPY 3, QQQ 3, IWM 4, TLT 1, GLD 2, UUP 2, BTC/USD 4, ETH/USD 4.',
  '*Source: DaviddTech+ (skool.com/daviddtech/about) — Informational only, not financial advice.*',
].join('\n\n')
const WEATHER = 'SPY 3 · QQQ 3 · IWM 4 · TLT 1 · GLD 2 · UUP 2 · BTC 4 · ETH 4'
// The structured result, as market_backdrop returns it (fields the mod does not read elided).
const MARKETS = {
  markets: ([
    ['SPY', 'US large caps', 3], ['QQQ', 'US tech-heavy', 3], ['IWM', 'US small caps', 4],
    ['TLT', 'long-term US Treasuries', 1], ['GLD', 'gold', 2], ['UUP', 'US dollar index fund', 2],
    ['BTC/USD', 'bitcoin', 4], ['ETH/USD', 'ether', 4],
  ] as const).map(([symbol, label, level]) => ({
    symbol, label, asof: symbol.includes('/') ? '2026-10-18' : '2026-10-16', swing_5d: { chance_pct: 30, storm_level: level },
  })),
  disclaimer: DISCLAIMER,
}
const REPORT = [
  'DaviddTech+ weather · end-of-day data as of 2026-10-16 (crypto 2026-10-18)',
  'stormy 4: IWM (US small caps), BTC (bitcoin), ETH (ether)',
  'choppy 3: SPY (US large caps), QQQ (US tech-heavy)',
  'normal 2: GLD (gold), UUP (US dollar index fund)',
  'calm 1: TLT (long-term US Treasuries)',
  MEANING,
  NEXT,
  DISCLAIMER,
].join('\n')
const USAGE = JSON.stringify({
  account: 'member@example.com', daily_limit: 20, used_today: 2, remaining_today: 18, burst_per_minute: 10,
  resets_at_utc: '2026-10-20T00:00:00Z', still_free: 'Still free: the market backdrop and ready routines.',
})
const CLAUDE_AI = 'claude.ai DaviddTech+'
// A claude.ai connector the member named differently, as Claude Code spells it in tool names.
const RENAMED = 'claude_ai_DaviddTech_Plus'
const toolsOf = (server: string) => ['market_backdrop', 'get_usage', 'analyze_asset'].map(tool => ({ name: `mcp__${server}__${tool}` }))

/**
 * How an answer may arrive: markdown text plus the structured result, markdown text alone, the structured
 * result as JSON text alone (as the model sees it), or an error.
 */
type Shape = 'structured' | 'text' | 'json' | 'error'

/**
 * A small engine for the connector logic: a connector reachable under `connected` (or none) whose tools
 * $.tool.list shows, a store, a clock that runs its timers on `advance`, and the status line.
 */
function engineOf(connected: string | null = CLAUDE_AI, shape: Shape = 'structured') {
  const world = {
    calls: [] as { server: string; tool: string }[],
    statuses: [] as string[],
    store: new Map<string, unknown>(),
    now: 1_000_000,
    timers: [] as { at: number; fn: () => void }[],
  }
  const $ = {
    tool: { list: async () => (connected === null ? [{ name: 'Bash' }] : [{ name: 'Bash' }, ...toolsOf(connected)]) },
    mcp: {
      call: async (server: string, tool: string) => {
        world.calls.push({ server, tool })

        if (server !== connected) {
          throw new Error(`no connected MCP tool "${tool}" on a server named "${server}"`)
        }

        const isBackdrop = tool === 'market_backdrop'
        const text = isBackdrop ? BACKDROP : USAGE
        const data = isBackdrop ? MARKETS : JSON.parse(USAGE)

        return {
          structured: { content: [{ type: 'text', text }], isError: false, structuredContent: data },
          text: { content: [{ type: 'text', text }], isError: false },
          json: { content: [{ type: 'text', text: JSON.stringify(data) }], isError: false },
          error: { content: [{ type: 'text', text: 'The data source is busy.' }], isError: true },
        }[shape]
      },
    },
    store: {
      get: async (key: string) => world.store.get(key),
      set: async (key: string, value: unknown) => void world.store.set(key, value),
    },
    clock: {
      now: async () => world.now,
      after: (ms: number, fn: () => void) => void world.timers.push({ at: world.now + ms, fn }),
    },
    ui: { status: (text: string) => void world.statuses.push(text) },
  }
  const advance = async (ms: number) => {
    world.now += ms
    const due = world.timers.filter(timer => timer.at <= world.now)

    world.timers = world.timers.filter(timer => timer.at > world.now)
    due.forEach(timer => timer.fn())
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  return { $: $ as never, world, advance }
}

const fresh = (): State => ({ server: null, why: null })

describe('reading the connector text', () => {
  test('the storm line becomes the weather line; anything else gives nothing', () => {
    expect(weatherOf(BACKDROP)).toBe(WEATHER)
    expect(weatherOf('## no storm line here')).toBe(null)
    expect(weatherOf('Storm levels: spy nine.')).toBe(null)
    expect(stormOf(MARKETS)).toBe(WEATHER)
    expect(stormOf({ markets: [{ symbol: 'SPY', swing_5d: { storm_level: null } }] })).toBe(null)
    expect(stormOf(undefined)).toBe(null)
    expect(statusOf(WEATHER)).toBe(`DaviddTech+ weather: ${WEATHER} (storm 1 calm to 5 very stormy)`)
  })

  test('the report groups the markets by storm level, stormiest first, then the meaning and what to try next', () => {
    expect(reportOf(MARKETS, WEATHER)).toBe(REPORT)
    expect(reportOf(null, WEATHER)).toBe([`DaviddTech+ weather: ${WEATHER}`, MEANING, NEXT, DISCLAIMER].join('\n'))
    expect(contextOf(BACKDROP)).toContain(BACKDROP)
  })

  test('units come from the usage JSON, with what stays free', () => {
    expect(unitsOf(USAGE)).toBe(
      'DaviddTech+: 18 of 20 units left today (resets 00:00 UTC). Still free: the market backdrop and ready routines.',
    )
    expect(unitsOf(JSON.parse(USAGE))).toBe(unitsOf(USAGE))
    expect(unitsOf('not json')).toBe(null)
    expect(unitsOf('{"daily_limit": 20}')).toBe(null)
  })

  test('the band option defaults to auto', () => {
    expect(bandOf({ band: 'off' } as never)).toBe('off')
    expect(bandOf({ band: 'command' } as never)).toBe('command')
    expect(bandOf({ band: 'loud' } as never)).toBe('auto')
    expect(bandOf({} as never)).toBe('auto')
  })
})

describe('the connector', () => {
  test('the weather is read once, saved, and read again after 6 hours or on refresh', async () => {
    const { $, world, advance } = engineOf()
    const state = fresh()

    expect(await weather($, state, false)).toMatchObject({ line: WEATHER, report: REPORT })
    expect(world.store.get(WEATHER_KEY)).toEqual({ line: WEATHER, report: REPORT, context: contextOf(BACKDROP), at: world.now })
    expect((await weather($, state, false))?.line).toBe(WEATHER)
    expect(world.calls.length, 'answered from the store').toBe(1)

    await weather($, state, true)
    expect(world.calls.length, 'refresh reads again').toBe(2)

    await advance(WEATHER_TTL_MS + 1)
    await weather($, state, false)
    expect(world.calls.length, 'an old line is read again').toBe(3)
    expect(world.calls.every(call => call.tool === 'market_backdrop' && call.server === CLAUDE_AI)).toBe(true)
  })

  test('every shape of answer gives the weather; the structured ones give the full report', async () => {
    for (const shape of ['structured', 'text', 'json'] as const) {
      const found = await weather(engineOf(CLAUDE_AI, shape).$, fresh(), false)

      expect(found?.line, shape).toBe(WEATHER)
      expect(found?.report.startsWith(shape === 'text' ? `DaviddTech+ weather: ${WEATHER}` : REPORT.split('\n')[0]!), shape).toBe(true)
    }
  })

  test('a weather saved by an older version is read again', async () => {
    const { $, world } = engineOf()

    world.store.set(WEATHER_KEY, { line: WEATHER, at: world.now })
    expect((await weather($, fresh(), false))?.report).toBe(REPORT)
    expect(world.calls.length).toBe(1)
  })

  test('the connector is found by its tools whatever its name, then remembered', async () => {
    const { $, world } = engineOf(RENAMED)
    const state = fresh()

    expect((await read($, state, 'get_usage'))?.text).toBe(USAGE)
    expect(world.calls.map(call => call.server)).toEqual([RENAMED])
    expect(state.server).toBe(RENAMED)

    await read($, state, 'market_backdrop')
    expect(world.calls.length).toBe(2)
  })

  test('only a server with both free tools counts as DaviddTech+', () => {
    expect(serversOf([...toolsOf(RENAMED), { name: 'mcp__other__market_backdrop' }, { name: 'Bash' }])).toEqual([RENAMED])
    expect(serversOf([{ name: 'mcp__claude_ai_DaviddTech___market_backdrop' }, { name: 'mcp__claude_ai_DaviddTech___get_usage' }]))
      .toEqual(['claude_ai_DaviddTech_'])
    expect(serversOf([])).toEqual([])
  })

  test('without tools in the list the fixed names are tried in order', async () => {
    const { $, world } = engineOf('daviddtechplus')

    ;($ as unknown as { tool: { list: () => Promise<unknown[]> } }).tool.list = async () => []
    expect((await read($, fresh(), 'get_usage'))?.text).toBe(USAGE)
    expect(world.calls.map(call => call.server)).toEqual(SERVERS.slice(0, SERVERS.indexOf('daviddtechplus') + 1))
  })

  test('a failure says why: not connected with the engine reason, or answered without data', async () => {
    const none = fresh()

    expect(await weather(engineOf(null).$, none, false)).toBe(null)
    expect(failureOf(none, 'weather')).toBe(
      `${NOT_CONNECTED} (${CLAUDE_AI}: no connected MCP tool "market_backdrop" on a server named "${CLAUDE_AI}")`,
    )

    const failed = fresh()

    expect(await weather(engineOf(CLAUDE_AI, 'error').$, failed, false)).toBe(null)
    expect(failureOf(failed, 'weather')).toBe(
      'DaviddTech+ answered, but the weather could not be read (market_backdrop: The data source is busy.).',
    )
  })

  test('at the start: the weather line shows once; nothing polls', async () => {
    const { $, world, advance } = engineOf()

    await showAtStart($, fresh())
    await advance(10 * RETRY_MS)

    expect(world.statuses).toEqual([statusOf(WEATHER)])
    expect(world.calls.length).toBe(1)
  })

  test('at the start without a connector: no status, one retry, then quiet', async () => {
    const { $, world, advance } = engineOf(null)

    await showAtStart($, fresh())
    expect(world.calls.length).toBe(SERVERS.length)

    await advance(RETRY_MS)
    expect(world.calls.length, 'one retry once the connector had time to connect').toBe(2 * SERVERS.length)

    await advance(10 * RETRY_MS)
    expect(world.calls.length, 'and no more').toBe(2 * SERVERS.length)
    expect(world.statuses).toEqual([])
  })

  test('a retry that finds the connector shows the line', async () => {
    const engine = engineOf(null)

    await showAtStart(engine.$, fresh())
    const late = engineOf()

    // the same timers, now against a connected engine
    late.world.timers = engine.world.timers.map(timer => ({ ...timer, fn: () => void showAtStart(late.$, fresh()) }))
    await late.advance(RETRY_MS)
    expect(late.world.statuses).toEqual([statusOf(WEATHER)])
  })
})

describe('inside Claude Code', () => {
  test('the start registers both commands', async ($, on) => {
    const commands: string[] = []

    on('command.register', ($: unknown, e: { name: string }) => {
      commands.push(e.name)

      return { value: { command: e.name } }
    })
    on('store.get', () => ({ value: undefined }))
    on('session.start', ($: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
    await $.session.start(SESSION)

    expect(commands.sort()).toEqual(['daviddtechplus-units', 'daviddtechplus-weather'])
  })

  test('with no connector the commands answer with the sign-in hint', async ($, on) => {
    on('store.get', () => ({ value: undefined }))

    for (const name of ['daviddtechplus-weather', 'daviddtechplus-units']) {
      const answer = (await $.command.run(command(name))) as { text: string }

      expect(answer.text.startsWith(NOT_CONNECTED), answer.text).toBe(true)
    }
  })
})
