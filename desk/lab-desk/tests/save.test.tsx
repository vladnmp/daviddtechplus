// Saving the chart: /lab-chart save and the chart tool's `save` write an SVG and a CSV into lab-charts/.

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import { CHART_TOOL_NAME } from '../hooks/register'
import { NOW, engine, typed } from './fixtures'

function files(on: On, fail: { on: boolean } = { on: false }): Map<string, string> {
  const m = new Map<string, string>()
  on('fs.write', (_, e) => {
    if (fail.on) throw new Error('read-only folder')
    m.set(e.path, e.text)
    return { value: undefined }
  })
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  return m
}

test('/lab-chart save writes the picture and the numbers, named by coin, interval and time', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  const fs = files(on)
  expect((await $.command.run(typed('lab-chart', 'save'))).text).toMatch(/Open a chart first/)
  await $.command.run(typed('lab-ind', 'ema 20, rsi'))
  await $.command.run(typed('lab-mark', '60000 resistance'))
  const text = (await $.command.run(typed('lab-chart', 'save'))).text ?? ''
  expect(text).toMatch(/^Saved lab-charts\/btc_1h_2026-11-16_1200\.svg \(the chart as drawn\), lab-charts\/btc_1h_2026-11-16_1200_card\.svg \(a card to post, 1200 x 675\) and lab-charts\/btc_1h_2026-11-16_1200\.csv \(\d+ candles, EMA 20 · RSI 14\)/)
  // The engine resolves the path against the working folder.
  const keys = [...fs.keys()].map(k => k.replaceAll('\\', '/'))
  expect(keys.map(k => k.split('/').slice(-2).join('/'))).toEqual(['lab-charts/btc_1h_2026-11-16_1200.svg', 'lab-charts/btc_1h_2026-11-16_1200_card.svg', 'lab-charts/btc_1h_2026-11-16_1200.csv'])
  const [svg = '', card = '', csvText = ''] = [...fs.values()]
  // The card: 16:9, the coin and interval on top, the chart inside, where it was made at the bottom.
  expect(card).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1200 675"/)
  expect(card).toContain('>BTC<tspan')
  expect(card).toContain('> · 1h</tspan>')
  expect(card).toMatch(/> [+-]?\d+\.\d\d% 24h<\/tspan>/)
  expect(card).toContain('<svg x="24" y="84" width="1152"')
  expect(card).toContain('EMA 20')
  expect(card).toContain('DaviddTech Lab')
  expect(card).toContain('2026-11-16 12:00 UTC · davidd.link/daviddtechplus')
  expect(card).not.toMatch(/\b(buy|sell|signals?|targets?|edge)\b/i)
  expect((card.match(/<svg /g) ?? []).length).toBe(2)
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  expect(svg).toContain('EMA 20')
  expect(svg).toContain('resistance')
  const csv = csvText.trim().split('\n')
  expect(csv[0]).toBe('time_utc,open,high,low,close,volume,EMA 20,RSI 14')
  expect(csv.length).toBeGreaterThan(30)
  expect(csv.at(-1)).toMatch(/^2026-11-16T\d\d:00,[\d.]+,[\d.]+,[\d.]+,[\d.]+,[\d.]+,[\d.]+,[\d.]+$/)
  expect(text).not.toMatch(/\b(buy|sell|signals?|targets?|edge)\b/i)
})

test('Claude saves through the chart tool; a failed write is said plainly', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  const fail = { on: false }
  const fs = files(on, fail)
  on('tool.register', (_, e) => ({ value: { tool: `mcp__lab-desk__${e.name}` } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await $.tool.call({ tool: CHART_TOOL_NAME, coin: 'BTC', add: ['adx'], save: true })
  expect(String(r.result ?? r.deny)).toMatch(/Saved lab-charts\/btc_1h_\S+\.svg/)
  expect([...fs.keys()].filter(k => k.endsWith('.csv'))).toHaveLength(1)
  fail.on = true
  const bad = await $.tool.call({ tool: CHART_TOOL_NAME, save: true })
  expect(String(bad.result ?? bad.deny)).toMatch(/Could not save the chart \(.+\)\./)
})
