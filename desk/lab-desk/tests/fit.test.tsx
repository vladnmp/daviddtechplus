// The terminal pane fits its rows: wrapped buttons are counted, and a cramped pane goes compact
// (set chips step aside, the connector hint takes two short lines) so the chart stays big.

import { expect, mock, test } from 'claude-code/testing'

import { buttonRows, textRows } from '../hooks/draw'
import { NOW, PANE, engine, typed } from './fixtures'

test('wrapped button rows and text rows are counted like the terminal draws them', () => {
  // "[ 5m ] [ 15m ] [ 1h ] [ 4h ] [ 1d ] [ < ] [ > ]" is 47 columns.
  expect(buttonRows(['5m', '15m', '1h', '4h', '1d', '<', '>'], 47)).toBe(1)
  expect(buttonRows(['5m', '15m', '1h', '4h', '1d', '<', '>'], 46)).toBe(2)
  expect(buttonRows(['Explain chart', 'Ask about BTC'], 50, 48)).toBe(2)
  expect(textRows('x'.repeat(101), 50)).toBe(3)
  expect(textRows('', 50)).toBe(1)
})

test('a cramped terminal pane goes compact; a roomy one keeps the set chips', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  const small = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 50, scroll: { offset: 0, bodyRows: 25 } } })
  const raster = await small.find({ type: 'Raster' })
  expect(Number(raster?.props?.rows ?? 0)).toBeGreaterThanOrEqual(12)
  expect(await small.find({ type: 'Button', text: /^Trend$/ })).toBeUndefined()
  expect(await small.find({ type: 'Button', text: /^Explain chart$/ })).toBeDefined()
  // Replay moved next to Explain chart; no lone row.
  expect(await small.find({ type: 'Button', text: /^Replay$/ })).toBeDefined()
  expect(await small.find({ type: 'Button', text: /^Last$/ })).toBeUndefined()
  // The header keeps whole pieces and the readout keeps the prices.
  const words = (await small.findAll({ type: 'Text' })).map(t => String(t.text ?? '')).join('\n')
  expect(words).not.toMatch(/…/)
  expect(words).toMatch(/O [\d,.]+ H [\d,.]+ L [\d,.]+ C [\d,.]+/)
  await small.unmount()
  const roomy = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 100, scroll: { offset: 0, bodyRows: 40 } } })
  expect(await roomy.find({ type: 'Button', text: /^Trend$/ })).toBeDefined()
  await roomy.unmount()
})
