import { expect, test } from 'claude-code/testing'

import { fromText } from '../hooks/parse'
import { COLORS, DEFAULT, GLYPHS, LABEL_W, fanRaster, fromBase64, rasterFor, rasterSize, toBase64 } from '../hooks/raster'
import { BRIEF_MD, CARD_MD, ODDS_MD, PLAN_MD, SCAN_MD } from './fixtures'

const ALLOWED = (cp: number) =>
  [0x2580, 0x2584, 0x2503, 0x2502, 0x2591, 0x2592, 0x2500, 0x2508].includes(cp) || (cp >= 0x20 && cp <= 0x7e)

function cellsOf(r: { columns: number; rows: number; cells: string }) {
  const w = fromBase64(r.cells)
  return Array.from({ length: r.columns * r.rows }, (_, i) => ({ cp: w[i * 3]!, fg: w[i * 3 + 1]!, bg: w[i * 3 + 2]!, x: i % r.columns, y: Math.floor(i / r.columns) }))
}

function textRow(r: { columns: number; rows: number; cells: string }, y: number): string {
  return cellsOf(r).filter(c => c.y === y).map(c => (c.cp < 0x80 ? String.fromCharCode(c.cp) : '#')).join('')
}

test('base64 round-trips little-endian triplets', () => {
  const words = Uint32Array.of(0x2588, 0xff8800, DEFAULT, 0x41, 0x123456, 0)
  const text = toBase64(words)
  expect(text).toBe('iCUAAACI/wAAAAABQQAAAFY0EgAAAAAA')
  expect(Array.from(fromBase64(text))).toEqual(Array.from(words))
})

test('the fan raster: size, allowed glyphs, no default-colored half block', () => {
  const chart = fromText('analyze_asset', BRIEF_MD, 1)!
  const r = fanRaster(chart, 80, 20)
  expect(fromBase64(r.cells).length * 4).toBe(80 * 20 * 12)
  const cells = cellsOf(r)
  expect(cells.every(c => ALLOWED(c.cp))).toBe(true)
  expect(cells.some(c => (c.cp === 0x2580 || c.cp === 0x2584) && c.fg === DEFAULT)).toBe(false)
  expect(cells.every(c => c.fg === DEFAULT || c.fg < 0x01000000)).toBe(true)
  const cc = 80 - LABEL_W
  const levelColors = [COLORS.level] as number[]
  for (let x = 0; x < cc; x++) {
    const column = cells.filter(c => c.x === x)
    // The middle in every column, unless a level line sits on it there (levels draw over the middle).
    expect(column.some(c => c.cp === GLYPHS.middle && c.fg === COLORS.fan) || column.some(c => levelColors.includes(c.fg))).toBe(true)
  }
  expect(cells.filter(c => c.cp === GLYPHS.middle).length).toBeGreaterThanOrEqual(cc - 4)
  // One ink, shade glyphs on the default background: no solid block or filled cell in the fan's blue.
  expect(cells.some(c => c.bg === COLORS.fan)).toBe(false)
  expect(cells.some(c => c.fg === COLORS.fan && (c.cp === 0x2580 || c.cp === 0x2584 || c.cp === 0x2588))).toBe(false)
  for (const glyph of [GLYPHS.range80, GLYPHS.range50, GLYPHS.middle]) expect(cells.some(c => c.cp === glyph && c.fg === COLORS.fan)).toBe(true)
  expect(cells.some(c => c.cp === GLYPHS.zero && c.fg === COLORS.neutral)).toBe(true)
  expect(cells.every(c => c.bg === DEFAULT || levelColors.includes(c.bg))).toBe(true)
})

test('the fan raster labels levels in ASCII at the right edge', () => {
  const chart = fromText('analyze_asset', BRIEF_MD, 1)!
  const r = fanRaster(chart, 80, 20)
  const right = Array.from({ length: 20 }, (_, y) => textRow(r, y).slice(80 - LABEL_W + 1).trim())
  expect(right[0]).toMatch(/^\+\d+\.\d%$/)
  expect(right[19]).toMatch(/^-\d+\.\d%$/)
  expect(right).toContain('+5.0% 41%')
  expect(right).toContain('-3.0% 47%')
  expect(right).toContain('-4.0% 35%')
  // Resistance above support above the break level, as the values go.
  expect(right.indexOf('+5.0% 41%')).toBeLessThan(right.indexOf('-3.0% 47%'))
  expect(right.indexOf('-3.0% 47%')).toBeLessThan(right.indexOf('-4.0% 35%'))
})

test('sizes clamp: columns to [20, 512], rows to [6, 20]', () => {
  expect(rasterSize(5, 3)).toEqual({ columns: 20, rows: 6 })
  expect(rasterSize(900, 80)).toEqual({ columns: 512, rows: 20 })
  expect(rasterSize(80, 30)).toEqual({ columns: 80, rows: 20 })
  const small = rasterFor(fromText('analyze_asset', BRIEF_MD, 1)!, 20, 6)!
  expect(cellsOf(small).every(c => ALLOWED(c.cp))).toBe(true)
})

test('odds and scan draw; card and plan draw no raster', () => {
  const odds = rasterFor(fromText('level_odds', ODDS_MD, 1)!, 60, 10)!
  expect(odds.rows).toBe(10)
  expect(cellsOf(odds).some(c => c.fg === 0x4c8bf5 || c.bg === 0x4c8bf5)).toBe(true)
  expect(cellsOf(odds).every(c => ALLOWED(c.cp))).toBe(true)
  const scan = rasterFor(fromText('scan_assets', SCAN_MD, 1)!, 60, 10)!
  expect(scan.rows).toBe(3)
  expect(textRow(scan, 0).startsWith('TSLA')).toBe(true)
  expect(cellsOf(scan).filter(c => c.cp === 0x2503 && c.fg === COLORS.fan)).toHaveLength(3)
  expect(cellsOf(scan).some(c => c.cp === GLYPHS.range50 && c.fg === COLORS.fan && c.bg === DEFAULT)).toBe(true)
  expect(cellsOf(scan).some(c => c.cp === 0x2502 && c.fg === COLORS.neutral)).toBe(true)
  expect(cellsOf(scan).every(c => c.bg === DEFAULT)).toBe(true)
  expect(rasterFor(fromText('analyze_asset', CARD_MD, 1)!, 60, 10)).toBeNull()
  expect(rasterFor(fromText('plan_check', PLAN_MD, 1)!, 60, 10)).toBeNull()
})
