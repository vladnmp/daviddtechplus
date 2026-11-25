// Scan: one condition over the chart coin and the watchlist, on the latest candle, read-only and one request at a time.

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import { parseCandles } from '../hooks/data'
import { NAMED_SCANS, expandWords, parseScan, scanCandles, scanText } from '../hooks/scan'
import { parseWhenAlert } from '../hooks/alerts'
import type { Scan } from '../hooks/scan'
import { compute, parseSpec } from '../hooks/indicators'
import type { Spec } from '../hooks/indicators'
import { READ_TOOL_NAME } from '../hooks/register'
import { NOW, candlesFixture, engine, typed } from './fixtures'

function memStore(on: On): Map<string, unknown> {
  const m = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: m.get(e.key) }))
  on('store.set', (_, e) => {
    m.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    m.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...m.keys()] }))
  return m
}

const scan = (t: string) => {
  const s = parseScan(t)
  if ('error' in s) throw new Error(s.error)
  return s as Scan
}

test('short words read as Pine, and the condition reads back plainly', () => {
  expect(expandWords('rsi < 30')).toBe('ta.rsi(close, 14) < 30')
  expect(expandWords('EMA 20 crosses above ema 50')).toBe('ta.ema(close, 20) crosses above ta.ema(close, 50)')
  expect(expandWords('price > atr 10')).toBe('close > ta.atr(10)')
  expect(expandWords('ta.rsi(close, 7) > 70')).toBe('ta.rsi(close, 7) > 70')
  expect(scan('rsi < 30').text).toBe('ta.rsi(close, 14) < 30')
  expect(scan('rsi 7 >= 70 on 4h').interval).toBe('4h')
  expect(scan('close > ema 200').op).toBe('>')
  expect(scan('ema 20 crosses below ema 50').op).toBe('crosses below')
  for (const bad of ['', 'rsi', 'nope < 3', '30 < 40', 'rsi < ', 'eval(1) > 2']) expect('error' in parseScan(bad)).toBe(true)
})

test('the latest candle decides, with the same RSI as the chart', () => {
  const c = parseCandles(candlesFixture(300))
  const rsi = compute(parseSpec('rsi 14') as Spec, c).series[0]?.values.at(-1) as number
  const hit = scanCandles(scan('rsi < 101'), c)
  expect(hit?.match).toBe(true)
  expect(Math.abs((hit?.left ?? 0) - rsi) < 1e-9).toBe(true)
  expect(scanCandles(scan('rsi > 101'), c)?.match).toBe(false)
  // Too few candles for a 200 EMA: no answer rather than a wrong one.
  expect(scanCandles(scan('close > ema 200'), c.slice(0, 50))).toBeNull()
  // A cross needs the candle before on the other side.
  const up = c.map((k, i) => ({ ...k, c: i === c.length - 1 ? 1e9 : 1 }))
  expect(scanCandles(scan('close crosses above 2'), up)?.match).toBe(true)
  expect(scanCandles(scan('close crosses above 2'), up.slice(0, -1))?.match).toBe(false)
})

test('/lab-scan checks the chart coin and the watchlist and names the matches', async ($, on) => {
  // SOL falls hard on its last candles, so only SOL's RSI is low.
  const candles = (coin: string) =>
    candlesFixture().map((r, i, all) => (coin === 'SOL' && i > all.length - 15 ? { ...r, o: '100', h: '100', l: '40', c: String(90 - 3 * (i - all.length + 15)) } : r))
  const w = engine(on, { candles })
  mock.clock(on, { now: NOW })
  memStore(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  await $.command.run(typed('lab-watch', 'ETH SOL'))
  const before = w.requests.length
  const text = (await $.command.run(typed('lab-scan', 'rsi < 30'))).text ?? ''
  expect(text).toMatch(/^Scan: ta\.rsi\(close, 14\) < 30 on 1h, latest candle, 3 coins\./)
  expect(text).toMatch(/\nMatches: SOL \([\d.]+ vs 30\.00\)\./)
  expect(text).toMatch(/\nNot now: BTC \([\d.]+ vs 30\.00\), ETH /)
  expect(text).toMatch(/\nNext: \/lab-chart SOL 1h opens it/)
  const asked = w.requests.slice(before).map(b => JSON.parse(b) as { type: string; req?: { coin: string } })
  expect(asked.filter(b => b.type === 'candleSnapshot').map(b => b.req?.coin)).toEqual(['BTC', 'ETH', 'SOL'])
  // A second scan inside a minute reuses the candles.
  const again = w.requests.length
  await $.command.run(typed('lab-scan', 'rsi > 70'))
  expect(w.requests.slice(again).filter(b => b.includes('candleSnapshot')).length).toBe(0)
  // Claude scans through chart_read.
  const r = String((await $.tool.call({ tool: READ_TOOL_NAME, scan: 'close > ema 20 on 4h' })).result ?? '')
  expect(r).toMatch(/^Scan: close > ta\.ema\(close, 20\) on 4h/)
  // In bar replay the scan waits: live candles would give it away.
  await $.command.run(typed('lab-chart', 'replay 10'))
  expect((await $.command.run(typed('lab-scan', 'rsi < 30'))).text).toMatch(/^The scan waits while bar replay is on/)
  expect(text + r).not.toMatch(/\b(buy|sell|signals?|targets?|edge)\b/i)
})

test('scans by name: oversold, uptrend, golden cross, in scans and alerts', () => {
  expect(scan('oversold')).toMatchObject({ text: 'ta.rsi(close, 14) < 30', name: 'oversold', interval: null })
  expect(scan('Golden  Cross on 1d')).toMatchObject({ text: 'ta.sma(close, 50) crosses above ta.sma(close, 200)', name: 'golden cross', interval: '1d' })
  expect(scan('downtrend').text).toBe('close < ta.ema(close, 200)')
  for (const name of Object.keys(NAMED_SCANS)) expect('error' in parseScan(name)).toBe(false)
  expect(scanText(scan('overbought 4h'), '4h', [{ coin: 'BTC', hit: { match: true, left: 75, right: 70 } }])).toMatch(/^Scan: overbought \(ta\.rsi\(close, 14\) > 70\) on 4h/)
  expect(('error' in parseScan('') ? parseScan('') as { error: string } : { error: '' }).error).toMatch(/or by name: oversold, overbought/)
  const market = { at: 0, coins: { SOL: { coin: 'SOL', price: 180, prevDay: 180, funding: null, openInterest: null, dayVolume: null } } }
  expect(parseWhenAlert('SOL oversold', market, 'BTC', '1h', 1)).toMatchObject({ coin: 'SOL', when: 'ta.rsi(close, 14) < 30', interval: '1h' })
  expect(parseWhenAlert('uptrend on 4h', market, 'BTC', '1h', 1)).toMatchObject({ coin: 'BTC', when: 'close > ta.ema(close, 200)', interval: '4h' })
})
