import { expect, test } from 'claude-code/testing'

import type { Candle } from '../types'
import { compute, ema, parseSpec, rma, rsi, sma, specId, stdev, supertrend, trueRange, valuesAt, vwap, warmup, PRESETS } from '../hooks/indicators'
import { parseCandles } from '../hooks/data'
import { candlesFixture } from './fixtures'

const close = (v: number[]) => v
const near = (a: (number | null)[], b: (number | null)[]) => {
  expect(a.length).toBe(b.length)
  a.forEach((x, i) => {
    const y = b[i]
    if (y === null || y === undefined) expect(x).toBeNull()
    else expect(Math.abs((x as number) - y)).toBeLessThan(1e-9)
  })
}

test('sma: the mean of the last N, null before N values', async () => {
  near(sma(close([1, 2, 3, 4, 5]), 3), [null, null, 2, 3, 4])
})

test('ema: alpha 2/(N+1), started from the SMA of the first N (ta.ema)', async () => {
  near(ema([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4])
  near(ema([2, 4, 6, 10], 3), [null, null, 4, 7])
})

test("rma: Wilder's alpha 1/N, started from the SMA (ta.rma)", async () => {
  near(rma([1, 2, 3, 4], 2), [null, 1.5, 2.25, 3.125])
})

test('stdev: biased, divides by N (ta.stdev default, as the Bollinger Bands use)', async () => {
  const out = stdev([2, 4, 4, 4, 5, 5, 7, 9], 8)
  expect(out[7]).toBe(2)
  expect(out[6]).toBeNull()
})

test('rsi: Wilder averages of gains and losses; 100 with no losses (ta.rsi)', async () => {
  near(rsi([1, 2, 3, 2, 3], 2), [null, null, 100, 50, 75])
})

test('true range: the first candle is high - low, then the widest of the three gaps', async () => {
  const c: Candle[] = [
    { t: 0, o: 10, h: 12, l: 9, c: 11, v: 1 },
    { t: 1, o: 11, h: 15, l: 11, c: 14, v: 1 },
    { t: 2, o: 14, h: 14, l: 8, c: 9, v: 1 },
  ]
  expect(trueRange(c)).toEqual([3, 4, 6])
})

test('vwap: hlc3 by volume, starting again at each UTC midnight', async () => {
  const day = 86_400_000
  const c: Candle[] = [
    { t: day - 7_200_000, o: 0, h: 12, l: 6, c: 9, v: 1 },
    { t: day - 3_600_000, o: 0, h: 15, l: 9, c: 12, v: 3 },
    { t: day, o: 0, h: 30, l: 30, c: 30, v: 5 },
  ]
  near(vwap(c), [9, (9 + 36) / 4, 30])
})

test('macd: fast EMA minus slow EMA, its EMA, and the gap between them as a histogram', async () => {
  const candles = parseCandles(candlesFixture(200))
  const closes = candles.map(k => k.c)
  const s = compute({ kind: 'macd', params: [12, 26, 9] }, candles)
  const f = ema(closes, 12)
  const sl = ema(closes, 26)
  const line = s.series.find(x => x.name === 'MACD')?.values ?? []
  expect(Math.abs((line[199] as number) - ((f[199] as number) - (sl[199] as number)))).toBeLessThan(1e-9)
  expect(line[24]).toBeNull()
  const hist = s.series[0]?.values ?? []
  const avg = s.series[2]?.values ?? []
  expect(Math.abs((hist[199] as number) - ((line[199] as number) - (avg[199] as number)))).toBeLessThan(1e-9)
  expect(s.pane).toBe('lower')
})

test('bollinger: basis is the SMA, bands sit 2 standard deviations away, the band is filled', async () => {
  const candles = parseCandles(candlesFixture(80))
  const s = compute({ kind: 'bb', params: [20, 2] }, candles)
  const [up, mid, lo] = s.series.map(x => x.values)
  const i = 79
  expect(Math.abs((((up?.[i] as number) + (lo?.[i] as number)) / 2) - (mid?.[i] as number))).toBeLessThan(1e-9)
  expect(s.fill).toEqual([0, 2])
  expect(s.pane).toBe('price')
})

test('supertrend: under the lows while price rises, above the highs after it falls, and it flips', async () => {
  const c: Candle[] = []
  for (let i = 0; i < 60; i++) {
    const p = i < 30 ? 100 + i * 2 : 160 - (i - 30) * 3
    c.push({ t: i, o: p - 0.5, h: p + 1, l: p - 1, c: p, v: 1 })
  }
  const st = supertrend(c, 10, 3)
  expect(st.side[25]).toBe(1)
  expect(st.line[25] as number).toBeLessThan((c[25] as Candle).l)
  expect(st.side[55]).toBe(-1)
  expect(st.line[55] as number).toBeGreaterThan((c[55] as Candle).h)
  expect(st.line[5]).toBeNull()
})

test('parse: plain words, glued numbers, defaults, aliases and friendly errors', async () => {
  expect(parseSpec('EMA 50')).toEqual({ kind: 'ema', params: [50] })
  expect(parseSpec('ema50')).toEqual({ kind: 'ema', params: [50] })
  expect(parseSpec('ema(200)')).toEqual({ kind: 'ema', params: [200] })
  expect(parseSpec('rsi')).toEqual({ kind: 'rsi', params: [14] })
  expect(parseSpec('bollinger 20, 2.5')).toEqual({ kind: 'bb', params: [20, 2.5] })
  expect(parseSpec('macd')).toEqual({ kind: 'macd', params: [12, 26, 9] })
  expect(parseSpec('st')).toEqual({ kind: 'supertrend', params: [10, 3] })
  expect('error' in parseSpec('ichimoku')).toBe(true)
  expect('error' in parseSpec('ema 0')).toBe(true)
  expect('error' in parseSpec('macd 30 26 9')).toBe(true)
  expect('error' in parseSpec('vwap 20')).toBe(true)
  expect(specId({ kind: 'bb', params: [20, 2] })).toBe('bb 20 2')
})

test('every preset parses, and warm-up asks for enough history', async () => {
  for (const list of Object.values(PRESETS)) for (const t of list) expect('error' in parseSpec(t)).toBe(false)
  expect(warmup({ kind: 'ema', params: [200] })).toBe(800)
  expect(warmup({ kind: 'vwap', params: [] })).toBe(0)
})

test('values at a candle: one number for one line, named parts for several, "warming up" before data', async () => {
  const candles = parseCandles(candlesFixture(40))
  const fmt = (n: number) => n.toFixed(0)
  expect(valuesAt(compute({ kind: 'ema', params: [10] }, candles), 0, fmt)).toMatch(/^\d+$/)
  expect(valuesAt(compute({ kind: 'bb', params: [20, 2] }, candles), 0, fmt)).toMatch(/^upper \d+ {2}basis \d+ {2}lower \d+$/)
  expect(valuesAt(compute({ kind: 'ema', params: [100] }, candles), 0, fmt)).toBe('warming up')
})
