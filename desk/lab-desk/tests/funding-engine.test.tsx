// Funding in a condition on the engine: /lab-after reads funding only when the condition names it, a scan refuses it
// in plain words, and /lab-chart reset also stops the TradingView reading and forgets the wallet.

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import { NOW, candlesFixture, engine, typed } from './fixtures'

const H = 3_600_000
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

const banned = /\b(buy|buying|sell|selling|signals?|targets?|edge|expected move)\b/i

/** Hourly funding from `start` to NOW, 500 a page: negative every 5th hour, else a little positive. */
function fundingPages(starts: number[]) {
  return (_coin: string, start: number) => {
    starts.push(start)
    const rows: Record<string, unknown>[] = []
    for (let t = Math.ceil(start / H) * H; t < NOW && rows.length < 500; t += H) rows.push({ coin: 'BTC', fundingRate: (t / H) % 5 === 0 ? '-0.00002' : '0.0000125', premium: '0', time: t })
    return rows
  }
}

test('/lab-after funding < 0 reads funding and finds the cases; rsi alone never reads it; a scan says where funding works', async ($, on) => {
  const starts: number[] = []
  engine(on, { candles: () => candlesFixture(400), funding: fundingPages(starts) })
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(typed('lab-after', 'rsi < 50'))
  expect(starts).toEqual([])
  const text = (await $.command.run(typed('lab-after', 'funding < 0'))).text ?? ''
  expect(starts.length).toBeGreaterThan(0)
  expect(text).toMatch(/^History: BTC 1h, funding < 0, then 10 candles on\. \d+ cases/)
  expect(text).toMatch(/^After: median /m)
  expect(text).not.toMatch(banned)
  const scan = (await $.command.run(typed('lab-scan', 'funding > 20'))).text ?? ''
  expect(scan).toMatch(/"funding" works in the history lab/)
})

test('/lab-chart reset stops reading TradingView alerts and forgets the link, the alerts and the wallet', async ($, on) => {
  const hook = `https://vlad-64070--daviddtech-plus-tv.modal.run/tv/0123456789abcdef0123${'AbCdEfGhIjKlMnOpQrStUv_-'}`
  const w = engine(on, { feed: () => ({ status: 200, body: { ok: true, alerts: [{ id: '1', at: NOW - 2 * H, name: 'x', interval: '1h', side: 'long', coin: 'BTC' }] } }), candles: () => candlesFixture(400) })
  const clock = mock.clock(on, { now: NOW })
  const store = memStore(on)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'client' as const } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(typed('lab-tv', `link ${hook}`))
  await $.command.run(typed('lab-trades', `0x${'cd'.repeat(20)}`))
  expect((await $.command.run(typed('lab-chart', 'reset'))).text ?? '').toMatch(/^Desk reset: /)
  const before = w.fetches.filter(f => f.includes('/tv/')).length
  await clock.advance(5 * 61_000)
  expect(w.fetches.filter(f => f.includes('/tv/')).length).toBe(before)
  expect((await $.command.run(typed('lab-tv', ''))).text ?? '').toMatch(/^TradingView alerts: off\./)
  expect((await $.command.run(typed('lab-trades', ''))).text ?? '').toMatch(/^Your trades on the chart: \/lab-trades 0x…/)
  expect([...store.keys()]).toEqual([])
})
