import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import { BAND, NOW, PANE, engine, typed } from './fixtures'

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

const ctxReads = (requests: string[]) => requests.filter(r => r.includes('metaAndAssetCtxs')).length

test('the band is off until /lab-watch; then four coins with price and 24h change', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const before = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await before.find({ type: 'Text' }))?.text).toBe('engine')
  await before.unmount()

  const r = await $.command.run(typed('lab-watch', ''))
  expect(r.text).toContain('Watchlist above the prompt: BTC, ETH, SOL, HYPE')
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)
    expect((await ui.find({ type: 'Button', key: 'coin-BTC' }))?.text).toBe('BTC 97,123 +1.2%')
    expect((await ui.find({ type: 'Button', key: 'coin-HYPE' }))?.text).toBe('HYPE 24.510 -3.0%')
    await ui.unmount()
  }
})

test('/lab-watch sets the coins (kept in the store), a narrow band is one cut line, off hides it', async ($, on) => {
  const w = engine(on)
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  const r = await $.command.run(typed('lab-watch', 'sol kpepe xyz'))
  expect(r.text).toContain('SOL, kPEPE, XYZ')
  expect(r.text).toContain('Not on Hyperliquid perps: XYZ.')
  expect(store.get('watch')).toEqual(['SOL', 'kPEPE', 'XYZ'])

  const narrow = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 30 } })
  expect((await narrow.find({ type: 'Text' }))?.text).toBe('SOL 182.35 +2.1% · kPEPE 0.012345 +2.0% · XYZ -')
  expect(await narrow.find({ type: 'Button' })).toBeUndefined()
  await narrow.unmount()

  const off = await $.command.run(typed('lab-watch', 'off'))
  expect(off.text).toContain('Watchlist off')
  expect(store.has('watch')).toBe(false)
  const gone = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await gone.find({ type: 'Text' }))?.text).toBe('engine')
  await gone.unmount()
  expect(w.opens).toHaveLength(0)
})

test('the band refreshes every 30 s at most, and stops after off', async ($, on) => {
  const w = engine(on)
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  await $.command.run(typed('lab-watch', 'BTC ETH'))
  const start = ctxReads(w.requests)
  await clock.advance(29_000)
  expect(ctxReads(w.requests)).toBe(start)
  await clock.advance(1_000)
  expect(ctxReads(w.requests)).toBe(start + 1)
  await $.command.run(typed('lab-watch', 'off'))
  const after = ctxReads(w.requests)
  await clock.advance(120_000)
  expect(ctxReads(w.requests)).toBe(after)
})

test('a watchlist from an earlier session comes back at start; a coin press opens its chart', async ($, on) => {
  const w = engine(on)
  mock.clock(on, { now: NOW })
  mock.store(on, { watch: ['ETH', 'SOL'] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(2)
  await ui.press({ key: 'coin-ETH' })
  await ui.unmount()
  expect(w.opens).toEqual(['lab-desk-chart'])
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await pane.find({ type: 'Text', text: /^ETH-PERP/ }))?.text).toContain('3,456.7')
  await pane.unmount()
})
