// The desk is read-only (MiCA: DaviddTech never trades or holds member funds), and trying it leaves nothing:
// /lab-chart reset wipes everything it saved.

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import { INFO_URL } from '../hooks/data'
import { BAND, BRIEF_FIXTURE, NOW, PANE, engine, typed } from './fixtures'

/** $.store beneath the plugin, readable by the test. */
function memStore(on: On, start: Record<string, unknown> = {}): Map<string, unknown> {
  const m = new Map(Object.entries(start))
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

const READ_TYPES = ['candleSnapshot', 'metaAndAssetCtxs', 'fundingHistory']

test('read-only: every request is a public read of the info API, and the only DaviddTech+ call is analyze_asset', async ($, on) => {
  const w = engine(on, {
    tools: ['mcp__daviddtechplus__analyze_asset'],
    mcp: () => ({ content: [{ type: 'text', text: 'brief' }], isError: false, structuredContent: BRIEF_FIXTURE }),
  })
  const clock = mock.clock(on, { now: NOW })
  memStore(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  await $.command.run(typed('lab-chart', 'ETH 15m'))
  await $.command.run(typed('lab-watch', 'BTC ETH SOL'))
  // The scan reads candles for every watchlist coin: still only public reads.
  expect((await $.command.run(typed('lab-scan', 'rsi < 30'))).text).toMatch(/^Scan: /)
  // History questions and the honest test read years of candles and funding: still only public reads.
  expect((await $.command.run(typed('lab-after', 'rsi < 50'))).text).toMatch(/^History: /)
  expect((await $.command.run(typed('lab-like', ''))).text).toMatch(/^Moments like now/)
  expect((await $.command.run(typed('lab-test', 'rsi < 50 exit rsi > 55'))).text).toMatch(/^Test: /)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (const key of ['iv-4h', 'back', 'fwd', 'last']) await pane.press({ key })
  await pane.unmount()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'coin-SOL' })
  await band.unmount()
  await clock.advance(5 * 60_000)
  await $.command.run(typed('lab-watch', 'off'))
  await $.command.run(typed('lab-chart', 'close'))

  expect(w.fetches.length).toBeGreaterThan(5)
  expect(new Set(w.fetches)).toEqual(new Set([`POST ${INFO_URL}`]))
  const types = new Set(w.requests.map(body => (JSON.parse(body) as { type: string }).type))
  expect([...types].every(type => READ_TYPES.includes(type))).toBe(true)
  expect(new Set(w.mcpCalls.map(c => c.tool))).toEqual(new Set(['analyze_asset']))
})

test('READ-ONLY shows in the status line and the pane footer on every surface', async ($, on) => {
  const w = engine(on)
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  expect(w.statuses.at(-1)?.startsWith('Lab desk READ-ONLY · ')).toBe(true)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^READ-ONLY · / }))?.text).toMatch(/^READ-ONLY · as of 12:00:00 UTC · /)
    await ui.unmount()
  }
})

test('/lab-chart reset closes the pane, turns the watchlist off and wipes every saved key', async ($, on) => {
  const w = engine(on, {
    tools: ['mcp__daviddtechplus__analyze_asset'],
    mcp: () => ({ content: [{ type: 'text', text: 'brief' }], isError: false, structuredContent: BRIEF_FIXTURE }),
  })
  const clock = mock.clock(on, { now: NOW })
  const store = memStore(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  await $.command.run(typed('lab-watch', 'BTC ETH'))
  expect([...store.keys()].sort()).toEqual(['forecast:BTC:5', 'watch'])

  const answer = await $.command.run(typed('lab-chart', 'reset'))
  expect(answer.text).toBe('Desk reset: chart closed, watchlist off, 2 saved items wiped. The desk keeps nothing now.')
  expect(store.size).toBe(0)
  expect(w.closes).toContain('lab-desk-chart')
  expect(w.statuses.at(-1)).toBeUndefined()

  // Nothing refreshes after a reset, and the band is gone.
  const before = w.requests.length
  await clock.advance(5 * 60_000)
  expect(w.requests.length).toBe(before)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.findAll({ type: 'Button' })).toHaveLength(0)
  await band.unmount()

  // A new session after a reset starts with no watchlist.
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(w.requests.length).toBe(before)
})
