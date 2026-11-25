// Condition alerts: "/lab-alert SOL rsi < 30" reads like /lab-scan, waits on the latest candle and is said once.

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import type { Market } from '../types'
import { MAX_WHEN, alertText, parseWhenAlert } from '../hooks/alerts'
import { CHART_TOOL_NAME } from '../hooks/register'
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

const ctx = (coin: string, price: number) => ({ coin, price, prevDay: price, funding: null, openInterest: null, dayVolume: null })
const market: Market = { at: 0, coins: { BTC: ctx('BTC', 60000), SOL: ctx('SOL', 180) } }
const banned = /\b(buy|sell|signals?|targets?|edge)\b/i

test('a condition reads as a condition alert; a price stays a price alert', () => {
  expect(parseWhenAlert('BTC > 65000', market, null, null, 1)).toBeNull()
  expect(parseWhenAlert('SOL 200', market, null, null, 1)).toBeNull()
  expect(parseWhenAlert('65000', market, 'BTC', '1h', 1)).toBeNull()
  const a = parseWhenAlert('SOL rsi < 30', market, 'BTC', '4h', 1)
  expect(a).toMatchObject({ coin: 'SOL', when: 'ta.rsi(close, 14) < 30', interval: '4h' })
  expect(alertText(a as never)).toBe('SOL when ta.rsi(close, 14) < 30 on 4h')
  // No coin named: the chart's coin; an interval in the words wins over the chart's.
  expect(parseWhenAlert('ema 20 crosses above ema 50 on 1d', market, 'BTC', '1h', 1)).toMatchObject({ coin: 'BTC', interval: '1d', when: 'ta.ema(close, 20) crosses above ta.ema(close, 50)' })
  expect((parseWhenAlert('SOL rsi < eval(1)', market, null, null, 1) as { error: string }).error).toMatch(/^Alert: /)
  // A coin whose name starts like a condition word is still a coin.
  const odd: Market = { at: 0, coins: { ...market.coins, MOMO: ctx('MOMO', 1), ROCKET: ctx('ROCKET', 1) } }
  expect(parseWhenAlert('MOMO rsi < 30', odd, 'BTC', '1h', 1)).toMatchObject({ coin: 'MOMO' })
  expect(parseWhenAlert('rocket close > 2', odd, 'BTC', '1h', 1)).toMatchObject({ coin: 'ROCKET' })
  expect(parseWhenAlert('mom > 0', odd, 'BTC', '1h', 1)).toMatchObject({ coin: 'BTC', when: 'ta.mom(close, 10) > 0' })
})

test('Claude removes alerts by coin and clears them through the chart tool', async ($, on) => {
  const w = engine(on)
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  on('tool.register', (_, e) => ({ value: { tool: `mcp__lab-desk__${e.name}` } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  const p = w.price('BTC')
  await $.tool.call({ tool: CHART_TOOL_NAME, alerts: [{ price: Math.round(p * 1.2) }, { coin: 'SOL', when: 'close > 500000' }] })
  expect(store.get('alerts')).toHaveLength(2)
  const r = String((await $.tool.call({ tool: CHART_TOOL_NAME, remove_alerts: ['sol'] })).result ?? '')
  expect(r).toMatch(/Removed SOL when close > 500000 on 1h\./)
  expect(store.get('alerts')).toHaveLength(1)
  expect(String((await $.tool.call({ tool: CHART_TOOL_NAME, remove_alerts: ['ETH'] })).result ?? '')).toMatch(/No alerts on ETH\./)
  expect(String((await $.tool.call({ tool: CHART_TOOL_NAME, clear_alerts: true })).result ?? '')).toMatch(/1 alert cleared\./)
  expect(store.get('alerts')).toEqual([])
})

test('/lab-alert waits for a condition, says it once, and refuses one already true', async ($, on) => {
  let jump = false
  const candles = (coin: string) => candlesFixture().map((r, i, all) => (jump && coin === 'SOL' && i === all.length - 1 ? { ...r, h: '1000000', c: '999999' } : r))
  engine(on, { candles })
  const clock = mock.clock(on, { now: NOW })
  const store = memStore(on)
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', () => ({ value: { isSent: true, channel: 'client' as const } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  const set = (await $.command.run(typed('lab-alert', 'SOL close > 500000'))).text ?? ''
  expect(set).toMatch(/^Alert set: SOL when close > 500000 on 1h\. Now [\d,.]+ vs 500,000\. Checked every 30 s/)
  // Already true: refused, like a price already past.
  const already = (await $.command.run(typed('lab-alert', 'SOL close > 1'))).text ?? ''
  expect(already).toMatch(/^SOL: close > 1 on 1h is already true/)
  expect(store.get('alerts')).toHaveLength(1)
  // Condition alerts draw no line on the chart.
  const list = (await $.command.run(typed('lab-alert', ''))).text ?? ''
  expect(list).toMatch(/1\. SOL when close > 500000 on 1h/)
  // Not yet: nothing said.
  await clock.advance(31_000)
  expect(toasts.filter(t => t.startsWith('Alert:'))).toHaveLength(0)
  // SOL jumps; after the minute cache the next check says it once and drops it.
  jump = true
  await clock.advance(61_000)
  expect(toasts.filter(t => t.startsWith('Alert: SOL: close > 500000 on 1h is true now'))).toHaveLength(1)
  expect(store.get('alerts')).toEqual([])
  await clock.advance(61_000)
  expect(toasts.filter(t => t.startsWith('Alert:'))).toHaveLength(1)
  for (const t of [set, already, list, ...toasts]) expect(t).not.toMatch(banned)
})

test(`up to ${MAX_WHEN} condition alerts; in replay they wait; Claude sets one through the chart tool`, async ($, on) => {
  let jump = false
  const candles = (coin: string) => candlesFixture().map((r, i, all) => (jump && coin === 'BTC' && i === all.length - 1 ? { ...r, h: '1000000', c: '999999' } : r))
  engine(on, { candles })
  const clock = mock.clock(on, { now: NOW })
  memStore(on)
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', () => ({ value: { isSent: true, channel: 'client' as const } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__lab-desk__${e.name}` } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  const r = String((await $.tool.call({ tool: CHART_TOOL_NAME, alerts: [{ when: 'close > 500000' }] })).result ?? '')
  expect(r).toMatch(/Alert set: BTC when close > 500000 on 1h\./)
  await $.command.run(typed('lab-alert', 'close > 600000'))
  await $.command.run(typed('lab-alert', 'close > 700000'))
  expect((await $.command.run(typed('lab-alert', 'close > 800000'))).text).toMatch(new RegExp(`^${MAX_WHEN} condition alerts at most; /lab-alert remove 1 makes room\.`))
  // In bar replay the condition comes true but waits until the chart is live again.
  await $.command.run(typed('lab-chart', 'replay 10'))
  jump = true
  await clock.advance(61_000)
  expect(toasts.filter(t => t.startsWith('Alert:'))).toHaveLength(0)
  await $.command.run(typed('lab-chart', 'replay off'))
  await clock.advance(31_000)
  expect(toasts.filter(t => t.startsWith('Alert: BTC: close > 500000'))).toHaveLength(1)
  expect(r).not.toMatch(banned)
})
