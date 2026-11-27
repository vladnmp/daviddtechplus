// Lab trades on the chart: each test or Swarm trade draws as a line from its entry close to its exit close, in the
// up color when it made money and the down color when it lost; a trade cut by the chart's edge, and any span
// Claude paints itself, keep the band. The live chart pulses at its last close; saves, cards and replays do not.

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import type { Candle } from '../types'
import { PALETTES } from '../hooks/draw'
import { addLayers, layerMarks, layersFromStore, layersLine } from '../hooks/layers'
import { TEST_TOOL_NAME } from '../hooks/register'
import { deskSvg } from '../hooks/svg'
import { NOW, PANE, candlesFixture, engine, typed } from './fixtures'

const HOUR = 3_600_000
const T0 = Date.UTC(2026, 10, 10, 0, 0, 0)
const candles: Candle[] = Array.from({ length: 80 }, (_, i) => {
  const c = 100 + Math.sin(i / 6) * 8
  return { t: T0 + i * HOUR, o: c - 0.5, h: c + 2, l: c - 2, c, v: 10 }
})
const at = (i: number) => (candles[i] as Candle).t

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

test('trade spans draw as lines, cut trades and plain spans keep the band', () => {
  const spans = [
    { from: at(40), to: at(45), trade: 'won' },
    { from: at(50), to: at(55), trade: 'lost' },
    { from: T0 - 5 * HOUR, to: at(3), trade: 'won' },
    { from: at(60), to: at(65), label: 'news' },
    { from: at(70), to: at(72), trade: 'maybe' },
  ]
  const { next } = addLayers([], 'ETH', { name: 'test', color: '#8bc34a', spans }, candles, NOW)
  // The flag is kept with the layer and survives the saved round trip.
  expect(next[0]?.spans?.map(s => s.trade ?? null)).toEqual(['won', 'lost', 'won', null, null])
  expect(layersFromStore(JSON.parse(JSON.stringify(next)))[0]?.spans?.filter(s => s.trade).length).toBe(3)
  expect(layersLine(next, 'ETH', [])).toBe('Layers: test (trades as lines from entry to exit close, 2 spans).')
  const marks = layerMarks(next, 'ETH', candles)
  expect(marks.map(m => m.trade ?? 'band')).toEqual(['won', 'lost', 'band', 'band', 'band'])
  for (const palette of ['classic', 'colorblind'] as const) {
    const svg = deskSvg({ candles, cursor: 0, fan: null, marks, palette: PALETTES[palette] }, '1h', 'ETH', null)
    const up = '#' + PALETTES[palette].up.toString(16).padStart(6, '0')
    const down = '#' + PALETTES[palette].down.toString(16).padStart(6, '0')
    const lines = [...svg.matchAll(/<line [^>]*stroke="(#[0-9a-f]+)" stroke-width="1.2" stroke-dasharray="3 2"\/>/gi)].map(m => (m[1] as string).toLowerCase())
    expect(lines).toEqual([up, down])
    // Three bands (the cut trade, the news span, the bad flag), each the plot's full height.
    expect(svg.match(/fill="#8bc34a" fill-opacity="\.09"/g)).toHaveLength(3)
    expect(svg).toContain('>news<')
  }
})

test('the live chart pulses at its last close; without live there is no motion at all', () => {
  const live = deskSvg({ candles, cursor: 0, fan: null, live: true }, '1h', 'ETH', null)
  expect(live).toContain('class="lp"')
  expect(live).toContain('@media (prefers-reduced-motion:reduce){.lp{animation:none}}')
  // The ring rests hidden, so only the still dot shows where nothing animates.
  expect(live).toMatch(/\.lp\{opacity:0;/)
  const still = deskSvg({ candles, cursor: 0, fan: null }, '1h', 'ETH', null)
  expect(still).not.toContain('class="lp"')
  expect(still).not.toContain('@keyframes')
})

test('a test pins its trades as lines, and the desktop chart pulses only while live', async ($, on) => {
  engine(on, { candles: () => candlesFixture(600) })
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  on('tool.register', (_, e) => ({ value: { tool: `mcp__lab-desk__${e.name}` } }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  const r = await $.tool.call({ tool: TEST_TOOL_NAME, enter: 'close > open', hold: 2 })
  expect(String(r.result)).toMatch(/pinned|on the chart/i)
  const saved = [...store.values()].flatMap(v => (Array.isArray(v) ? v : [])).filter(l => l && typeof l === 'object' && (l as { name?: string }).name === 'test')
  const spans = (saved[0] as { spans?: { trade?: string }[] } | undefined)?.spans ?? []
  expect(spans.length).toBeGreaterThan(0)
  expect(spans.every(s => s.trade === 'won' || s.trade === 'lost')).toBe(true)
  // Each pin knows its trade's exit, so a replay can hide the result.
  const pins = (saved[0] as { pins?: { t: number; until?: number }[] } | undefined)?.pins ?? []
  expect(pins.length).toBeGreaterThan(0)
  expect(pins.every(p => typeof p.until === 'number' && p.until > p.t)).toBe(true)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const source = async () => String((await pane.find({ type: 'Svg' }))?.props?.source ?? '')
  const svg = await source()
  // The box carries the chart's own size, so the desktop frame does not shrink it to its default height.
  const props = (await pane.find({ type: 'Svg' }))?.props ?? {}
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)
  expect(props.width).toBe(Number(vb?.[1]))
  expect(props.height).toBe(Number(vb?.[2]))
  expect(props.width).toBe(720)
  expect(svg).toContain('stroke-dasharray="3 2"')
  expect(svg).toContain('class="lp"')
  // Scrolled back a candle: still, no pulse; back to the last candle, it pulses again.
  await pane.press({ key: 'back' })
  expect(await source()).not.toContain('class="lp"')
  await pane.press({ key: 'last' })
  expect(await source()).toContain('class="lp"')
  await pane.unmount()
})

test('in a replay, a trade that ends after the last candle shown keeps its result to itself', () => {
  const { next } = addLayers([], 'ETH', { name: 'test', pins: [{ time: at(40), dir: 'up', label: '+2.0%', until: at(45) }, { time: at(20), dir: 'up', label: '-1.0%', until: at(25) }], spans: [{ from: at(40), to: at(45), trade: 'won' }] }, candles, NOW)
  expect(next[0]?.pins?.[0]?.until).toBe(at(45))
  const shown = candles.slice(0, 43)
  const marks = layerMarks(next, 'ETH', shown)
  expect(marks.filter(m => m.kind === 'pin').map(m => m.label)).toEqual(['', '-1.0%'])
  // Cut by the replay's edge: the band, no line, and the label nowhere in the picture.
  expect(marks.find(m => m.kind === 'span')?.trade).toBeUndefined()
  expect(deskSvg({ candles: shown, cursor: 0, fan: null, marks }, '1h', 'ETH', null)).not.toContain('+2.0%')
  expect(layerMarks(next, 'ETH', candles).filter(m => m.kind === 'pin').map(m => m.label)).toEqual(['+2.0%', '-1.0%'])
})
