// The second set of indicators: HMA and Keltner on price; Stoch RSI, Stoch, ADX and OBV in a lower pane.
// Same TradingView ta.* conventions as the first set, the same Pine and Python export.

import { expect, mock, test } from 'claude-code/testing'

import type { Candle } from '../types'
import { changeList, compute, dmi, fmtCompact, hma, obv, parseSpec, specId, stochOf, wma } from '../hooks/indicators'
import { pineScript, pythonScript } from '../hooks/export'
import { deskSvg } from '../hooks/svg'
import { NOW, engine, typed } from './fixtures'

const BANNED = /\b(buy|sell|signals?|targets?|edge)\b/i

/** A small made-up series: a climb, a dip, a climb, with volume. */
function candles(n = 120): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + 10 * Math.sin(i / 9) + i * 0.2
    return { t: NOW - (n - i) * 3_600_000, o: c - 0.5, h: c + 1 + (i % 3) * 0.3, l: c - 1 - (i % 4) * 0.2, c, v: 1000 + (i % 7) * 50 }
  })
}

test('names people type: "stoch rsi", "kc", "hull ma", "dmi", "obv"; numbers in TradingView order', async () => {
  const ids = (t: string) => {
    const s = parseSpec(t)
    return 'error' in s ? s.error : specId(s)
  }
  expect(ids('stoch rsi')).toBe('stochrsi 3 3 14 14')
  expect(ids('Stochastic RSI 3 3 21 21')).toBe('stochrsi 3 3 21 21')
  expect(ids('stoch')).toBe('stoch 14 1 3')
  expect(ids('kc 20 1.5')).toBe('keltner 20 1.5 10')
  expect(ids('Keltner Channels')).toBe('keltner 20 2 10')
  expect(ids('hull ma 55')).toBe('hma 55')
  expect(ids('dmi')).toBe('adx 14 14')
  expect(ids('obv')).toBe('obv')
  expect(ids('obv 5')).toMatch(/OBV takes no numbers/)
  // The pane limit names what is on the chart.
  expect(changeList(['adx 14 14', 'obv'], { add: ['rsi'] }).notes.join(' ')).toMatch(/remove ADX 14 14 or OBV to add RSI 14/)
  expect(changeList([], { add: ['strength'] }).ids).toEqual(['adx 14 14', 'stochrsi 3 3 14 14'])
})

test('the math, as ta.* defines it', async () => {
  // ta.wma: weights 1..n, newest heaviest.
  expect(wma([1, 2, 3, 4], 3)).toEqual([null, null, (1 + 4 + 9) / 6, (2 + 6 + 12) / 6])
  // On a straight line the Hull average sits on the line: it has no lag there.
  const line = Array.from({ length: 40 }, (_, i) => 10 + i)
  const h = hma(line, 9)
  expect(Math.abs((h[39] ?? 0) - 49) < 1e-9).toBe(true)
  expect(h.findIndex(v => v !== null)).toBe(8 + 2)
  // ta.stoch: 100 at the top of the window, 0 at the bottom, na on a flat window.
  expect(stochOf([1, 2, 3], [1, 2, 3], [1, 2, 3], 3)[2]).toBe(100)
  expect(stochOf([3, 2, 1], [3, 2, 1], [3, 2, 1], 3)[2]).toBe(0)
  expect(stochOf([5, 5, 5], [5, 5, 5], [5, 5, 5], 3)[2]).toBeNull()
  const c = candles()
  // ta.obv: added on a higher close, taken off on a lower one.
  const o = obv(c)
  expect(o[0]).toBe(0)
  expect(o[1]).toBe(c[1]!.v)
  const d = dmi(c, 14, 14)
  for (const v of [...d.adx, ...d.plus, ...d.minus]) if (v !== null) expect(v >= 0 && v <= 100).toBe(true)
  // +DI starts once 14 ranges are averaged (the first candle has none); ADX 14 more after.
  expect(d.plus.findIndex(v => v !== null)).toBe(14)
  expect(d.adx.findIndex(v => v !== null)).toBe(27)
  const k = compute({ kind: 'stochrsi', params: [3, 3, 14, 14] }, c)
  expect(k.series.map(s => s.name)).toEqual(['%K', '%D'])
  expect(k.scale).toEqual({ min: 0, max: 100, levels: [20, 50, 80] })
  const kc = compute({ kind: 'keltner', params: [20, 2, 10] }, c)
  expect(kc.pane).toBe('price')
  expect(kc.fill).toEqual([0, 2])
  expect(fmtCompact(1_234_567)).toBe('1.23M')
  expect(fmtCompact(-45_600)).toBe('-45.6K')
})

test('the chart draws them: Stoch with its 20/80 band, ADX with +DI and -DI in the candle colors', async () => {
  const c = candles()
  const studies = [compute({ kind: 'stochrsi', params: [3, 3, 14, 14] }, c), compute({ kind: 'adx', params: [14, 14] }, c), compute({ kind: 'hma', params: [9] }, c)]
  const svg = deskSvg({ candles: c, studies, cursor: 0, fan: null }, '1h', 'BTC', null)
  expect(svg).toContain('Stoch RSI 3 3 14 14')
  expect(svg).toContain('ADX 14 14')
  expect(svg).toContain('HMA 9')
  expect(svg).toMatch(/>80</)
  expect(svg).toMatch(/>20</)
})

test('export: Pine uses ta.hma, ta.dmi, ta.obv and the written-out Keltner; Python has the same helpers', async () => {
  const ids = ['hma 9', 'keltner 20 2 10', 'stochrsi 3 3 14 14', 'adx 14 14', 'obv']
  const pine = pineScript(ids, 'BTC', '1h')
  expect(pine).toContain('hma_9 = ta.hma(close, 9)')
  expect(pine).toContain('keltner_20_2_10_range = ta.atr(10)')
  expect(pine).toContain('stochrsi_3_3_14_14_raw = ta.stoch(stochrsi_3_3_14_14_rsi, stochrsi_3_3_14_14_rsi, stochrsi_3_3_14_14_rsi, 14)')
  expect(pine).toContain('[adx_14_14_plus, adx_14_14_minus, adx_14_14_adx] = ta.dmi(14, 14)')
  expect(pine).toContain('obv = ta.obv')
  // Price studies in one script, then one per lower pane.
  expect(pine.split('// ---- next script').length).toBe(4)
  const py = pythonScript(ids, 'BTC', '1h')
  for (const s of ['def hma(', 'def stoch(', 'def dmi(', 'def obv(', 'df["OBV"] = obv(c, v)', '= dmi(h, l, c, 14, 14)']) expect(py).toContain(s)
  expect(pine + py).not.toMatch(BANNED)
})

test('/lab-ind takes them like the others', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  const text = (await $.command.run(typed('lab-ind', 'stoch rsi, kc'))).text ?? ''
  expect(text).toMatch(/Added Stoch RSI 3 3 14 14 · KC 20 2 10/)
  const help = (await $.command.run(typed('lab-ind', 'help'))).text ?? ''
  for (const k of ['hma 9', 'keltner 20 2 10', 'stochrsi 3 3 14 14', 'adx 14 14', 'obv']) expect(help).toContain(k)
  expect(help).not.toMatch(BANNED)
})
