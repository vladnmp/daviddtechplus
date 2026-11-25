// Bar replay keeps its promise: nothing after the replay point, and not the live price, shows on any surface,
// in any command's answer or in Claude's tools. The hidden candles carry sentinel prices (54,3xx) to look for.

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import { CHART_TOOL_NAME, HISTORY_TOOL_NAME, READ_TOOL_NAME, TEST_TOOL_NAME } from '../hooks/register'
import { BAND, NOW, PANE, candlesFixture, engine, typed } from './fixtures'

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

type Node = { text?: unknown; props?: Record<string, unknown>; children?: unknown[] }
/** Every word and string prop under a drawn tree: texts, labels, SVG sources. */
function wordsOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (!node || typeof node !== 'object') return ''
  const n = node as Node
  const own = typeof n.text === 'string' ? n.text : ''
  const props = Object.entries(n.props ?? {})
    .filter(([k, v]) => typeof v === 'string' && k !== 'key')
    .map(([, v]) => v as string)
    .join(' ')
  const kids = (n.children ?? []).map(wordsOf).join(' ')
  return `${own} ${props} ${kids}`
}

const HIDDEN = /54,3\d\d|97,123/

test('nothing after the replay point, nor the live price, shows anywhere', async ($, on) => {
  const rows = candlesFixture()
  rows.slice(-10).forEach((r, i) => {
    const p = (54_310 + i).toFixed(1)
    Object.assign(r, { o: p, h: p, l: p, c: p })
  })
  const w = engine(on, { candles: () => rows })
  mock.clock(on, { now: NOW })
  memStore(on)
  on('tool.register', (_, e) => ({ value: { tool: `mcp__lab-desk__${e.name}` } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(typed('lab-watch', ''))
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  await $.command.run(typed('lab-ind', 'ema 20, rsi'))
  // A note on a candle that replay will hide.
  await $.tool.call({ tool: CHART_TOOL_NAME, marks: [{ time: new Date(NOW - 3 * 3_600_000).toISOString(), label: 'peekaboo' }] })
  const sawStatus = w.statuses.length
  expect((await $.command.run(typed('lab-chart', 'replay 10'))).text).toMatch(/10 later candles hidden/)

  const said: string[] = []
  for (const [cmd, args] of [
    ['lab-ind', ''],
    ['lab-ind', 'macd'],
    ['lab-ind', 'save practice'],
    ['lab-ind', 'load practice'],
    ['lab-ind', 'export pine'],
    ['lab-mark', ''],
    ['lab-mark', 'fib'],
    ['lab-mark', 'trend lows'],
    ['lab-alert', ''],
    ['lab-after', 'rsi < 50'],
    ['lab-like', ''],
    ['lab-test', 'rsi < 50 exit rsi > 55'],
    ['lab', ''],
  ] as const) said.push(`${cmd} ${args}: ${(await $.command.run(typed(cmd, args))).text ?? ''}`)
  for (const input of [{ add: ['atr'] }, { marks: [{ price: 90_000, label: 'floor' }] }, {}]) {
    const r = await $.tool.call({ tool: CHART_TOOL_NAME, ...input })
    said.push(String(r.result ?? r.deny))
  }
  for (const input of [{ candles: 300 }, { export: 'pine' }, { export: 'python' }]) {
    const r = await $.tool.call({ tool: READ_TOOL_NAME, ...input })
    said.push(String(r.result ?? r.deny))
  }
  for (const input of [{ mode: 'after', when: 'close > 0' }, { mode: 'like', window: 10, ahead: 3 }]) {
    const r = await $.tool.call({ tool: HISTORY_TOOL_NAME, ...input })
    said.push(String(r.result ?? r.deny))
  }
  {
    const r = await $.tool.call({ tool: TEST_TOOL_NAME, enter: 'close > 0', hold: 1 })
    said.push(String(r.result ?? r.deny))
  }
  // After the history tools pinned their layers, the chart and its CSV still end at the replay point.
  {
    const r = await $.tool.call({ tool: READ_TOOL_NAME, candles: 300 })
    said.push(String(r.result ?? r.deny))
  }
  said.push(...w.statuses.slice(sawStatus).map(s => s ?? ''))
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const placement of ['dock', 'widget'] as const) {
      const pane = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, placement } })
      said.push(...(await pane.findAll({ type: 'Text' })).map(wordsOf))
      said.push(...(await pane.findAll({ type: 'Button' })).map(wordsOf))
      said.push(...(await pane.findAll({ type: 'Svg' })).map(wordsOf))
      await pane.unmount()
    }
  }
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const bandWords = [...(await band.findAll({ type: 'Text' })), ...(await band.findAll({ type: 'Button' }))].map(wordsOf).join(' ')
  said.push(bandWords)
  await band.unmount()

  const leaks = said.filter(s => HIDDEN.test(s)).map(s => s.slice(Math.max(0, s.search(HIDDEN) - 80), s.search(HIDDEN) + 40))
  expect(leaks).toEqual([])
  // The note on a hidden candle stays hidden too, and the band still shows the other coins.
  expect(said.join('\n')).not.toMatch(/peekaboo/)
  expect(bandWords).toMatch(/ETH/)

  // Switching coin ends the replay and says so.
  expect((await $.command.run(typed('lab-chart', 'ETH'))).text).toMatch(/Bar replay ended with the switch\./)
  expect(String((await $.tool.call({ tool: READ_TOOL_NAME })).result ?? '')).not.toMatch(/Bar replay is on/)
})
