// Trade review (leaks against the person's own usual, checked against chance) and the second look (an idea set
// against their rules file, the market now and the leaks that apply now).

import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { NOW, candlesFixture, engine, typed } from './fixtures'
import type { Trip } from '../hooks/fills'
import { seededRandom } from '../hooks/honest'
import { RULES_MAX, RULES_TEMPLATE, allRulesOf, leaksNow, reviewText, reviewTrips, rulesOf, secondLookText, tripContexts } from '../hooks/review'

const H = 3_600_000
const W = '0x1234567890abcdef1234567890abcdef12345678'

function trip(coin: string, open: number, close: number, net: number, side: 'long' | 'short' = 'long', size = 1): Trip {
  return { coin, side, open, close, entry: 100, exit: 100, size, net, fees: 1, fills: 2 }
}

/** Trips 2h long; every third starts half an hour after the last closed, and after a loss those lose. */
function tiltTrips(n: number, seed: number, tilt: boolean): Trip[] {
  const rand = seededRandom(seed)
  const out: Trip[] = []
  let t = NOW - 2000 * H
  let prev: Trip | null = null
  for (let i = 0; i < n; i++) {
    const soon = i % 3 === 0
    const open: number = t + (soon ? H / 2 : 5 * H)
    const net = tilt && soon && prev !== null && prev.net < 0 ? -60 - 40 * rand() : (rand() - 0.4) * 100
    const tr = trip(i % 2 ? 'BTC' : 'ETH', open, open + 2 * H, net, rand() < 0.5 ? 'long' : 'short', 1 + rand())
    out.push(tr)
    prev = tr
    t = open + 2 * H
  }
  return out
}

test('each trip knows the trip closed last before it opened', () => {
  const a = trip('BTC', 0, 2 * H, -5)
  const b = trip('ETH', 3 * H, 4 * H, 5)
  const c = trip('BTC', 3.5 * H, 6 * H, 1)
  const ctx = tripContexts([c, a, b, { ...a, close: null, open: 10 * H }])
  expect(ctx.length).toBe(3)
  expect(ctx[0]?.prev).toBe(null)
  expect(ctx[1]?.prev).toBe(a)
  expect(ctx[2]?.prev).toBe(a)
})

test('a tilt after losses is found and stands out; plain noise has no leak that stands out', { timeoutMs: 60_000 }, () => {
  const tilted = reviewTrips(tiltTrips(150, 3, true), 999)
  const soon = tilted.leaks.find(g => g.key === 'soonAfterLoss')
  expect(soon).toBeDefined()
  expect((soon?.adjusted ?? 1) < 0.05).toBe(true)
  expect(soon?.cost ?? 0).toBeLessThan(0)
  const text = reviewText(tilted, W, 90)
  expect(text).toMatch(/^Trade review of 0x1234…5678, last 90 days: 150 finished trips/)
  expect(text).toMatch(/^· Opened within an hour of closing a loss: \d+ trips, net -\$[\d,]+, made money \d+% .*Stands out even allowing for the \d+ splits looked at\.$/m)
  expect(text).not.toMatch(/\b(buy|sell|signal|target|edge)\b/i)
  // On 100 traders with no habit at all, a split "stands out" for about 5 or fewer of them.
  let flagged = 0
  for (let seed = 1; seed <= 100; seed++) if (reviewTrips(tiltTrips(150, 100 + seed, false), 399).all.some(g => g.adjusted < 0.05)) flagged++
  expect(flagged).toBeLessThanOrEqual(8)
  // Too few trips: no splits.
  expect(reviewText(reviewTrips(tiltTrips(12, 1, true)), W, 90)).toMatch(/Under 20 finished trips: too few/)
})

test('the leaks that apply now: right after closing a loss, on that coin and side', () => {
  const trips = tiltTrips(150, 3, true)
  const r = reviewTrips(trips, 999)
  const lastLoss = trip('BTC', NOW - 3 * H, NOW - H / 2, -50)
  const now = leaksNow(r, [...trips, lastLoss], 'BTC', 'long', NOW)
  expect(now.some(g => g.key === 'soonAfterLoss')).toBe(true)
  // Size and time held are not known before a trade: never among them.
  expect(now.every(g => g.atOpen)).toBe(true)
  const later = leaksNow(r, [...trips, trip('BTC', NOW - 30 * H, NOW - 20 * H, 40)], 'BTC', 'long', NOW)
  expect(later.some(g => g.key === 'soonAfterLoss')).toBe(false)
})

test('the rules file: headings and the help line left out, list marks taken off; the brief asks for 3 reasons against', () => {
  expect(rulesOf(RULES_TEMPLATE).length).toBe(4)
  expect(rulesOf('# Mine\n1. no trades on Sunday\n* max 3 trades a day\n\n')).toEqual(['no trades on Sunday', 'max 3 trades a day'])
  const brief = secondLookText({ idea: 'long SOL here', coin: 'SOL', side: 'long', rules: ['no trades on Sunday'], rulesPath: '/data/my-trading-rules.md', facts: ['SOL 182.35.'], leaks: [], looked: 0, hasTrades: false })
  expect(brief).toMatch(/^Second look at: long SOL here \(SOL, long\)\./)
  expect(brief).toMatch(/^1\. no trades on Sunday$/m)
  expect(brief).toMatch(/exactly the 3 strongest reasons against this idea/)
  expect(brief).not.toMatch(/\b(buy|sell|signal|target|edge)\b/i)
})

function memStore(on: On): Map<string, unknown> {
  const m = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: m.get(e.key) }))
  on('store.set', (_, e) => (m.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_, e) => (m.delete(e.key), { value: undefined }))
  return m
}

/** 40 BTC round trips from the public fills, every 4th a loss right after a loss. */
function fills(): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (let i = 0; i < 40; i++) {
    const t = NOW - 1500 * H + i * 30 * H
    const loss = i % 4 === 0 || i % 4 === 1
    out.push({ coin: 'BTC', px: '95000', sz: '0.1', side: 'B', time: t, startPosition: '0', dir: 'Open Long', closedPnl: '0', fee: '2', oid: i, tid: i })
    out.push({ coin: 'BTC', px: '95000', sz: '0.1', side: 'A', time: t + 3 * H, startPosition: '0.1', dir: 'Close Long', closedPnl: loss ? '-40' : '30', fee: '2', oid: i, tid: 100 + i })
  }
  return out
}

test('/lab-trades review, /lab-rules and the second look', async ($, on) => {
  const w = engine(on, { fills: user => (user === W ? fills() : []), candles: () => candlesFixture(400) })
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const run = async (name: string, args: string) => (await $.command.run(typed(name, args))).text ?? ''
  expect(await run('lab-trades', 'review')).toMatch(/^The review reads your trades from a public address/)
  await run('lab-trades', W)
  const review = await run('lab-trades', 'review')
  expect(review).toMatch(/^Trade review of 0x1234…5678, last 90 days: 40 finished trips/)
  expect(review).toMatch(/^\d+ splits looked at/m)
  expect(review).toMatch(/^Next: /m)
  // Rules: started from the template, then one added; kept by the desk when there is no data folder.
  expect(await run('lab-rules', '')).toMatch(/^Your trading rules: one rule a line, kept by the desk on this PC\. Started with 4 examples/)
  expect(await run('lab-rules', 'add no trades on Sunday')).toMatch(/^Rule added: no trades on Sunday\. 5 rules now/)
  expect(String(store.get('myRules'))).toMatch(/- no trades on Sunday\n$/)
  expect(await run('lab-rules', '')).toMatch(/^5\. no trades on Sunday$/m)
  // The second look: the tool's brief has the rules, the market and their last trip.
  const brief = String((await $.tool.call({ tool: 'mcp__lab-desk__chart_second_look', idea: 'short sol here, it looks tired' } as never)).result ?? '')
  expect(brief).toMatch(/^Second look at: short sol here, it looks tired \(SOL, short\)\./)
  expect(brief).toMatch(/^5\. no trades on Sunday$/m)
  expect(brief).toMatch(/^· SOL 182\.35, /m)
  expect(brief).toMatch(/^· rsi 14: \d+ on 1h/m)
  expect(brief).toMatch(/^· Their last trip: long BTC, closed \d+ days ago, net [+-]\$\d+\.$/m)
  expect(brief).toMatch(/^1\. No new trade within an hour of closing a loss\. \(a starting example they have not changed\)$/m)
  expect(brief).toMatch(/exactly the 3 strongest reasons against/)
  // The command hands it to Claude through the prompt box, or says what to ask.
  expect(await run('lab-second-look', 'long BTC')).toMatch(/^Second look ready in the prompt box/)
  expect(w.fills.at(-1)).toMatch(/^Second look before I trade: long BTC\. Use chart_second_look/)
  expect(await run('lab-second-look', '')).toMatch(/^Second look before you trade: /)
})

test('rule lines: decimals, "#1" and bold stay whole; headings, dividers and list marks go', () => {
  expect(rulesOf('1.5% max risk a trade\n3.5x leverage at most\n-2% daily stop, then done\n#1 rule: never revenge trade\n**Never** chase a candle\n---\n## Risk\n- [ ] check funding first\n2) max 3 trades a day')).toEqual([
    '1.5% max risk a trade',
    '3.5x leverage at most',
    '-2% daily stop, then done',
    '#1 rule: never revenge trade',
    'Never chase a candle',
    'check funding first',
    'max 3 trades a day',
  ])
  // A long file: whole lines only, never one cut in half; the rest are counted.
  const long = Array.from({ length: 400 }, (_, i) => `- rule number ${i + 1} about something worth keeping`).join('\n')
  const read = rulesOf(long)
  expect(allRulesOf(long).length).toBe(400)
  expect(read.length).toBeLessThan(400)
  expect(read.join('\n').length).toBeLessThanOrEqual(RULES_MAX)
  expect(read.at(-1)).toMatch(/^rule number \d+ about something worth keeping$/)
})

test('size thirds go by rank: equal sizes are not split, ties never empty a third', () => {
  const at = (i: number, size: number) => trip(i % 2 ? 'BTC' : 'ETH', i * 10 * H, i * 10 * H + H, i % 3 ? 5 : -5, 'long', size)
  const same = tripContexts(Array.from({ length: 30 }, (_, i) => at(i, 1)))
  expect(same.every(x => x.sizeThird === null)).toBe(true)
  const two = tripContexts(Array.from({ length: 30 }, (_, i) => at(i, i < 15 ? 1 : 2)))
  expect(two.filter(x => x.sizeThird === 0).length).toBe(10)
  expect(two.filter(x => x.sizeThird === 2).length).toBe(10)
  expect(two.filter(x => x.sizeThird === 0).every(x => x.trip.size === 1)).toBe(true)
  expect(two.filter(x => x.sizeThird === 2).every(x => x.trip.size === 2)).toBe(true)
})

test('a trader whose result per dollar is the same on every trip has no size leak that stands out', { timeoutMs: 60_000 }, () => {
  let flagged = 0
  for (let seed = 1; seed <= 20; seed++) {
    const rand = seededRandom(500 + seed)
    const trips: Trip[] = []
    for (let i = 0; i < 400; i++) {
      // Sizes spread wide; each trip makes the same per dollar on average (price noise less fees), so big ones swing more.
      const size = Math.exp(rand() * 3)
      const net = 100 * size * ((rand() - 0.5) * 0.006 - 0.0009)
      trips.push(trip(i % 2 ? 'BTC' : 'ETH', i * 5 * H, i * 5 * H + 2 * H, net, rand() < 0.5 ? 'long' : 'short', size))
    }
    const r = reviewTrips(trips, 399)
    if (r.all.some(g => (g.key === 'big' || g.key === 'small') && g.adjusted < 0.05)) flagged++
  }
  expect(flagged).toBeLessThanOrEqual(2)
})

test('gaps that could be chance are never called leaks; longs and shorts are not said twice', { timeoutMs: 60_000 }, () => {
  const plain = reviewTrips(tiltTrips(150, 104, false), 399)
  if (plain.leaks.every(g => g.adjusted >= 0.05) && plain.leaks.length > 0) {
    const text = reviewText(plain, W, 90)
    expect(text).toMatch(/^No leak stands out from chance yet\. Worse than usual, but could be chance:$/m)
    expect(text).not.toMatch(/^Leaks \(/m)
    const shown = text.split('\n').filter(l => l.startsWith('· '))
    const longs = shown.some(l => l.startsWith('· Longs:'))
    expect(longs && /^Best split: Shorts:/m.test(text)).toBe(false)
  }
  // The tilted trader: the leak stands out and is shown first, whatever it cost against the others.
  const tilted = reviewText(reviewTrips(tiltTrips(150, 3, true), 999), W, 90)
  const stands = tilted.slice(tilted.indexOf('Leaks (worse than your own usual, and it stands out from chance):'), tilted.indexOf('Worse than usual, but could be chance:'))
  expect(stands).toMatch(/^· Opened within an hour of closing a loss: .*Stands out even allowing/m)
  expect(stands).not.toMatch(/Could be chance/)
  expect(reviewText(reviewTrips(tiltTrips(150, 3, true), 999), W, 90, '2026-10-02')).toMatch(/^Trade review of 0x1234…5678, since 2026-10-02: /)
})
