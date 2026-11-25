// /lab-tv and /lab-trades on the engine: the link from DaviddTech+, the feed read every minute, the scorecard, and a
// wallet read straight from Hyperliquid (the address never goes to DaviddTech).

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import { ALERTS_TOOL_NAME, TRADES_TOOL_NAME } from '../hooks/register'
import { NOW, candlesFixture, engine, typed } from './fixtures'

const H = 3_600_000
const TOKEN = '0123456789abcdef0123' + 'AbCdEfGhIjKlMnOpQrStUv_-'
const HOOK = `https://vlad-64070--daviddtech-plus-tv.modal.run/tv/${TOKEN}`
const W = '0x' + 'cd'.repeat(20)
const banned = /\b(buy|buying|sell|selling|signals?|targets?|edge|expected move)\b/i

function memStore(on: On): Map<string, unknown> {
  const m = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: m.get(e.key) }))
  on('store.set', (_, e) => {
    m.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    m.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...m.keys()] }))
  return m
}

const LINK = {
  content: [{ type: 'text' as const, text: 'link' }],
  isError: false,
  structuredContent: { action: 'link', webhook_url: HOOK, feed_url: `${HOOK}/recent`, message: '{"name":"My alert"}', strategy_message: '{"name":"My strategy"}' },
}

/** 12 long alerts on BTC 1h, 25 hours apart, all closed 50 candles before NOW. */
function feedAlerts(n = 12) {
  return Array.from({ length: n }, (_, i) => ({
    id: (i + 1).toString(16),
    at: NOW - 380 * H + i * 25 * H + 30 * 60_000,
    name: 'RSI dip',
    ticker: 'BTCUSDT.P',
    exchange: 'BINANCE',
    interval: '1h',
    side: 'long',
    coin: 'BTC',
    symbol: 'BTC/USD',
    rule: 'rsi < 45',
  }))
}

function quiet(on: On): string[] {
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', () => ({ value: { isSent: true, channel: 'client' as const } }))
  return toasts
}

test('/lab-tv on asks DaviddTech+ for the link, shows how to paste it, and reads the feed', async ($, on) => {
  const alerts = feedAlerts()
  const w = engine(on, {
    tools: ['mcp__daviddtech-plus__analyze_asset'],
    mcpTool: (_, tool) => (tool === 'tv_alerts' ? LINK : null),
    feed: url => ({ status: 200, body: { ok: true, alerts: url.includes('?after=') ? [] : alerts } }),
    candles: () => candlesFixture(400),
  })
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  quiet(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const text = (await $.command.run(typed('lab-tv', 'on'))).text ?? ''
  expect(text).toMatch(/^TradingView alerts on: the desk reads them every minute/)
  expect(text).toMatch(/12 alerts from the last 30 days came in\./)
  expect(text).toContain(HOOK)
  expect(text).toMatch(/2-step sign-in/)
  expect(text).toMatch(/^Next: /m)
  expect(w.mcpCalls.filter(c => c.tool === 'tv_alerts')).toEqual([{ server: 'daviddtech-plus', tool: 'tv_alerts', args: { action: 'link' } }])
  expect(store.get('tvFeed')).toBe(`${HOOK}/recent`)
  expect((store.get('tvAlerts') as unknown[]).length).toBe(12)
  // The status hides the private part of the link.
  const status = (await $.command.run(typed('lab-tv', ''))).text ?? ''
  expect(status).toMatch(/^TradingView alerts: on, reading https:\/\/vlad-64070--daviddtech-plus-tv\.modal\.run\/tv\/0123456789abcdef0123…\/recent every minute\./)
  expect(status).not.toContain(TOKEN)
  expect(status).toMatch(/12 kept on this PC\./)
  expect(status).toMatch(/RSI dip · BTC 1h · long/)
  // The next read asks only for what came after the last one kept.
  expect(w.fetches.filter(f => f.includes('/tv/')).at(-1)).toBe(`GET ${HOOK}/recent?after=c`)
  for (const t of [text, status]) expect(t).not.toMatch(banned)
})

test('/lab-tv on without DaviddTech+ says how to get the link; a wrong link is refused', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  memStore(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await $.command.run(typed('lab-tv', 'on'))).text ?? '').toMatch(/^DaviddTech\+ did not answer with a TradingView link\..*\/lab-tv link <link>/)
  expect((await $.command.run(typed('lab-tv', 'link https://example.com/tv/abc'))).text ?? '').toMatch(/^That isn't a DaviddTech\+ TradingView link/)
  expect((await $.command.run(typed('lab-tv', ''))).text ?? '').toMatch(/^TradingView alerts: off\./)
})

test('a new alert is said once and pinned in orange when the chart shows its coin; a renewed link stops the reading', async ($, on) => {
  let list: Record<string, unknown>[] = []
  let isGone = false
  engine(on, { feed: () => (isGone ? undefined : { status: 200, body: { ok: true, alerts: list } }), candles: () => candlesFixture(400) })
  const clock = mock.clock(on, { now: NOW })
  memStore(on)
  const toasts = quiet(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  await $.command.run(typed('lab-tv', `link ${HOOK}`))
  list = [{ id: '1', at: NOW - 2 * H, name: 'Breakout', interval: '1h', side: 'short', coin: 'BTC', ticker: 'BTCUSDT.P', dplus: { symbol: 'BTC/USD', days: 5, as_of: '2026-11-15', lean: 'slightly downward', chance_up: 0.44, range80: [-7, 5], middle: -0.5 } }]
  await clock.advance(61_000)
  expect(toasts.filter(t => t.startsWith('TradingView:'))).toEqual(['TradingView: Breakout · BTC 1h · short · DaviddTech+ 5 days: slightly downward, 44% up, 80% range -7.0% to +5.0%'])
  const layers = String((await $.tool.call({ tool: 'mcp__lab-desk__chart_read' })).result ?? '')
  expect(layers).toMatch(/tv alerts/)
  await clock.advance(61_000)
  expect(toasts.filter(t => t.startsWith('TradingView:'))).toHaveLength(1)
  isGone = true
  await clock.advance(61_000)
  expect(toasts.filter(t => t.startsWith('Your TradingView link was renewed'))).toHaveLength(1)
  await clock.advance(61_000)
  expect(toasts.filter(t => t.startsWith('Your TradingView link was renewed'))).toHaveLength(1)
})

test('/lab-tv score grades each alert on the candles after it; the tool says the same', async ($, on) => {
  engine(on, { feed: () => ({ status: 200, body: { ok: true, alerts: feedAlerts() } }), candles: () => candlesFixture(400) })
  mock.clock(on, { now: NOW })
  memStore(on)
  quiet(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(typed('lab-tv', `link ${HOOK}`))
  const text = (await $.command.run(typed('lab-tv', 'score'))).text ?? ''
  expect(text).toMatch(/^RSI dip · BTC 1h · long: 12 alerts from /)
  expect(text).toMatch(/^ {2} 5 on: median [+-]\d+\.\d%/m)
  expect(text).toMatch(/any candle/)
  expect(text).toMatch(/Backtest of the rule "rsi < 45"/)
  expect(text).toMatch(/^Next: \/lab-after rsi < 45/m)
  expect(text).toMatch(/Market data: Hyperliquid public API$/)
  const tool = String((await $.tool.call({ tool: ALERTS_TOOL_NAME, action: 'score' } as never)).result ?? '')
  expect(tool).toMatch(/^RSI dip · BTC 1h · long: 12 alerts/)
  const listed = String((await $.tool.call({ tool: ALERTS_TOOL_NAME, action: 'list', count: 2 } as never)).result ?? '')
  expect(listed.match(/^- /gm)).toHaveLength(2)
  for (const t of [text, tool, listed]) expect(t).not.toMatch(banned)
})

test('/lab-trades reads a wallet from Hyperliquid only, pins the trips in purple, and forgets it on off', async ($, on) => {
  const fills: Record<string, unknown>[] = []
  for (let i = 0; i < 12; i++) {
    const t = NOW - 300 * H + i * 20 * H
    fills.push({ coin: 'BTC', px: '95000', sz: '0.1', side: 'B', time: t, startPosition: '0', dir: 'Open Long', closedPnl: '0', fee: '2', oid: i, tid: i })
    fills.push({ coin: 'BTC', px: i % 2 ? '95500' : '94800', sz: '0.1', side: 'A', time: t + 3 * H, startPosition: '0.1', dir: 'Close Long', closedPnl: i % 2 ? '50' : '-20', fee: '2', oid: i, tid: i })
  }
  const w = engine(on, { fills: user => (user === W ? fills : []), feed: () => ({ status: 200, body: { ok: true, alerts: feedAlerts() } }), candles: () => candlesFixture(400) })
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  quiet(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(typed('lab-tv', `link ${HOOK}`))
  const text = (await $.command.run(typed('lab-trades', W))).text ?? ''
  expect(text).toMatch(/^Trades of 0xcdcd…cdcd over the last 90 days: 12 finished round trips/)
  expect(text).toMatch(/Made money 50% of the time/)
  expect(text).toMatch(/Pinned on BTC 1h in purple: \d+ on the candles shown/)
  expect(text).toMatch(/Of 12 long or short alerts on coins you trade, you took \d+ and skipped \d+/)
  expect(store.get('tvWallet')).toBe(W)
  // The address goes to Hyperliquid's info API and nowhere else.
  expect(w.requests.filter(b => b.includes(W)).length).toBeGreaterThan(0)
  expect(w.fetches.filter(f => f.includes('/tv/') && f.includes(W))).toEqual([])
  expect(JSON.stringify(w.mcpCalls)).not.toContain(W)
  const tool = String((await $.tool.call({ tool: TRADES_TOOL_NAME } as never)).result ?? '')
  expect(tool).toMatch(/^Trades of 0xcdcd…cdcd/)
  expect(String((await $.tool.call({ tool: TRADES_TOOL_NAME, wallet: 'nope' } as never)).result ?? '')).toMatch(/^That is not a wallet address/)
  expect((await $.command.run(typed('lab-trades', 'off'))).text ?? '').toMatch(/^Wallet forgotten/)
  expect(store.get('tvWallet')).toBe('')
  expect((await $.command.run(typed('lab-trades', ''))).text ?? '').toMatch(/^Your trades on the chart: \/lab-trades 0x…/)
  for (const t of [text, tool]) expect(t).not.toMatch(banned)
})

test('the alerts and the wallet come back in the next session', async ($, on) => {
  engine(on, { feed: () => ({ status: 200, body: { ok: true, alerts: [] } }) })
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  store.set('tvAlerts', feedAlerts(3))
  store.set('tvFeed', `${HOOK}/recent`)
  store.set('tvWallet', W)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const status = (await $.command.run(typed('lab-tv', ''))).text ?? ''
  expect(status).toMatch(/^TradingView alerts: on/)
  expect(status).toMatch(/3 kept on this PC\./)
})
