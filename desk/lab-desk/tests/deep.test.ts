// Deep history: Binance, Bybit, Deribit and FRED answers read right, kept by time, and attached to candles with
// nothing from after a candle's close. Pure; the reads go through a fake `get`.

import { expect, test } from 'claude-code/testing'

import type { Candle } from '../types'
import {
  packHlFunding,
  unpackHlFunding,
  binanceSymbol,
  extrasOf,
  hourlyFunding,
  mergeByTime,
  packCandles,
  packPoints,
  parseDvol,
  parseFundingRows,
  parseKlines,
  parseOi,
  parseVix,
  bybitSymbol,
  readFunding,
  readKlines,
  readOi,
  toCoinUnits,
  settledFunding,
  sourcesLine,
  unpackCandles,
  unpackPoints,
  valuesAtClose,
  withExtras,
  withSettledFunding,
} from '../hooks/deep'
import { parseCondition } from '../hooks/history'
import { evalFormula, parseFormula } from '../hooks/formula'

const H = 3_600_000
const T0 = Date.UTC(2024, 0, 1)

test('coin names map to Binance perps', () => {
  expect(binanceSymbol('BTC')).toBe('BTCUSDT')
  expect(binanceSymbol('kPEPE')).toBe('1000PEPEUSDT')
})

test('klines, funding, open interest, DVOL and VIX answers parse; errors come back in words', () => {
  const k = parseKlines(JSON.stringify([[T0, '1', '2', '0.5', '1.5', '10', T0 + H - 1, '0', 1, '0', '0', '0']]))
  expect(k).toEqual([{ t: T0, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }])
  expect(parseKlines('{"code":-1121,"msg":"Invalid symbol."}')).toEqual({ error: 'Invalid symbol.' })
  expect(parseFundingRows(JSON.stringify([{ symbol: 'BTCUSDT', fundingTime: T0, fundingRate: '0.0001' }]))).toEqual([{ t: T0, rate: 0.0001 }])
  const oi = parseOi(JSON.stringify({ retCode: 0, result: { list: [{ openInterest: '200', singleOpenInterest: '90', timestamp: String(T0 + H) }, { openInterest: '100', timestamp: String(T0) }], nextPageCursor: 'abc' } }))
  expect(oi).toEqual({ rows: [{ t: T0, v: 50 }, { t: T0 + H, v: 90 }], cursor: 'abc' })
  expect(parseOi('{"retCode":10001,"retMsg":"params error"}')).toEqual({ error: 'params error' })
  const dv = parseDvol(JSON.stringify({ result: { data: [[T0, 50, 55, 45, 52]], continuation: null } }))
  expect(dv).toEqual({ rows: [{ t: T0 + 24 * H, v: 52 }], more: null })
  expect(parseVix('observation_date,VIXCLS\n2024-01-02,13.2\n2024-01-03,.\n')).toEqual([{ t: Date.UTC(2024, 0, 3), v: 13.2 }])
})

test('8h funding settlements spread over their hours, so the total paid stays the same', () => {
  const rows = [
    { t: T0, rate: 0.0008 },
    { t: T0 + 8 * H, rate: 0.0016 },
    { t: T0 + 12 * H, rate: 0.0004 },
  ]
  const h = hourlyFunding(rows)
  expect(h.length).toBe(8 + 8 + 4)
  expect(Math.abs(h.filter(x => x.t > T0 && x.t <= T0 + 8 * H).reduce((s, x) => s + x.rate, 0) - 0.0016) < 1e-12).toBe(true)
  expect(h.filter(x => x.t > T0 + 8 * H).every(x => Math.abs(x.rate - 0.0001) < 1e-12)).toBe(true)
  expect(h.at(-1)?.t).toBe(T0 + 12 * H)
})

test('the funding word sees a Binance settlement only once it settles: changing the 08:00 rate moves no candle closing before 08:00', () => {
  const rows = (r8: number) => [
    { t: T0 + 3, rate: 0.0001 },
    { t: T0 + 8 * H + 5, rate: r8 },
    { t: T0 + 16 * H + 2, rate: 0.0001 },
  ]
  for (const step of [H, 4 * H]) {
    const candles: Candle[] = Array.from({ length: (20 * H) / step }, (_, i) => ({ t: T0 + i * step, o: 1, h: 1, l: 1, c: 1, v: 1 }))
    const a = withSettledFunding(candles, settledFunding(rows(0.0001)), step)
    const b = withSettledFunding(candles, settledFunding(rows(0.003)), step)
    candles.forEach((c, i) => {
      if (c.t + step < T0 + 8 * H) expect(b[i]?.f).toBe(a[i]?.f)
      else if (c.t + step < T0 + 16 * H) expect(b[i]?.f).not.toBe(a[i]?.f)
    })
  }
  // %/yr by each settlement's own interval: 0.01% every 8 h is 10.95%/yr, every 4 h is 21.9%/yr.
  const four = settledFunding([{ t: T0, rate: 0.0001 }, { t: T0 + 4 * H, rate: 0.0001 }])
  expect(Math.abs((four[1]?.v ?? NaN) - 21.9) < 1e-9).toBe(true)
  expect(Math.abs((settledFunding(rows(0.0001))[1]?.v ?? NaN) - 10.95) < 1e-9).toBe(true)
  // A read that stopped early: past 9 hours after the last settlement the candles know nothing, not a frozen rate.
  const hourly: Candle[] = Array.from({ length: 40 }, (_, i) => ({ t: T0 + i * H, o: 1, h: 1, l: 1, c: 1, v: 1 }))
  const cut = withSettledFunding(hourly, settledFunding(rows(0.0003)).slice(0, 2), H)
  expect(cut[16]?.f).not.toBeNull()
  expect(cut[17]?.f).toBeNull()
  expect(cut[39]?.f).toBeNull()
})

test('rows merge by time, newest wins, and the oldest drop past the cap', () => {
  const m = mergeByTime([{ t: 1, v: 1 }, { t: 2, v: 2 }], [{ t: 2, v: 9 }, { t: 3, v: 3 }], 2)
  expect(m).toEqual([{ t: 2, v: 9 }, { t: 3, v: 3 }])
})

test('a series is attached as known at each candle close, never from later', () => {
  const candles: Candle[] = Array.from({ length: 4 }, (_, i) => ({ t: T0 + i * H, o: 1, h: 1, l: 1, c: 1, v: 1 }))
  // A point stamped at T0 + 1h is known at the close of the first candle; one at T0 + 1h + 1 ms is not.
  const pts = [{ t: T0 + H, v: 10 }, { t: T0 + 2 * H + 1, v: 20 }]
  expect(valuesAtClose(candles, pts, H)).toEqual([10, 10, 20, 20])
  const late = [{ t: T0 + 3 * H, v: 5 }]
  expect(valuesAtClose(candles, late, H)).toEqual([null, null, 5, 5])
  const x = withExtras(candles, H, { oi: pts })
  expect(x[0]?.oi).toBe(10)
  expect(x[0]?.dv).toBeUndefined()
})

test('files pack and unpack to the same rows', () => {
  const c: Candle[] = [{ t: T0, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }]
  expect(unpackCandles(packCandles(c))).toEqual(c)
  expect(unpackPoints(packPoints([{ t: T0, v: 3 }]))).toEqual([{ t: T0, v: 3 }])
  expect(unpackPoints(packPoints([{ t: T0, rate: 0.0001 }]))).toEqual([{ t: T0, v: 0.0001 }])
  expect(unpackCandles('not json')).toEqual([])
})

test('candles are read page by page from the start until now', async () => {
  const urls: string[] = []
  const get = async (url: string) => {
    urls.push(url)
    const from = Number(/startTime=(\d+)/.exec(url)?.[1])
    const n = from < T0 + 1500 * H ? 1500 : 700
    return JSON.stringify(Array.from({ length: n }, (_, i) => [from + i * H, '1', '1', '1', '1', '1']))
  }
  const got = await readKlines(get, 'BTCUSDT', '1h', T0, T0 + 5000 * H)
  if ('error' in got) throw new Error(got.error)
  expect(got.length).toBe(2200)
  expect(urls.length).toBe(2)
  expect(got[1500]?.t).toBe(T0 + 1500 * H)
})

test('open interest is read in slices side by side, each followed to its last page', async () => {
  let calls = 0
  const get = async (url: string) => {
    calls++
    const a = Number(/startTime=(\d+)/.exec(url)?.[1])
    const cursor = /cursor=([^&]+)/.exec(url)?.[1]
    const t = cursor ? a + H : a
    return JSON.stringify({ retCode: 0, result: { list: [{ openInterest: '10', singleOpenInterest: '5', timestamp: String(t) }], nextPageCursor: cursor ? '' : 'next' } })
  }
  const got = await readOi(get, 'BTCUSDT', '1h', T0, T0 + 600 * H)
  if ('error' in got) throw new Error(got.error)
  expect(calls).toBe(12)
  expect(got.length).toBe(12)
  expect(got.every(p => p.v === 5)).toBe(true)
})

test('oi, dvol and vix read in the history lab; "oi change 24 > 10%" is the 24-candle change in %', () => {
  const c = parseCondition('oi change 24 > 10% and dvol > 60 and vix < 20')
  if ('error' in c) throw new Error(c.error)
  expect(c.text).toBe('ta.roc(oi, 24) > 10 and dvol > 60 and vix < 20')
  expect(extrasOf(c.text)).toEqual({ oi: true, dvol: true, vix: true })
  expect(extrasOf('ta.rsi(close, 14) < 30')).toEqual({ oi: false, dvol: false, vix: false })
  const plot = parseFormula('oi * 2')
  expect('error' in plot ? plot.error : '').toMatch(/history lab/)
  const n = parseFormula('ta.roc(oi, 1)', { allowFunding: true })
  if ('error' in n) throw new Error(n.error)
  const candles: Candle[] = [100, 110, 99].map((oi, i) => ({ t: T0 + i * H, o: 1, h: 1, l: 1, c: 1, v: 1, oi }))
  const v = evalFormula(n, candles)
  expect(Math.abs((v[1] ?? 0) - 10) < 1e-9).toBe(true)
  expect(Math.abs((v[2] ?? 0) + 10) < 1e-9).toBe(true)
})

test('the data line names each venue used', () => {
  expect(sourcesLine(true, { oi: true, dvol: false, vix: true })).toBe('Market data: Binance public API (candles, funding), Bybit (open interest), FRED (VIX)')
  expect(sourcesLine(false, { oi: false, dvol: false, vix: false })).toBe('Market data: Hyperliquid public API')
})

test('a klines read that fails partway gives its error and the candles before it', async () => {
  let calls = 0
  const get = async (url: string) => {
    calls++
    const from = Number(/startTime=(\d+)/.exec(url)?.[1])
    if (calls > 1) return JSON.stringify({ code: -1003, msg: 'Too many requests' })
    return JSON.stringify(Array.from({ length: 1500 }, (_, i) => [from + i * H, '1', '1', '1', '1', '1']))
  }
  const got = await readKlines(get, 'BTCUSDT', '1h', T0, T0 + 5000 * H)
  if (!('error' in got)) throw new Error('expected an error')
  expect(got.rows.length).toBe(1500)
})

test('open interest with one slice cut short on a later page is a failed read, not a hole', async () => {
  const get = async (url: string) => {
    const a = Number(/startTime=(\d+)/.exec(url)?.[1])
    const cursor = /cursor=([^&]+)/.exec(url)?.[1]
    if (cursor && a > T0 + 300 * H) return JSON.stringify({ retCode: 10006, retMsg: 'Too many visits' })
    return JSON.stringify({ retCode: 0, result: { list: [{ openInterest: '10', timestamp: String(cursor ? a + H : a) }], nextPageCursor: cursor ? '' : 'next' } })
  }
  const got = await readOi(get, 'BTCUSDT', '1h', T0, T0 + 600 * H)
  expect('error' in got).toBe(true)
})

test('a funding read that stops partway keeps what came and says it is not complete', async () => {
  let calls = 0
  const page = (from: number, n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ fundingTime: from + i * 8 * H, fundingRate: '0.0001' })))
  const cut = async (url: string) => {
    calls++
    return calls > 1 ? JSON.stringify({ code: -1003, msg: 'Too many requests' }) : page(Number(/startTime=(\d+)/.exec(url)?.[1]), 1000)
  }
  const got = await readFunding(cut, 'BTCUSDT', T0, T0 + 3000 * 8 * H)
  if ('error' in got) throw new Error(got.error)
  expect(got.rows.length).toBe(1000)
  expect(got.isComplete).toBe(false)
  const whole = await readFunding(async url => page(Number(/startTime=(\d+)/.exec(url)?.[1]), 10), 'BTCUSDT', T0, T0 + 100 * H)
  if ('error' in whole) throw new Error(whole.error)
  expect(whole.isComplete).toBe(true)
})

test('odd names: kNEIRO is NEIROUSDT on Binance in 1000s, kSHIB is SHIB1000USDT on Bybit', () => {
  expect(binanceSymbol('kNEIRO')).toBe('NEIROUSDT')
  expect(binanceSymbol('kPEPE')).toBe('1000PEPEUSDT')
  expect(bybitSymbol('kSHIB')).toBe('SHIB1000USDT')
  expect(bybitSymbol('kNEIRO')).toBe('1000NEIROCTOUSDT')
  expect(bybitSymbol('BTC')).toBe('BTCUSDT')
  const c = toCoinUnits('kNEIRO', [{ t: 0, o: 0.001, h: 0.002, l: 0.0005, c: 0.0015, v: 3000 }])[0]
  expect(Math.abs((c?.c ?? 0) - 1.5) < 1e-9).toBe(true)
  expect(Math.abs((c?.v ?? 0) - 3) < 1e-9).toBe(true)
  const btc = [{ t: 0, o: 1, h: 1, l: 1, c: 1, v: 1 }]
  expect(toCoinUnits('BTC', btc)).toBe(btc)
})

test('Hyperliquid funding on the PC: packed and read back, and a broken file reads as none', () => {
  const rows = [{ t: 1000, rate: 0.0000125 }, { t: 3_601_000, rate: -0.00002 }]
  expect(unpackHlFunding(packHlFunding(500, rows))).toEqual({ from: 500, rows })
  expect(unpackHlFunding('not json')).toBe(null)
  expect(unpackHlFunding('{"rows": []}')).toBe(null)
})
