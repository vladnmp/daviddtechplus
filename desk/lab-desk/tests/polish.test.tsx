// The desk polish: caption ladder, palettes, the soft fan, hollow candles,
// data age and READ-ONLY, and the line view under 40 columns.

import { expect, mock, test } from 'claude-code/testing'

import { parseCandles } from '../hooks/data'
import {
  DEFAULT,
  FAN_GLYPHS,
  LABEL,
  PALETTES,
  chartCells,
  chartSvg,
  layoutFor,
  lineCells,
  lineReadout,
  timeAxis,
} from '../hooks/draw'
import { fanCaption, fanFrom, legendLine, rangeCaption } from '../hooks/forecast'
import { BAND, BRIEF_FIXTURE, NOW, PANE, candlesFixture, engine, typed } from './fixtures'
import type { WorldOptions } from './fixtures'

const BANNED = /\b(buy|buying|sell|selling|signal|signals|target|targets|edge)\b|expected move/i
const candles = parseCandles(candlesFixture(200))
const fan = fanFrom(BRIEF_FIXTURE)

function luminance(rgb: number): number {
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin((rgb >> 16) & 255) + 0.7152 * lin((rgb >> 8) & 255) + 0.0722 * lin(rgb & 255)
}

function contrast(a: number, b: number): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

test('caption ladder: the first form that fits, at 40, 56, 72, 90 and 110 columns', async () => {
  const at = (columns: number) => rangeCaption('58,959', '70,177', 5, 'days', columns)
  const f1 = '80% range 58,959 to 70,177 · 1 in 10 ends above 70,177, 1 in 10 below 58,959 (5 days)'
  const f2 = '80% range 58,959 to 70,177 · 1 in 10 ends above, 1 in 10 below (5 days)'
  const f3a = '80% range 58,959 to 70,177 (5 days)'
  expect(f1).toHaveLength(85)
  expect(f2).toHaveLength(71)
  expect(at(110)).toEqual([f1])
  expect(at(90)).toEqual([f1])
  expect(at(72)).toEqual([f2])
  expect(at(56)).toEqual([f3a, '1 in 10 ends above 70,177, 1 in 10 below 58,959'])
  expect(at(40)).toEqual([f3a, '1 in 10 ends above, 1 in 10 below'])
  expect(at(30)).toEqual(['80% 58,959 to 70,177 (5d)', '1 in 10 above, 1 in 10 below'])
  // Sessions have no short "d" form; one step is singular.
  expect(rangeCaption('-9.3%', '+13.0%', 5, 'trading sessions', 30)[0]).toBe('80% range -9.3% to +13.0% (5 sessions)')
  expect(rangeCaption('1', '2', 1, 'days', 200)[0]).toContain('(1 day)')
  for (const columns of [20, 30, 40, 56, 72, 90, 110]) {
    for (const line of at(columns)) expect(BANNED.test(line)).toBe(false)
    const c = fanCaption(fan!, 97_000, p => p.toFixed(0), columns)
    expect(BANNED.test(`${c.lineA} ${c.lineB}`)).toBe(false)
  }
})

test('the legend names the darker shade and the start, as much as fits', async () => {
  const fmt = (p: number) => p.toFixed(0)
  expect(legendLine(fan!, 97_000, fmt, 200)).toMatch(/^Darker shade: 50% range \d+ to \d+ · middle \d+ · from the 15 Nov close$/)
  expect(legendLine(fan!, 97_000, fmt, 60)).toMatch(/^Darker shade: 50% range \d+ to \d+ · middle \d+$/)
  expect(legendLine(fan!, 97_000, fmt, 40)).toMatch(/^50% range \d+ to \d+ · middle \d+$/)
  expect(legendLine(fan!, 97_000, fmt, 20)).toMatch(/^50% range \d+ to \d+$/)
  expect(legendLine({ ...fan!, referencePrice: null }, 97_000, fmt, 200)).toContain('· from the latest price')
  // A one-line caption gets the legend under it; a two-line caption does not.
  expect(fanCaption(fan!, 97_000, fmt, 110).isLegend).toBe(true)
  expect(fanCaption(fan!, 97_000, fmt, 50).isLegend).toBe(false)
})

test('every palette color reads at least 2.95:1 on white and on #1e1e1e; the axis label too', async () => {
  for (const pal of Object.values(PALETTES)) {
    for (const color of [pal.up, pal.down, pal.fan]) {
      expect(contrast(color, 0xffffff)).toBeGreaterThanOrEqual(2.95)
      expect(contrast(color, 0x1e1e1e)).toBeGreaterThanOrEqual(2.95)
    }
    // The fan ink sits between the two candle colors in brightness.
    const [a, b] = [luminance(pal.up), luminance(pal.down)].sort((p, q) => p - q) as [number, number]
    expect(luminance(pal.fan)).toBeGreaterThanOrEqual(a - 0.03)
    expect(luminance(pal.fan)).toBeLessThanOrEqual(b + 0.03)
  }
  expect(contrast(LABEL, 0xffffff)).toBeGreaterThanOrEqual(2.95)
  expect(contrast(LABEL, 0x1e1e1e)).toBeGreaterThanOrEqual(2.95)
  expect(PALETTES.colorblind).toEqual({ up: 0x0072b2, down: 0xd68000, upText: 0xffffff, downText: 0x14171c, fan: 0x77808c })
})

test('the terminal fan: shade glyphs and a thin middle in one ink, never a solid block', async () => {
  for (const palette of Object.values(PALETTES)) {
    const columns = 120
    const rows = 24
    const L = layoutFor({ candles, cursor: 0, fan, palette }, columns)
    const cells = chartCells({ candles, cursor: 0, fan, palette }, columns, rows)
    const zone: [number, number, number][] = []
    for (let y = 0; y < rows; y++) for (let x = L.plot + 1; x < L.plot + L.fan; x++) zone.push(cells[y * columns + x] as [number, number, number])
    const inked = zone.filter(c => c[1] === palette.fan)
    expect(inked.length).toBeGreaterThan(20)
    expect(inked.every(c => [FAN_GLYPHS.range80, FAN_GLYPHS.range50, FAN_GLYPHS.middle].includes(c[0] as 0x2591))).toBe(true)
    expect(zone.some(c => c[2] === palette.fan)).toBe(false)
    expect(zone.some(c => c[1] === palette.fan && (c[0] === 0x2588 || c[0] === 0x2580 || c[0] === 0x2584))).toBe(false)
    expect(zone.every(c => c[2] === DEFAULT)).toBe(true)
    for (const glyph of Object.values(FAN_GLYPHS)) expect(inked.some(c => c[0] === glyph)).toBe(true)
  }
})

test('SVG: hollow up candles on a fixed pitch, 62 with the fan and 80 without', async () => {
  const withFan = chartSvg({ candles, cursor: 0, fan }, '1h', 'BTC', 'next 5d')
  const without = chartSvg({ candles, cursor: 0, fan: null }, '1h', 'BTC', null)
  expect(withFan.match(/<g><title>/g)).toHaveLength(62)
  expect(without.match(/<g><title>/g)).toHaveLength(80)
  expect(withFan).toMatch(/<rect [^>]*fill="transparent" stroke="#26a69a" stroke-width="1.5"\/>/)
  expect(withFan).toMatch(/<rect [^>]*width="5.6" [^>]*fill="#ef5350"\/>/)
  // The middle path: fan ink, thin and see-through, never brighter than a candle.
  expect(withFan).toContain('fill="none" stroke="#4c8bf5" stroke-width="1" stroke-opacity="0.6"')
  expect(withFan).not.toContain('#a8c7ff')
  // The hover text carries the signed change.
  expect(withFan).toMatch(/C [\d,]+ {2}[+-]\d+\.\d\d%<\/title>/)
  const blind = chartSvg({ candles, cursor: 0, fan, palette: PALETTES.colorblind }, '1h', 'BTC', 'next 5d')
  expect(blind).toContain('#0072b2')
  expect(blind).toContain('#d68000')
  expect(blind).toContain('fill="#77808c" fill-opacity="0.18"')
  expect(blind).not.toContain('#26a69a')
})

test('line view: only spaces, braille and axis glyphs; one color; the short readout', async () => {
  for (const [columns, rows] of [
    [20, 4],
    [28, 8],
    [38, 12],
  ] as const) {
    const cells = lineCells({ candles, cursor: 0, fan }, columns, rows)
    expect(cells).toHaveLength(columns * rows)
    const axisAt = columns >= 30 ? columns - 11 : columns
    let braille = 0
    cells.forEach(([cp], i) => {
      const x = i % columns
      const isAxisGlyph = cp === 0x2502 || cp === 0x2524 || (cp >= 0x20 && cp <= 0x7e)
      const isBraille = cp > 0x2800 && cp <= 0x28ff
      if (isBraille) braille++
      expect(cp === 0x20 || isBraille || (x >= axisAt - 3 && isAxisGlyph)).toBe(true)
    })
    expect(braille).toBeGreaterThan(columns / 2)
    const colors = new Set(cells.filter(c => c[0] > 0x2800 && c[0] <= 0x28ff).map(c => c[1]))
    expect(colors.size).toBe(1)
  }
  expect(lineReadout(candles, 0, '1h')).toMatch(/^[\d,]+ [+-]\d+\.\d\d% · \w{3} \d+ \w{3} \d{2}:00$/)
  expect(lineReadout(candles, 3, '1h').startsWith('3 back · ')).toBe(true)
  expect(timeAxis({ candles, cursor: 0, fan: null }, '1h', 38, null, true).length).toBeLessThanOrEqual(38)
})

test('under 40 columns the pane draws the line view; captions still show, in their narrow forms', async ($, on) => {
  engine(on, { tools: ['mcp__daviddtechplus__analyze_asset'], mcp: () => ({ content: [{ type: 'text', text: 'b' }], isError: false, structuredContent: BRIEF_FIXTURE }) })
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.command.run(typed('lab-chart', 'BTC'))
  for (const bodyColumns of [28, 38]) {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns } })
    expect((await ui.find({ type: 'Raster' }))?.props.columns).toBe(bodyColumns)
    expect(await ui.find({ type: 'Text', text: /^[\d,]+ [+-]\d+\.\d\d% · / })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^80% / }))?.text).toMatch(/^80% (range )?[\d,]+ to [\d,]+ \(5( days|d)\)$/)
    expect((await ui.find({ type: 'Text', text: /^1 in 10 / }))?.text).toMatch(/^1 in 10 /)
    await ui.unmount()
  }
  const wide = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 40 } })
  // At 40 columns the candle readout keeps the prices first; with room it starts with the time.
  expect(await wide.find({ type: 'Text', text: /^O [\d,]+ H [\d,]+ L [\d,]+ C [\d,]+/ })).toBeDefined()
  await wide.unmount()
  const roomy = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 120 } })
  expect(await roomy.find({ type: 'Text', text: /^last · / })).toBeDefined()
  await roomy.unmount()
})

test('palette colorblind reaches the pane', { options: { palette: 'colorblind' } }, async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.command.run(typed('lab-chart', 'BTC'))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('#0072b2')
  expect(source).not.toContain('#26a69a')
  await ui.unmount()
})

type Found = { text: string; props: Record<string, unknown>; children: unknown[] }
type Mounted = { findAll: (q: { type: string; key?: string }) => Promise<Found[]> }

/** The words under a drawn element, its own text first, else its children's. */
function wordsOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (!node || typeof node !== 'object') return ''
  const n = node as { text?: unknown; children?: unknown[]; props?: { children?: unknown } }
  if (typeof n.text === 'string' && n.text !== '') return n.text
  const kids = n.children && n.children.length > 0 ? n.children : n.props?.children === undefined ? [] : [n.props.children].flat()
  return kids.map(wordsOf).join('')
}

/** The stale marks: words in a grey outline. Each is `{ text, outline }`, outline being `style/color`. */
const outlined = async (ui: Mounted) =>
  (await ui.findAll({ type: 'Box', key: 'stale' })).map(b => ({ text: wordsOf(b).trim(), outline: `${String(b.props.borderStyle)}/${String(b.props.borderColor)}` }))

/** Any Text drawn in a color of its own for stale data (amber, or the colorblind orange): there must be none. */
const colored = async (ui: Mounted) =>
  (await ui.findAll({ type: 'Text' })).filter(t => /stale/i.test(t.text) && t.props.color !== undefined).map(t => t.text)

const GREY = 'round/inactive'

// The colorblind down color is orange (#d68000); an amber stale mark (the theme's `warning`) would read like it,
// so stale data is said in plain words inside a grey outline (the theme's `inactive`), in every palette.
for (const palette of ['classic', 'colorblind'] as const) {
  test(`with the ${palette} palette, the pane and widget mark stale data with a grey outline, on terminal and desktop`, { options: { palette } }, async ($, on) => {
    const opts: WorldOptions = {}
    engine(on, opts)
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    await $.command.run(typed('lab-chart', 'BTC 1h'))
    opts.isFetchDown = true
    await clock.advance(60_000)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await outlined(ui)).toEqual([{ text: 'Stale 1m · Hyperliquid answered 503 · retrying every 30 s', outline: GREY }])
      expect(await colored(ui)).toEqual([])
      expect(await ui.findAll({ type: 'Text', text: /stale/i })).toHaveLength(1)
      await ui.unmount()
    }
    const widget = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, placement: 'widget' } })
    expect(await outlined(widget)).toEqual([{ text: 'stale 1m', outline: GREY }])
    expect(await colored(widget)).toEqual([])
    await widget.unmount()
  })
}

test('one failed refresh shows nothing; two in a row show a grey-outlined "stale" in the pane, widget and status', async ($, on) => {
  const opts: WorldOptions = {}
  const w = engine(on, opts)
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  opts.isFetchDown = true

  await clock.advance(30_000)
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await outlined(ui)).toEqual([])
  expect(await ui.find({ type: 'Text', text: /stale/i })).toBeUndefined()
  expect(w.statuses.at(-1)).toBe('Lab desk READ-ONLY · as of 12:00:00 UTC · BTC 97,123 +1.2% · funding +10.95%/yr')
  await ui.unmount()

  await clock.advance(30_000)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await outlined(ui)).toEqual([{ text: 'Stale 1m · Hyperliquid answered 503 · retrying every 30 s', outline: GREY }])
  expect(await colored(ui)).toEqual([])
  expect((await ui.find({ type: 'Text', text: /Market data/ }))?.text).toBe('READ-ONLY · as of 12:00:00 UTC · Market data: Hyperliquid public API')
  await ui.unmount()
  expect(w.statuses.at(-1)).toBe('Lab desk READ-ONLY · stale 1m · BTC 97,123 +1.2% · funding +10.95%/yr')
  const widget = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, placement: 'widget' } })
  expect(await outlined(widget)).toEqual([{ text: 'stale 1m', outline: GREY }])
  await widget.unmount()

  // Data again: fresh, no outline.
  opts.isFetchDown = false
  await clock.advance(30_000)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await outlined(ui)).toEqual([])
  await ui.unmount()
  expect(w.statuses.at(-1)).toBe('Lab desk READ-ONLY · as of 12:01:30 UTC · BTC 97,123 +1.2% · funding +10.95%/yr')
})

test('the watchlist band adds a grey-outlined "stale" after two failed refreshes, not one', async ($, on) => {
  const opts: WorldOptions = {}
  engine(on, opts)
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  await $.command.run(typed('lab-watch', 'BTC ETH'))
  opts.isFetchDown = true
  await clock.advance(30_000)
  const early = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await outlined(early)).toEqual([])
  await early.unmount()
  await clock.advance(30_000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await outlined(band)).toEqual([{ text: 'stale 1m', outline: GREY }])
    expect(await colored(band)).toEqual([])
    expect(await band.findAll({ type: 'Button' })).toHaveLength(2)
    await band.unmount()
  }
  const narrow = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 30 } })
  expect(await outlined(narrow)).toEqual([{ text: 'stale 1m', outline: GREY }])
  expect(await colored(narrow)).toEqual([])
  expect(await narrow.find({ type: 'Text', text: /^BTC .* · ETH / })).toBeDefined()
  await narrow.unmount()
})