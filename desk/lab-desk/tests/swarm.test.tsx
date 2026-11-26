// The Swarm: many rules on one coin judged together; the ledger of tries that saw the unseen part; and deep history
// read from Binance (faked here) instead of Hyperliquid's 5000 candles.

import { expect, mock, test } from 'claude-code/testing'

import type { Candle } from '../types'
import { NOW, candlesFixture, engine, typed } from './fixtures'
import { parseTest, seededRandom } from '../hooks/honest'
import type { TestSpec } from '../hooks/honest'
import { runSwarm, splitRules, swarmText } from '../hooks/swarm'
import type { SwarmResult } from '../hooks/swarm'
import { parseTestWords } from '../hooks/register'

const H = 3_600_000

function walk(n: number, seed: number): Candle[] {
  const rand = seededRandom(seed)
  const out: Candle[] = []
  let p = 100
  for (let i = 0; i < n; i++) {
    const o = p
    const z = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
    p *= 1 + 0.008 * z
    out.push({ t: i * H, o, h: Math.max(o, p), l: Math.min(o, p), c: p, v: 1 })
  }
  return out
}

function spec(enter: string, hold: number, side: 'long' | 'short' = 'long'): TestSpec {
  const s = parseTest({ enter, hold, fee: 0.045, side })
  if ('error' in s) throw new Error(s.error)
  return s
}

test('splitRules: semicolons, new lines and list marks', () => {
  expect(splitRules('rsi < 30 hold 10; ema 20 crosses above ema 50 hold 24')).toEqual(['rsi < 30 hold 10', 'ema 20 crosses above ema 50 hold 24'])
  expect(splitRules('1. rsi < 30 hold 10\n- rsi > 70 hold 6 short\n\n• close > ema 200 hold 12')).toEqual(['rsi < 30 hold 10', 'rsi > 70 hold 6 short', 'close > ema 200 hold 12'])
})

test('on noise the swarm is an honest empty: nothing beats luck, the unseen part stays sealed, a walk-forward is shown', () => {
  const c = walk(4000, 41)
  const specs = [...[25, 30, 35, 40].map(a => spec(`rsi < ${a}`, 12)), ...[60, 70].map(a => spec(`rsi > ${a}`, 12, 'short')), spec('ema 20 crosses above ema 50', 24)]
  const x = runSwarm(specs, c, [], 299)
  expect(x.rows.length).toBe(7)
  expect(x.rows.every(r => r.unseen === undefined)).toBe(true)
  expect(x.unseenP).toBe(null)
  expect(x.walk?.steps.length).toBe(4)
  expect(x.cut).toBeGreaterThan(2700)
  expect(x.cut).toBeLessThan(2900)
  const text = swarmText(x, 'BTC', '1h', 'Hyperliquid', ['nonsense here'])
  expect(text).toMatch(/^Swarm: 7 rules on BTC 1h on Hyperliquid/)
  expect(text).toMatch(/^Luck check across all 7 \(/m)
  expect(text).toMatch(/^Walk-forward \(seen part in 5 stretches/m)
  expect(text).toMatch(/^Honest empty: none of the 7 beat luck/m)
  expect(text).toMatch(/^Left out, not understood: nonsense here\.$/m)
  expect(text).not.toMatch(/\b(buy|sell|signal|target|edge)\b/i)
  // The same rules on the same candles give the same answer.
  expect(JSON.stringify(runSwarm(specs, c, [], 299).rows.map(r => r.p))).toBe(JSON.stringify(x.rows.map(r => r.p)))
})

test('rules that beat luck get their unseen part opened and a luck line across them there', () => {
  const s = spec('rsi < 30', 12)
  const part = { n: 40, winShare: 0.6, avg: 0.004, total: 0.17, maxDrawdown: -0.05, trades: [] }
  const x: SwarmResult = {
    rows: [{ spec: s, words: 'rsi < 30 hold 12', seen: part, t: 3.1, p: 0.012, survives: true, unseen: { ...part, n: 31 } }],
    cut: 100,
    warm: 10,
    from: 0,
    cutT: 100 * H,
    to: 200 * H,
    p: 0.012,
    used: 1,
    draws: 2000,
    block: 24,
    walk: null,
    unseenP: { p: 0.03, held: true, best: 'rsi < 30 hold 12' },
    few: 0,
  } as unknown as SwarmResult
  const text = swarmText(x, 'SOL', '4h', 'Binance', [])
  expect(text).toMatch(/1 beat luck one by one\./)
  expect(text).toMatch(/^Unseen part, opened for the 1 strongest that beat luck/m)
  expect(text).toMatch(/^· rsi < 30 hold 12: 31 trades/m)
  expect(text).toMatch(/it held where it was never tuned\. Still only history\.$/m)
  expect(text).not.toMatch(/Honest empty/)
})

test('/lab-swarm: rules run together, each counts as a try, the ledger keeps them, a Next line', async ($, on) => {
  engine(on, { candles: () => candlesFixture(1200) })
  mock.clock(on, { now: NOW })
  const kept = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: kept.get(e.key) }))
  on('store.set', (_, e) => (kept.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_, e) => (kept.delete(e.key), { value: undefined }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const run = async (name: string, args: string) => (await $.command.run(typed(name, args))).text ?? ''
  const text = await run('lab-swarm', 'BTC 1h: rsi < 40 hold 6; rsi < 30 hold 6; rsi > 60 hold 6 short; rsi < 40 hold 6; what is this')
  // The copy runs once; the line it could not read is said.
  expect(text).toMatch(/^Swarm: 3 rules on BTC 1h on Hyperliquid/)
  expect(text).toMatch(/^Left out, not understood: what is this\.$/m)
  expect(text).toMatch(/^Luck check across all 3/m)
  expect(text).toMatch(/^Next: /m)
  expect(text).toMatch(/^Market data: Hyperliquid public API$/m)
  // The three were tries on BTC 1h: a new test is the fourth.
  expect(await run('lab-test', 'rsi < 45 exit rsi > 55 on 1h')).toMatch(/4 tries on BTC 1h so far/)
  const ledger = kept.get('ledger') as Record<string, { k: string; u: number }[]>
  expect(ledger['BTC 1h']?.length).toBe(4)
  // Nothing beat luck in the swarm, so none of its rules saw the unseen part.
  expect(ledger['BTC 1h']?.slice(0, 3).every(r => r.u === 0)).toBe(true)
  // Too few rules: how to use it.
  expect(await run('lab-swarm', 'rsi < 30 hold 6')).toMatch(/^Swarm: give 2 to 200 rules/)
})

test('the chart_swarm tool takes the rules as a list', async ($, on) => {
  engine(on, { candles: () => candlesFixture(800) })
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = String((await $.tool.call({ tool: 'mcp__lab-desk__chart_swarm', rules: ['rsi < 35 hold 8', 'rsi > 65 hold 8 short'], coin: 'ETH', interval: '1h' } as never)).result ?? '')
  expect(r).toMatch(/^Swarm: 2 rules on ETH 1h on Hyperliquid/)
})

/** Binance's klines, 1500 a page from startTime, a steady made-up walk up to NOW. */
function binance(url: string): { status: number; text: string } | undefined {
  const q = new URL(url)
  const start = Number(q.searchParams.get('startTime') ?? 0)
  if (q.pathname.endsWith('/klines')) {
    const rows: unknown[] = []
    for (let t = Math.ceil(start / H) * H; t < NOW && rows.length < 1500; t += H) {
      const k = t / H
      const o = 30_000 + 2_000 * Math.sin(k / 50) + 300 * Math.sin(k / 3)
      const c = o + 120 * Math.sin(k * 1.7)
      rows.push([t, String(o), String(Math.max(o, c) + 50), String(Math.min(o, c) - 50), String(c), '10', t + H - 1])
    }
    return { status: 200, text: JSON.stringify(rows) }
  }
  if (q.pathname.endsWith('/fundingRate')) {
    const rows: unknown[] = []
    for (let t = Math.ceil(start / (8 * H)) * 8 * H; t < NOW && rows.length < 1000; t += 8 * H) rows.push({ symbol: 'BTCUSDT', fundingTime: t, fundingRate: '0.0001' })
    return { status: 200, text: JSON.stringify(rows) }
  }
  return undefined
}

test('deep: years of Binance candles, the venue and its fee named, Hyperliquid candles not read', async ($, on) => {
  const w = engine(on, { get: binance })
  const toasts: string[] = []
  on('ui.toast', (_, e) => (toasts.push(String((e as { text?: unknown }).text ?? '')), { value: undefined }))
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const text = (await $.command.run(typed('lab-test', 'rsi < 30 exit rsi > 50 on 1h deep'))).text ?? ''
  expect(text).toMatch(/^Test: BTC 1h on Binance/m)
  expect(w.fetches.some(f => f.includes('fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h'))).toBe(true)
  expect(text).toMatch(/Binance/)
  expect(toasts.some(t => /^Reading BTC 1h from \d{4}-\d\d-\d\d from Binance/.test(t))).toBe(true)
  // 50,000 hourly candles fit in 34 pages of 1500.
  expect(w.fetches.filter(f => f.includes('/klines')).length).toBe(34)
  // A second test reads the kept candles, not Binance again.
  const before = w.fetches.length
  await $.command.run(typed('lab-test', 'rsi < 25 exit rsi > 50 on 1h deep'))
  expect(w.fetches.slice(before).filter(f => f.includes('/klines')).length).toBe(0)
})

/** Noise where a candle that closed over 0.5% up is followed by a 0.4% rise on average: a pattern a rule can find. */
function planted(n: number, seed: number, end = NOW): Candle[] {
  const rand = seededRandom(seed)
  const out: Candle[] = []
  let p = 100
  let last = 0
  for (let i = 0; i < n; i++) {
    const o = p
    const z = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
    const r = 0.008 * z + (last > 0.005 ? 0.004 : 0)
    p *= 1 + r
    last = r
    out.push({ t: end - (n - i) * H, o, h: Math.max(o, p), l: Math.min(o, p), c: p, v: 1 })
  }
  return out
}

const PLANT = 'ta.roc(close, 1) > 0.5 hold 1'
const NOISE = ['rsi < 30 hold 6', 'rsi < 40 hold 12', 'rsi > 70 hold 6 short', 'rsi > 60 hold 12 short', 'ema 20 crosses above ema 50 hold 24', 'close > ema 200 hold 6', 'close < ema 50 hold 6 short', 'rsi < 35 exit rsi > 55']

test('a planted pattern beats luck in the swarm, its unseen part is opened, and it holds there', () => {
  const c = planted(4000, 11)
  const specs = [PLANT, ...NOISE].map(w => {
    const t = parseTestWords(w)
    const s = t ? parseTest(t) : null
    if (!s || 'error' in s) throw new Error(w)
    return s
  })
  const x = runSwarm(specs, c, [], 499)
  const plant = x.rows[0]
  expect(plant?.survives).toBe(true)
  expect(plant?.unseen && plant.unseen.n).toBeGreaterThan(30)
  expect(x.rows.slice(1).every(r => !r.survives)).toBe(true)
  expect(x.unseenP?.p ?? 1).toBeLessThan(0.05)
  const text = swarmText(x, 'BTC', '1h', 'Hyperliquid', [])
  expect(text).toMatch(/^Unseen part, opened for the 1 strongest that beat luck/m)
  expect(text).toMatch(/it held where it was never tuned\. Still only history\.$/m)
  // Earlier tries join the check: with them it says how many.
  const again = runSwarm(specs.slice(0, 3), c, [], 199, specs.slice(3).map(spec => ({ spec, sawUnseen: false })))
  expect(again.earlier).toBe(6)
  expect(swarmText(again, 'BTC', '1h', 'Hyperliquid', [])).toMatch(/^Luck check across all 3 and the 6 earlier tries on BTC 1h /m)
})

test('/lab-swarm on a planted pattern: pinned, the ledger marks what saw the unseen part, the next swarm counts the earlier ones', async ($, on) => {
  const rows = planted(2500, 11).map(k => ({ t: k.t, T: k.t + H - 1, s: 'BTC', i: '1h', o: String(k.o), c: String(k.c), h: String(k.h), l: String(k.l), v: '1', n: 1 }))
  engine(on, { candles: () => rows })
  mock.clock(on, { now: NOW })
  const kept = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: kept.get(e.key) }))
  on('store.set', (_, e) => (kept.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_, e) => (kept.delete(e.key), { value: undefined }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const run = async (args: string) => (await $.command.run(typed('lab-swarm', args))).text ?? ''
  const text = await run(`BTC 1h: ${[PLANT, ...NOISE.slice(0, 5)].join('; ')}`)
  expect(text).toMatch(/^Unseen part, opened for the 1 strongest that beat luck/m)
  expect(text).toMatch(/pinned on the chart \(layer "swarm"\)\./)
  expect(text).toMatch(/^Next: the fairest check is other coins: \/lab-test ta\.roc\(close, 1\) > 0\.5 hold 1 .*across ETH SOL on 1h\.$/m)
  const ledger = kept.get('ledger') as Record<string, { w: string; u: number }[]>
  expect(ledger['BTC 1h']?.filter(r => r.u === 1).length).toBe(1)
  expect(ledger['BTC 1h']?.find(r => r.u === 1)?.w).toMatch(/^ta\.roc\(close, 1\) > 0\.5 hold 1/)
  // The next swarm on the same coin is judged with the 6 before it.
  expect(await run('BTC 1h: rsi < 25 hold 6; rsi > 75 hold 6 short')).toMatch(/^Luck check across all 2 and the 6 earlier tries on BTC 1h /m)
})

test('/lab-swarm reads a head without a colon, named rules, rules on another interval, and says when commas joined them', { timeoutMs: 60_000 }, async ($, on) => {
  engine(on, { candles: () => candlesFixture(1200) })
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const run = async (args: string) => (await $.command.run(typed('lab-swarm', args))).text ?? ''
  expect(await run('SOL 4h rsi < 40 hold 6; rsi < 30 hold 6')).toMatch(/^Swarm: 2 rules on SOL 4h/)
  expect(await run('ETH 1h: Dip: rsi < 40 hold 6; Fade: rsi > 60 hold 6 short')).toMatch(/^Swarm: 2 rules on ETH 1h/)
  const mixed = await run('rsi < 40 hold 6 on 1h; rsi < 30 hold 6 on 4h; rsi < 35 hold 6 on 1h')
  expect(mixed).toMatch(/^Swarm: 2 rules on BTC 1h/)
  expect(mixed).toMatch(/^On another interval than 1h, left out: rsi < 30 hold 6 on 4h\.$/m)
  expect(await run('BTC 1h: rsi < 40 hold 6, rsi < 30 hold 6')).toMatch(/not a comma\.$/)
})
