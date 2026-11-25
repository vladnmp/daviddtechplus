// The same test across coins: each coin's unseen part, each coin a try on that coin, and a luck line for the group
// that knows how many coins were tried.

import { expect, mock, test } from 'claude-code/testing'

import { NOW, candlesFixture, engine, typed } from './fixtures'
import { binomTail } from '../hooks/honest'
import { parseTest } from '../hooks/honest'
import { parseTestWords, testWords } from '../hooks/register'

test('binomTail: the chance at least k of m pass a 5% bar by luck', () => {
  expect(binomTail(0, 5, 0.05)).toBe(1)
  expect(Math.abs(binomTail(1, 1, 0.05) - 0.05) < 1e-12).toBe(true)
  // At least one of 5 by luck: 1 - 0.95^5, about 23%.
  expect(Math.abs(binomTail(1, 5, 0.05) - (1 - 0.95 ** 5)) < 1e-12).toBe(true)
  // Two of 5: about 2.3%.
  expect(Math.round(binomTail(2, 5, 0.05) * 1000)).toBe(23)
  expect(binomTail(5, 5, 0.05)).toBeLessThan(1e-6)
})

test('"across BTC ETH SOL" in the command words is the coin list, with or without an interval after it', () => {
  expect(parseTestWords('rsi < 30 exit rsi > 50 across BTC ETH SOL')).toMatchObject({ enter: 'rsi < 30', exit: 'rsi > 50', coins: ['BTC', 'ETH', 'SOL'] })
  expect(parseTestWords('rsi < 30 exit rsi > 50 across btc, eth on 4h')).toMatchObject({ exit: 'rsi > 50', coins: ['btc', 'eth'], interval: '4h' })
  expect(parseTestWords('rsi > 70 hold 12 short across BTC ETH')).toMatchObject({ enter: 'rsi > 70', hold: 12, side: 'short', coins: ['BTC', 'ETH'] })
  expect(parseTestWords('rsi < 30 exit rsi > 50')?.coins).toBe(undefined)
  // Side, hold and fee after the coins are still side, hold and fee.
  expect(parseTestWords('rsi > 70 exit rsi < 50 across BTC ETH short')).toMatchObject({ side: 'short', coins: ['BTC', 'ETH'] })
  expect(parseTestWords('rsi < 30 across BTC ETH hold 12 fee 0.02 on 4h')).toMatchObject({ enter: 'rsi < 30', hold: 12, fee: 0.02, coins: ['BTC', 'ETH'], interval: '4h' })
})

test('the words a Next line suggests give back the same test', () => {
  for (const said of ['rsi < 30 exit rsi > 50', 'rsi > 70 hold 12 short', 'ema 20 crosses above ema 50 exit ema 20 crosses below ema 50 hold 30 fee 0.02', 'close > ema 200 and rsi < 40 hold 5']) {
    const w = parseTestWords(said)
    const spec = parseTest(w as NonNullable<typeof w>)
    if ('error' in spec) throw new Error(spec.error)
    const again = parseTest(parseTestWords(testWords(spec)) as NonNullable<typeof w>)
    if ('error' in again) throw new Error(again.error)
    expect(JSON.stringify({ ...again, enter: again.enter.text, exit: again.exit?.text })).toBe(JSON.stringify({ ...spec, enter: spec.enter.text, exit: spec.exit?.text }))
  }
})

test('/lab-test across coins: a line per coin, unknown names said, each coin a try on itself, nothing pinned', async ($, on) => {
  engine(on, { candles: () => candlesFixture(400) })
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const run = async (args: string) => (await $.command.run(typed('lab-test', args))).text ?? ''
  const text = await run('rsi < 50 exit rsi > 55 across BTC ETH NOPE')
  expect(text).toMatch(/^Test across 3 coins on 1h: long, enter when rsi < 50, exit when rsi > 55\./)
  expect(text).toMatch(/^· NOPE: no Hyperliquid perp by that name\.$/m)
  expect(text).toMatch(/^· BTC: /m)
  expect(text).toMatch(/^· ETH: /m)
  expect(text).toMatch(/Made money on the unseen part on \d of 2 coins\./)
  expect(text).toMatch(/^Luck check: /m)
  expect(text).toMatch(/^Next: one coin on its own pins its unseen trades/m)
  expect(text).not.toMatch(/pinned on the chart \(layer/)
  // Each coin counted the test as a try on itself: the same test on BTC alone is still its first, a new one its second.
  expect(await run('rsi < 50 exit rsi > 55 on 1h')).toMatch(/1 try on BTC 1h so far/)
  expect(await run('rsi < 45 exit rsi > 55 on 1h')).toMatch(/2 tries on BTC 1h so far/)
  expect(await run('rsi < 50 exit rsi > 55 across ETH SOL')).toMatch(/^· ETH: .*\(1 try\)\.$/m)
})

test('a coin named twice runs once', async ($, on) => {
  engine(on, { candles: () => candlesFixture(400) })
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const text = (await $.command.run(typed('lab-test', 'rsi < 50 hold 5 across BTC ETH SOL HYPE BTC'))).text ?? ''
  // Duplicates count once: 4 coins.
  expect(text).toMatch(/^Test across 4 coins on 1h/)
  expect(text).not.toMatch(/left out/)
})

/** Hourly funding rows from `start` to NOW, 500 a page as Hyperliquid answers; `busyAfter` pages answer 429 after that many. */
function fundingPages(busyAfter: number | null) {
  let pages = 0
  return (_coin: string, start: number) => {
    pages++
    if (busyAfter !== null && pages > busyAfter) return null
    const rows: Record<string, unknown>[] = []
    for (let t = Math.ceil(start / 3_600_000) * 3_600_000; t < NOW && rows.length < 500; t += 3_600_000) rows.push({ coin: 'BTC', fundingRate: '0.0000125', premium: '0', time: t })
    return rows
  }
}

test('a funding read cut short by a busy Hyperliquid is said, never passed off as all of it', async ($, on) => {
  // 1100 hourly candles: 3 funding pages; Hyperliquid answers the first and then is busy.
  engine(on, { candles: () => candlesFixture(1100), funding: fundingPages(1) })
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const one = (await $.command.run(typed('lab-test', 'rsi < 50 exit rsi > 55'))).text ?? ''
  expect(one).toMatch(/Hyperliquid was busy, so the latest hours count none; ask again in a minute/)
  const across = (await $.command.run(typed('lab-test', 'rsi < 50 exit rsi > 55 across ETH SOL'))).text ?? ''
  expect(across).toMatch(/^· ETH: Hyperliquid was busy and its funding could not all be read; ask again in a minute\.$/m)
})

test('across coins reads funding from the unseen part only; a full read is not flagged', async ($, on) => {
  const starts: number[] = []
  const pages = fundingPages(null)
  engine(on, { candles: () => candlesFixture(400), funding: (coin, start) => (starts.push(start), pages(coin, start)) })
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const text = (await $.command.run(typed('lab-test', 'rsi < 50 exit rsi > 55 across BTC ETH'))).text ?? ''
  expect(text).not.toMatch(/busy/)
  // 400 hourly candles: the unseen part is the last ~30%, so the first funding page starts well after the first candle.
  expect(Math.min(...starts)).toBeGreaterThan(NOW - 200 * 3_600_000)
  const single = (await $.command.run(typed('lab-test', 'rsi < 50 exit rsi > 55 on 1h'))).text ?? ''
  expect(single).not.toMatch(/busy/)
  expect(single).toMatch(/funding from \d{4}-\d\d-\d\d on\./)
})
