// Bar replay: later candles hidden everywhere (both charts, Claude's reads, saves), stepped forward by Next.

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import { CHART_TOOL_NAME, READ_TOOL_NAME, candlesUpTo } from '../hooks/register'
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

test('candles up to a time, never fewer than two', () => {
  const c = [1, 2, 3, 4].map(t => ({ t }))
  expect(candlesUpTo(c, 3)).toEqual([{ t: 1 }, { t: 2 }, { t: 3 }])
  expect(candlesUpTo(c, 0)).toEqual([{ t: 1 }, { t: 2 }])
  expect(candlesUpTo(c, 99)).toHaveLength(4)
})

test('/lab-chart replay hides the later candles, Next walks forward, the end goes live', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  memStore(on)
  expect((await $.command.run(typed('lab-chart', 'replay'))).text).toMatch(/^Open a chart first/)
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  const start = (await $.command.run(typed('lab-chart', 'replay 10'))).text ?? ''
  expect(start).toMatch(/^Bar replay from 2026-11-16 \d\d:00 UTC: 10 later candles hidden\./)

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await pane.find({ type: 'Text', text: /^REPLAY/ }))?.text).toMatch(/^REPLAY .+ · 10 candles hidden · what comes next\?$/)
  // The live price would give it away.
  expect((await pane.find({ type: 'Text', text: /^BTC-PERP/ }))?.text).not.toContain('97,123')
  expect(await pane.find({ type: 'Button', key: 'replay' })).toBeFalsy()
  await pane.press({ key: 'replay-next' })
  expect((await pane.find({ type: 'Text', text: /^REPLAY/ }))?.text).toMatch(/· 9 candles hidden/)
  await pane.unmount()

  expect((await $.command.run(typed('lab-chart', 'next 3'))).text).toMatch(/^Replay at .+ UTC, close [\d,.]+; 6 candles still hidden\.$/)
  expect((await $.command.run(typed('lab-chart', 'next 50'))).text).toBe('Replay reached the live candle; the chart is live again.')
  const live = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await live.find({ type: 'Text', text: /^REPLAY/ })).toBeFalsy()
  expect(await live.find({ type: 'Button', key: 'replay' })).toBeTruthy()
  await live.press({ key: 'replay' })
  expect((await live.find({ type: 'Text', text: /^REPLAY/ }))?.text).toMatch(/candles hidden/)
  await live.unmount()
  expect((await $.command.run(typed('lab-chart', 'replay off'))).text).toBe('Replay off: the chart is live again.')
  expect((await $.command.run(typed('lab-chart', 'replay 2026-11-15 18:00'))).text).toMatch(/^Bar replay from 2026-11-15 18:00 UTC: 17 later candles hidden/)
  expect((await $.command.run(typed('lab-chart', 'replay someday'))).text).toMatch(/^Replay from where\?/)
})

test("Claude's reads stop at the replay point and say not to tell", async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  memStore(on)
  on('tool.register', (_, e) => ({ value: { tool: `mcp__lab-desk__${e.name}` } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = String((await $.tool.call({ tool: CHART_TOOL_NAME, coin: 'BTC', add: ['rsi'], replay: '12' })).result ?? '')
  expect(r).toMatch(/Bar replay from .+: 12 later candles hidden/)
  expect(r).toMatch(/Bar replay is on at .+ UTC \(close [\d,.]+\): the person is practising/)
  expect(r).not.toMatch(/Price 97,123/)
  const read = String((await $.tool.call({ tool: READ_TOOL_NAME, candles: 5 })).result ?? '')
  const rows = read.split('\n').filter(l => /^2026-/.test(l))
  expect(rows).toHaveLength(5)
  const cut = new Date(NOW - 13 * 3_600_000).toISOString().slice(0, 16)
  expect(rows.at(-1)?.startsWith(cut)).toBe(true)
  const step = String((await $.tool.call({ tool: CHART_TOOL_NAME, replay: 'next 2' })).result ?? '')
  expect(step).toMatch(/10 candles still hidden/)
  const off = String((await $.tool.call({ tool: CHART_TOOL_NAME, replay: 'off' })).result ?? '')
  expect(off).toMatch(/Replay off/)
  expect(off).toMatch(/Price 97,123/)
  expect(r + step).not.toMatch(/\b(buy|sell|signals?|targets?|edge)\b/i)
})
