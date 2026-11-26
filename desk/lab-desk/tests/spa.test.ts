// The luck check across tries (Hansen's SPA): a trade's candles add up to the trade, noise rarely passes even with
// many correlated rules and an always-long rule on a rising market, and a planted pattern is found. Pure.

import { expect, test } from 'claude-code/testing'

import type { Candle } from '../types'
import { parseTest, runTest, seededRandom } from '../hooks/honest'
import type { TestSpec, Trade } from '../hooks/honest'
import { barReturns, blockLength, spaTest } from '../hooks/spa'

const H = 3_600_000

function walk(n: number, sd: number, drift: number, seed: number, plant = false): Candle[] {
  const rand = seededRandom(seed)
  const out: Candle[] = []
  let p = 100
  for (let i = 0; i < n; i++) {
    const o = p
    const z = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
    p *= 1 + drift + sd * z + (plant && i % 24 === 5 ? 0.006 : 0)
    out.push({ t: i * H, o, h: Math.max(o, p), l: Math.min(o, p), c: p, v: 1 })
  }
  return out
}

function spec(enter: string, hold: number): TestSpec {
  const s = parseTest({ enter, hold, fee: 0.045 })
  if ('error' in s) throw new Error(s.error)
  return s
}

const RULES: TestSpec[] = [
  ...[25, 30, 35, 40].flatMap(a => [6, 12, 24].map(h => spec(`rsi < ${a}`, h))),
  ...[60, 65, 70].flatMap(a => [6, 12, 24].map(h => spec(`rsi > ${a}`, h))),
  ...[10, 20].flatMap(f => [50, 100].map(s => spec(`ema ${f} crosses above ema ${s}`, 24))),
  spec('close > 0', 1000),
]

test('a trade\'s candles add up to the trade, with fees and funding', () => {
  const c = walk(3000, 0.008, 0, 5)
  const s = spec('rsi < 30', 12)
  const trades = runTest(s, c, [], 500).map((t, k) => ({ ...t, funding: k % 2 ? 0.0003 : -0.0001, ret: t.ret + (k % 2 ? 0.0003 : -0.0001) }))
  const rows = barReturns(trades, c, 500, c.length, 'long', s.fee)
  const sum = rows.reduce((a, x) => a + x, 0)
  const want = trades.reduce((a, t) => a + t.ret, 0)
  expect(Math.abs(sum - want) < 1e-12).toBe(true)
})

test('on noise with an upward drift the family passes about 1 time in 20 or less, the always-long rule included', () => {
  let passed = 0
  let runs = 0
  for (let k = 1; k <= 24; k++) {
    const c = walk(3000, 0.008, 0.0003, 100 + k)
    const cut = 2100
    const holds: number[] = []
    const rows = RULES.map(s => {
      const tr = runTest(s, c, [], cut)
      for (const t of tr) holds.push(t.j - t.i)
      return barReturns(tr, c, cut, c.length, s.side, s.fee, true)
    })
    const r = spaTest(rows, { block: blockLength(H, holds, c.length - cut), draws: 299, seed: k })
    runs++
    if (r.p < 0.05 || r.survivors.length > 0) passed++
  }
  expect(passed / runs <= 0.09).toBe(true)
})

test('without the drift taken off, always long on a steady rise looks like skill; with it, it does not', () => {
  const c = walk(3000, 0.004, 0.0015, 9)
  const always = spec('close > 0', 1000)
  const tr = runTest(always, c, [], 2100)
  const raw = spaTest([barReturns(tr, c, 2100, c.length, 'long', always.fee, false)], { block: 24, draws: 299, seed: 1 })
  const fair = spaTest([barReturns(tr, c, 2100, c.length, 'long', always.fee, true)], { block: 24, draws: 299, seed: 1 })
  expect(raw.p < 0.05).toBe(true)
  expect(fair.p > 0.05).toBe(true)
})

test('a planted pattern stands out among the noise rules, and the stepwise check names it', () => {
  let found = 0
  for (let k = 1; k <= 6; k++) {
    const c = walk(4000, 0.008, 0, 500 + k, true)
    const cut = 2800
    const holds: number[] = []
    const rows = RULES.map(s => {
      const tr = runTest(s, c, [], cut)
      for (const t of tr) holds.push(t.j - t.i)
      return barReturns(tr, c, cut, c.length, s.side, s.fee, true)
    })
    const planted: Trade[] = []
    for (let i = cut; i < c.length - 1; i++) if (i % 24 === 4) planted.push({ i, j: i + 1, t: 0, t2: 0, gross: 0, funding: 0, ret: 0 })
    rows.push(barReturns(planted, c, cut, c.length, 'long', 0.00045, true))
    const r = spaTest(rows, { block: blockLength(H, holds, c.length - cut), draws: 299, seed: k })
    if (r.survivors.includes(rows.length - 1)) found++
    expect(r.survivors.every(x => x === rows.length - 1)).toBe(true)
  }
  expect(found >= 4).toBe(true)
})

test('rules that never trade sit out; the same rows give the same answer', () => {
  const c = walk(1000, 0.008, 0, 3)
  const tr = runTest(spec('rsi < 30', 6), c, [], 700)
  const rows = [new Float64Array(300), barReturns(tr, c, 700, 1000, 'long', 0.00045, true)]
  const a = spaTest(rows, { block: 24, draws: 199, seed: 4 })
  const b = spaTest(rows, { block: 24, draws: 199, seed: 4 })
  expect(a).toEqual(b)
  expect(a.used).toBe(1)
  expect(a.adjusted[0]).toBe(1)
  expect(spaTest([], { block: 24 }).p).toBe(1)
})
