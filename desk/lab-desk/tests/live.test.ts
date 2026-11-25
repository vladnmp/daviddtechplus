// TradingView alerts on the desk: the feed read, kept and graded on known candles. Pure math, no engine.

import { expect, test } from 'claude-code/testing'

import type { Candle, Market } from '../types'
import { MIN_CASES } from '../hooks/history'
import {
  alertPins,
  backtestOf,
  dplusAgrees,
  feedQuery,
  feedUrlOf,
  firstOpenAfter,
  groupAlerts,
  keepAlerts,
  lastId,
  listText,
  parseFeed,
  scoreGroup,
  scoreRow,
  scoreText,
  toastText,
  ungradedLine,
} from '../hooks/live'
import type { TvAlert } from '../hooks/live'

const H = 3_600_000
const T0 = Date.UTC(2026, 0, 1)
const TOKEN = '0123456789abcdef0123' + 'AbCdEfGhIjKlMnOpQrStUv_-'
const banned = /\b(buy|buying|sell|selling|signals?|targets?|edge|expected move)\b/i

/** Candles going up 1% every hour, opening at the last close. */
function rising(n: number): Candle[] {
  const out: Candle[] = []
  let p = 100
  for (let i = 0; i < n; i++) {
    const c = p * 1.01
    out.push({ t: T0 + i * H, o: p, h: c * 1.001, l: p * 0.999, c, v: 1 })
    p = c
  }
  return out
}

const ctx = (coin: string) => ({ coin, price: 1, prevDay: 1, funding: null, openInterest: null, dayVolume: null })
const market: Market = { at: 0, coins: { BTC: ctx('BTC'), SOL: ctx('SOL'), kPEPE: ctx('kPEPE') } }

function alert(i: number, extra: Partial<TvAlert> = {}): TvAlert {
  return { id: (i + 1).toString(16), at: T0 + i * H + 60_000, name: 'RSI dip', ticker: 'BTCUSDT.P', exchange: 'BINANCE', interval: '1h', side: 'long', coin: 'BTC', symbol: 'BTC/USD', ...extra }
}

test('the feed is read field by field; junk is dropped', () => {
  const raw = {
    ok: true,
    alerts: [
      { id: '1a', at: 5, name: 'A', side: 'long', price: 10, coin: 'BTC', dplus: { symbol: 'BTC/USD', days: 5, as_of: '2026-11-20', lean: 'slightly upward', chance_up: 0.56, range80: [-6, 7.5], middle: 0.4 } },
      { id: 'zz', at: 5 },
      { id: '2', at: 'x' },
      { id: '3', at: 6, side: 'sideways', price: -1 },
      null,
    ],
  }
  const got = parseFeed(raw)
  expect(got.map(a => a.id)).toEqual(['1a', '3'])
  expect(got[0]?.dplus?.range80).toEqual([-6, 7.5])
  expect(got[1]?.side).toBeUndefined()
  expect(got[1]?.price).toBeUndefined()
  expect(parseFeed(null)).toEqual([])
  expect(parseFeed({ alerts: 'no' })).toEqual([])
})

test('the feed link comes from the webhook link or the feed link, and nothing else', () => {
  const hook = `https://vlad-64070--daviddtech-plus-tv.modal.run/tv/${TOKEN}`
  expect(feedUrlOf(hook)).toBe(`${hook}/recent`)
  expect(feedUrlOf(`here: ${hook}/recent ok`)).toBe(`${hook}/recent`)
  expect(feedUrlOf(`http://localhost:8000/tv/${TOKEN}`)).toBe(`http://localhost:8000/tv/${TOKEN}/recent`)
  expect(feedUrlOf(`http://evil.example/tv/${TOKEN}`)).toBeNull()
  expect(feedUrlOf('https://x.modal.run/tv/short')).toBeNull()
  expect(feedQuery('u', null)).toBe('u')
  expect(feedQuery('u', 'ff')).toBe('u?after=ff')
})

test('alerts are kept once each, oldest first; the cursor is the highest id', () => {
  const kept = keepAlerts([alert(1), alert(2)], [alert(2), alert(15), alert(3)])
  expect(kept.map(a => a.id)).toEqual(['2', '3', '4', '10'])
  expect(lastId(kept)).toBe('10')
  expect(lastId([])).toBeNull()
})

test('pins: up for long, down for short, a dot at the price for a close; only this coin and interval', () => {
  const kept = [alert(1), alert(2, { side: 'short' }), alert(3, { side: 'close', price: 101 }), alert(4, { coin: 'SOL' }), alert(5, { interval: '4h' })]
  const pins = alertPins(kept, 'BTC', '1h', market)
  expect(pins.map(p => p.dir)).toEqual(['up', 'down', 'dot'])
  expect(pins[2]?.price).toBe(101)
  expect(pins[0]?.label).toBe('RSI dip')
})

test('grading starts at the first candle opening after the alert arrived', () => {
  const c = rising(10)
  expect(firstOpenAfter(c, T0)).toBe(0)
  expect(firstOpenAfter(c, T0 + 1)).toBe(1)
  expect(firstOpenAfter(c, T0 + 9 * H + 1)).toBe(-1)
})

test('under 10 graded alerts there are no numbers; from 10 on, the median, the share and any candle', () => {
  const c = rising(800)
  const few = groupAlerts(Array.from({ length: MIN_CASES - 1 }, (_, i) => alert(i * 60)), market)[0]
  if (!few) throw new Error('no group')
  const s1 = scoreGroup(few, c, [])
  expect(s1.steps.every(s => s.stats === null)).toBe(true)
  const t1 = scoreText(s1)
  expect(t1).toMatch(/no numbers under 10/)
  expect(scoreRow(s1)).toMatch(/no numbers under 10/)

  const many = groupAlerts(Array.from({ length: 12 }, (_, i) => alert(i * 60)), market)[0]
  if (!many) throw new Error('no group')
  const s2 = scoreGroup(many, c, [])
  const at5 = s2.steps.find(s => s.k === 5)
  expect(at5?.cases.length).toBe(12)
  // Five rising candles from the open: 1.01^5 - 1.
  expect(Math.abs((at5?.stats?.median ?? NaN) - (1.01 ** 5 - 1)) < 1e-6).toBe(true)
  expect(at5?.stats?.up).toBe(1)
  expect(at5?.base.up).toBe(1)
  const text = scoreText(s2)
  expect(text).toMatch(/RSI dip · BTC 1h · long: 12 alerts/)
  expect(text).toMatch(/ 5 on: median \+5\.1%/)
  expect(text).not.toMatch(banned)
})

test('alerts closer together than k candles count once at that step', () => {
  const c = rising(400)
  const g = groupAlerts(Array.from({ length: 12 }, (_, i) => alert(i * 3)), market)[0]
  if (!g) throw new Error('no group')
  const s = scoreGroup(g, c, [])
  expect(s.steps.find(x => x.k === 5)?.cases.length).toBe(6)
  expect(s.steps.find(x => x.k === 20)?.cases.length).toBe(2)
})

test('a short is graded on the move down, and funding is paid by a long', () => {
  const c = rising(400)
  const shorts = groupAlerts(Array.from({ length: 10 }, (_, i) => alert(i * 30, { side: 'short', name: 'top' })), market)[0]
  if (!shorts) throw new Error('no group')
  const s = scoreGroup(shorts, c, [])
  expect(s.steps[0]?.stats?.up).toBe(0)
  expect(scoreText(s)).toMatch(/down 0%/)
  const funding = Array.from({ length: 400 }, (_, i) => ({ t: T0 + i * H, rate: 0.001 }))
  const longs = groupAlerts(Array.from({ length: 10 }, (_, i) => alert(i * 30)), market)[0]
  if (!longs) throw new Error('no group')
  const free = scoreGroup(longs, c, []).steps[0]?.stats?.median ?? NaN
  const paid = scoreGroup(longs, c, funding).steps[0]?.stats?.median ?? NaN
  expect(Math.abs((free - paid) - (0.005)) < 1e-6).toBe(true)
})

test('DaviddTech+ agreeing or not, by its lean and the alert side', () => {
  const d = (lean: string) => ({ symbol: 'BTC/USD', days: 5, as_of: '2026-11-20', lean, chance_up: 0.5, range80: [-5, 5] as [number, number] })
  expect(dplusAgrees(alert(1, { dplus: d('slightly upward') }))).toBe(true)
  expect(dplusAgrees(alert(1, { side: 'short', dplus: d('slightly upward') }))).toBe(false)
  expect(dplusAgrees(alert(1, { side: 'short', dplus: d('downward') }))).toBe(true)
  expect(dplusAgrees(alert(1, { dplus: d('no clear lean') }))).toBeNull()
  expect(dplusAgrees(alert(1, { side: 'close', dplus: d('upward') }))).toBeNull()
  expect(dplusAgrees(alert(1))).toBeNull()
  const g = groupAlerts(Array.from({ length: 12 }, (_, i) => alert(i * 60, { dplus: d(i % 2 ? 'upward' : 'downward') })), market)[0]
  if (!g) throw new Error('no group')
  const s = scoreGroup(g, rising(800), [])
  expect(s.dplus?.agree.length).toBe(6)
  expect(s.dplus?.against.length).toBe(6)
  expect(scoreText(s)).toMatch(/DaviddTech\+ leaned the same way 6 times and against 6: under 10 each/)
})

test('the backtest of a rule; a rule the desk cannot read gives none', () => {
  const c = rising(300)
  expect(backtestOf('rsi is high', c, 20, 'long')).toBeNull()
  const b = backtestOf('close > ema 20', c, 20, 'long')
  expect(b?.k).toBe(20)
})

test('stocks and currency pairs are listed, not graded; texts carry the DaviddTech+ range', () => {
  const dplus = { symbol: 'AAPL', days: 5, as_of: '2026-11-20', lean: 'slightly upward', chance_up: 0.56, range80: [-4, 5.5] as [number, number] }
  const kept = [alert(1, { coin: undefined, ticker: 'AAPL', exchange: 'NASDAQ', name: 'Breakout', symbol: 'AAPL', dplus }), alert(2)]
  const groups = groupAlerts(kept, market)
  expect(ungradedLine(groups)).toMatch(/^1 alert not graded here, not a Hyperliquid perp: Breakout \(AAPL\)/)
  expect(ungradedLine(groupAlerts([alert(1)], market))).toBeNull()
  const t = toastText(kept[0] as TvAlert)
  expect(t).toMatch(/^TradingView: Breakout · AAPL 1h · long · DaviddTech\+ 5 days: slightly upward, 56% up, 80% range -4\.0% to \+5\.5%$/)
  expect(listText(kept, 1)).toMatch(/RSI dip · BTC 1h · long/)
  expect(listText([])).toBe('No TradingView alerts yet.')
  for (const x of [t, listText(kept), ungradedLine(groups) ?? '']) expect(x).not.toMatch(banned)
})
