// Funding as a word in history-lab conditions: %/yr per candle from its own hours, kept by time in the luck check,
// and refused in plain words where years of it are not read (plot, scan, alert). Pure.

import { expect, test } from 'claude-code/testing'

import type { Candle } from '../types'
import { parseFormula } from '../hooks/formula'
import { afterStudy, conditionSeries, parseCondition } from '../hooks/history'
import { fundingNote, parseTest, runTest, shuffledCandles, withFunding } from '../hooks/honest'
import type { Funding } from '../hooks/honest'
import { parseScan } from '../hooks/scan'

const H = 3_600_000
const T0 = Date.UTC(2026, 0, 1)
const YEAR = 24 * 365 * 100

function candles(n: number, step = H): Candle[] {
  return Array.from({ length: n }, (_, i) => ({ t: T0 + i * step, o: 100, h: 101, l: 99, c: 100 + (i % 7) - 3, v: 1 }))
}

/** One hourly rate per hour, settled at the end of each hour; rate(i) for the hour that ends at T0 + (i + 1) h. */
function rows(n: number, rate: (i: number) => number, from = 0): Funding[] {
  return Array.from({ length: n - from }, (_, k) => ({ t: T0 + (from + k + 1) * H, rate: rate(from + k) }))
}

test('funding reads as %/yr in the history lab, and is refused in a plot or a scan', () => {
  const c = parseCondition('funding > 20% and rsi < 40 on 4h')
  if ('error' in c) throw new Error(c.error)
  expect(c.usesFunding).toBe(true)
  expect(c.interval).toBe('4h')
  expect(c.text).toBe('funding > 20 and ta.rsi(close, 14) < 40')
  const plain = parseCondition('rsi < 30')
  expect('error' in plain ? true : plain.usesFunding).toBe(false)
  const scan = parseScan('funding > 20')
  expect('error' in scan ? scan.error : '').toMatch(/works in the history lab \(\/lab-after, \/lab-test\)/)
  const plot = parseFormula('funding * 2')
  expect('error' in plot ? plot.error : '').toMatch(/not in a plot, scan or alert/)
})

test('each candle gets the average rate of its own hours as %/yr; nothing from after its close; null where unread', () => {
  const c = withFunding(candles(6), rows(6, i => (i < 3 ? 0.00001 : -0.00002), 1))
  // Candle 0 covers the hour ending at T0 + 1 h: that row was not read, so it knows nothing.
  expect(c[0]?.f).toBeNull()
  expect(Math.abs((c[1]?.f ?? NaN) - 0.00001 * YEAR) < 1e-9).toBe(true)
  expect(Math.abs((c[3]?.f ?? NaN) - -0.00002 * YEAR) < 1e-9).toBe(true)
  // 4h candles: the four hours inside each, averaged.
  const four = withFunding(candles(3, 4 * H), rows(12, i => (i < 4 ? 0.00001 : i < 8 ? 0.00003 : 0)))
  expect(four.map(k => Math.round((k.f ?? NaN) * 1000) / 1000)).toEqual([0.00001 * YEAR, 0.00003 * YEAR, 0].map(v => Math.round(v * 1000) / 1000))
})

test('a funding condition holds where funding says so, and is unknown where it was not read', () => {
  const c = parseCondition('funding < 0')
  if ('error' in c) throw new Error(c.error)
  const k = withFunding(candles(8), rows(8, i => (i % 2 ? -0.00001 : 0.00001), 2))
  expect(conditionSeries(c, k)).toEqual([null, null, false, true, false, true, false, true])
  const a = afterStudy(c, k, 1)
  expect(a.cases.length).toBeGreaterThan(0)
})

test('the luck check keeps funding with its time: a funding rule still trades on shuffled candles', () => {
  const k = withFunding(candles(300), rows(300, i => (i % 10 === 0 ? -0.00005 : 0.00001)))
  const spec = parseTest({ enter: 'funding < 0', hold: 3 })
  if ('error' in spec) throw new Error(spec.error)
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const fake = shuffledCandles(k, 200, rand)
  expect(fake.map(x => x.f)).toEqual(k.map(x => x.f))
  expect(runTest(spec, fake, [], 200).length).toBeGreaterThan(5)
})

test('the funding note says from when it was read, or that none could be', () => {
  const k = withFunding(candles(6), rows(6, () => 0.00001, 2))
  expect(fundingNote(k, true)).toMatch(/^Funding \(%\/yr\) is read from 2026-01-01 02:00 UTC; candles before it don't count\.$/)
  expect(fundingNote(withFunding(candles(6), rows(7, () => 0)), true)).toBe('')
  expect(fundingNote(withFunding(candles(6), []), true)).toMatch(/^No funding could be read/)
  expect(fundingNote(withFunding(candles(6), rows(7, () => 0)), false)).toMatch(/stopped answering/)
})
