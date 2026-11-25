import { expect, test } from 'claude-code/testing'

import { deskCells, PANE_ROWS, rowPlan } from '../hooks/cells'
import { parseCandles } from '../hooks/data'
import { chartCells } from '../hooks/draw'
import { compute, specsOf } from '../hooks/indicators'
import { candlesFixture } from './fixtures'

const candles = parseCandles(candlesFixture(600))
const studiesOf = (ids: string[]) => specsOf(ids).map(s => compute(s, candles))

test('no indicators: exactly the old candle chart', async () => {
  expect(deskCells({ candles, cursor: 0, fan: null, studies: [] }, 100, 24)).toEqual(chartCells({ candles, cursor: 0, fan: null }, 100, 24))
})

test('rows split into legend, candles and lower panes; panes give way to keep 8 candle rows', async () => {
  const two = studiesOf(['ema 20', 'rsi', 'macd'])
  expect(rowPlan(34, two)).toMatchObject({ legend: 1, price: 34 - 1 - 2 * PANE_ROWS })
  expect(rowPlan(20, two).lowers.length).toBe(1)
  expect(rowPlan(12, two).lowers.length).toBe(0)
  expect(rowPlan(30, studiesOf(['rsi'])).legend).toBe(0)
})

test('indicator dots only fill empty cells; candles and the axis stay as they were', async () => {
  const studies = studiesOf(['ema 20', 'bb 20 2'])
  const plain = chartCells({ candles, cursor: 0, fan: null }, 100, 23)
  const cells = deskCells({ candles, cursor: 0, fan: null, studies }, 100, 24)
  expect(cells).toHaveLength(100 * 24)
  const body = cells.slice(100)
  let dots = 0
  body.forEach((c, i) => {
    const was = plain[i] as [number, number, number]
    if (c[0] !== was[0]) {
      expect(was[0] === 0x20 || was[0] === 0x2508).toBe(true)
      expect(c[0] >= 0x2800 && c[0] <= 0x28ff).toBe(true)
      dots++
    }
  })
  expect(dots).toBeGreaterThan(50)
  const legend = String.fromCodePoint(...cells.slice(0, 100).map(c => c[0]))
  expect(legend).toMatch(/^▪EMA 20 [\d,.]+ {2}▪BB 20 2 [\d,.]+\/[\d,.]+/)
})

test('lower panes: a title row with values, then lines or a histogram', async () => {
  const cells = deskCells({ candles, cursor: 0, fan: null, studies: studiesOf(['rsi 14', 'macd']) }, 100, 30)
  const rowText = (y: number) => String.fromCodePoint(...cells.slice(y * 100, y * 100 + 100).map(c => c[0]))
  const rsiTitle = 30 - 2 * PANE_ROWS
  expect(rowText(rsiTitle)).toMatch(/^─ RSI 14 · \d+\.\d ─+$/)
  expect(rowText(rsiTitle + PANE_ROWS)).toMatch(/^─ MACD 12 26 9 · hist [-\d.]+ · MACD [-\d.]+ · avg 9 [-\d.]+ ─+$/)
  const macdBody = cells.slice((rsiTitle + PANE_ROWS + 1) * 100)
  expect(macdBody.some(c => c[0] === 0x2580 || c[0] === 0x2584 || c[0] === 0x2588)).toBe(true)
})
