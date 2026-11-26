import { expect, test } from 'claude-code/testing'

import {
  annualFundingPct,
  bandText,
  candleBody,
  changePct,
  fmtPct,
  fmtPrice,
  fundingText,
  intervalOf,
  parseCandles,
  parseMarket,
  refreshMs,
  resolveCoin,
  ageText,
  chartDataAt,
  fmtClock,
  isStale,
  statusText,
  watchArgs,
} from '../hooks/data'
import { CTX_FIXTURE, NOW, candlesFixture } from './fixtures'

/** Within a millionth, relative. */
function near(got: number | null | undefined, want: number) {
  expect(typeof got === 'number' && Math.abs(got - want) <= Math.abs(want) * 1e-6 + 1e-9).toBe(true)
}

test('candles: strings become numbers, oldest first, broken rows dropped', async () => {
  const raw = [
    { t: 2000, T: 2999, s: 'BTC', i: '1h', o: '101.5', c: '99.25', h: '102', l: '98.75', v: '12.5', n: 4 },
    { t: 1000, T: 1999, s: 'BTC', i: '1h', o: '100', c: '101.5', h: '101.75', l: '99.5', v: '3', n: 2 },
    { t: 3000, o: 'oops', c: '1', h: '1', l: '1', v: '1' },
    null,
  ]
  const candles = parseCandles(raw)
  expect(candles).toEqual([
    { t: 1000, o: 100, h: 101.75, l: 99.5, c: 101.5, v: 3 },
    { t: 2000, o: 101.5, h: 102, l: 98.75, c: 99.25, v: 12.5 },
  ])
  expect(typeof candles[0]?.o).toBe('number')
  expect(parseCandles({ error: 'x' })).toEqual([])
  expect(parseCandles(candlesFixture(60))).toHaveLength(60)
})

test('funding: hourly rate x 24 x 365, as a percentage', async () => {
  near(annualFundingPct(0.0000125), 10.95)
  near(annualFundingPct(-0.000005), -4.38)
  expect(fundingText(0.0000125)).toBe('funding +10.95%/yr')
  expect(fundingText(null)).toBe('funding -')
})

test('market: contexts line up with the universe, strings parsed', async () => {
  const m = parseMarket(CTX_FIXTURE, NOW)
  expect(m?.at).toBe(NOW)
  expect(m?.coins.BTC).toEqual({ coin: 'BTC', price: 97123, prevDay: 95930, funding: 0.0000125, openInterest: 25000.5, dayVolume: 2100000000 })
  expect(m?.coins.HYPE?.price).toBe(24.51)
  near(changePct(m?.coins.BTC), ((97123 - 95930) / 95930) * 100)
  expect(resolveCoin(m, 'btc')).toBe('BTC')
  expect(resolveCoin(m, 'KPEPE')).toBe('kPEPE')
  expect(resolveCoin(m, 'NOPE')).toBeNull()
  expect(parseMarket({}, NOW)).toBeNull()
})

test('intervals, refresh period and the candle request', async () => {
  expect(intervalOf('1H')).toBe('1h')
  expect(intervalOf('1M')).toBe('1M')
  expect(intervalOf('1m')).toBe('1m')
  expect(intervalOf('7h')).toBeNull()
  expect(refreshMs('1m')).toBe(15_000)
  expect(refreshMs('1h')).toBe(30_000)
  expect(refreshMs('1d')).toBe(60_000)
  const body = JSON.parse(candleBody('BTC', '1h', NOW, 10)) as { type: string; req: Record<string, unknown> }
  expect(body).toEqual({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '1h', startTime: NOW - 10 * 3_600_000, endTime: NOW } })
  // 5000 weeks back is before 1970, which Hyperliquid refuses: the start stays at 0.
  expect((JSON.parse(candleBody('BTC', '1w', NOW, 5000)) as { req: { startTime: number } }).req.startTime).toBe(0)
})

test('numbers as traders read them', async () => {
  expect(fmtPrice(97123)).toBe('97,123')
  expect(fmtPrice(3456.7)).toBe('3,456.7')
  expect(fmtPrice(182.35)).toBe('182.35')
  expect(fmtPrice(24.51)).toBe('24.510')
  expect(fmtPrice(0.012345)).toBe('0.012345')
  expect(fmtPct(1.2436)).toBe('+1.24%')
  expect(fmtPct(-0.4, 1)).toBe('-0.4%')
  expect(fmtPct(null)).toBe('-')
})

test('band text: price and 24h change per coin, cut to the width', async () => {
  const m = parseMarket(CTX_FIXTURE, NOW)
  const coins = ['BTC', 'ETH', 'SOL', 'HYPE']
  expect(bandText(coins, m, 200)).toBe('BTC 97,123 +1.2% · ETH 3,456.7 -0.4% · SOL 182.35 +2.1% · HYPE 24.510 -3.0%')
  const cut = bandText(coins, m, 30)
  expect(cut).toHaveLength(30)
  expect(cut.endsWith('…')).toBe(true)
  expect(bandText(['XYZ'], m, 80)).toBe('XYZ -')
  expect(bandText(coins, null, 80)).toBe('BTC - · ETH - · SOL - · HYPE -')
})

test('status line: READ-ONLY first, then as of, or stale after two refresh periods, or loading', async () => {
  const m = parseMarket(CTX_FIXTURE, NOW)
  expect(statusText('BTC', m?.coins.BTC, NOW, NOW + 30_000, 30_000)).toBe('Lab desk READ-ONLY · as of 12:00:00 UTC · BTC 97,123 +1.2% · funding +10.95%/yr')
  expect(statusText('BTC', m?.coins.BTC, NOW, NOW + 120_000, 30_000)).toBe('Lab desk READ-ONLY · stale 2m · BTC 97,123 +1.2% · funding +10.95%/yr')
  expect(statusText('BTC', undefined, null, 0, 30_000)).toBe('Lab desk READ-ONLY · loading · BTC -')
  expect(statusText('BTC', m?.coins.BTC, null, NOW, 30_000)).toBe('Lab desk READ-ONLY · loading · BTC -')
  expect(fmtClock(NOW + 3_723_000)).toBe('13:02:03')
  expect([ageText(45_000), ageText(125_000), ageText(3 * 3_600_000 + 5)]).toEqual(['45s', '2m', '3h'])
  // One missed refresh is not stale; two are.
  expect(isStale(30_000, 30_000)).toBe(false)
  expect(isStale(60_000, 30_000)).toBe(true)
  expect(isStale(null, 30_000)).toBe(false)
  // The chart's data is as old as the older of its candles and the market read.
  expect(chartDataAt(NOW, m)).toBe(NOW)
  expect(chartDataAt(NOW + 5, m)).toBe(NOW)
  expect(chartDataAt(NOW - 5, m)).toBe(NOW - 5)
  expect(chartDataAt(0, m)).toBeNull()
  expect(chartDataAt(NOW, null)).toBeNull()
})

test('watch arguments: upper-cased, de-duplicated, six at most', async () => {
  expect(watchArgs('btc, eth sol btc')).toEqual(['BTC', 'ETH', 'SOL'])
  expect(watchArgs('a b c d e f g h')).toHaveLength(6)
  expect(watchArgs('')).toEqual([])
})
