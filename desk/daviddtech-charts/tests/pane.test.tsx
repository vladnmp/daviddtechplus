import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { BRIEF_MD, ERROR_TEXT, PLAN_MD, SCAN_MD } from './fixtures'

const TOOL = 'mcp__claude_ai_DaviddTech___analyze_asset'
const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

const PANE = {
  plugin: 'daviddtech-charts',
  component: 'Pane',
  requestId: 'daviddtech-chart',
  props: {
    title: 'DaviddTech+ chart',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

type Opened = { id: string; title?: string; focus?: true }

/** The engine beneath the plugin: a desktop session whose tool answers `text`. */
function engine(on: On, text: string, opened: Opened[], { isError = false, surfaces = ['desktop'] as const as readonly ('terminal' | 'desktop')[] } = {}) {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'daviddtech-chart' } }))
  on('ui.open', (_, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('session.surfaces', () => ({ value: surfaces }))
  on('tool.call', () => (isError ? { isError: true, result: text, text } : { result: [{ type: 'text', text }], text }))
}

test('a forecast opens the pane and passes the answer through unchanged', async ($, on) => {
  const opened: Opened[] = []
  engine(on, BRIEF_MD, opened)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ran = await $.tool.call({ tool: TOOL, symbol: 'NVDA' })

  expect(ran.text).toBe(BRIEF_MD)
  expect(ran.result).toEqual([{ type: 'text', text: BRIEF_MD }])
  expect(opened[0]?.id).toBe('daviddtech-chart')
  expect(opened[0]?.focus).toBeUndefined()

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const raster = await term.find({ type: 'Raster' })
  expect(raster?.props.columns).toBe(80)
  expect(raster?.props.rows).toBe(20)
  expect((await term.find({ type: 'Text', text: /^NVDA · next 10 trading sessions/ }))?.text).toBe(
    'NVDA · next 10 trading sessions · from 13 Nov close',
  )
  expect(await term.find({ type: 'Text', text: /^13 Nov +30 Nov$/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: 'Resistance +5.00% major (643.02) · touch 41%' })).toBeDefined()
  expect(await term.find({ type: 'Button', key: 'odds' })).toBeDefined()
  expect((await term.find({ type: 'Text', text: /^Source:/ }))?.text).toBe('Source: DaviddTech+ (skool.com/daviddtech/about)')
  await term.unmount()

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const svg = await ui.find({ type: 'Svg' })
    expect(String(svg?.props.alt)).toContain('NVDA')
    expect(String(svg?.props.source).startsWith('<svg')).toBe(true)
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a suggestion button fills the prompt box', async ($, on) => {
  const opened: Opened[] = []
  const fills: string[] = []
  engine(on, BRIEF_MD, opened)
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  await $.tool.call({ tool: TOOL, symbol: 'NVDA' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'odds' })
  expect(fills[0]).toBe('Use DaviddTech+ level_odds on NVDA for +5%, -3% by 30 Nov')
  await ui.unmount()
})

test('the widget seat shows the summary only', async ($, on) => {
  engine(on, BRIEF_MD, [])
  await $.tool.call({ tool: TOOL, symbol: 'NVDA' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, placement: 'widget' } })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /chance higher 56%/ })).toBeDefined()
  await ui.unmount()
})

test('plans draw as progress bars, scans as ranges', async ($, on) => {
  let text = PLAN_MD
  on('tool.call', () => ({ result: [{ type: 'text', text }], text }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  await $.tool.call({ tool: 'mcp__daviddtechplus__plan_check', symbol: 'NVDA' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: /Profit exit 1 first \(if opened\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Plan 2 \(down\): opens at 630, loss exit 645$/ })).toBeDefined()
    await ui.unmount()
  }
  text = SCAN_MD
  await $.tool.call({ tool: 'mcp__daviddtechplus__scan_assets', symbols: 'TSLA NVDA BTC' })
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Raster' }))?.props.rows).toBe(3)
  await term.unmount()
})

test('the empty pane says so on every surface', async $ => {
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text' }))?.text).toBe('No DaviddTech+ forecast yet.')
    await ui.unmount()
  }
})

test('an error answer leaves no chart', async ($, on) => {
  const opened: Opened[] = []
  engine(on, ERROR_TEXT, opened, { isError: true })
  const ran = await $.tool.call({ tool: TOOL, symbol: 'ZZZZ' })
  expect(ran.isError).toBe(true)
  expect(opened).toHaveLength(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('No DaviddTech+ forecast yet.')
  await ui.unmount()
})

test('another server with the same tool name is left alone', async ($, on) => {
  const opened: Opened[] = []
  engine(on, BRIEF_MD, opened)
  await $.tool.call({ tool: 'mcp__other__analyze_asset', symbol: 'NVDA' })
  expect(opened).toHaveLength(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('No DaviddTech+ forecast yet.')
  await ui.unmount()
})

test('autoOpen never keeps the chart but does not open the pane', { options: { autoOpen: 'never' } }, async ($, on) => {
  const opened: Opened[] = []
  engine(on, BRIEF_MD, opened)
  await $.tool.call({ tool: TOOL, symbol: 'NVDA' })
  expect(opened).toHaveLength(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
})

test('sidebar mode on a terminal-only session does not open unasked', async ($, on) => {
  const opened: Opened[] = []
  engine(on, BRIEF_MD, opened, { surfaces: ['terminal'] })
  await $.tool.call({ tool: TOOL, symbol: 'NVDA' })
  expect(opened).toHaveLength(0)
})

const BAND = {
  plugin: 'daviddtech-charts',
  component: 'AbovePrompt',
  requestId: 'band',
  surface: 'terminal',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

test('a fullscreen terminal opens unasked only from 144 columns', async ($, on) => {
  const opened: Opened[] = []
  engine(on, BRIEF_MD, opened, { surfaces: ['terminal'] })
  const narrow = await $.ui.mount({ ...BAND, viewport: { columns: 120, rows: 40, isFullscreen: true } })
  await narrow.unmount()
  await $.tool.call({ tool: TOOL, symbol: 'NVDA' })
  expect(opened).toHaveLength(0)

  const wide = await $.ui.mount({ ...BAND, viewport: { columns: 160, rows: 40, isFullscreen: true } })
  await wide.unmount()
  await $.tool.call({ tool: TOOL, symbol: 'NVDA' })
  expect(opened.map(o => o.id)).toEqual(['daviddtech-chart'])
  // Placed beside the chat: the band steps aside, no second "Chart" button.
  const after = await $.ui.mount({ ...BAND, viewport: { columns: 160, rows: 40, isFullscreen: true } })
  expect(await after.find({ type: 'Button', key: 'chart' })).toBeUndefined()
  await after.unmount()
})

test('an unplaced auto-open keeps the band', async ($, on) => {
  on('tool.call', () => ({ result: [{ type: 'text', text: BRIEF_MD }], text: BRIEF_MD }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no surface places panes' } }))
  await $.tool.call({ tool: TOOL, symbol: 'NVDA' })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Button', key: 'chart' })).toBeDefined()
  await band.unmount()
})
