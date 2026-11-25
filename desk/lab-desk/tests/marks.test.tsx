// Marks on the chart: /lab-mark, the chart tool's marks, and how both charts draw them.

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import type { Candle } from '../types'
import { deskCells } from '../hooks/cells'
import { MAX_MARKS, addMarks, markFrom, markText, parseMark, priceOf } from '../hooks/marks'
import { CHART_TOOL_NAME } from '../hooks/register'
import { deskSvg } from '../hooks/svg'
import { NOW, PANE, engine, typed } from './fixtures'

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
const candles: Candle[] = Array.from({ length: 80 }, (_, i) => {
  const c = 100 + Math.sin(i / 6) * 8
  return { t: 1_700_000_000_000 + i * HOUR, o: c - 0.5, h: c + 2, l: c - 2, c, v: 10 }
})

test('prices and the two typed forms', async () => {
  expect(priceOf('65k')).toBe(65000)
  expect(priceOf('64,500')).toBe(64500)
  expect(priceOf('0.0125')).toBe(0.0125)
  expect(priceOf('abc')).toBeNull()
  expect(parseMark('BTC', '65000 resistance')).toEqual({ coin: 'BTC', kind: 'level', price: 65000, label: 'resistance' })
  expect(parseMark('BTC', '60k 58k demand zone')).toEqual({ coin: 'BTC', kind: 'zone', price: 58000, price2: 60000, label: 'demand zone' })
  expect('error' in parseMark('BTC', 'resistance')).toBe(true)
  expect(parseMark('BTC', '65000 <b>x</b>')).toEqual({ coin: 'BTC', kind: 'level', price: 65000, label: 'bx/b' })
})

test('the tool\'s marks: levels, zones, notes snapped to a candle; the list keeps 12 per coin', async () => {
  const at = candles[40] as Candle
  const note = markFrom('ETH', { time: new Date(at.t + 20 * 60_000).toISOString(), label: 'breakout' }, candles)
  expect(note).toEqual({ coin: 'ETH', kind: 'note', price: at.h, t: at.t, label: 'breakout' })
  expect(markFrom('ETH', { time: '2001-01-01T00:00', label: 'x' }, candles)).toBeNull()
  expect(markFrom('ETH', { price: 101, to: 99 }, candles)).toEqual({ coin: 'ETH', kind: 'zone', price: 99, price2: 101, label: '' })
  expect(markFrom('ETH', { label: 'no price' }, candles)).toBeNull()
  let list = addMarks([], [{ coin: 'SOL', kind: 'level', price: 1, label: '' }])
  for (let k = 0; k < MAX_MARKS + 3; k++) list = addMarks(list, [{ coin: 'ETH', kind: 'level', price: 100 + k, label: '' }])
  expect(list.filter(x => x.coin === 'ETH')).toHaveLength(MAX_MARKS)
  expect(list.filter(x => x.coin === 'SOL')).toHaveLength(1)
  expect(list.find(x => x.coin === 'ETH')?.price).toBe(103)
  // The same mark twice stays one.
  expect(addMarks(list, [{ coin: 'SOL', kind: 'level', price: 1, label: 'again' }]).filter(x => x.coin === 'SOL')).toHaveLength(1)
  expect(markText({ coin: 'BTC', kind: 'zone', price: 58000, price2: 60000, label: 'demand' })).toBe('zone 58,000–60,000 demand')
})

test('both charts draw a level, a zone and a note', async () => {
  const marks = [
    { coin: 'ETH', kind: 'level', price: 106, label: 'resistance' },
    { coin: 'ETH', kind: 'zone', price: 92, price2: 94, label: 'demand' },
    { coin: 'ETH', kind: 'note', price: 0, t: (candles[60] as Candle).t, label: 'look here' },
  ] as const
  const svg = deskSvg({ candles, cursor: 0, fan: null, marks: [...marks] }, '1h', 'ETH', null)
  expect(svg).toContain('>resistance<')
  // The price sits in a tag on the scale, as TradingView draws it.
  expect(svg).toMatch(/fill="#16181c">106</)
  expect(svg).toMatch(/>demand 92–94</)
  expect(svg).toContain('>look here<')
  expect(svg).toContain('stroke-dasharray="6 4"')
  const cols = 90
  const cells = deskCells({ candles, cursor: 0, fan: null, marks: [...marks] }, cols, 24)
  const rows = Array.from({ length: 24 }, (_, y) => cells.slice(y * cols, (y + 1) * cols).map(c => String.fromCodePoint(c[0])).join(''))
  expect(rows.some(r => r.includes('resistance 106') && r.includes('╌'))).toBe(true)
  expect(rows.filter(r => r.includes('┄')).length).toBeGreaterThanOrEqual(2)
  expect(rows.some(r => r.includes('▼'))).toBe(true)
  expect(rows.some(r => r.includes('look here'))).toBe(true)
})

test('/lab-mark draws, lists and clears on the open chart, and the marks come back', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  expect((await $.command.run(typed('lab-mark', '65000 resistance'))).text).toMatch(/Open a chart first/)
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  expect((await $.command.run(typed('lab-mark', '65000 resistance'))).text).toMatch(/^Drew level 65,000 resistance on BTC\./)
  expect((await $.command.run(typed('lab-mark', '58000 60000 demand'))).text).toMatch(/zone 58,000–60,000 demand/)
  expect((await $.command.run(typed('lab-mark', 'what'))).text).toMatch(/Give a price first/)
  expect((await $.command.run(typed('lab-mark', ''))).text).toMatch(/BTC marks: level 65,000 resistance · zone 58,000–60,000 demand\./)
  expect(store.get('marks')).toHaveLength(2)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = String((await pane.find({ type: 'Svg' }))?.props?.source ?? '')
  expect(svg).toContain('>resistance<')
  await pane.unmount()
  expect((await $.command.run(typed('lab-mark', 'clear'))).text).toBe('Marks cleared on BTC.')
  expect(store.get('marks')).toEqual([])
})

test('Claude\'s chart tool draws marks and reports them; a bad mark is named', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  on('tool.register', (_, e) => ({ value: { tool: `mcp__lab-desk__${e.name}` } }))
  store.set('marks', [{ coin: 'ETH', kind: 'level', price: 1, label: 'old' }, { junk: true }])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await $.tool.call({ tool: CHART_TOOL_NAME, coin: 'eth', clear_marks: true, marks: [{ price: 3000, label: 'support' }, { price: 3100, to: 3200, label: 'supply' }, { label: 'nothing' }] })
  const text = String(r.result ?? r.deny)
  expect(text).toMatch(/Marks cleared on ETH\./)
  expect(text).toMatch(/1 mark\(s\) skipped/)
  expect(text).toMatch(/Marks: level 3,000 support · zone 3,100–3,200 supply\./)
  expect(text).not.toMatch(/\b(buy|sell|signals?|targets?|edge)\b/i)
})
