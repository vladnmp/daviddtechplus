// What happened after, and moments like now: pure math on known candles.

import { expect, test } from 'claude-code/testing'

import type { Candle } from '../types'
import { MIN_CASES, afterStudy, afterText, conditionSeries, likeNow, likeText, parseCondition, spread, wilson } from '../hooks/history'
import type { Condition } from '../hooks/history'

const H = 3_600_000
const T0 = Date.UTC(2025, 0, 1)

function candlesOf(closes: readonly number[]): Candle[] {
  return closes.map((c, i) => ({ t: T0 + i * H, o: c, h: c * 1.01, l: c * 0.99, c, v: 1 }))
}

function cond(raw: string): Condition {
  const c = parseCondition(raw)
  if ('error' in c) throw new Error(c.error)
  return c
}

test('a condition reads "and", the interval and the person\'s words', () => {
  const c = cond('rsi < 30 and close > ema 200 on 4h')
  expect(c.parts.length).toBe(2)
  expect(c.interval).toBe('4h')
  expect(c.said).toBe('rsi < 30 and close > ema 200')
  expect('error' in parseCondition('')).toBe(true)
  expect('error' in parseCondition('a < 1 and b < 1 and c < 1 and d < 1 and e < 1')).toBe(true)
  expect('error' in parseCondition('rsi is low')).toBe(true)
})

test('the 95% range for a share up holds the share and stays inside 0 to 1', () => {
  const [lo, hi] = wilson(5, 10)
  expect(lo < 0.5 && hi > 0.5).toBe(true)
  expect(lo > 0.18 && hi < 0.82).toBe(true)
  expect(wilson(0, 10)[0]).toBe(0)
  expect(wilson(10, 10)[1]).toBe(1)
  const s = spread([0.01, -0.02, 0.03, 0.04, -0.01])
  expect(s.n).toBe(5)
  expect(s.median).toBe(0.01)
  expect(s.up).toBe(0.6)
})

test('after: only the first candle of each run counts, cases never overlap, the last ones stay open', () => {
  // Runs of 3 candles at 110 then 3 at 90: the condition turns true every 6 candles.
  const closes = Array.from({ length: 120 }, (_, i) => (i % 6 < 3 ? 110 : 90))
  const candles = candlesOf(closes)
  const c = cond('close > 100')
  const on = conditionSeries(c, candles)
  const a = afterStudy(c, candles, 2)
  for (const k of a.cases) {
    expect(on[k.i]).toBe(true)
    expect(on[k.i - 1]).toBe(false)
    // Two candles after the first of three at 110 is still 110.
    expect(Math.abs(k.ret) < 1e-12).toBe(true)
  }
  for (let q = 1; q < a.cases.length; q++) expect((a.cases[q] as { i: number }).i - (a.cases[q - 1] as { i: number }).i >= 2).toBe(true)
  expect(a.cases.length).toBe(19)
  expect(a.stats !== null).toBe(true)
  expect(a.halves !== null).toBe(false)

  // Looking 10 ahead: each case is at least 10 candles after the one before; a run near the end stays open.
  const b = afterStudy(c, candles, 10)
  for (let q = 1; q < b.cases.length; q++) expect((b.cases[q] as { i: number }).i - (b.cases[q - 1] as { i: number }).i >= 10).toBe(true)
  expect(b.open.length).toBe(1)
})

test('after: under 10 cases there are no numbers, only the cases', () => {
  const closes = Array.from({ length: 60 }, (_, i) => (i % 12 < 3 ? 110 : 90))
  const candles = candlesOf(closes)
  const c = cond('close > 100')
  const a = afterStudy(c, candles, 2)
  expect(a.cases.length < MIN_CASES).toBe(true)
  expect(a.stats).toBe(null)
  const text = afterText(c, 'BTC', '1h', 2, a, a.cases.length)
  expect(text.includes('close > 100')).toBe(true)
  expect(/median/i.test(text)).toBe(false)
})

test('moments like now: a repeating shape finds its twins, none overlapping each other or now', () => {
  const closes = Array.from({ length: 600 }, (_, i) => 100 + 10 * Math.sin((2 * Math.PI * i) / 50))
  const candles = candlesOf(closes)
  const l = likeNow(candles, 20, 10, 10)
  expect(l.matches.length).toBe(10)
  for (const m of l.matches) {
    expect(m.likeness > 0.99).toBe(true)
    expect(m.path.length).toBe(10)
    // The look-alike and the 10 candles after it end before the current stretch starts.
    expect(m.i + 10 < candles.length - 20).toBe(true)
  }
  for (const m of l.matches) for (const n of l.matches) if (m !== n) expect(Math.abs(m.i - n.i) >= 20).toBe(true)
  // Every twin went the same way after, so the middle path matches each one.
  const last = l.median.at(-1) as number
  for (const m of l.matches) expect(Math.abs((m.path.at(-1) as number) - last) < 0.02).toBe(true)
  expect(l.stats !== null).toBe(true)
  expect(likeText('BTC', '1h', l, 10).includes('BTC')).toBe(true)
})
