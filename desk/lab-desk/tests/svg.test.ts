import { expect, test } from 'claude-code/testing'

import { parseCandles } from '../hooks/data'
import { PALETTES } from '../hooks/draw'
import { fanFrom } from '../hooks/forecast'
import { compute, specsOf } from '../hooks/indicators'
import { INKS, MAX_SVG, deskAlt, deskSvg, deskSvgAt, fmtTick, niceTicks, svgHeight, timeTicks } from '../hooks/svg'
import { BRIEF_FIXTURE, candlesFixture } from './fixtures'

const candles = parseCandles(candlesFixture(1500))
const fan = fanFrom(BRIEF_FIXTURE)
const six = specsOf(['ema 20', 'ema 50', 'bb 20 2', 'supertrend 10 3', 'rsi 14', 'macd 12 26 9']).map(s => compute(s, candles))

test('height grows by one pane per oscillator; the legend, panel and hover layer are there', async () => {
  const svg = deskSvg({ candles, cursor: 0, fan, studies: six }, '1h', 'BTC', 'next 5d')
  expect(svg).toContain(`height="${svgHeight(2)}"`)
  expect(svg).toContain('.c:hover .h{display:inline}')
  expect(svg).toContain('<g class="def">')
  expect((svg.match(/<g class="c">/g) ?? []).length).toBeGreaterThan(50)
  for (const label of ['EMA 20', 'EMA 50', 'BB 20 2', 'Supertrend 10 3', 'RSI 14', 'MACD 12 26 9', 'DaviddTech+']) expect(svg).toContain(label)
  expect(svg.length).toBeLessThan(110_000)
  expect(deskSvg({ candles, cursor: 0, fan: null }, '1h', 'BTC', null)).toContain(`height="${svgHeight(0)}"`)
})

test('stays under the frame limit by dropping hover detail first', async () => {
  const many = specsOf(['bb 20 2', 'donchian 20', 'bb 50 3', 'donchian 55', 'macd 12 26 9', 'macd 5 35 5']).map(s => compute(s, candles))
  const full = deskSvgAt({ candles, cursor: 0, fan, studies: many }, '1h', 'BTC', null, 'full')
  const chosen = deskSvg({ candles, cursor: 0, fan, studies: many }, '1h', 'BTC', null)
  expect(chosen.length).toBeLessThanOrEqual(MAX_SVG)
  expect(chosen.length).toBeLessThanOrEqual(full.length)
})

test('the two palettes use their own inks, and light and dark panels differ', async () => {
  const cb = deskSvg({ candles, cursor: 0, fan: null, studies: six, palette: PALETTES.colorblind }, '1h', 'BTC', null)
  expect(cb).toContain(INKS.colorblind[0])
  expect(cb).not.toContain(INKS.classic[0])
  const dark = deskSvg({ candles, cursor: 0, fan: null, theme: 'dark' }, '1h', 'BTC', null)
  const light = deskSvg({ candles, cursor: 0, fan: null, theme: 'light' }, '1h', 'BTC', null)
  expect(dark).toContain('#16181c')
  expect(light).toContain('#fafafa')
})

test('the cursor draws a crosshair in the default legend', async () => {
  const at0 = deskSvg({ candles, cursor: 0, fan: null }, '1h', 'BTC', null)
  const at5 = deskSvg({ candles, cursor: 5, fan: null }, '1h', 'BTC', null)
  const def = (s: string) => s.slice(s.indexOf('<g class="def">'))
  expect(def(at0)).not.toContain('class="x"')
  expect(def(at5)).toContain('class="x"')
})

test('round ticks and tidy labels', async () => {
  expect(niceTicks(58_000, 64_900, 5)).toEqual([58_000, 60_000, 62_000, 64_000])
  expect(fmtTick(64_000, 2000)).toBe('64,000')
  expect(fmtTick(75, 5)).toBe('75')
  expect(fmtTick(0.0125, 0.0025)).toBe('0.0125')
  expect(fmtTick(-480, 240)).toBe('-480')
  const ticks = timeTicks(candles.slice(-80))
  expect(ticks.length).toBeGreaterThan(2)
  expect(ticks.length).toBeLessThanOrEqual(6)
})

test('alt text names the indicators', async () => {
  expect(deskAlt('BTC', '1h', candles, true, six)).toMatch(/with EMA 20, EMA 50, BB 20 2, Supertrend 10 3, RSI 14, MACD 12 26 9, and the DaviddTech\+ forecast range$/)
})

test('a fib level under the legend names itself on the right; the range label is never cut', () => {
  const last = candles.slice(-200)
  const hi = Math.max(...last.map(c => c.h))
  const lo = Math.min(...last.map(c => c.l))
  const fib = { coin: 'BTC', kind: 'fib' as const, price: lo, price2: hi, label: 'fib' }
  const svg = deskSvgAt({ candles, cursor: 0, fan, studies: six.slice(0, 3), marks: [fib] }, '1h', 'BTC', 'next 5d', 'full')
  // The x of the <text> that holds a label.
  const xOf = (label: string) => {
    const at = svg.indexOf(`>${label}<`)
    const open = svg.lastIndexOf('<text', at)
    return at < 0 ? NaN : Number(/x="([\d.]+)"/.exec(svg.slice(open, at))?.[1] ?? NaN)
  }
  const top = /\>(0 \([\d,.]+\))</.exec(svg)?.[1] ?? ''
  const one = /\>(1 \([\d,.]+\))</.exec(svg)?.[1] ?? ''
  expect(top).not.toBe('')
  expect(xOf(top) > 200).toBe(true)
  expect(xOf(one) < 20).toBe(true)
  expect(svg).toMatch(/>DaviddTech\+ · next 5d</)
  // A level right on a fib level: its label moves to the right end instead of covering the fib's.
  const l236 = lo + (hi - lo) * (1 - 0.236)
  const both = deskSvgAt({ candles, cursor: 0, fan, studies: [], marks: [fib, { coin: 'BTC', kind: 'level', price: l236, label: 'resistance' }] }, '1h', 'BTC', 'next 5d', 'full')
  // The backing box drawn just before a label's text.
  const box = (label: string) => {
    const at = both.indexOf(`>${label}`)
    const r = both.slice(both.lastIndexOf('<rect class="k"', at), at)
    const n = (k: string) => Number(new RegExp(`${k}="([\\d.]+)"`).exec(r)?.[1] ?? NaN)
    return { x: n('x'), y: n('y'), w: n('width'), h: n('height') }
  }
  const a = box('resistance')
  const b = box('0.236 (')
  expect([a.x, a.y, b.x, b.y].every(Number.isFinite)).toBe(true)
  const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  expect(overlap).toBe(false)
})
