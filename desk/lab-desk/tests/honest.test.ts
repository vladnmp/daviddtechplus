// The honest test: known answers for fees, funding and sides, and a luck check that is right about noise.

import { expect, test } from 'claude-code/testing'

import type { Candle } from '../types'
import { FEE_DEFAULT, MIN_UNSEEN, fundingBetween, honestTest, luckChance, luckLine, parseTest, partResult, runTest, shuffleCheck, shuffledCandles, seededRandom, testText } from '../hooks/honest'
import type { Funding, TestSpec } from '../hooks/honest'
import { parseTestWords } from '../hooks/register'

const H = 3_600_000
const T0 = Date.UTC(2025, 0, 1)

function candlesOf(closes: readonly number[]): Candle[] {
  return closes.map((c, i) => ({ t: T0 + i * H, o: c, h: c * 1.01, l: c * 0.99, c, v: 1 }))
}

function spec(o: Parameters<typeof parseTest>[0]): TestSpec {
  const s = parseTest(o)
  if ('error' in s) throw new Error(s.error)
  return s
}

/** A seeded random walk, 1% a candle, so the calibration test is the same every run. */
function walk(seed: number, n: number): number[] {
  let a = seed >>> 0
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out: number[] = []
  let p = 100
  for (let i = 0; i < n; i++) {
    const z = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
    p *= 1 + 0.01 * z
    out.push(p)
  }
  return out
}

test('the fee comes in %, as a number or a word; none gives Hyperliquid\'s 0.045%', () => {
  expect(spec({ enter: 'rsi < 30', fee: 0.02 }).fee).toBe(0.0002)
  expect(spec({ enter: 'rsi < 30', fee: '0.02%' }).fee).toBe(0.0002)
  expect(spec({ enter: 'rsi < 30' }).fee).toBe(FEE_DEFAULT)
  expect(spec({ enter: 'rsi < 30', fee: 'lots' }).fee).toBe(FEE_DEFAULT)
  expect(spec({ enter: 'rsi < 30' }).hold).toBe(10)
  expect(spec({ enter: 'rsi < 30', exit: 'rsi > 50' }).hold).toBe(null)
  expect(spec({ enter: 'rsi < 30', side: 'SHORT' }).side).toBe('short')
  expect('error' in parseTest({})).toBe(true)
  expect('error' in parseTest({ enter: 'rsi < 30', exit: 'rsi is high' })).toBe(true)
})

test('on a flat price every trade loses exactly two fees', () => {
  const candles = candlesOf(Array.from({ length: 100 }, () => 100))
  const s = spec({ enter: 'close > 99', hold: 5, fee: 0.05 })
  const trades = runTest(s, candles, [])
  expect(trades.length > 10).toBe(true)
  for (const t of trades) {
    expect(Math.abs(t.ret - -0.001) < 1e-12).toBe(true)
    if (!t.open) expect(t.j - t.i).toBe(5)
  }
  // The last trade runs past the end: it is kept, valued at the last close, and says so.
  expect(trades.at(-1)?.open).toBe(true)
  expect(trades.at(-1)?.j).toBe(99)
  // One trade at a time: the next starts after the last ends.
  for (let q = 1; q < trades.length; q++) expect((trades[q] as { i: number }).i > (trades[q - 1] as { j: number }).j).toBe(true)
})

test('a long pays positive funding, a short gets it, hour by hour held', () => {
  const candles = candlesOf(Array.from({ length: 60 }, () => 100))
  const funding: Funding[] = Array.from({ length: 80 }, (_, i) => ({ t: T0 + i * H, rate: 0.0001 }))
  expect(Math.abs(fundingBetween(funding, T0, T0 + 5 * H) - 0.0005) < 1e-12).toBe(true)
  const long = runTest(spec({ enter: 'close > 99', hold: 5, fee: 0 }), candles, funding)
  const short = runTest(spec({ enter: 'close > 99', hold: 5, fee: 0, side: 'short' }), candles, funding)
  expect(long.length > 0).toBe(true)
  for (const t of long) if (!t.open) expect(Math.abs(t.ret - -0.0005) < 1e-12).toBe(true)
  for (const t of short) if (!t.open) expect(Math.abs(t.ret - 0.0005) < 1e-12).toBe(true)
  long.forEach((t, q) => expect(Math.abs(t.ret + (short[q] as { ret: number }).ret) < 1e-12).toBe(true))
})

test('a short is the mirror of a long on the same candles', () => {
  const candles = candlesOf(walk(7, 800))
  const l = runTest(spec({ enter: 'rsi < 40', exit: 'rsi > 55', fee: 0 }), candles, [])
  const s = runTest(spec({ enter: 'rsi < 40', exit: 'rsi > 55', fee: 0, side: 'short' }), candles, [])
  expect(l.length > 5).toBe(true)
  expect(s.length).toBe(l.length)
  l.forEach((t, q) => {
    const m = s[q] as { i: number; j: number; gross: number }
    expect(m.i).toBe(t.i)
    expect(m.j).toBe(t.j)
    expect(Math.abs(m.gross + t.gross) < 1e-12).toBe(true)
  })
})

test('the unseen part never sees the seen part\'s answers, and the seen part never looks past the cut', () => {
  const candles = candlesOf(walk(11, 1500))
  const s = spec({ enter: 'rsi < 35', exit: 'rsi > 50' })
  const r = honestTest(s, { enter: 'rsi < 35', exit: 'rsi > 50' }, candles, [], 1)
  for (const t of r.seen.trades) expect(t.j < r.cut).toBe(true)
  for (const t of r.unseen.trades) expect(t.i >= r.cut).toBe(true)
  expect(r.cutT).toBe((candles[r.cut] as Candle).t)
  expect(r.near.tried > 0).toBe(true)
  const text = testText(r, 'BTC', '1h', 3)
  expect(text.includes('unseen part from')).toBe(true)
  expect(text.includes('Luck check')).toBe(true)
})

test('the luck line: too few, lost, or a chance that grows with each try', () => {
  expect(Math.abs(luckChance(0.05, 1) - 0.05) < 1e-12).toBe(true)
  expect(luckChance(0.02, 10) > luckChance(0.02, 1)).toBe(true)
  expect(luckChance(0.02, 10) < 0.2).toBe(true)
  const candles = candlesOf(walk(3, 400))
  const r = honestTest(spec({ enter: 'rsi < 20', exit: 'rsi > 50' }), { enter: 'rsi < 20', exit: 'rsi > 50' }, candles, [], 1)
  if (r.unseen.n < MIN_UNSEEN) expect(luckLine(r, 'BTC').includes('too few')).toBe(true)
})

test('shuffling keeps the moves and the times, only the order changes', () => {
  const candles = candlesOf(walk(5, 300))
  const fake = shuffledCandles(candles, 200, seededRandom(9))
  expect(fake.length).toBe(300)
  for (let i = 0; i < 200; i++) expect(fake[i]).toEqual(candles[i] as Candle)
  for (let i = 0; i < 300; i++) expect((fake[i] as Candle).t).toBe((candles[i] as Candle).t)
  const moves = (cs: Candle[]) => cs.slice(200).map((k, q) => k.c / (cs[199 + q] as Candle).c).sort((a, b) => a - b)
  moves(fake).forEach((m, q) => expect(Math.abs(m - (moves(candles)[q] as number)) < 1e-9).toBe(true))
  // The whole move from the cut to the end is the same, whatever the order.
  expect(Math.abs((fake[299] as Candle).c / (candles[299] as Candle).c - 1) < 1e-9).toBe(true)
  // The same seed gives the same shuffle.
  expect(shuffledCandles(candles, 200, seededRandom(9))).toEqual(fake)
})

test('on pure noise the luck check says "unlikely" about 1 time in 20, not more, whatever the rule', () => {
  // Rules that exit on a price move make lopsided trades (many small wins, a few big losses): a check that assumes
  // a bell curve passes them on noise 20-27% of the time. The shuffle check must stay near 5%.
  const rules = [
    ['close < ema 50', 'close > ema 50'],
    ['close crosses above ema 20', 'close crosses below ema 20'],
    ['close > ema 10', 'close < ema 10'],
  ] as const
  let tested = 0
  let passed = 0
  for (let k = 0; k < 90; k++) {
    const candles = candlesOf(walk(2000 + k, 900))
    const [enter, exit] = rules[k % rules.length] as readonly [string, string]
    const s = spec({ enter, exit, fee: 0 })
    const cut = 630
    const u = partResult(runTest(s, candles, [], cut), candles, cut, candles.length, 'long')
    if (u.n < 10) continue
    tested++
    if (u.avg > 0 && luckChance(shuffleCheck(s, candles, [], cut, u.avg, 99, k + 1).p, 1) < 0.05) passed++
  }
  expect(tested >= 40).toBe(true)
  expect(passed / tested <= 0.12).toBe(true)
})

test('a rule that really reads the order passes the luck check', () => {
  // Prices that rise for 5 candles after every close above the 10-candle high: "enter on a new high, hold 5" has a real pattern.
  const closes: number[] = []
  let p = 100
  let push = 0
  const rand = seededRandom(42)
  for (let i = 0; i < 1500; i++) {
    const z = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
    p *= 1 + 0.01 * z + (push > 0 ? 0.006 : 0)
    push = Math.max(0, push - 1)
    closes.push(p)
    const hi = Math.max(...closes.slice(-11, -1))
    if (closes.length > 11 && p > hi) push = 5
  }
  const candles = candlesOf(closes)
  const s = spec({ enter: 'close >= ta.highest(close, 11)', hold: 5, fee: 0 })
  const r = honestTest(s, { enter: 'close >= ta.highest(close, 11)' }, candles, [], 1, 99)
  expect(r.unseen.n >= MIN_UNSEEN).toBe(true)
  expect(r.luck !== null && r.luck.survives && r.luck.p < 0.05).toBe(true)
  expect(luckLine(r, 'TEST 1h').includes('so it beats luck')).toBe(true)
})

test('/lab-test words: enter, exit, hold, side, fee and interval', () => {
  expect(parseTestWords('rsi < 30 exit rsi > 50')).toEqual({ enter: 'rsi < 30', exit: 'rsi > 50' })
  expect(parseTestWords('enter when rsi > 70 exit when rsi < 50 short on 4h')).toEqual({ enter: 'rsi > 70', exit: 'rsi < 50', side: 'short', interval: '4h' })
  expect(parseTestWords('ema 20 crosses above ema 50 hold 12 fee 0.02%')).toEqual({ enter: 'ema 20 crosses above ema 50', hold: 12, fee: 0.02 })
  expect(parseTestWords('rsi < 30 after 24 candles long')).toEqual({ enter: 'rsi < 30', hold: 24, side: 'long' })
  expect(parseTestWords('')).toBe(null)
  expect(parseTestWords('exit rsi > 50')).toBe(null)
})
