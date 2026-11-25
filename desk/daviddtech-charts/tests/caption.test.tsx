// The 80% range in words under the fan, the summary's order, and colors that
// read on light and dark terminals.

import { expect, test } from 'claude-code/testing'

import { FORBIDDEN, captionOf, rangeCaption, summaryOf } from '../hooks/model'
import { fromText } from '../hooks/parse'
import { COLORS } from '../hooks/raster'
import { scanSvg } from '../hooks/svg'
import { BRIEF_MD, CARD_MD, ODDS_MD, SCAN_MD } from './fixtures'

const PANE = {
  plugin: 'daviddtech-charts',
  component: 'Pane',
  requestId: 'daviddtech-chart',
  props: { title: 'DaviddTech+ chart', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

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

type Node = { type?: unknown; text?: unknown; props?: Record<string, unknown>; children?: unknown[] }

function kids(n: Node): Node[] {
  const own = Array.isArray(n.children) ? n.children : []
  const pc = n.props?.children
  const fromProps = Array.isArray(pc) ? pc : pc === undefined ? [] : [pc]
  return [...own, ...fromProps].filter((c): c is Node => typeof c === 'object' && c !== null)
}

function words(n: unknown): string {
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (!n || typeof n !== 'object') return ''
  const node = n as Node
  const own = typeof node.text === 'string' ? node.text : ''
  const pc = node.props?.children
  const inner = Array.isArray(pc) ? pc.map(words).join('') : typeof pc === 'string' ? pc : ''
  return own || inner || (node.children ?? []).map(words).join('')
}

/** A box whose own children are the picture and the caption line. */
function boxWith(root: unknown, picture: string, caption: string): boolean {
  if (!root || typeof root !== 'object') return false
  const n = root as Node
  const children = kids(n)
  if (children.some(c => c.type === picture) && children.some(c => words(c).startsWith(caption))) return true
  return children.some(c => boxWith(c, picture, caption))
}

test('caption ladder in percents: the first form that fits at 40, 56, 72, 90 and 110 columns', () => {
  const at = (columns: number) => rangeCaption('-6.1%', '+8.0%', 10, 'trading sessions', columns)
  const f1 = '80% range -6.1% to +8.0% · 1 in 10 ends above +8.0%, 1 in 10 below -6.1% (10 sessions)'
  const f3a = '80% range -6.1% to +8.0% (10 sessions)'
  const f3b = '1 in 10 ends above +8.0%, 1 in 10 below -6.1%'
  expect(at(110)).toEqual([f1])
  expect(at(90)).toEqual([f1])
  expect(at(80)).toEqual(['80% range -6.1% to +8.0% · 1 in 10 ends above, 1 in 10 below (10 sessions)'])
  expect(at(72)).toEqual([f3a, f3b])
  expect(at(56)).toEqual([f3a, f3b])
  expect(at(40)).toEqual([f3a, '1 in 10 ends above, 1 in 10 below'])
  // Days get the short form; sessions keep theirs.
  expect(rangeCaption('-9.3%', '+13.0%', 5, 'days', 28)).toEqual(['80% -9.3% to +13.0% (5d)', '1 in 10 above, 1 in 10 below'])
  expect(rangeCaption('-9.3%', '+13.0%', 5, 'trading sessions', 28)[0]).toBe('80% range -9.3% to +13.0% (5 sessions)')
  for (const columns of [20, 28, 40, 56, 72, 90, 110]) for (const line of at(columns)) expect(FORBIDDEN.test(line)).toBe(false)
})

test('the caption comes from a brief with a path; a card or odds chart has none', () => {
  const brief = fromText('analyze_asset', BRIEF_MD, 1)!
  expect(captionOf(brief, 120)).toEqual(['80% range -6.1% to +8.0% · 1 in 10 ends above +8.0%, 1 in 10 below -6.1% (10 sessions)'])
  expect(captionOf(fromText('analyze_asset', CARD_MD, 1)!, 120)).toEqual([])
  expect(captionOf(fromText('level_odds', ODDS_MD, 1)!, 120)).toEqual([])
  // The summary puts the range before the middle, as the server's own text does.
  expect(summaryOf(brief).indexOf('80% range')).toBeLessThan(summaryOf(brief).indexOf('middle'))
})

test('the fan ink and the zero line read at least 2.95:1 on white and on #1e1e1e', () => {
  for (const color of [COLORS.fan, COLORS.neutral]) {
    expect(contrast(color, 0xffffff)).toBeGreaterThanOrEqual(2.95)
    expect(contrast(color, 0x1e1e1e)).toBeGreaterThanOrEqual(2.95)
  }
})

test('the pane shows the caption directly under the date axis or the chart, in the same box', async ($, on) => {
  on('tool.call', () => ({ result: [{ type: 'text', text: BRIEF_MD }], text: BRIEF_MD }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  await $.tool.call({ tool: 'mcp__daviddtechplus__analyze_asset', symbol: 'NVDA' })
  const f2 = '80% range -6.1% to +8.0% · 1 in 10 ends above, 1 in 10 below (10 sessions)'
  for (const [surface, picture] of [
    ['terminal', 'Raster'],
    ['desktop', 'Svg'],
  ] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const line = await ui.find({ type: 'Text', text: f2 })
    expect(line?.props.wrap).toBe('truncate-end')
    expect(boxWith(await ui.drawn(), picture, '80% range')).toBe(true)
    await ui.unmount()
  }
  const narrow = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 50 } })
  expect(await narrow.find({ type: 'Text', text: '80% range -6.1% to +8.0% (10 sessions)' })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: '1 in 10 ends above +8.0%, 1 in 10 below -6.1%' })).toBeDefined()
  await narrow.unmount()
})

test('the scan hover text and the editor rows lead with the 80% range, then the middle', async ($, on) => {
  const scan = fromText('scan_assets', SCAN_MD, 1)!
  const svg = scanSvg(scan)
  const tips = [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map(m => m[1] ?? '')
  expect(tips.length).toBe(scan.rows.length)
  for (const tip of tips) expect(tip.indexOf('80% range')).toBeLessThan(tip.indexOf('middle'))
  on('tool.call', () => ({ result: [{ type: 'text', text: SCAN_MD }], text: SCAN_MD }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.surfaces', () => ({ value: ['vscode'] }))
  await $.tool.call({ tool: 'mcp__daviddtechplus__scan_assets', symbols: 'TSLA,NVDA,BTC/USD' })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: 'TSLA: 80% range -14.0% to +16.2% · middle +0.8%' })).toBeDefined()
  await ui.unmount()
})
