// Moments like now draws what came after each look-alike to the right of the last closed candle, in both charts,
// only while that candle is still the latest and never beside the DaviddTech+ range.

import { expect, test } from 'claude-code/testing'

import type { Candle, Fan } from '../types'
import { deskCells } from '../hooks/cells'
import { PALETTES } from '../hooks/draw'
import { addLayers, layerGhost } from '../hooks/layers'
import { deskSvg } from '../hooks/svg'

const H = 3_600_000
const T0 = Date.UTC(2026, 10, 1)
const candles: Candle[] = Array.from({ length: 120 }, (_, i) => {
  const c = 100 + 5 * Math.sin(i / 7)
  return { t: T0 + i * H, o: c - 0.3, h: c + 1, l: c - 1, c, v: 10 }
})
const paths = Array.from({ length: 6 }, (_, k) => Array.from({ length: 10 }, (_, s) => ((k - 2.5) / 100) * ((s + 1) / 10)))
const median = Array.from({ length: 10 }, (_, s) => 0.002 * (s + 1))

function withAhead(anchorT: number) {
  return addLayers([], 'BTC', { name: 'like now', color: '#00bcd4', ahead: { t: anchorT, paths, median } }, candles, T0).next
}

test('a layer can carry paths ahead; they are checked and kept', () => {
  const all = withAhead((candles[118] as Candle).t)
  expect(all.length).toBe(1)
  expect(all[0]?.ahead?.paths.length).toBe(6)
  // Paths of the wrong length or with words in them are left out; no middle, nothing ahead.
  const bad = addLayers([], 'BTC', { name: 'x', ahead: { t: T0, paths: [[1, 'a'], [0.1]], median: [0.1, 0.2] } }, candles, T0).next
  expect(bad[0]?.ahead?.paths.length).toBe(0)
  expect(addLayers([], 'BTC', { name: 'y', ahead: { t: T0, paths } }, candles, T0).next.length).toBe(0)
})

test('the paths show only while their candle is the last closed one (or the last)', () => {
  expect(layerGhost(withAhead((candles[118] as Candle).t), 'BTC', candles)?.anchor).toBe(118)
  expect(layerGhost(withAhead((candles[119] as Candle).t), 'BTC', candles)?.anchor).toBe(119)
  // Two candles later the chart has moved on: not drawn.
  expect(layerGhost(withAhead((candles[117] as Candle).t), 'BTC', candles)).toBe(null)
  expect(layerGhost(withAhead((candles[118] as Candle).t), 'ETH', candles)).toBe(null)
  expect(layerGhost(withAhead((candles[118] as Candle).t), 'BTC', candles)?.label).toBe('6 look-alikes')
})

test('both charts draw the paths in the layer ink, and neither does beside the DaviddTech+ range', () => {
  const ghost = layerGhost(withAhead((candles[118] as Candle).t), 'BTC', candles)
  const base = { candles, cursor: 0, palette: PALETTES.classic, studies: [], marks: [] }
  const svg = deskSvg({ ...base, fan: null, ghost }, '1h', 'BTC', null)
  expect(svg).toMatch(/6 look-alikes/)
  expect(svg).toMatch(/stroke="#00bcd4"/)
  const plain = deskSvg({ ...base, fan: null, ghost: null }, '1h', 'BTC', null)
  expect(plain).not.toMatch(/look-alikes/)
  const cells = deskCells({ ...base, fan: null, ghost }, 100, 24)
  expect(cells.some(c => c[0] >= 0x2800 && c[0] <= 0x28ff && c[1] === 0x00bcd4)).toBe(true)

  const fan: Fan = { steps: 10, unit: 'hours', points: [{ step: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 }, { step: 10, p10: -3, p25: -1, p50: 0, p75: 1, p90: 3 }] } as unknown as Fan
  const withFan = deskSvg({ ...base, fan, ghost }, '1h', 'BTC', '10 hours')
  expect(withFan).not.toMatch(/look-alikes/)
  const fanCells = deskCells({ ...base, fan, ghost }, 100, 24)
  expect(fanCells.some(c => c[1] === 0x00bcd4)).toBe(false)
})
