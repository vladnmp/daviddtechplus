// Export: the chart's indicators as Pine v6 (Aid rules) and Python, from /lab-ind export and chart_read.

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import { exportFile, pineScript, pythonScript } from '../hooks/export'
import { READ_TOOL_NAME } from '../hooks/register'
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

const BANNED = /\b(buy|sell|signals?|targets?|edge)\b/i

test('Pine: v6 under the Aid line, one script per pane, the same inputs as the chart, marks as hlines', async () => {
  const pine = pineScript(['ema 50', 'bb 20 2', 'vwap', 'supertrend 10 3', 'rsi 14', 'macd 12 26 9'], 'ETH', '1h', [
    { coin: 'ETH', kind: 'level', price: 3000, label: 'resistance' },
    { coin: 'ETH', kind: 'zone', price: 2800, price2: 2850, label: 'demand' },
  ])
  const scripts = pine.split('// ---- next script: paste as its own indicator ----').map(s => s.trim())
  expect(scripts).toHaveLength(3)
  for (const s of scripts) {
    const lines = s.split('\n')
    expect(lines[0]).toBe('// Written with the DaviddTech Aid rules (skool.com/daviddtech/about)')
    expect(lines[1]).toBe('//@version=6')
    expect(lines.at(-1)).toMatch(/^\/\/ Checks: v6/)
    // Aid rule 4: no future data.
    expect(s).not.toMatch(/\[-\d|lookahead_on|barstate\.islast|timenow/)
  }
  expect(scripts[0]).toContain('indicator("Lab desk · ETH 1h", overlay = true)')
  expect(scripts[0]).toContain('ema_50 = ta.ema(close, 50)')
  expect(scripts[0]).toContain('= ta.bb(close, 20, 2)')
  expect(scripts[0]).toContain('vwap_day = ta.vwap(hlc3)')
  expect(scripts[0]).toContain('= ta.supertrend(3, 10)')
  expect(scripts[0]).toContain('hline(3000, "resistance"')
  expect(scripts[0]).toMatch(/fill\(zone_1_lo, zone_1_hi/)
  expect(scripts[1]).toContain('rsi_14 = ta.rsi(close, 14)')
  expect(scripts[2]).toContain('ta.macd(close, 12, 26, 9)')
  expect(scripts[2]).toContain('"avg 9"')
  expect(pine).not.toMatch(BANNED)
})

test('Python: fetch, the ta.* helpers, one column per series; nothing on the chart still runs', async () => {
  const py = pythonScript(['ema 50', 'donchian 20', 'macd 12 26 9', 'atr 14'], 'kPEPE', '4h')
  expect(py).toContain('COIN, INTERVAL, CANDLES = "kPEPE", "4h", 1000')
  expect(py).toContain('df["EMA 50"] = ema(c, 50)')
  expect(py).toContain('df["Donchian 20 middle"]')
  expect(py).toContain('df["MACD 12 26 9 avg 9"] = macd_12_26_9_avg')
  expect(py).toContain('df["ATR 14"] = rma(true_range(h, l, c), 14)')
  expect(py).toContain('data.to_csv("lab_kpepe_4h.csv")')
  expect(py).not.toMatch(/\{(body|coin|interval|csv|file)\}/)
  expect(py).not.toMatch(BANNED)
  expect(pythonScript([], 'BTC', '1h')).toContain('    pass  # no indicators')
  expect(exportFile('pine', 'BTC', '1h')).toBe('lab_btc_1h.pine')
})

test('/lab-ind export gives Pine or Python for the open chart; chart_read hands Claude the code', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  memStore(on)
  on('tool.register', (_, e) => ({ value: { tool: `mcp__lab-desk__${e.name}` } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await $.command.run(typed('lab-ind', 'export'))).text).toMatch(/Open a chart first/)
  await $.command.run(typed('lab-ind', 'ema 20, rsi'))
  await $.command.run(typed('lab-mark', '60000 resistance'))
  const pine = (await $.command.run(typed('lab-ind', 'export'))).text ?? ''
  expect(pine).toMatch(/^BTC 1h: EMA 20 · RSI 14 as Pine\./)
  expect(pine).toContain('```pine\n// Written with the DaviddTech Aid rules')
  expect(pine).toContain('hline(60000, "resistance"')
  expect(pine).toMatch(/Save it as lab_btc_1h\.pine/)
  expect(pine).toContain('With the DaviddTech Aid connector added (davidd.link/daviddtechaid)')
  const py = (await $.command.run(typed('lab-ind', 'export py'))).text ?? ''
  expect(py).toContain('```python\n# Lab desk indicators')
  expect(py).toContain('df["RSI 14"] = rsi(c, 14)')
  const r = await $.tool.call({ tool: READ_TOOL_NAME, export: 'pine' })
  const text = String(r.result ?? r.deny)
  expect(text).toMatch(/^Suggested file name: lab_btc_1h\.pine\n\/\/ Written with/)
  for (const t of [pine, py, text]) expect(t).not.toMatch(BANNED)
})

test('with the Aid connector, the Pine export carries its check; without it, a line says how to add it', async ($, on) => {
  const w = engine(on, {
    tools: ['Bash', 'mcp__claude_ai_DaviddTech_Aid__check_pine'],
    mcp: server => (server === 'claude_ai_DaviddTech_Aid' ? { content: [{ type: 'text', text: 'ok' }], isError: false, structuredContent: { score: 100, counts: { red: 0, orange: 0 } } } : null),
  })
  mock.clock(on, { now: NOW })
  memStore(on)
  await $.command.run(typed('lab-ind', 'ema 20, rsi'))
  const text = (await $.command.run(typed('lab-ind', 'export pine'))).text ?? ''
  expect(text).toContain('DaviddTech Aid check: script 1 100/100 · script 2 100/100.')
  const checks = w.mcpCalls.filter(c => c.tool === 'check_pine')
  expect(checks).toHaveLength(2)
  expect(String(checks[0]?.args.code)).toMatch(/^\/\/ Written with the DaviddTech Aid rules/)
  expect(String(checks[1]?.args.code)).toContain('rsi_14 = ta.rsi(close, 14)')
})
