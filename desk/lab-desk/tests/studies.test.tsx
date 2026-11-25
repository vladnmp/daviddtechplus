// Indicators on the chart: /lab-ind, the saved list, and the two tools Claude calls (chart, chart_read).

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import { changeList, MAX_STUDIES } from '../hooks/indicators'
import { CHART_TOOL_NAME, READ_TOOL_NAME } from '../hooks/register'
import { NOW, PANE, engine, typed } from './fixtures'

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

test('change list: presets, kind-wide removal, the limits, plain notes', async () => {
  const a = changeList([], { add: ['trend', 'rsi'] })
  expect(a.ids).toEqual(['ema 20', 'ema 50', 'ema 200', 'rsi 14'])
  const b = changeList(a.ids, { remove: ['ema'] })
  expect(b.ids).toEqual(['rsi 14'])
  expect(b.removed).toEqual(['ema 20', 'ema 50', 'ema 200'])
  const c = changeList(['rsi 14', 'macd 12 26 9'], { add: ['atr'] })
  expect(c.ids).toEqual(['rsi 14', 'macd 12 26 9'])
  expect(c.notes.join(' ')).toMatch(/Two lower panes at most/)
  const d = changeList(['sma 1', 'sma 2', 'sma 3', 'sma 4', 'sma 5', 'sma 6'], { add: ['vwap'] })
  expect(d.ids).toHaveLength(MAX_STUDIES)
  expect(d.notes.join(' ')).toMatch(/at most/)
  expect(changeList(['rsi 14'], { add: ['nope'] }).notes.join(' ')).toMatch(/No indicator called "nope"/)
  expect(changeList(['rsi 14'], { remove: ['ema 50'] }).notes).toEqual(['ema 50 is not on the chart.'])
  expect(changeList(['rsi 14', 'vwap'], { clear: true, add: ['ema 9'] }).ids).toEqual(['ema 9'])
})

test('/lab-ind adds, lists, removes and clears; it opens a chart when none is up and saves the list', async ($, on) => {
  const w = engine(on)
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  const added = (await $.command.run(typed('lab-ind', 'ema 50, rsi'))).text ?? ''
  expect(added).toMatch(/Opened the BTC 1h chart/)
  expect(added).toMatch(/Added EMA 50 · RSI 14/)
  expect(w.opens).toEqual(['lab-desk-chart'])
  expect(store.get('studies')).toEqual(['ema 50', 'rsi 14'])
  // EMA 50 wants 200 candles of warm-up: the chart asks for 500.
  const last = JSON.parse(w.requests.filter(r => r.includes('candleSnapshot')).at(-1) ?? '{}') as { req: { startTime: number; endTime: number } }
  expect((last.req.endTime - last.req.startTime) / 3_600_000).toBe(500)
  const listed = (await $.command.run(typed('lab-ind', ''))).text ?? ''
  expect(listed).toMatch(/On the chart: EMA 50 · RSI 14\. EMA 50: [\d,.]+ · RSI 14: \d+\.\d/)
  const removed = (await $.command.run(typed('lab-ind', 'remove ema'))).text ?? ''
  expect(removed).toMatch(/Removed EMA 50\. On the chart: RSI 14\./)
  const cleared = (await $.command.run(typed('lab-ind', 'clear'))).text ?? ''
  expect(cleared).toMatch(/On the chart: none\./)
  expect(store.get('studies')).toEqual([])
  const help = (await $.command.run(typed('lab-ind', 'help'))).text ?? ''
  expect(help).toMatch(/supertrend 10 3: /)
})

test('the list comes back in a new session', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  store.set('studies', ['bb 20 2', 'macd 12 26 9'])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const listed = (await $.command.run(typed('lab-ind', 'list'))).text ?? ''
  expect(listed).toMatch(/On the chart: BB 20 2 · MACD 12 26 9\./)
})

test('Claude\'s chart tool switches coin and interval and paints; chart_read returns values and CSV', async ($, on) => {
  const w = engine(on)
  mock.clock(on, { now: NOW })
  memStore(on)
  on('tool.register', (_, e) => ({ value: { tool: `mcp__lab-desk__${e.name}` } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await $.tool.call({ tool: CHART_TOOL_NAME, coin: 'eth', interval: '4h', add: ['ema 20', 'momentum'] })
  const text = String(r.result ?? r.deny)
  expect(text).toMatch(/Added EMA 20 · RSI 14 · MACD 12 26 9\./)
  expect(text).toMatch(/Chart: ETH 4h/)
  expect(text).toMatch(/MACD 12 26 9: hist [-\d.]+ {2}MACD [-\d.]+ {2}avg 9 [-\d.]+/)
  expect(w.opens.length).toBeGreaterThan(0)
  const read = await $.tool.call({ tool: READ_TOOL_NAME, candles: 5 })
  const csv = String(read.result ?? read.deny).split('\n')
  const head = csv.find(l => l.startsWith('time_utc,'))
  expect(head).toBe('time_utc,open,high,low,close,volume,EMA 20,RSI 14,MACD 12 26 9 hist,MACD 12 26 9 MACD,MACD 12 26 9 avg 9')
  expect(csv.filter(l => /^\d{4}-\d\d-\d\dT/.test(l))).toHaveLength(5)
  const bad = await $.tool.call({ tool: CHART_TOOL_NAME, coin: 'NOPE' })
  expect(String(bad.result ?? bad.deny)).toMatch(/No Hyperliquid perp named NOPE; kept ETH\./)
})

test('/lab opens the chart and lists what the desk does', async ($, on) => {
  const w = engine(on)
  mock.clock(on, { now: NOW })
  memStore(on)
  const text = (await $.command.run(typed('lab', ''))).text ?? ''
  expect(text).toMatch(/^Lab desk, read-only\. BTC 1h chart open\. Indicators: none\./)
  expect(text).toMatch(/\/lab-ind ema 50, rsi/)
  expect(w.opens).toEqual(['lab-desk-chart'])
})

test('preset chips under the chart add a set, light up, and take it off again', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    expect((await pane.find({ type: 'Button', key: 'set-trend' }))?.props?.variant).toBe('secondary')
    await pane.unmount()
  }
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'set-momentum' })
  expect(store.get('studies')).toEqual(['rsi 14', 'macd 12 26 9'])
  expect((await pane.find({ type: 'Button', key: 'set-momentum' }))?.props?.variant).toBe('primary')
  const svg = String((await pane.find({ type: 'Svg' }))?.props?.source ?? '')
  expect(svg).toContain('RSI 14')
  await pane.press({ key: 'set-momentum' })
  expect(store.get('studies')).toEqual([])
  await pane.unmount()
})

test('desktop zoom buttons show more or fewer candles; the terminal has none', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  memStore(on)
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Button', key: 'zoom-in' })).toBeUndefined()
  await term.unmount()
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const hits = async () => (String((await pane.find({ type: 'Svg' }))?.props?.source ?? '').match(/class="hit"/g) ?? []).length
  const normal = await hits()
  await pane.press({ key: 'zoom-in' })
  const closer = await hits()
  await pane.press({ key: 'zoom-out' })
  await pane.press({ key: 'zoom-out' })
  const svg = String((await pane.find({ type: 'Svg' }))?.props?.source ?? '')
  expect(closer).toBeLessThan(normal)
  // Zoomed out, each candle is 5 units wide instead of 8 (the fixture has 60 candles, all shown already).
  expect(svg).toMatch(/class="hit" x="[\d.]+" y="\d+" width="5"/)
  await pane.unmount()
})

test('Explain chart fills the prompt with a plain question about what is painted', async ($, on) => {
  const w = engine(on)
  mock.clock(on, { now: NOW })
  memStore(on)
  await $.command.run(typed('lab-chart', 'ETH 4h'))
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'explain' })
  expect(w.fills.at(-1)).toMatch(/^Read the Lab desk chart \(chart_read\) for ETH 4h and explain the recent price action/)
  await pane.unmount()
  await $.command.run(typed('lab-ind', 'ema 50, rsi'))
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await again.press({ key: 'explain' })
  expect(w.fills.at(-1)).toBe('Read the Lab desk chart (chart_read) and explain in plain words what EMA 50 · RSI 14 show on ETH 4h right now. Then add one indicator that would help and say why.')
  for (const f of w.fills) expect(f).not.toMatch(/\b(buy|sell|signals?|targets?|edge)\b/i)
  await again.unmount()
})
