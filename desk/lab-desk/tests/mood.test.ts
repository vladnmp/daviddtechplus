// The honest test by market mood: each trade sorted by the mood on the candle it opened at (rising or falling,
// calm or wild), read from that candle and the ones before only; no numbers under 10 trades. Pure.

import { expect, test } from 'claude-code/testing'

import type { Candle } from '../types'
import { moodCarries, moodLine, moodSplit, testText, honestTest, parseTest } from '../hooks/honest'
import type { MoodRow, Trade } from '../hooks/honest'

const H = 3_600_000
const T0 = Date.UTC(2026, 0, 1)
const banned = /\b(buy|buying|sell|selling|signals?|targets?|edge|expected move)\b/i

/** 300 calm candles going up, then 300 wild candles going down. */
function twoMoods(): Candle[] {
  const out: Candle[] = []
  let c = 100
  for (let i = 0; i < 600; i++) {
    const up = i < 300
    const o = c
    c = up ? c * 1.002 : c * 0.996
    const wide = up ? 0.002 - i * 0.000003 : 0.02
    out.push({ t: T0 + i * H, o, h: Math.max(o, c) * (1 + wide), l: Math.min(o, c) * (1 - wide), c, v: 1 })
  }
  return out
}

const trade = (i: number, ret: number): Trade => ({ i, j: i + 1, t: T0 + i * H, t2: T0 + (i + 1) * H, ret, gross: ret, funding: 0 })

test('a trade counts in the mood of the candle it opened at; before the 200-candle settle it is in none', () => {
  const k = twoMoods()
  const trades = [trade(50, 0.01), ...Array.from({ length: 12 }, (_, n) => trade(250 + n, 0.01)), ...Array.from({ length: 12 }, (_, n) => trade(450 + n, -0.02))]
  const m = moodSplit(trades, k)
  const by = (name: string) => m.find(r => r.name === name) as MoodRow
  expect(by('rising').n).toBe(12)
  expect(by('falling').n).toBe(12)
  expect(by('calm').n).toBe(12)
  expect(by('wild').n).toBe(12)
  expect(Math.abs(by('rising').avg - 0.01) < 1e-12).toBe(true)
  expect(by('falling').win).toBe(0)
})

const rows = (a: number, b: number, opts: { na?: number; nb?: number; sd?: number; calm?: number; wild?: number } = {}): MoodRow[] => [
  { name: 'rising', what: 'close over its 200 EMA', n: opts.na ?? 12, avg: a, win: 0.6, sd: opts.sd ?? 0.01 },
  { name: 'falling', what: 'close under it', n: opts.nb ?? 12, avg: b, win: 0.3, sd: opts.sd ?? 0.01 },
  { name: 'calm', what: 'ATR under its 200-candle average', n: 12, avg: opts.calm ?? 0.001, win: 0.5, sd: opts.sd ?? 0.01 },
  { name: 'wild', what: 'ATR over it', n: 12, avg: opts.wild ?? 0.002, win: 0.5, sd: opts.sd ?? 0.01 },
]

test('the mood line gives numbers from 10 trades, says when one mood clearly carries it, and stays quiet under 10 in all', () => {
  const line = moodLine(rows(0.01, -0.005), 24) ?? ''
  expect(line).toMatch(/^Market mood \(24 trades, seen and unseen, by the mood when each opened; one before the 200-candle averages settle has none\): rising \(close over its 200 EMA\) 12 trades, average /)
  expect(line).toMatch(/It made money only while the market was rising, by more than noise usually gives: it may just ride that mood\.$/)
  expect(line).not.toMatch(/while it was calm/)
  const few = moodLine(rows(0.01, -0.005, { na: 15, nb: 4 }), 19) ?? ''
  expect(few).toMatch(/falling \(close under it\) 4 trades: under 10, no numbers/)
  expect(few).not.toMatch(/ride that mood/)
  expect(moodLine(rows(0.01, -0.005), 9)).toBeNull()
  expect(line).not.toMatch(banned)
})

test('a small wobble is no verdict: the gap must be over twice its standard error, and a flat side has not lost', () => {
  // Same averages, but trades spread 5% apart: a 1.5% gap over 12 trades a side is noise.
  expect(moodLine(rows(0.01, -0.005, { sd: 0.05 }), 24) ?? '').not.toMatch(/ride/)
  // One side exactly flat: nothing lost there, so nothing is said, and the flat side is never named as the one that made money.
  expect(moodCarries(rows(0, -0.01)[0] as MoodRow, rows(0, -0.01)[1] as MoodRow)).toBeNull()
  expect(moodCarries(rows(0.01, 0)[0] as MoodRow, rows(0.01, 0)[1] as MoodRow)).toBeNull()
  // Both pairs clear: one sentence names both.
  const two = moodLine(rows(0.01, -0.01, { calm: 0.01, wild: -0.01 }), 24) ?? ''
  expect(two).toMatch(/only while the market was rising, and only while it was calm, by more than noise usually gives: it may just ride those moods\.$/)
  expect(two.match(/made money only/g)?.length).toBe(1)
})

test('the honest test text carries the mood line before the luck line', () => {
  const k = twoMoods()
  const spec = parseTest({ enter: 'close > open', hold: 3 })
  if ('error' in spec) throw new Error(spec.error)
  const r = honestTest(spec, { enter: 'close > open' }, k, [], 1, 20)
  expect(r.moods.map(m => m.name)).toEqual(['rising', 'falling', 'calm', 'wild'])
  const text = testText(r, 'BTC', '1h', 0)
  const at = text.split('\n').findIndex(l => l.startsWith('Market mood'))
  expect(at).toBeGreaterThan(0)
  expect(text.split('\n')[at + 1]).toMatch(/^Luck check/)
  expect(text).not.toMatch(banned)
})
