// Formula indicators: "plot ta.ema(close, 20) - ta.ema(close, 50)". Our own parser (a whitelist, no eval), the same
// numbers as the built-ins, a price level on the chart and anything else in a pane, and Pine export as written.

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import { parseCandles } from '../hooks/data'
import { pineScript, pythonScript } from '../hooks/export'
import { formulaPane, parseFormula, splitTop } from '../hooks/formula'
import type { Node } from '../hooks/formula'
import { compute, parseSpec, specId } from '../hooks/indicators'
import type { Spec } from '../hooks/indicators'
import { CHART_TOOL_NAME } from '../hooks/register'
import { expandWords } from '../hooks/scan'
import { NOW, candlesFixture, engine, typed } from './fixtures'

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

const candles = parseCandles(candlesFixture(300))
const spec = (t: string) => {
  const s = parseSpec(t)
  if ('error' in s) throw new Error(s.error)
  return s as Spec
}
const values = (t: string, k = 0) => compute(spec(t), candles).series[k]?.values ?? []
const same = (a: readonly (number | null)[], b: readonly (number | null)[]) =>
  a.length === b.length && a.every((x, i) => (x === null ? b[i] === null : b[i] !== null && Math.abs(x - (b[i] as number)) < 1e-9))

test('a formula gives the same numbers as the built-in indicator', () => {
  // MACD's line is EMA fast minus EMA slow.
  expect(same(values('plot ta.ema(close, 20) - ta.ema(close, 50)'), values('macd 20 50 9', 1))).toBe(true)
  expect(same(values('plot ta.rsi(close, 14)'), values('rsi 14'))).toBe(true)
  expect(same(values('plot ta.sma(close, 20)'), values('sma 20'))).toBe(true)
  expect(same(values('plot ta.atr(14)'), values('atr 14'))).toBe(true)
  expect(same(values('plot ta.hma(close, 9)'), values('hma 9'))).toBe(true)
  const v = values('plot ta.ema(close, 20) - ta.ema(close, 50)')
  expect(v.filter(x => x !== null).length).toBeGreaterThan(200)
})

test('ta.vwma, ta.cci, ta.roc and ta.mom follow Pine', () => {
  const i = 150
  const c = candles.map(k => k.c)
  // ta.mom is ta.change; ta.roc is the same move in % of the old close.
  expect(same(values('plot ta.mom(close, 10)'), values('plot ta.change(close, 10)'))).toBe(true)
  expect(Math.abs((values('plot ta.roc(close, 9)')[i] as number) - (100 * ((c[i] as number) - (c[i - 9] as number))) / (c[i - 9] as number)) < 1e-9).toBe(true)
  // ta.vwma: sum(close * volume) / sum(volume) over the window; on the chart, like an average.
  const w = candles.slice(i - 19, i + 1)
  const vw = w.reduce((s, k) => s + k.c * k.v, 0) / w.reduce((s, k) => s + k.v, 0)
  expect(Math.abs((values('plot ta.vwma(close, 20)')[i] as number) - vw) < 1e-6).toBe(true)
  expect(compute(spec('plot ta.vwma(close, 20)'), candles).pane).toBe('price')
  // ta.cci: (src - mean) / (0.015 * mean absolute deviation), in its own pane.
  const src = w.map(k => (k.h + k.l + k.c) / 3)
  const mean = src.reduce((s, x) => s + x, 0) / 20
  const dev = src.reduce((s, x) => s + Math.abs(x - mean), 0) / 20
  expect(Math.abs((values('plot ta.cci(hlc3, 20)')[i] as number) - ((src[19] as number) - mean) / (0.015 * dev)) < 1e-9).toBe(true)
  expect(compute(spec('plot ta.cci(hlc3, 20)'), candles).pane).toBe('lower')
  expect(values('plot ta.cci(hlc3, 20)')[18]).toBeNull()
  // The scan words.
  expect(expandWords('cci < -100')).toBe('ta.cci(hlc3, 20) < -100')
  expect(expandWords('roc 12 > 5 and vwma 20')).toBe('ta.roc(close, 12) > 5 and ta.vwma(close, 20)')
  expect(expandWords('mom > 0')).toBe('ta.mom(close, 10) > 0')
})

test('a price level draws on the chart, anything else in a pane', () => {
  const pane = (t: string) => formulaPane(parseFormula(t) as Node)
  expect(pane('ta.ema(close, 20)')).toBe('price')
  expect(pane('(high + low) / 2')).toBe('price')
  expect(pane('close + 2 * ta.atr(14)')).toBe('price')
  expect(pane('math.max(ta.ema(close, 20), ta.sma(close, 50))')).toBe('price')
  expect(pane('ta.ema(close, 20) - ta.ema(close, 50)')).toBe('lower')
  expect(pane('close / ta.ema(close, 50)')).toBe('lower')
  expect(pane('ta.rsi(close, 14) - 50')).toBe('lower')
  expect(pane('volume')).toBe('lower')
  expect(compute(spec('plot hl2'), candles).pane).toBe('price')
  expect(compute(spec('plot ta.change(close, 3)'), candles).pane).toBe('lower')
})

test('only the whitelist reads: anything else is a plain error, never run', () => {
  for (const bad of [
    'plot eval(1)',
    'plot close; drop',
    'plot request.security(syminfo.tickerid, "D", close)',
    'plot close[1]',
    'plot ta.ema(close, x)',
    'plot ta.ema(close, 0)',
    'plot ta.ema(close)',
    'plot 1 + 2',
    'plot constructor',
    'plot',
    'plot (close',
    'plot close ** 2',
  ]) {
    const s = parseSpec(bad)
    expect('error' in s ? s.error : `parsed: ${bad}`).toMatch(/^Formula: |not part of a formula|Write a formula/)
  }
})

test('the same formula always reads the same way', () => {
  expect(specId(spec('plot TA.EMA( close ,20)-ta.ema(close,50)'))).toBe('plot ta.ema(close, 20) - ta.ema(close, 50)')
  expect(specId(spec('plot (close - open) / 2'))).toBe('plot (close - open) / 2')
  expect(specId(spec('plot close - (open - low)'))).toBe('plot close - (open - low)')
  expect(specId(spec('plot (close - open) - low'))).toBe('plot close - open - low')
  expect(specId(spec('plot -ta.change(close)'))).toBe('plot -ta.change(close)')
  expect(splitTop('ema 20, plot ta.ema(close, 20) - close; rsi and macd')).toEqual(['ema 20', 'plot ta.ema(close, 20) - close', 'rsi', 'macd'])
})

test('/lab-ind plot paints it, lists it, exports it to Pine as written and to Python', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  memStore(on)
  on('tool.register', (_, e) => ({ value: { tool: `mcp__lab-desk__${e.name}` } }))
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  const added = (await $.command.run(typed('lab-ind', 'ema 20, plot ta.ema(close, 20) - ta.ema(close, 50)'))).text ?? ''
  expect(added).toMatch(/ema\(close,20\)-ema\(close,50\)/)
  expect((await $.command.run(typed('lab-ind', 'plot ta.ema(close, x)'))).text).toMatch(/Formula: /)
  const list = (await $.command.run(typed('lab-ind', ''))).text ?? ''
  expect(list).toMatch(/EMA 20 · ema\(close,20\)-ema\(close,50\)/)
  const pine = (await $.command.run(typed('lab-ind', 'export pine'))).text ?? ''
  expect(pine).toMatch(/plot_\w+ = ta\.ema\(close, 20\) - ta\.ema\(close, 50\)/)
  expect(pine).toMatch(/indicator\("Lab desk · ema\(close,20\)-ema\(close,50\)", overlay = false\)/)
  const r = String((await $.tool.call({ tool: CHART_TOOL_NAME, add: ['plot (high + low) / 2'] })).result ?? '')
  expect(r).toMatch(/\(high\+low\)\/2/)
  expect((await $.command.run(typed('lab-ind', 'remove plot'))).text).toMatch(/EMA 20/)
  expect(pythonScript(['plot ta.ema(close, 20) - ta.ema(close, 50)'], 'BTC', '1h')).toMatch(/df\["plot ta\.ema\(close, 20\) - ta\.ema\(close, 50\)"\] = _bin\(ema\(c, 20\), ema\(c, 50\), lambda x, y: x - y\)/)
  // A price-level formula joins the price script.
  expect(pineScript(['plot hl2'], 'BTC', '1h')).toMatch(/overlay = true\)[\s\S]*plot_\w+ = hl2/)
})
