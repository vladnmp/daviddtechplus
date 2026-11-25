// Drawing tools like TradingView's: a trend line through two swings and a Fibonacci retracement, typed or asked of Claude.

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import type { Candle } from '../types'
import { deskCells } from '../hooks/cells'
import { pineScript } from '../hooks/export'
import { autoFib, autoTrend, fibPrices, markFrom, markText, parseMark, swings, trendAt } from '../hooks/marks'
import { CHART_TOOL_NAME } from '../hooks/register'
import { deskSvg } from '../hooks/svg'
import { NOW, engine, typed } from './fixtures'

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

const HOUR = 3_600_000
// Waves on a slow rise: two swing lows, the second higher.
const candles: Candle[] = Array.from({ length: 80 }, (_, i) => {
  const c = 100 + Math.sin(i / 6) * 8 + i * 0.1
  return { t: 1_700_000_000_000 + i * HOUR, o: c - 0.5, h: c + 2, l: c - 2, c, v: 10 }
})

test('swings, the automatic trend line and fib, and their words', () => {
  const lows = swings(candles, 'low')
  expect(lows.length).toBeGreaterThanOrEqual(2)
  const t = autoTrend('ETH', candles, 'low')
  if (!t) throw new Error('no trend')
  expect(t.kind).toBe('trend')
  expect((t.t ?? 0) < (t.t2 ?? 0)).toBe(true)
  expect((t.price2 ?? 0) > t.price).toBe(true)
  // The line runs on past its second point.
  const last = (candles.at(-1) as Candle).t
  expect((trendAt(t, last) ?? 0) > (t.price2 ?? 0)).toBe(true)
  expect(markText(t, last)).toMatch(/^trend line [\d,.]+ \(2023-11-\d\d \d\d:\d\d\) → [\d,.]+ \(.+\) lows, now [\d,.]+$/)

  const f = autoFib('ETH', candles)
  if (!f) throw new Error('no fib')
  const hi = Math.max(...candles.map(c => c.h))
  const lo = Math.min(...candles.map(c => c.l))
  expect([f.price, f.price2].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([lo, hi])
  const lv = fibPrices({ coin: 'BTC', kind: 'fib', price: 1600, price2: 1800, label: 'fib' })
  expect(lv.map(x => x.r)).toEqual([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1])
  expect(lv[0]?.price).toBe(1800)
  expect(lv.at(-1)?.price).toBe(1600)
  expect(Math.abs((lv[4]?.price ?? 0) - 1676.4) < 1e-9).toBe(true)
  expect(markText({ coin: 'BTC', kind: 'fib', price: 1600, price2: 1800, label: 'fib' })).toBe('fib 1,600 → 1,800: 0.382 1,723.6 · 0.5 1,700 · 0.618 1,676.4')

  expect(parseMark('BTC', 'fib 58000 65000')).toEqual({ coin: 'BTC', kind: 'fib', price: 58000, price2: 65000, label: 'fib' })
  expect(parseMark('BTC', 'fib 58000')).toHaveProperty('error')
  expect(parseMark('ETH', 'fib', candles)).toEqual(f)
  expect(parseMark('ETH', 'trend highs', candles)).toEqual(autoTrend('ETH', candles, 'high'))
  expect(parseMark('ETH', 'trend lows')).toHaveProperty('error')

  // Claude's form: two points, or a swing side.
  const a = candles[10] as Candle
  const b = candles[40] as Candle
  const two = markFrom('ETH', { kind: 'trend', time: new Date(b.t).toISOString(), price: 104, time2: new Date(a.t).toISOString(), to: 96 }, candles)
  expect(two).toEqual({ coin: 'ETH', kind: 'trend', price: 96, t: a.t, price2: 104, t2: b.t, label: '' })
  expect(markFrom('ETH', { kind: 'trend', swing: 'lows' }, candles)).toEqual(t)
  expect(markFrom('ETH', { kind: 'fib' }, candles)).toEqual(f)
  expect(markFrom('ETH', { kind: 'trend', time: 'nope', price: 1, to: 2 }, candles)).toBeNull()
})

test('both charts draw the trend line and the fib levels', () => {
  const t = autoTrend('ETH', candles, 'low')
  const f = autoFib('ETH', candles)
  if (!t || !f) throw new Error('no marks')
  const input = { candles, cursor: 0, fan: null, marks: [t, f] }
  const svg = deskSvg(input, '1h', 'ETH', null)
  expect(svg).toMatch(/<circle cx="[\d.]+" cy="[\d.]+" r="2\.5"/)
  expect(svg).toContain('>lows<')
  expect(svg).toMatch(/>0\.618 \([\d,.]+\)</)
  expect(svg).toMatch(/>0\.5 \([\d,.]+\)</)
  const cols = 90
  const cells = deskCells(input, cols, 24)
  const rows = Array.from({ length: 24 }, (_, y) => cells.slice(y * cols, (y + 1) * cols).map(c => String.fromCodePoint(c[0])).join(''))
  expect(rows.some(r => r.includes('0.618') && r.includes('┈'))).toBe(true)
  expect(rows.join('').split('•').length - 1).toBeGreaterThan(5)
})

test('the Pine export draws them too', () => {
  const t = autoTrend('ETH', candles, 'low')
  const f = autoFib('ETH', candles)
  if (!t || !f) throw new Error('no marks')
  const pine = pineScript([], 'ETH', '1h', [t, f])
  expect(pine).toMatch(/var line trend_0 = line\.new\(\d+, [\d.]+, \d+, [\d.]+, xloc = xloc\.bar_time, extend = extend\.right/)
  expect(pine).toMatch(/hline\([\d.]+, "fib 0\.618"/)
  expect(pine.match(/"fib /g)).toHaveLength(7)
  expect(pine).not.toMatch(/barstate\.islast|lookahead|\[-\d/)
})

test('/lab-mark trend and fib, and the chart tool, on a live chart', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  on('tool.register', (_, e) => ({ value: { tool: `mcp__lab-desk__${e.name}` } }))
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  const fib = (await $.command.run(typed('lab-mark', 'fib'))).text ?? ''
  expect(fib).toMatch(/^Drew fib [\d,.]+ → [\d,.]+: 0\.382 [\d,.]+ · 0\.5 [\d,.]+ · 0\.618 [\d,.]+ on BTC\./)
  const list = (await $.command.run(typed('lab-mark', ''))).text ?? ''
  expect(list).toMatch(/Trend line: \/lab-mark trend lows/)
  expect((await $.command.run(typed('lab-mark', 'fib 1 2 3'))).text).toMatch(/^Drew fib 1 → 2/)
  expect(store.get('marks')).toHaveLength(2)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = String((await $.tool.call({ tool: CHART_TOOL_NAME, clear_marks: true, marks: [{ kind: 'fib', price: 60000, to: 66000 }] })).result ?? '')
  expect(r).toMatch(/Marks: fib 60,000 → 66,000: 0\.382 63,708 · 0\.5 63,000 · 0\.618 62,292\./)
  expect(r).not.toMatch(/\b(buy|sell|signals?|targets?|edge)\b/i)
})
