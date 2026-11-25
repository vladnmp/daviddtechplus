// Layouts: a named set of indicators, saved once and put on any chart (TradingView's indicator templates).

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import { CHART_TOOL_NAME } from '../hooks/register'
import { NOW, engine, typed } from './fixtures'

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

test('/lab-ind save, load, layouts and forget', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  expect((await $.command.run(typed('lab-ind', 'layouts'))).text).toMatch(/^No layouts saved yet/)
  expect((await $.command.run(typed('lab-ind', 'save swing'))).text).toMatch(/^Nothing to save yet/)
  await $.command.run(typed('lab-ind', 'ema 20, ema 50, rsi'))
  expect((await $.command.run(typed('lab-ind', 'save'))).text).toMatch(/^Give it a name/)
  const saved = (await $.command.run(typed('lab-ind', 'save Swing Setup!'))).text ?? ''
  expect(saved).toBe('Saved layout "swing setup": EMA 20 · EMA 50 · RSI 14. Put it on any chart: /lab-ind load swing setup.')
  expect(store.get('layouts')).toEqual({ 'swing setup': ['ema 20', 'ema 50', 'rsi 14'] })
  await $.command.run(typed('lab-ind', 'clear'))
  await $.command.run(typed('lab-ind', 'macd'))
  const loaded = (await $.command.run(typed('lab-ind', 'load swing setup'))).text ?? ''
  expect(loaded).toMatch(/^Loaded "swing setup"\..*On the chart: EMA 20 · EMA 50 · RSI 14\.$/)
  expect(store.get('studies')).toEqual(['ema 20', 'ema 50', 'rsi 14'])
  expect((await $.command.run(typed('lab-ind', 'load nope'))).text).toBe('No layout called "nope". Yours: swing setup.')
  expect((await $.command.run(typed('lab-ind', 'layouts'))).text).toBe('Layouts (/lab-ind load <name>):\n· swing setup: EMA 20 · EMA 50 · RSI 14')
  expect((await $.command.run(typed('lab-ind', 'forget swing setup'))).text).toBe('Forgot layout "swing setup".')
  expect(store.get('layouts')).toEqual({})
  // "remove" and "delete" still take indicators off.
  expect((await $.command.run(typed('lab-ind', 'delete ema'))).text).toMatch(/Removed EMA 20 · EMA 50/)
})

test('Claude saves and loads layouts through the chart tool', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  on('tool.register', (_, e) => ({ value: { tool: `mcp__lab-desk__${e.name}` } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const a = String((await $.tool.call({ tool: CHART_TOOL_NAME, coin: 'BTC', add: ['adx', 'hma 21'], save_layout: 'trend check' })).result ?? '')
  expect(a).toMatch(/Saved layout "trend check": ADX 14 14 · HMA 21\./)
  await $.tool.call({ tool: CHART_TOOL_NAME, clear: true })
  const b = String((await $.tool.call({ tool: CHART_TOOL_NAME, layout: 'trend check' })).result ?? '')
  expect(b).toMatch(/Loaded "trend check"/)
  expect(b).toMatch(/Indicators: ADX 14 14 · HMA 21\./)
  expect(store.get('studies')).toEqual(['adx 14 14', 'hma 21'])
})
