import { expect, mock, test } from 'claude-code/testing'

import { DATA_LINE } from '../hooks/data'
import { NOW, PANE, engine, typed } from './fixtures'

const candleReads = (requests: string[]) => requests.filter(r => r.includes('candleSnapshot')).length

test('/lab-chart opens the pane: header, price, funding, Raster on the terminal, Svg elsewhere', async ($, on) => {
  const w = engine(on)
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await $.command.run(typed('lab-chart', 'btc 1h'))
  expect(w.opens).toEqual(['lab-desk-chart'])
  expect(r.text).toContain('BTC 1h chart open, refreshing every 30 s.')
  expect(r.text).toContain('funding +10.95%/yr')
  expect(r.text).toContain('Next: /lab-watch')
  expect(w.statuses.at(-1)).toBe('Lab desk READ-ONLY · as of 12:00:00 UTC · BTC 97,123 +1.2% · funding +10.95%/yr')

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const raster = await term.find({ type: 'Raster' })
  expect(raster?.props.columns).toBe(100)
  expect(Number(raster?.props.rows)).toBeGreaterThanOrEqual(20)
  expect((await term.find({ type: 'Text', text: /^BTC-PERP/ }))?.text).toContain('funding +10.95%/yr')
  expect(await term.find({ type: 'Text', text: /^last · / })).toBeDefined()
  expect((await term.find({ type: 'Text', text: /Market data/ }))?.text).toBe(`READ-ONLY · as of 12:00:00 UTC · ${DATA_LINE}`)
  expect(await term.find({ type: 'Button', key: 'iv-1h' })).toBeDefined()
  await term.unmount()

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const svg = await ui.find({ type: 'Svg' })
    expect(String(svg?.props.source).startsWith('<svg')).toBe(true)
    expect(String(svg?.props.alt)).toContain('BTC 1h candle chart')
    expect((await ui.find({ type: 'Text', text: /Market data/ }))?.text).toContain(DATA_LINE)
    await ui.unmount()
  }
})

test('a narrow pane says so instead of drawing; a wide one draws wide', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.command.run(typed('lab-chart', 'BTC'))
  const narrow = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 16 } })
  expect(await narrow.find({ type: 'Raster' })).toBeUndefined()
  expect(await narrow.find({ type: 'Text', text: /too small for the chart/ })).toBeDefined()
  await narrow.unmount()
  const wide = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 240, scroll: { offset: 0, bodyRows: 60 } } })
  const raster = await wide.find({ type: 'Raster' })
  expect(raster?.props.columns).toBe(240)
  expect(raster?.props.rows).toBe(40)
  await wide.unmount()
})

test('the cursor buttons move the readout back and forth', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.command.run(typed('lab-chart', 'BTC'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'back' })
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Text', text: /^2 back · / })).toBeDefined()
  await ui.press({ key: 'fwd' })
  expect(await ui.find({ type: 'Text', text: /^1 back · / })).toBeDefined()
  await ui.press({ key: 'last' })
  expect(await ui.find({ type: 'Text', text: /^last · / })).toBeDefined()
  await ui.unmount()
})

test('refresh runs on the clock while the pane is up and stops when /lab-chart close closes it', async ($, on) => {
  const w = engine(on)
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  const first = candleReads(w.requests)
  expect(first).toBe(1)
  await clock.advance(30_000)
  expect(candleReads(w.requests)).toBe(2)
  await clock.advance(30_000)
  expect(candleReads(w.requests)).toBe(3)

  expect((await $.command.run(typed('lab-chart', 'close'))).text).toBe('Chart pane closed.')
  expect(w.closes).toEqual(['lab-desk-chart'])
  expect(w.statuses.at(-1)).toBeUndefined()
  await clock.advance(300_000)
  expect(candleReads(w.requests)).toBe(3)
})

test('a pane the person closed (gone from the pane list) stops the refresh at the next tick', async ($, on) => {
  const w = engine(on)
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  await $.command.run(typed('lab-chart', 'BTC 5m'))
  expect(candleReads(w.requests)).toBe(1)
  w.isOpen = false
  await clock.advance(15_000)
  await clock.advance(120_000)
  expect(candleReads(w.requests)).toBe(1)
})

test('close, an unknown coin and an unreachable API each answer in a line', async ($, on) => {
  const w = engine(on)
  mock.clock(on, { now: NOW })
  mock.store(on)
  expect((await $.command.run(typed('lab-chart', 'NOPE'))).text).toBe('No perp named NOPE on Hyperliquid. Try BTC, ETH, SOL or HYPE.')
  expect(w.opens).toHaveLength(0)
  expect((await $.command.run(typed('lab-chart', 'close'))).text).toBe('Chart pane closed.')
  expect((await $.command.run(typed('lab-chart', 'BTC ETH SOL'))).text).toContain('Usage: /lab-chart')
})

test('Hyperliquid down: the command says so and opens nothing', async ($, on) => {
  const w = engine(on, { isFetchDown: true })
  mock.clock(on, { now: NOW })
  mock.store(on)
  const r = await $.command.run(typed('lab-chart', 'BTC'))
  expect(r.text).toContain('Hyperliquid could not be reached (Hyperliquid answered 503)')
  expect(w.opens).toHaveLength(0)
})

test('switching interval while a refresh runs: the new interval still loads when that refresh ends', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on, { delay: body => (body.includes('"interval":"4h"') ? clock.sleep(5_000) : undefined) })
  mock.store(on)
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  const slow = $.command.run(typed('lab-chart', 'BTC 4h'))
  await clock.settle()
  await $.command.run(typed('lab-chart', 'BTC 15m'))
  expect(w.requests.some(r => r.includes('"interval":"15m"'))).toBe(false)
  await clock.advance(5_000)
  await slow
  expect(w.requests.some(r => r.includes('"interval":"15m"'))).toBe(true)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Loading candles/ })).toBeUndefined()
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  await ui.unmount()
})

test('a refresh that never answers does not freeze the chart: after 45 s the next tick starts a new one', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let held = 0
  const w = engine(on, {
    delay: body => (body.includes('candleSnapshot') && candleReads(w.requests) === 2 && held++ === 0 ? clock.sleep(3_600_000) : undefined),
  })
  mock.store(on)
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  expect(candleReads(w.requests)).toBe(1)
  await clock.advance(30_000)
  expect(candleReads(w.requests)).toBe(2)
  await clock.advance(30_000)
  expect(candleReads(w.requests)).toBe(2)
  await clock.advance(30_000)
  expect(candleReads(w.requests)).toBe(3)
})
