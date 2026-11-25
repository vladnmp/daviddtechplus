// Compare: another coin over the chart as a % line, both from the first candle on screen (TradingView's Compare).

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import type { Candle } from '../types'
import { deskCells } from '../hooks/cells'
import { parseCandles } from '../hooks/data'
import { COMPARE_INK, compareStudy, fmtStudy } from '../hooks/indicators'
import { CHART_TOOL_NAME } from '../hooks/register'
import { deskSvg } from '../hooks/svg'
import { NOW, PANE, candlesFixture, engine, typed } from './fixtures'

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
const at = (i: number) => 1_700_000_000_000 + i * HOUR
const base: Candle[] = Array.from({ length: 50 }, (_, i) => ({ t: at(i), o: 100, h: 101, l: 99, c: 100 + i * 0.1, v: 1 }))
// The other coin doubles over the same candles, with one gap.
const other: Candle[] = Array.from({ length: 50 }, (_, i) => ({ t: at(i), o: 10, h: 10, l: 10, c: 10 + (10 * i) / 49, v: 1 })).filter((_, i) => i !== 30)

test('the line starts at its anchor candle and reads as % change', () => {
  const s = compareStudy('ETH', base, other, at(30))
  if (!s) throw new Error('no line')
  const v = s.series[0]?.values ?? []
  expect(v.slice(0, 30).every(x => x === null)).toBe(true)
  // Both start at the base's close on the first candle shown.
  expect(v[30]).toBeNull()
  expect(Math.abs((v[31] ?? 0) - (base[31] as Candle).c) < 1e-9).toBe(true)
  expect(s.ink).toBe(COMPARE_INK)
  expect(s.label).toBe('ETH')
  const end = v.at(-1) ?? 0
  const pct = ((other.at(-1) as Candle).c / (other[30] as Candle).c - 1) * 100
  expect(fmtStudy(s, end, String)).toBe(`+${pct.toFixed(2)}%`)
  expect(compareStudy('ETH', base, [], at(30))).toBeNull()
  expect(compareStudy('ETH', base, other, at(99))).toBeNull()
})

test('both charts draw it in its own ink, with a % legend', () => {
  const input = { candles: base, cursor: 0, fan: null, compare: { coin: 'ETH', candles: other, from: at(30) } }
  const svg = deskSvg(input, '1h', 'BTC', null)
  expect(svg).toContain(`stroke="${COMPARE_INK}"`)
  expect(svg).toMatch(/>ETH</)
  expect(svg).toMatch(/fill="#29b6f6">\+\d+\.\d\d%</)
  const cols = 80
  const cells = deskCells(input, cols, 20)
  const legend = cells.slice(0, cols).map(c => String.fromCodePoint(c[0])).join('')
  expect(legend).toMatch(/ETH \+\d+\.\d\d%/)
  expect(cells.some(c => c[1] === parseInt(COMPARE_INK.slice(1), 16) && c[0] >= 0x2800 && c[0] <= 0x28ff)).toBe(true)
})

test('/lab-chart compare and the chart tool lay a coin over the chart and take it off', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  memStore(on)
  on('tool.register', (_, e) => ({ value: { tool: `mcp__lab-desk__${e.name}` } }))
  expect((await $.command.run(typed('lab-chart', 'compare ETH'))).text).toMatch(/^Open a chart first/)
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  expect((await $.command.run(typed('lab-chart', 'compare BTC'))).text).toMatch(/chart's own coin/)
  expect((await $.command.run(typed('lab-chart', 'compare NOPE'))).text).toMatch(/^No perp named NOPE/)
  const text = (await $.command.run(typed('lab-chart', 'compare eth'))).text ?? ''
  expect(text).toMatch(/^ETH is on the BTC chart as a % line, both starting 100 candles back/)
  // The test API sends the same candles for every coin, so both moved alike.
  expect(text).toMatch(/Compare: ETH ([+-]\d+\.\d\d%) vs BTC \1 over the last \d+ candles \(since .+ UTC\)\./)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(String((await pane.find({ type: 'Svg' }))?.props?.source ?? '')).toContain(`stroke="${COMPARE_INK}"`)
  await pane.unmount()
  expect((await $.command.run(typed('lab-chart', 'compare off'))).text).toBe('Compare off: ETH taken off the chart.')

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = String((await $.tool.call({ tool: CHART_TOOL_NAME, compare: 'SOL' })).result ?? '')
  expect(r).toMatch(/SOL is on the BTC chart/)
  expect(r).toMatch(/\nCompare: SOL /)
  const off = String((await $.tool.call({ tool: CHART_TOOL_NAME, compare: 'off' })).result ?? '')
  expect(off).toMatch(/Compare off/)
  expect(off).not.toMatch(/\nCompare: /)
  expect(r + text).not.toMatch(/\b(buy|sell|signals?|targets?|edge)\b/i)
})

test('the pane, the terminal and Claude give the same % for Compare', async ($, on) => {
  // ETH climbs 0.1% a candle against the test candles; BTC is the test candles.
  const eth = (coin: string) =>
    candlesFixture().map((r, i) => (coin === 'ETH' ? { ...r, c: (Number(r.c) * (1 + i * 0.001)).toFixed(1) } : r))
  engine(on, { candles: eth })
  mock.clock(on, { now: NOW })
  memStore(on)
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  const text = (await $.command.run(typed('lab-chart', 'compare ETH'))).text ?? ''
  const said = /Compare: ETH ([+-]\d+\.\d\d%)/.exec(text)?.[1]
  expect(said).toMatch(/^\+/)
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = String((await desk.find({ type: 'Svg' }))?.props?.source ?? '')
  await desk.unmount()
  // The default legend (the last group) shows the last candle's value.
  const shown = [...svg.matchAll(/fill="#29b6f6">([+-]\d+\.\d\d%)</g)].at(-1)?.[1]
  expect(shown).toBe(said)
  // The terminal chart reads the same anchor: its legend row says the same.
  const btc = parseCandles(candlesFixture())
  const cells = deskCells({ candles: btc, cursor: 0, fan: null, compare: { coin: 'ETH', candles: parseCandles(eth('ETH')), from: (btc[0] as Candle).t } }, 70, 20)
  expect(cells.slice(0, 70).map(c => String.fromCodePoint(c[0])).join('')).toContain(`ETH ${said}`)
})
