// Layers: Claude paints its own results on the chart (a line, pins, spans), kept per coin across sessions.

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import type { Candle } from '../types'
import { deskCells } from '../hooks/cells'
import { MAX_LAYERS, addLayers, alignPoints, inkOf, layerMarks, layerStudies, layersFromStore, removeLayers, timeOf } from '../hooks/layers'
import { CHART_TOOL_NAME, READ_TOOL_NAME } from '../hooks/register'
import { deskSvg } from '../hooks/svg'
import { NOW, PANE, engine } from './fixtures'

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

const HOUR = 3_600_000
const T0 = Date.UTC(2026, 10, 10, 0, 0, 0)
const candles: Candle[] = Array.from({ length: 80 }, (_, i) => {
  const c = 100 + Math.sin(i / 6) * 8
  return { t: T0 + i * HOUR, o: c - 0.5, h: c + 2, l: c - 2, c, v: 10 }
})

test('times, colors and lining points up with candles', () => {
  expect(timeOf('2026-11-10T03:00')).toBe(T0 + 3 * HOUR)
  expect(timeOf('2026-11-10T03:00Z')).toBe(T0 + 3 * HOUR)
  expect(timeOf(T0 / 1000)).toBe(T0)
  expect(timeOf(String(T0))).toBe(T0)
  expect(timeOf('soon')).toBeNull()
  expect(inkOf('orange')).toBe('#ff9800')
  expect(inkOf('#F80')).toBe('#ff8800')
  expect(inkOf('url(x)')).toBeNull()
  // One point a day on hourly candles: held through its day, then stops.
  const daily = alignPoints([[T0, 1], [T0 + 24 * HOUR, 2]], candles)
  expect(daily[0]).toBe(1)
  expect(daily[23]).toBe(1)
  expect(daily[24]).toBe(2)
  expect(daily[47]).toBe(2)
  expect(daily[48]).toBeNull()
  // Points inside one candle: the last one counts.
  expect(alignPoints([[T0 + 5 * HOUR + 60_000, 7], [T0 + 5 * HOUR + 120_000, 8]], candles)[5]).toBe(8)
})

test('values by candle become a line on the price chart; other numbers get their own pane', () => {
  const closes = candles.map(c => c.c + 1)
  const a = addLayers([], 'ETH', [{ name: 'my model', values: closes.slice(-30) }, { name: 'score', values: candles.map((_, i) => i % 7) }], candles, NOW)
  expect(a.notes).toEqual([])
  expect(a.next.map(l => [l.name, l.pane])).toEqual([['my model', 'price'], ['score', 'lower']])
  // The two get different inks.
  expect(new Set(a.next.map(l => l.ink)).size).toBe(2)
  const st = layerStudies(a.next, 'ETH', candles)
  expect(st.map(s => s.label)).toEqual(['my model', 'score'])
  expect(st[0]?.series[0]?.values[49]).toBeNull()
  expect(Math.abs((st[0]?.series[0]?.values[79] ?? 0) - (closes[79] as number))).toBeLessThan(1e-9)
  // Another coin sees none; the same name replaces.
  expect(layerStudies(a.next, 'BTC', candles)).toEqual([])
  const b = addLayers(a.next, 'ETH', { name: 'My Model', values: [1, 2, 3] }, candles, NOW)
  expect(b.next.filter(l => l.coin === 'ETH')).toHaveLength(2)
  expect(b.next.find(l => l.name === 'My Model')?.ink).toBe(a.next[0]?.ink)
  // Removing by name, and the limit per coin.
  expect(removeLayers(b.next, 'ETH', ['score']).next).toHaveLength(1)
  expect(removeLayers(b.next, 'ETH', ['nope']).notes[0]).toMatch(/No layer named nope on ETH/)
  let many = b.next
  for (let k = 0; k < MAX_LAYERS + 2; k++) many = addLayers(many, 'ETH', { name: `l${k}`, values: [1] }, candles, NOW).next
  expect(many.filter(l => l.coin === 'ETH')).toHaveLength(MAX_LAYERS)
  expect(addLayers(many, 'ETH', { name: 'one more', values: [1] }, candles, NOW).notes[0]).toMatch(/8 layers at most on ETH/)
  expect(addLayers([], 'ETH', { name: 'empty' }, candles, NOW).notes[0]).toMatch(/had nothing to draw/)
})

test('pins and spans become marks on their candles, and both charts draw them', () => {
  const t = (i: number) => new Date((candles[i] as Candle).t + 20 * 60_000).toISOString()
  const { next } = addLayers(
    [],
    'ETH',
    { name: 'pattern', color: 'pink', pins: [{ time: t(60), dir: 'up', label: 'A' }, { time: t(70), dir: 'down' }, { time: t(65), dir: 'dot', price: 101 }, { time: '2020-01-01' }], spans: [{ from: t(40), to: t(50), label: 'news' }] },
    candles,
    NOW,
  )
  const marks = layerMarks(next, 'ETH', candles)
  expect(marks.map(m => m.kind)).toEqual(['span', 'pin', 'pin', 'pin'])
  expect(marks[1]?.t).toBe((candles[60] as Candle).t)
  expect(marks.every(m => m.ink === '#e91e63')).toBe(true)
  const svg = deskSvg({ candles, cursor: 0, fan: null, marks }, '1h', 'ETH', null)
  expect(svg).toContain('>news<')
  expect(svg).toContain('>A<')
  expect(svg).toContain('fill="#e91e63" fill-opacity=')
  const cols = 100
  const cells = deskCells({ candles, cursor: 0, fan: null, marks }, cols, 24)
  const text = cells.map(c => String.fromCodePoint(c[0])).join('')
  expect(text).toContain('▲')
  expect(text).toContain('▼')
  // Replay: pins after the last candle shown are not drawn.
  expect(layerMarks(next, 'ETH', candles.slice(0, 62)).filter(m => m.kind === 'pin')).toHaveLength(1)
  expect(layersFromStore([...next, { junk: 1 }])).toHaveLength(1)
})

test('Claude paints a layer through the chart tool; it shows in the report, the CSV, the picture, and comes back', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  on('tool.register', (_, e) => ({ value: { tool: `mcp__lab-desk__${e.name}` } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: CHART_TOOL_NAME, coin: 'BTC', interval: '1h' })
  const r = await $.tool.call({
    tool: CHART_TOOL_NAME,
    layers: [
      { name: 'fair value', color: 'teal', points: [{ time: new Date(NOW - 10 * HOUR).toISOString(), value: 95_500 }, { time: new Date(NOW - 5 * HOUR).toISOString(), value: 95_800 }, { time: new Date(NOW - HOUR).toISOString(), value: 96_000 }] },
      { name: 'setups', pins: [{ time: new Date(NOW - 3 * HOUR).toISOString(), dir: 'up', label: 'here' }], spans: [{ from: new Date(NOW - 8 * HOUR).toISOString(), to: new Date(NOW - 6 * HOUR).toISOString(), label: 'CPI' }] },
    ],
  })
  const text = String(r.result ?? r.deny)
  expect(text).toMatch(/Painted fair value, setups on BTC\./)
  expect(text).toMatch(/fair value: 96,000/)
  expect(text).toMatch(/Layers: fair value \(line, 3 points, on the price chart\) · setups \(1 pin, 1 span\)\./)
  expect(text).not.toMatch(/\b(buy|sell|signals?|targets?|edge)\b/i)
  expect(store.get('layers')).toHaveLength(2)
  const csv = String((await $.tool.call({ tool: READ_TOOL_NAME, candles: 3 })).result ?? '')
  expect(csv).toMatch(/time_utc,open,high,low,close,volume,fair value/)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = String((await pane.find({ type: 'Svg' }))?.props?.source ?? '')
  expect(svg).toContain('fair value')
  expect(svg).toContain('>CPI<')
  expect(svg).toContain('>here<')
  await pane.unmount()
  const gone = String((await $.tool.call({ tool: CHART_TOOL_NAME, remove_layers: ['setups'] })).result ?? '')
  expect(gone).toMatch(/Layers removed on BTC: setups\./)
  expect(String((await $.tool.call({ tool: CHART_TOOL_NAME, clear_layers: true })).result ?? '')).toMatch(/Layers cleared on BTC\./)
  expect(store.get('layers')).toEqual([])
})
