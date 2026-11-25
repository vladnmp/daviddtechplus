// Your trades on the chart: Hyperliquid fills into round trips, pins, and habits next to the alerts. Pure.

import { expect, test } from 'claude-code/testing'

import type { Candle } from '../types'
import { alertHabits, habitsText, keepFills, moveAfter, parseFills, roundTrips, shortWallet, tripList, tripPins, tripsText, walletOf } from '../hooks/fills'
import type { Fill, Trip } from '../hooks/fills'
import type { TvAlert } from '../hooks/live'

const H = 3_600_000
const T0 = Date.UTC(2026, 9, 1)
const W = '0x' + 'ab'.repeat(20)
const banned = /\b(buy|buying|sell|selling|signals?|targets?|edge|expected move)\b/i

/** One fill as Hyperliquid sends it (strings for numbers). */
function raw(coin: string, side: 'B' | 'A', sz: number, px: number, at: number, start: number, closedPnl = 0, fee = 0.1): Record<string, unknown> {
  return { coin, px: String(px), sz: String(sz), side, time: at, startPosition: String(start), dir: 'x', closedPnl: String(closedPnl), fee: String(fee), hash: '0x', oid: 1, tid: 1, crossed: true, feeToken: 'USDC' }
}

test('a wallet address is read from text; anything else is not one', () => {
  expect(walletOf(`mine: ${W.toUpperCase().replace('0X', '0x')}`)).toBe(W)
  expect(walletOf('0x1234')).toBeNull()
  expect(shortWallet(W)).toBe('0xabab…abab')
})

test('perp fills only; spot and junk are left out; oldest first', () => {
  const fills = parseFills([raw('BTC', 'B', 1, 100, 3, 0), raw('@107', 'B', 1, 1, 1, 0), raw('PURR/USDC', 'B', 1, 1, 1, 0), raw('ETH', 'A', 0, 1, 2, 0), raw('SOL', 'A', 2, 50, 1, 0), { coin: 'BTC' }])
  expect(fills.map(f => f.coin)).toEqual(['SOL', 'BTC'])
  expect(parseFills('nope')).toEqual([])
  expect(keepFills(fills, fills)).toHaveLength(2)
})

test('a trip opens off zero and ends back at zero; adds average the entry; net is closed PnL after fees', () => {
  const fills = parseFills([raw('BTC', 'B', 1, 100, T0, 0), raw('BTC', 'B', 1, 110, T0 + H, 1), raw('BTC', 'A', 2, 120, T0 + 2 * H, 2, 30)])
  const trips = roundTrips(fills)
  expect(trips).toHaveLength(1)
  const t = trips[0] as Trip
  expect(t.side).toBe('long')
  expect(t.size).toBe(2)
  expect(Math.abs((t.entry ?? NaN) - (105)) < 1e-9).toBe(true)
  expect(t.exit).toBe(120)
  expect(Math.abs((t.net ?? NaN) - (30 - 0.3)) < 1e-9).toBe(true)
  expect(t.close).toBe(T0 + 2 * H)
})

test('a fill that flips the position ends one trip and opens the next, its fee split by size', () => {
  const fills = parseFills([raw('BTC', 'B', 1, 100, T0, 0, 0, 0.1), raw('BTC', 'A', 3, 90, T0 + H, 1, -10, 0.3)])
  const trips = roundTrips(fills)
  expect(trips.map(t => t.side)).toEqual(['long', 'short'])
  expect(Math.abs((trips[0]?.net ?? NaN) - (-10 - 0.1 - 0.1)) < 1e-9).toBe(true)
  expect(trips[1]?.size).toBe(2)
  expect(trips[1]?.close).toBeNull()
  expect(Math.abs((trips[1]?.fees ?? NaN) - (0.2)) < 1e-9).toBe(true)
})

test('a position opened before the window read is left out until it is flat again', () => {
  const fills = parseFills([raw('ETH', 'A', 2, 50, T0, 2), raw('ETH', 'A', 1, 50, T0 + H, 0), raw('ETH', 'B', 1, 45, T0 + 2 * H, -1, 5)])
  const trips = roundTrips(fills)
  expect(trips).toHaveLength(1)
  expect(trips[0]?.side).toBe('short')
  expect(Math.abs((trips[0]?.net ?? NaN) - (5 - 0.2)) < 1e-9).toBe(true)
})

function trips(n: number, coin = 'BTC'): Fill[] {
  const out: Record<string, unknown>[] = []
  for (let i = 0; i < n; i++) {
    out.push(raw(coin, 'B', 1, 100, T0 + i * 10 * H, 0))
    out.push(raw(coin, 'A', 1, i % 3 ? 105 : 95, T0 + i * 10 * H + 2 * H, 1, i % 3 ? 5 : -5))
  }
  return parseFills(out)
}

test('the trips in words: no numbers under 10; from 10 on, net, the share that made money and how long', () => {
  const few = tripsText(roundTrips(trips(9)), W, 90)
  expect(few).toMatch(/9 finished round trips/)
  expect(few).toMatch(/Under 10 finished trips: no numbers yet\./)
  const many = tripsText(roundTrips(trips(12)), W, 90)
  expect(many).toMatch(/Made money 67% of the time \[\d+%–\d+%\]/)
  expect(many).toMatch(/Median time in a trade 2\.0 hours/)
  expect(many).toMatch(/- BTC: 12 trips, net \+\$\d+, made money 67%/)
  expect(many).not.toMatch(banned)
  expect(tripList(roundTrips(trips(3)))).toMatch(/BTC long 1\.00 at 100\.00 → /)
})

test('pins: an opening up or down, a close as a dot at its price', () => {
  const pins = tripPins(roundTrips(trips(2)), 'BTC')
  expect(pins.map(p => p.dir)).toEqual(['up', 'dot', 'up', 'dot'])
  expect(pins[1]?.price).toBe(95)
  expect(pins[1]?.label).toBe('-$5')
  expect(tripPins(roundTrips(trips(2)), 'ETH')).toEqual([])
})

test('alerts taken or skipped: a trip its way within 3 of its candles', () => {
  const t = roundTrips(trips(3))
  const a = (i: number, side: 'long' | 'short', dt: number): TvAlert => ({ id: String(i), at: T0 + i * 10 * H - dt, coin: 'BTC', interval: '1h', side, name: 'x' })
  const h = alertHabits([a(0, 'long', 30 * 60_000), a(1, 'long', 5 * H), a(2, 'short', 0), { id: '9', at: T0, coin: 'SOL', side: 'long' }], t, x => x.coin ?? null)
  expect(h.map(x => !!x.trip)).toEqual([true, false, false])
  expect(h[0]?.lagMs).toBe(30 * 60_000)
  const text = habitsText(h, () => 0.01)
  expect(text).toMatch(/^Of 3 long or short alerts on coins you trade, you took 1 and skipped 2/)
  expect(text).toMatch(/under 10 each: no numbers yet/)
  expect(habitsText([], () => null)).toMatch(/^No long or short/)
})

test('the move after an alert, in its direction', () => {
  const c: Candle[] = Array.from({ length: 30 }, (_, i) => ({ t: T0 + i * H, o: 100 + i, h: 101 + i, l: 99 + i, c: 101 + i, v: 1 }))
  const a: TvAlert = { id: '1', at: T0 + 1, side: 'short' }
  expect(Math.abs((moveAfter(a, c, 5) ?? NaN) - (-(106 / 101 - 1))) < 1e-9).toBe(true)
  expect(moveAfter({ ...a, at: T0 + 28 * H }, c, 5)).toBeNull()
})
