// Recorded-shape answers of the Hyperliquid info API and DaviddTech+ (made up
// numbers, documented shapes), and the engine beneath the plugin in tests.

import type { On } from 'claude-code'

const HOUR = 3_600_000
/** 16 Nov 2026 12:00 UTC. */
export const NOW = Date.UTC(2026, 10, 16, 12, 0, 0)

/** candleSnapshot: 1h candles, o/c/h/l/v as strings, as the API sends them. */
export function candlesFixture(count = 60, end = NOW): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  let price = 95_000
  for (let i = count; i >= 1; i--) {
    const t = end - i * HOUR
    const o = price
    const c = o + Math.sin(i) * 400 + (i % 3 === 0 ? -150 : 120)
    const h = Math.max(o, c) + 180
    const l = Math.min(o, c) - 160
    rows.push({ t, T: t + HOUR - 1, s: 'BTC', i: '1h', o: o.toFixed(1), c: c.toFixed(1), h: h.toFixed(1), l: l.toFixed(1), v: (120 + i).toFixed(5), n: 900 + i })
    price = c
  }
  return rows
}

/** metaAndAssetCtxs: [meta, ctxs] in the universe's order; funding is hourly. */
export const CTX_FIXTURE = [
  {
    universe: [
      { name: 'BTC', szDecimals: 5, maxLeverage: 40 },
      { name: 'ETH', szDecimals: 4, maxLeverage: 25 },
      { name: 'SOL', szDecimals: 2, maxLeverage: 20 },
      { name: 'HYPE', szDecimals: 2, maxLeverage: 10 },
      { name: 'kPEPE', szDecimals: 0, maxLeverage: 10 },
    ],
  },
  [
    { funding: '0.0000125', openInterest: '25000.5', markPx: '97123.0', midPx: '97122.5', prevDayPx: '95930.0', dayNtlVlm: '2100000000.0', oraclePx: '97100.0' },
    { funding: '0.00001', openInterest: '600000.0', markPx: '3456.7', midPx: '3456.65', prevDayPx: '3470.6', dayNtlVlm: '900000000.0', oraclePx: '3455.0' },
    { funding: '-0.000005', openInterest: '3000000.0', markPx: '182.35', midPx: '182.34', prevDayPx: '178.6', dayNtlVlm: '300000000.0', oraclePx: '182.3' },
    { funding: '0.0000125', openInterest: '20000000.0', markPx: '24.51', midPx: null, prevDayPx: '25.27', dayNtlVlm: '120000000.0', oraclePx: '24.5' },
    { funding: '0.0000125', openInterest: '9000000000.0', markPx: '0.012345', midPx: '0.012344', prevDayPx: '0.0121', dayNtlVlm: '5000000.0', oraclePx: '0.01234' },
  ],
] as const

/** analyze_asset's structured brief: the fields the overlay reads. */
export const BRIEF_FIXTURE = {
  instrument: { symbol: 'BTC/USD', asset_class: 'crypto' },
  data: { last_session: '2026-11-15', reference_price: 96_500, generated_at: '2026-11-16T00:10:00Z' },
  horizon: { steps: 5, unit: 'days', sessions: ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'] },
  forecast_path: [1, 2, 3, 4, 5].map(step => ({
    step,
    session: `2026-11-${15 + step}`,
    p10: -2.2 * Math.sqrt(step),
    p25: -1.0 * Math.sqrt(step),
    p50: 0.1 * step,
    p75: 1.1 * Math.sqrt(step),
    p90: 2.4 * Math.sqrt(step),
    prob_up: 0.52,
    p50_price: null,
  })),
}

export const PANE = {
  plugin: 'lab-desk',
  component: 'Pane',
  requestId: 'lab-desk-chart',
  props: {
    title: 'BTC 1h',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 34 },
    view: {},
  },
} as const

export const BAND = {
  plugin: 'lab-desk',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

/** /<command> typed in a 120-column terminal. */
export function typed(command: string, args: string) {
  return { command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
}

export type World = {
  /** Bodies of every info API request, in order. */
  requests: string[]
  /** "METHOD url" of every HTTP request, in order. */
  fetches: string[]
  opens: string[]
  closes: string[]
  statuses: (string | undefined)[]
  mcpCalls: { server: string; tool: string; args: Record<string, unknown> }[]
  /** Servers asked for get_usage (free), kept apart from mcpCalls. */
  usageCalls: string[]
  /** Texts put in the prompt box. */
  fills: string[]
  /** Whether the pane is open, as `$.ui.panes()` answers. */
  isOpen: boolean
  /** A coin's mark price as metaAndAssetCtxs answers now. */
  price: (coin: string) => number
  /** Moves a coin's mark and mid price for the next metaAndAssetCtxs read. */
  setPrice: (coin: string, price: number) => void
}

export type WorldOptions = {
  tools?: string[]
  /** What analyze_asset answers on a server that exists; absent, every server is missing. */
  mcp?: (server: string) => { content: { type: 'text'; text: string }[]; isError: boolean; structuredContent?: unknown } | null
  /** What get_usage answers (structured content) on a server that exists; absent, it answers as `mcp` does. */
  usage?: unknown
  isFetchDown?: boolean
  /** A wait before the info API answers this body (e.g. a mocked clock's sleep), or undefined to answer at once. */
  delay?: (body: string) => Promise<void> | undefined
  /** The candles candleSnapshot answers for a coin; candlesFixture() when absent. */
  candles?: (coin: string) => Record<string, unknown>[]
  /** The rows fundingHistory answers for a coin from a time, or null to answer 429 (busy); [] when absent. */
  funding?: (coin: string, startTime: number) => Record<string, unknown>[] | null
  /** What a GET of the TradingView feed answers (url with its cursor), or undefined for 404. */
  feed?: (url: string) => { status: number; body: unknown } | undefined
  /** The fills userFillsByTime answers for a wallet and window; [] when absent. */
  fills?: (user: string, startTime: number, endTime: number) => Record<string, unknown>[]
  /** What one MCP tool answers, ahead of `mcp`; null passes on to `mcp`. */
  mcpTool?: (server: string, tool: string, args: Record<string, unknown>) => { content: { type: 'text'; text: string }[]; isError: boolean; structuredContent?: unknown } | null
}

/** The engine beneath the plugin: the info API, panes, commands, MCP, status. */
export function engine(on: On, opts: WorldOptions = {}): World {
  const moved: Record<string, number> = {}
  const names = CTX_FIXTURE[0].universe.map(u => u.name as string)
  const ctxText = () =>
    JSON.stringify([
      CTX_FIXTURE[0],
      CTX_FIXTURE[1].map((c, i) => {
        const p = moved[names[i] ?? '']
        return p === undefined ? c : { ...c, markPx: String(p), midPx: String(p) }
      }),
    ])
  const w: World = {
    requests: [],
    fetches: [],
    opens: [],
    closes: [],
    statuses: [],
    mcpCalls: [],
    usageCalls: [],
    fills: [],
    isOpen: false,
    price: coin => moved[coin] ?? Number(CTX_FIXTURE[1][names.indexOf(coin)]?.markPx ?? NaN),
    setPrice: (coin, price) => {
      moved[coin] = price
    },
  }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('http.fetch', async (_, e) => {
    const body = typeof e.init?.body === 'string' ? e.init.body : ''
    w.requests.push(body)
    w.fetches.push(`${e.init?.method ?? 'GET'} ${e.url}`)
    await opts.delay?.(body)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (opts.isFetchDown) return { value: { status: 503, ok: false, headers, text: 'down' } }
    if (e.url.includes('/tv/')) {
      const got = opts.feed?.(e.url)
      return { value: got ? { status: got.status, ok: got.status < 300, headers, text: JSON.stringify(got.body) } : { status: 404, ok: false, headers, text: 'Not found' } }
    }
    const req = JSON.parse(body) as { type: string; req?: { coin?: string }; coin?: string; startTime?: number; endTime?: number; user?: string }
    if (req.type === 'userFillsByTime') return { value: { status: 200, ok: true, headers, text: JSON.stringify(opts.fills?.(req.user ?? '', req.startTime ?? 0, req.endTime ?? 0) ?? []) } }
    if (req.type === 'fundingHistory' && opts.funding) {
      const rows = opts.funding(req.coin ?? '', req.startTime ?? 0)
      if (rows === null) return { value: { status: 429, ok: false, headers, text: 'null' } }
      return { value: { status: 200, ok: true, headers, text: JSON.stringify(rows) } }
    }
    const text = req.type === 'metaAndAssetCtxs' ? ctxText() : req.type === 'candleSnapshot' ? JSON.stringify(opts.candles?.(req.req?.coin ?? '') ?? candlesFixture()) : '[]'
    return { value: { status: 200, ok: true, headers, text } }
  })
  on('ui.open', (_, e) => {
    w.opens.push(e.id)
    w.isOpen = true
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    w.closes.push(e.id)
    w.isOpen = false
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: w.isOpen ? [{ id: 'lab-desk-chart', title: 'BTC 1h', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  on('ui.status', (_, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  on('tool.list', () => ({ value: (opts.tools ?? ['Bash', 'Read']).map(name => ({ name, description: name, mcp: name.startsWith('mcp__') })) }))
  on('prompt.fill', (_, e) => {
    w.fills.push(e.text)
    return { isFilled: true }
  })
  on('mcp.call', (_, e) => {
    if (e.tool === 'get_usage') {
      w.usageCalls.push(e.server)
      if (opts.usage !== undefined && opts.mcp?.(e.server)) {
        return { value: { content: [{ type: 'text' as const, text: 'usage' }], isError: false, structuredContent: opts.usage } }
      }
    } else w.mcpCalls.push({ server: e.server, tool: e.tool, args: e.args })
    const answer = opts.mcpTool?.(e.server, e.tool, e.args) ?? opts.mcp?.(e.server) ?? null
    if (!answer) throw new Error(`No MCP server named ${e.server}`)
    return { value: answer }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return w
}
