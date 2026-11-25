import { expect, mock, test } from 'claude-code/testing'

import { CONNECTOR_URL, fanAnchor, fanAt, fanCaption, fanFrom, fanRange, legendLine, MISSING_LINES, nextQuestion, serverCandidates, SERVERS, SOURCE_LINE, symbolFor, tierFrom } from '../hooks/forecast'
import { BRIEF_FIXTURE, NOW, PANE, engine, typed } from './fixtures'

/** Within a millionth, relative. */
function near(got: number | null | undefined, want: number) {
  expect(typeof got === 'number' && Math.abs(got - want) <= Math.abs(want) * 1e-6 + 1e-9).toBe(true)
}

const TOOL = 'mcp__claude_ai_DaviddTech___analyze_asset'
const OK = { content: [{ type: 'text' as const, text: '# BTC/USD brief' }], isError: false, structuredContent: BRIEF_FIXTURE }

test('fan: forecast_path read from the structured brief, step 0 added', async () => {
  const fan = fanFrom(BRIEF_FIXTURE)
  expect(fan?.points).toHaveLength(6)
  expect(fan?.points[0]).toEqual({ step: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 })
  expect(fan?.steps).toBe(5)
  expect(fan?.referencePrice).toBe(96_500)
  const end = fanAt(fan!, 97_000, 1)
  near(end.p50, 96_500 * 1.005)
  expect(end.p10).toBeLessThan(end.p25)
  expect(end.p75).toBeLessThan(end.p90)
  const [lo, hi] = fanRange(fan!, 97_000)
  near(lo, 96_500 * (1 - (2.2 * Math.sqrt(5)) / 100))
  near(hi, 96_500 * (1 + (2.4 * Math.sqrt(5)) / 100))
  expect(fanFrom({ headline: 'card view' })).toBeNull()
  expect(fanFrom(null)).toBeNull()
})

test('servers: the ones found by their tool, then the usual names', async () => {
  expect(serverCandidates([{ name: TOOL }, { name: 'mcp__other__analyze_asset' }])).toEqual(['claude_ai_DaviddTech_', ...SERVERS])
  expect(serverCandidates([])).toEqual(SERVERS)
  expect(symbolFor('BTC')).toBe('BTC/USD')
  expect(symbolFor('kPEPE')).toBe('PEPE/USD')
})

test('DaviddTech+ missing: the chart still draws and one line says how to add it', async ($, on) => {
  const w = engine(on)
  mock.clock(on, { now: NOW })
  mock.store(on)
  const r = await $.command.run(typed('lab-chart', 'BTC'))
  expect(r.text).toContain('BTC 1h chart open')
  expect(w.mcpCalls.map(c => c.server)).toEqual(SERVERS)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: surface === 'terminal' ? 'Raster' : 'Svg' })).toBeDefined()
    const hint = await ui.find({ type: 'Text', text: /^Add DaviddTech\+/ })
    expect(hint?.text).toBe(MISSING_LINES[0])
    expect(hint?.props.wrap).toBe('wrap')
    const url = await ui.find({ type: 'Text', text: CONNECTOR_URL })
    expect(url?.props.wrap).toBe('wrap')
    expect(await ui.find({ type: 'Text', text: /^80% range/ })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: SOURCE_LINE }))?.text).toBe(SOURCE_LINE)   // the footer always names it
    await ui.unmount()
  }
})

test('DaviddTech+ found by its tool: one call, the fan drawn and its source named', async ($, on) => {
  const w = engine(on, { tools: ['Bash', TOOL], mcp: server => (server === 'claude_ai_DaviddTech_' ? OK : null) })
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.command.run(typed('lab-chart', 'BTC'))
  expect(w.mcpCalls).toEqual([{ server: 'claude_ai_DaviddTech_', tool: 'analyze_asset', args: { symbol: 'BTC/USD', horizon: 5, price_now: 97_123 } }])
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /^80% range/ }))?.text).toBe(
    '80% range 91,753 to 101,679 · 1 in 10 ends above 101,679, 1 in 10 below 91,753 (5 days)',
  )
  const legend = await term.find({ type: 'Text', text: /^Darker shade/ })
  expect(legend?.text).toBe('Darker shade: 50% range 94,342 to 98,874 · middle 96,982 · from the 15 Nov close')
  expect(legend?.props.dimColor).toBe(true)
  const source = await term.find({ type: 'Text', text: SOURCE_LINE })
  expect(source?.text).toBe(SOURCE_LINE)
  expect(source?.props.dimColor).toBe(true)
  for (const text of [/^80% range/, /^Darker shade/, SOURCE_LINE]) expect((await term.find({ type: 'Text', text }))?.props.wrap).toBe('truncate-end')
  expect((await term.find({ type: 'Text', text: /Market data/ }))?.text).not.toContain(SOURCE_LINE)
  await term.unmount()
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(String((await desk.find({ type: 'Svg' }))?.props.source)).toContain('<polygon')
  await desk.unmount()

  // The same coin again, and a refresh: no second call (it can cost a daily unit).
  await $.command.run(typed('lab-chart', 'BTC 4h'))
  expect(w.mcpCalls).toHaveLength(1)
})

test('a forecast kept in the store is reused for 6 hours', async ($, on) => {
  const w = engine(on, { tools: [TOOL], mcp: () => OK })
  mock.clock(on, { now: NOW })
  const fan = fanFrom(BRIEF_FIXTURE)
  mock.store(on, { 'forecast:BTC:5': { at: NOW - 3_600_000, view: { coin: 'BTC', status: 'ok', fan, note: '' } } })
  await $.command.run(typed('lab-chart', 'BTC'))
  expect(w.mcpCalls).toHaveLength(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^80% range / })).toBeDefined()
  await ui.unmount()
})

test('a DaviddTech+ error is one dim line; forecast off asks nothing', async ($, on) => {
  engine(on, { tools: [TOOL], mcp: () => ({ content: [{ type: 'text', text: 'Unknown symbol HYPE/USD.\nTry a listed coin.' }], isError: true }) })
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.command.run(typed('lab-chart', 'HYPE'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^DaviddTech\+ has no range/ }))?.text).toBe(
    'DaviddTech+ has no range for HYPE/USD right now: Unknown symbol HYPE/USD.',
  )
  await ui.unmount()
})

test('forecast off: no MCP call at all', { options: { forecast: 'off' } }, async ($, on) => {
  const w = engine(on, { tools: [TOOL], mcp: () => OK })
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.command.run(typed('lab-chart', 'BTC'))
  expect(w.mcpCalls).toHaveLength(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^80% range|^Add DaviddTech|has no range/ })).toBeUndefined()
  expect(w.usageCalls).toHaveLength(0)
  await ui.unmount()
})

test('fan anchor: the reference close when it fits, scaled for k-coins, else the last price', async () => {
  const fan = fanFrom(BRIEF_FIXTURE)!
  expect(fanAnchor(fan, 97_000)).toBe(96_500)
  // kPEPE quotes 1000 PEPE: a PEPE/USD close of 0.0105 sits beside a chart near 10.5.
  const pepe = { ...fan, referencePrice: 0.0105 }
  near(fanAnchor(pepe, 10.6), 10.5)
  const [lo, hi] = fanRange(pepe, 10.6)
  expect(lo).toBeGreaterThan(9)
  expect(hi).toBeLessThan(12)
  // Far from the chart either way: the last price anchors it, so the candles keep their scale.
  expect(fanAnchor(fan, 30_000)).toBe(30_000)
  expect(fanAnchor({ ...fan, referencePrice: null }, 97_000)).toBe(97_000)
})

test('a missing DaviddTech+ is asked again after a minute, not on every interval change', async ($, on) => {
  const w = engine(on)
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  expect(w.mcpCalls).toHaveLength(SERVERS.length)
  await $.command.run(typed('lab-chart', 'BTC 4h'))
  expect(w.mcpCalls).toHaveLength(SERVERS.length)
  await clock.advance(61_000)
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  expect(w.mcpCalls).toHaveLength(SERVERS.length * 2)
})

test('a fan for another horizon is not reused: horizon 20 asks again', { options: { forecastHorizon: '20' } }, async ($, on) => {
  const w = engine(on, { tools: [TOOL], mcp: () => OK })
  mock.clock(on, { now: NOW })
  const fan = fanFrom(BRIEF_FIXTURE)
  mock.store(on, { 'forecast:BTC:5': { at: NOW - 3_600_000, view: { coin: 'BTC', horizon: 5, at: NOW - 3_600_000, status: 'ok', fan, note: '' } } })
  await $.command.run(typed('lab-chart', 'BTC'))
  expect(w.mcpCalls).toEqual([{ server: 'claude_ai_DaviddTech_', tool: 'analyze_asset', args: { symbol: 'BTC/USD', horizon: 20, price_now: 97_123 } }])
})


const LIVE = {
  ...BRIEF_FIXTURE,
  data: { ...BRIEF_FIXTURE.data, reference_price: null },
  at_your_price: { price_now: 97_123, reference_date: '2026-11-15', about: 'x', central_path_at_horizon: 97_609, range_80_at_horizon: [92_345, 102_345], path: [] },
}

test('live price: the server echoes price_now and its own range and middle are the caption', async () => {
  const fan = fanFrom(LIVE)!
  expect(fan.livePrice).toBe(97_123)
  expect(fanAnchor(fan, 50_000)).toBe(97_123)          // the price sent, whatever the chart shows now
  const fmt = (p: number) => p.toFixed(0)
  expect(fanCaption(fan, 97_500, fmt, 200).lineA).toBe('80% range 92345 to 102345 · 1 in 10 ends above 102345, 1 in 10 below 92345 (5 days)')
  expect(legendLine(fan, 97_500, fmt, 200)).toMatch(/· middle 97609 · at the live price 97123$/)
  // k-coins: the price sent is the chart's own (1000 units), so nothing is scaled.
  const pepe = fanFrom({ ...LIVE, at_your_price: { ...LIVE.at_your_price, price_now: 10.6, range_80_at_horizon: [10.1, 11.2], central_path_at_horizon: 10.62 } })!
  expect(fanAnchor(pepe, 10.6)).toBe(10.6)
  expect(fanCaption(pepe, 10.6, p => p.toFixed(2), 200).lineA).toContain('80% range 10.10 to 11.20')
  // An older copy without the live price keeps the reference-close anchor.
  expect(fanFrom(BRIEF_FIXTURE)!.livePrice).toBeNull()
})

test('get_usage: only the tier and counts are read; the email is dropped', async () => {
  expect(tierFrom({ account: 'someone@example.com', tier: 'guest', remaining_today: 2, daily_limit: 3 })).toEqual({ tier: 'guest', left: 2, limit: 3 })
  expect(tierFrom({ account: 'someone@example.com' })).toEqual({ tier: null, left: null, limit: null })
  expect(nextQuestion('kPEPE', 5, 10.6, p => p.toFixed(2))).toBe('Analyze PEPE/USD with DaviddTech+ for the next 5 days at the live price 10.60 (price_now).')
})

test('a guest is asked before the range spends a request', async ($, on) => {
  const usage = { account: 'guest@example.com', tier: 'guest', remaining_today: 2, daily_limit: 3 }
  const w = engine(on, { tools: [TOOL], mcp: () => OK, usage })
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.command.run(typed('lab-chart', 'BTC'))
  expect(w.usageCalls).toEqual(['claude_ai_DaviddTech_'])
  expect(w.mcpCalls).toHaveLength(0)                     // nothing spent yet
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Guest account/ }))?.text).toBe('Guest account: the DaviddTech+ range uses 1 daily request (2 of 3 left today).')
  await ui.press({ key: 'range' })
  expect(w.mcpCalls).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /^80% range/ })).toBeDefined()
  await ui.unmount()
})

test('a guest with no requests left gets one line and no button', async ($, on) => {
  const w = engine(on, { tools: [TOOL], mcp: () => OK, usage: { tier: 'guest', remaining_today: 0, daily_limit: 3 } })
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.command.run(typed('lab-chart', 'BTC'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Guest account/ }))?.text).toContain('no requests left today')
  expect(await ui.find({ key: 'range' })).toBeUndefined()
  expect(w.mcpCalls).toHaveLength(0)
  await ui.unmount()
})

test('a member sees the range at once; the footer button puts the next question in the prompt box', async ($, on) => {
  const w = engine(on, { tools: [TOOL], mcp: () => OK, usage: { tier: 'member', remaining_today: 40, daily_limit: 50 } })
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.command.run(typed('lab-chart', 'BTC'))
  expect(w.mcpCalls).toHaveLength(1)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'next' })
  expect(w.fills).toEqual(['Analyze BTC/USD with DaviddTech+ for the next 5 days at the live price 97,123 (price_now).'])
  await ui.unmount()
})
