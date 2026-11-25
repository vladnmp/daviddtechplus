// Price alerts: /lab-alert, the chart tool's alerts, the 30 s check, one toast and notification each.

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import type { Market } from '../types'
import { alertText, hitAlerts, hitText, parseAlert } from '../hooks/alerts'
import { CHART_TOOL_NAME } from '../hooks/register'
import { NOW, engine, typed } from './fixtures'

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

test('typed alerts: coin, direction from where price is, past prices refused', async () => {
  expect(parseAlert('BTC above 65000', market, null, 1)).toEqual({ coin: 'BTC', dir: 'above', price: 65000, note: '', at: 1 })
  expect(parseAlert('sol 150 retest of the low', market, null, 1)).toEqual({ coin: 'SOL', dir: 'below', price: 150, note: 'retest of the low', at: 1 })
  expect(parseAlert('62k', market, 'BTC', 1)).toMatchObject({ coin: 'BTC', dir: 'above', price: 62000 })
  expect(parseAlert('BTC below 65000', market, null, 1)).toEqual({ error: 'BTC is already below 65,000 (now 60,000).' })
  expect(parseAlert('NOPE 5', market, null, 1)).toEqual({ error: 'No Hyperliquid perp named NOPE.' })
  expect('error' in parseAlert('BTC above', market, null, 1)).toBe(true)
  const set = [parseAlert('BTC above 61000', market, null, 1), parseAlert('SOL below 170', market, null, 1)].filter(
    (x): x is Exclude<typeof x, { error: string }> => !('error' in x),
  )
  const next: Market = { at: 1, coins: { BTC: ctx('BTC', 61002), SOL: ctx('SOL', 175) } }
  const r = hitAlerts(set, next)
  expect(r.hit.map(h => alertText(h.alert))).toEqual(['BTC above 61,000'])
  expect(r.left.map(alertText)).toEqual(['SOL below 170'])
  expect(hitText(set[0]!, 61002)).toBe('BTC is above 61,000: now 61,002.')
})

test('/lab-alert sets, lists, removes and clears; a reached alert is said once and dropped', async ($, on) => {
  const w = engine(on)
  const clock = mock.clock(on, { now: NOW })
  const store = memStore(on)
  const toasts: string[] = []
  const notes: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', (_, e) => {
    notes.push(e.text)
    return { value: { isSent: true, channel: 'client' as const } }
  })
  const price = w.price('BTC')
  const set = (await $.command.run(typed('lab-alert', `BTC above ${Math.round(price + 100)}`))).text ?? ''
  expect(set).toMatch(/^Alert set: BTC above [\d,]+\. The desk tells you once/)
  await $.command.run(typed('lab-alert', `BTC ${Math.round(price - 5000)} deep dip`))
  const list = (await $.command.run(typed('lab-alert', ''))).text ?? ''
  expect(list).toMatch(/1\. BTC above [\d,]+\n2\. BTC below [\d,]+ \(deep dip\)/)
  expect(store.get('alerts')).toHaveLength(2)
  expect((await $.command.run(typed('lab-alert', 'remove 2'))).text).toMatch(/^Removed BTC below/)
  // Price moves past the level: the next check says it once and drops it.
  w.setPrice('BTC', price + 200)
  await clock.advance(31_000)
  expect(toasts.filter(t => t.startsWith('Alert: BTC is above'))).toHaveLength(1)
  expect(notes.filter(t => t.startsWith('BTC is above'))).toHaveLength(1)
  expect(store.get('alerts')).toEqual([])
  await clock.advance(31_000)
  expect(toasts.filter(t => t.startsWith('Alert:'))).toHaveLength(1)
  for (const t of [set, list, ...toasts, ...notes]) expect(t).not.toMatch(/\b(buy|sell|signals?|targets?|edge)\b/i)
})

test('Claude sets alerts through the chart tool and sees them in its report', async ($, on) => {
  const w = engine(on)
  mock.clock(on, { now: NOW })
  memStore(on)
  on('tool.register', (_, e) => ({ value: { tool: `mcp__lab-desk__${e.name}` } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const p = w.price('BTC')
  const r = await $.tool.call({ tool: CHART_TOOL_NAME, coin: 'BTC', alerts: [{ price: Math.round(p * 1.1), note: 'range top' }, { price: Math.round(p * 0.5), direction: 'above' }] })
  const text = String(r.result ?? r.deny)
  expect(text).toMatch(/Alert set: BTC above [\d,]+ \(range top\)\./)
  expect(text).toMatch(/BTC is already above [\d,]+/)
  expect(text).toMatch(/Alerts waiting: BTC above [\d,]+ \(range top\)\./)
})
