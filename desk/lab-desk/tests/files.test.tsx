// The member's own candle file: any market's candles from a CSV on their PC, for "after", the test and the Swarm.
// Its own file, so the module's kept files and tries start fresh.

import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { NOW, candlesFixture, engine } from './fixtures'
import { FILE_HEADER, FILE_MAX, fileInterval, fileTime, marketLabel, parseCandleFile } from '../hooks/files'
import { seededRandom } from '../hooks/honest'

const D = 86_400_000
const H = 3_600_000

test('a row\'s time: unix seconds or ms, an ISO date or time, no zone read as UTC, an offset taken off', () => {
  expect(fileTime('2024-01-31')).toBe(Date.UTC(2024, 0, 31))
  expect(fileTime('2024-01-31 14:30')).toBe(Date.UTC(2024, 0, 31, 14, 30))
  expect(fileTime('2024-01-31T14:30:00Z')).toBe(Date.UTC(2024, 0, 31, 14, 30))
  expect(fileTime('2024-01-31T14:30:00+02:00')).toBe(Date.UTC(2024, 0, 31, 12, 30))
  expect(fileTime('2024-01-31T14:30:00-0500')).toBe(Date.UTC(2024, 0, 31, 19, 30))
  expect(fileTime('1706659200')).toBe(1_706_659_200_000)
  expect(fileTime('1706659200000')).toBe(1_706_659_200_000)
  expect(fileTime('"2024-01-31"')).toBe(Date.UTC(2024, 0, 31))
  expect(fileTime('31/01/2024')).toBe(null)
  expect(fileTime('')).toBe(null)
  expect(fileInterval(D)).toBe('1d')
  expect(fileInterval(4 * H)).toBe('4h')
  expect(fileInterval(2 * H)).toBe(null)
  expect(marketLabel('spy')).toBe('SPY')
  expect(marketLabel('NASDAQ:aapl')).toBe('AAPL')
  expect(marketLabel(' eurusd ')).toBe('EURUSD')
  expect(marketLabel('EUR/USD')).toBe(null)
  expect(marketLabel('')).toBe(null)
  expect(marketLabel(5)).toBe(null)
  // As the answers say it back.
  expect(marketLabel('SPY (file)')).toBe('SPY')
})

test('a long candle file keeps its latest 50,000 candles, as deep history does', () => {
  const start = Date.UTC(2026, 0, 1)
  const rows = Array.from({ length: FILE_MAX + 7 }, (_, i) => ({ t: start + i * 60_000, o: 100, h: 101, l: 99, c: 100.5, v: 1 }))
  const got = parseCandleFile(csv(rows, FILE_HEADER, ',', t => String(t / 1000)), NOW)
  if ('error' in got) throw new Error(got.error)
  expect(got.interval).toBe('1m')
  expect(got.trimmed).toBe(7)
  expect(got.candles.length).toBe(FILE_MAX)
  expect(got.candles.at(-1)?.t).toBe(start + (FILE_MAX + 6) * 60_000)
})

/** Weekday daily candles (a stock's), a steady made-up walk, oldest first, ending with `lastDay`. */
function weekdays(n: number, lastDay: number, seed = 7): { t: number; o: number; h: number; l: number; c: number; v: number }[] {
  const rand = seededRandom(seed)
  const days: number[] = []
  for (let t = lastDay; days.length < n; t -= D) {
    const wd = new Date(t).getUTCDay()
    if (wd !== 0 && wd !== 6) days.unshift(t)
  }
  let p = 400
  return days.map(t => {
    const o = p
    const c = o * (1 + (rand() - 0.5) * 0.03)
    p = c
    return { t, o, h: Math.max(o, c) * (1 + rand() * 0.006), l: Math.min(o, c) * (1 - rand() * 0.006), c, v: Math.round(1e6 * (1 + rand())) }
  })
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const csv = (rows: { t: number; o: number; h: number; l: number; c: number; v: number }[], head = FILE_HEADER, sep = ',', time = iso) =>
  [head, ...rows.map(k => [time(k.t), k.o.toFixed(2), k.h.toFixed(2), k.l.toFixed(2), k.c.toFixed(2), k.v].join(sep))].join('\n')

// NOW is a Monday noon; the last closed weekday candle is the Friday before, Monday's is still forming.
const MONDAY = Date.UTC(2026, 10, 16)

test('a candle file: sorted, one row a time, the forming candle left out, the start where two candles are a day apart', () => {
  const rows = weekdays(300, MONDAY)
  // Newest first as some exports give, one row twice (the later one wins), and the first kept day a Friday.
  const shuffled = [...rows].reverse()
  shuffled.splice(6, 0, { ...(rows[rows.length - 6] as (typeof rows)[number]), c: 999, h: 1000 })
  const got = parseCandleFile(csv(shuffled), NOW)
  if ('error' in got) throw new Error(got.error)
  expect(got.interval).toBe('1d')
  expect(got.skipped).toBe(0)
  const c = got.candles
  for (let i = 1; i < c.length; i++) expect((c[i]?.t as number) > (c[i - 1]?.t as number)).toBe(true)
  // Monday's forming candle is out; Friday's closed one is the last.
  expect(c.at(-1)?.t).toBe(MONDAY - 3 * D)
  expect(c.find(k => k.t === (rows[rows.length - 6]?.t as number))?.c).toBe(999)
  // A weekend between the first two never reads as the interval: the start moves to two candles a day apart.
  expect((c[1]?.t as number) - (c[0]?.t as number)).toBe(D)
  expect(c.length).toBeGreaterThan(290)
})

test('a candle file: semicolons and other column names read; a wrong header, bad rows and an odd spacing are said plainly', () => {
  const rows = weekdays(60, MONDAY - 3 * D)
  const semi = parseCandleFile(csv(rows, 'Date;Open;High;Low;Close;Vol', ';'), NOW)
  if ('error' in semi) throw new Error(semi.error)
  expect(semi.candles.length).toBeGreaterThan(55)
  const unix = parseCandleFile(csv(rows, 'timestamp,open,high,low,close', ',', t => String(t / 1000)), NOW)
  if ('error' in unix) throw new Error(unix.error)
  expect(unix.candles[0]?.v).toBe(0)
  // The desk's own saved chart (/lab-chart save): time_utc, the forming candle and indicator columns after.
  const saved = parseCandleFile(csv(rows, 'time_utc,open,high,low,close,volume', ',', t => new Date(t).toISOString().slice(0, 16)).split('\n').map((l, i) => `${l},${i === 0 ? 'RSI 14' : '55.5'}`).join('\n'), NOW)
  if ('error' in saved) throw new Error(saved.error)
  expect(saved.candles.at(-1)?.c).toBe(Number((rows.at(-1)?.c as number).toFixed(2)))
  const head = parseCandleFile(csv(rows, 'when,o,h,l,c'), NOW)
  expect('error' in head && head.error).toMatch(/^The file's first row has no time, open, high, low, close columns\. The file needs a header row like time,open,high,low,close,volume/)
  // The row itself is never said back.
  expect('error' in head && head.error).not.toMatch(/when,o/)
  const bad = csv(rows).split('\n').map((l, i) => (i > 0 && i % 5 === 0 ? l.replace(/,[\d.]+,/, ',x,') : l)).join('\n')
  expect(((parseCandleFile(bad, NOW) as { error: string }).error)).toMatch(/rows did not read as candles/)
  const two = csv(rows.map((k, i) => ({ ...k, t: Date.UTC(2026, 0, 1) + i * 2 * H })), FILE_HEADER, ',', t => new Date(t).toISOString())
  expect(((parseCandleFile(two, NOW) as { error: string }).error)).toMatch(/about 120 minutes apart/)
  expect(((parseCandleFile(FILE_HEADER, NOW) as { error: string }).error)).toMatch(/no candles/)
})

/** The world beneath: a CSV at lab-charts/SPY_1d.csv (the engine gives it as an absolute Windows path), Hyperliquid faked. */
function world(on: On, text: string) {
  const w = engine(on, { candles: () => candlesFixture(400) })
  mock.clock(on, { now: NOW })
  mock.store(on)
  const reads: string[] = []
  on('fs.read', (_, e, next) => {
    const p = e.path.replaceAll('\\', '/').replace(/^[A-Za-z]:/, '')
    if (!p.endsWith('lab-charts/SPY_1d.csv')) return next(e)
    reads.push(p)
    return { value: text }
  })
  return { w, reads }
}

const call = async ($: Engine, tool: string, args: Record<string, unknown>) =>
  String((await $.tool.call({ tool: `mcp__lab-desk__${tool}`, ...args } as never)).result ?? '')

const snapshots = (requests: string[]) => requests.filter(b => b.includes('candleSnapshot')).length

test('chart_history "after" on a candle file: the market by its own name, no Hyperliquid read or named', async ($, on) => {
  const { w, reads } = world(on, csv(weekdays(700, MONDAY)))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const before = snapshots(w.requests)
  const r = await call($, 'chart_history', { mode: 'after', when: 'rsi < 40', file: 'lab-charts/SPY_1d.csv', coin: 'spy', ahead: 5 })
  expect(r).toMatch(/^History: SPY \(file\) 1d, rsi < 40, then 5 candles on\./)
  expect(r).toMatch(/^Next: ask Claude to test "rsi < 40 hold 5" on SPY_1d\.csv: /m)
  expect(r).toMatch(/^Market data: your file SPY_1d\.csv$/m)
  expect(r).not.toMatch(/Hyperliquid|Binance|deep|funding/i)
  expect(r.match(/^Next: /gm)?.length).toBe(1)
  expect(reads.length).toBe(1)
  expect(snapshots(w.requests)).toBe(before)
  // No market name: asked for, so the tries are kept under it; funding and open interest are a perp's.
  expect(await call($, 'chart_history', { mode: 'after', when: 'rsi < 40', file: 'lab-charts/SPY_1d.csv' })).toMatch(/^Candle file: say which market SPY_1d\.csv is/)
  expect(await call($, 'chart_history', { mode: 'after', when: 'funding < 0', file: 'lab-charts/SPY_1d.csv', coin: 'SPY' })).toMatch(/^Candle file SPY_1d\.csv: funding is a crypto perp's/)
  expect(await call($, 'chart_history', { mode: 'after', when: 'oi change 24 > 10', file: 'lab-charts/SPY_1d.csv', coin: 'SPY' })).toMatch(/open interest is a crypto perp's/)
  // An interval the file is not: said, with the one it is.
  expect(await call($, 'chart_history', { mode: 'after', when: 'rsi < 40', file: 'lab-charts/SPY_1d.csv', coin: 'SPY', interval: '4h' })).toMatch(/^Candle file SPY_1d\.csv has 1d candles, not 4h\./)
  expect(await call($, 'chart_history', { mode: 'like', file: 'lab-charts/SPY_1d.csv', coin: 'SPY' })).toMatch(/file/)
  expect(await call($, 'chart_history', { mode: 'after', when: 'rsi < 40', file: 'lab-charts/NOPE.csv', coin: 'SPY' })).toMatch(/^Candle file: could not read lab-charts\/NOPE\.csv/)
  // A .csv only: any other file is never read.
  const before2 = reads.length
  expect(await call($, 'chart_history', { mode: 'after', when: 'rsi < 40', file: '.env', coin: 'SPY' })).toMatch(/^Candle file: the Lab reads a \.csv of candles only .*not \.env\. Next: /)
  expect(reads.length).toBe(before2)
  // The market as the answer said it reads back; without the file it is refused, never run on Hyperliquid.
  expect(await call($, 'chart_history', { mode: 'after', when: 'rsi < 40', file: 'lab-charts/SPY_1d.csv', coin: 'SPY (file)', ahead: 5 })).toMatch(/^History: SPY \(file\) 1d/)
  expect(await call($, 'chart_history', { mode: 'after', when: 'rsi < 40', coin: 'SPY (file)', ahead: 5 })).toMatch(/^SPY \(file\) is a candle file's market, not a Hyperliquid perp\. Next: /)
})

test('chart_test on a candle file: the file and the fee named, no funding, its tries kept under the market\'s name', async ($, on) => {
  const { w } = world(on, csv(weekdays(900, MONDAY)))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const before = snapshots(w.requests)
  const r = await call($, 'chart_test', { enter: 'rsi < 40', hold: 5, fee: 0.01, file: 'lab-charts/SPY_1d.csv', coin: 'SPY' })
  expect(r).toMatch(/^Test: SPY \(file\) 1d on your file SPY_1d\.csv, long, enter when rsi < 40, exit after 5 candles\. Fee 0\.010% a side, no funding \(a candle file\)\./)
  expect(r).toMatch(/1 try on SPY \(file\) 1d so far/)
  expect(r).toMatch(/^Market data: your file SPY_1d\.csv$/m)
  expect(r).not.toMatch(/Hyperliquid|Binance|"deep"|across|funding [+-]/)
  expect(r).toMatch(/^Unseen costs: fees -[\d.]+% \(summed over trades\)\.$/m)
  expect(r.match(/^Next: /gm)?.length).toBe(1)
  expect(snapshots(w.requests)).toBe(before)
  // A second, different test on the same market counts as its second try there.
  expect(await call($, 'chart_test', { enter: 'rsi < 35', hold: 5, fee: 0.01, file: 'lab-charts/SPY_1d.csv', coin: 'spy' })).toMatch(/2 tries on SPY \(file\) 1d so far/)
  // One market only; no funding.
  expect(await call($, 'chart_test', { enter: 'rsi < 40', hold: 5, file: 'lab-charts/SPY_1d.csv', coin: 'SPY', coins: ['BTC', 'ETH'] })).toMatch(/^A test on a candle file runs on that one market\./)
  expect(await call($, 'chart_test', { enter: 'funding < 0', hold: 5, file: 'lab-charts/SPY_1d.csv', coin: 'SPY' })).toMatch(/funding is a crypto perp's/)
  // deep is ignored on a file: still the file, never Binance.
  expect(await call($, 'chart_test', { enter: 'rsi < 30', hold: 5, file: 'lab-charts/SPY_1d.csv', coin: 'SPY', deep: true })).toMatch(/^Test: SPY \(file\) 1d on your file SPY_1d\.csv/)
})

test('chart_test on a short candle file: too few candles said, with a longer export as the way on', async ($, on) => {
  world(on, csv(weekdays(150, MONDAY)))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(await call($, 'chart_test', { enter: 'rsi < 40', hold: 5, file: 'lab-charts/SPY_1d.csv', coin: 'SPY' })).toMatch(/^Test: SPY_1d\.csv has only 1\d\d closed candles.*Next: a longer export/)
})

test('chart_swarm on a candle file: rules on funding or open interest left out and said, the rest run on the file', async ($, on) => {
  const { w } = world(on, csv(weekdays(1200, MONDAY)))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const before = snapshots(w.requests)
  const rules = ['rsi < 35 hold 5', 'rsi > 65 hold 5 short', 'ema 20 crosses above ema 50 hold 10', 'funding < 0 hold 5', 'oi change 24 > 10 hold 5']
  const r = await call($, 'chart_swarm', { rules, file: 'lab-charts/SPY_1d.csv', coin: 'SPY', fee: 0.01 })
  expect(r).toMatch(/^Swarm: 3 rules on SPY \(file\) 1d on your file SPY_1d\.csv, /)
  expect(r).toMatch(/^Left out on SPY_1d\.csv \(funding and open interest are a crypto perp's\): funding < 0 hold 5 · oi change 24 > 10 hold 5\.$/m)
  expect(r).toMatch(/^Market data: your file SPY_1d\.csv$/m)
  expect(r).not.toMatch(/Hyperliquid|Binance|"deep"|pinned/)
  expect(r.match(/^Next: /gm)?.length).toBe(1)
  expect(snapshots(w.requests)).toBe(before)
  // Too few left once those are out.
  expect(await call($, 'chart_swarm', { rules: ['rsi < 35 hold 5', 'funding < 0 hold 5'], file: 'lab-charts/SPY_1d.csv', coin: 'SPY' })).toMatch(/^Swarm: only 1 rule to run on SPY_1d\.csv, 2 needed\. Left out on SPY_1d\.csv/)
})
