import { expect, test } from 'claude-code/testing'

import { chartCells, chartSize, chartSvg, DEFAULT, layoutFor, packCells, readout, timeAxis, UP, DOWN } from '../hooks/draw'
import { fanFrom } from '../hooks/forecast'
import { parseCandles } from '../hooks/data'
import { BRIEF_FIXTURE, candlesFixture } from './fixtures'

const candles = parseCandles(candlesFixture(200))
const fan = fanFrom(BRIEF_FIXTURE)

test('size: a narrow or short pane gets no chart, a wide one is capped', async () => {
  expect(chartSize(18, 30, 6)).toBeNull()
  expect(chartSize(60, 9, 6)).toBeNull()
  expect(chartSize(60, 30, 6)).toEqual({ columns: 60, rows: 24 })
  expect(chartSize(900, 400, 6)).toEqual({ columns: 512, rows: 40 })
})

for (const [columns, rows] of [
  [20, 4],
  [44, 10],
  [120, 24],
  [300, 40],
] as const) {
  test(`cells fill exactly ${columns} x ${rows}, with candles in both colors`, async () => {
    const cells = chartCells({ candles, cursor: 0, fan }, columns, rows)
    expect(cells).toHaveLength(columns * rows)
    for (const [cp] of cells) {
      expect(cp >= 0x20 && cp <= 0xffff).toBe(true)
    }
    const colors = new Set(cells.map(c => c[1]))
    expect(colors.has(UP)).toBe(true)
    expect(colors.has(DOWN)).toBe(true)
    const packed = packCells(cells)
    expect(packed.length).toBe(Math.ceil((columns * rows * 12) / 3) * 4)
    expect(packed).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })
}

test('layout: the fan and the axis appear only when there is room', async () => {
  const narrow = layoutFor({ candles, cursor: 0, fan }, 20)
  expect(narrow.axis).toBe(0)
  expect(narrow.fan).toBe(0)
  expect(narrow.plot).toBe(20)
  expect(narrow.shown).toHaveLength(20)
  const wide = layoutFor({ candles, cursor: 0, fan }, 120)
  expect(wide.axis).toBeGreaterThan(0)
  expect(wide.fan).toBeGreaterThan(5)
  expect(wide.plot + wide.fan + wide.axis).toBe(120)
  const noFan = layoutFor({ candles, cursor: 0, fan: null }, 120)
  expect(noFan.fan).toBe(0)
  // Fewer candles than columns: all of them, right-aligned.
  const few = layoutFor({ candles: candles.slice(-5), cursor: 0, fan: null }, 120)
  expect(few.shown).toHaveLength(5)
})

test('the fan is drawn right of the last candle; nothing is drawn there without it', async () => {
  const columns = 120
  const rows = 24
  const L = layoutFor({ candles, cursor: 0, fan }, columns)
  const zone = (cells: [number, number, number][]) => {
    const out: [number, number, number][] = []
    for (let y = 0; y < rows; y++) for (let x = L.plot + 1; x < L.plot + L.fan; x++) out.push(cells[y * columns + x] as [number, number, number])
    return out
  }
  const withFan = zone(chartCells({ candles, cursor: 0, fan }, columns, rows))
  expect(withFan.some(c => c[0] !== 0x20 && c[0] !== 0x2508)).toBe(true)
  const without = chartCells({ candles, cursor: 0, fan: null }, columns, rows)
  const L2 = layoutFor({ candles, cursor: 0, fan: null }, columns)
  expect(L2.plot).toBe(columns - L2.axis)
  expect(without.filter(c => c[2] !== DEFAULT).length).toBeGreaterThan(0)
})

test('readout, time axis and SVG', async () => {
  expect(readout(candles, 0, '1h')).toMatch(/^last · \w{3} \d+ \w{3} \d{2}:00 UTC · O [\d,.]+ H [\d,.]+ L [\d,.]+ C [\d,.]+ · [+-]?[\d.]+% · vol [\d,.]+$/)
  expect(readout(candles, 3, '1h').startsWith('3 back · ')).toBe(true)
  expect(readout([], 0, '1h')).toBe('No candles yet.')
  const axis = timeAxis({ candles, cursor: 0, fan }, '1h', 120, 'next 5d')
  expect(axis.length).toBeLessThanOrEqual(120)
  expect(axis).toContain('next 5d')
  const svg = chartSvg({ candles, cursor: 0, fan }, '1h', 'BTC', 'next 5d')
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.length).toBeLessThan(131072)
  expect(svg).toContain('<title>')
  expect(svg).toContain('<polygon')
  expect(chartSvg({ candles, cursor: 0, fan: null }, '1h', 'BTC', null)).not.toContain('<polygon')
})

test('axis: five prices on a tall chart, none touching the last-price tag, the tag in the candle color', async () => {
  const columns = 80
  const rows = 24
  const rowText = (cells: ReturnType<typeof chartCells>, y: number) => String.fromCodePoint(...cells.slice(y * columns, (y + 1) * columns).map(c => c[0]))
  const labelled = (cells: ReturnType<typeof chartCells>) => Array.from({ length: rows }, (_, y) => y).filter(y => /┤\S/.test(rowText(cells, y)))
  // Close the last candle at the very top: the top label gives way to the tag.
  const top = candles.map((c, i) => (i === candles.length - 1 ? { ...c, h: c.h * 1.5, c: c.h * 1.5, o: c.h } : c))
  const cells = chartCells({ candles: top, cursor: 0, fan: null }, columns, rows)
  const rowsWithLabels = labelled(cells)
  const tag = rowsWithLabels.find(y => cells[y * columns + columns - 2]?.[2] !== DEFAULT)
  expect(tag).toBeDefined()
  for (const y of rowsWithLabels) if (y !== tag) expect(Math.abs(y - (tag ?? 0)) > 1).toBe(true)
  // In the middle, all five evenly spaced labels show around it.
  const mid = chartCells({ candles, cursor: 0, fan: null }, columns, rows)
  expect(labelled(mid).length >= 4).toBe(true)
  const lastUp = top[top.length - 1]!
  expect(cells[(tag ?? 0) * columns + columns - 2]?.[2]).toBe(lastUp.c >= lastUp.o ? UP : DOWN)
})
