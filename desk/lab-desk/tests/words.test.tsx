import { expect, mock, test } from 'claude-code/testing'

import { BAND, BRIEF_FIXTURE, NOW, PANE, engine, typed } from './fixtures'

// Neutral market words only: what the desk shows never reads as advice.
const BANNED = /\b(buy|buying|sell|selling|signal|signals|target|targets|edge)\b/i

type Node = { text?: string; props?: Record<string, unknown>; children?: unknown[] }

function texts(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node)
  else if (node && typeof node === 'object') {
    const n = node as Node
    for (const k of ['label', 'alt', 'source']) if (typeof n.props?.[k] === 'string') out.push(n.props[k] as string)
    for (const child of n.children ?? []) texts(child, out)
    const propsChildren = n.props?.children
    if (Array.isArray(propsChildren)) for (const child of propsChildren) texts(child, out)
    else if (propsChildren !== undefined) texts(propsChildren, out)
  }
  return out
}

test('commands, pane, band and status use none of the banned words', async ($, on) => {
  const w = engine(on, {
    tools: ['mcp__daviddtechplus__analyze_asset'],
    mcp: () => ({ content: [{ type: 'text', text: 'brief' }], isError: false, structuredContent: BRIEF_FIXTURE }),
  })
  mock.clock(on, { now: NOW })
  mock.store(on)
  const said: string[] = []
  said.push((await $.command.run(typed('lab-chart', 'BTC'))).text ?? '')
  said.push((await $.command.run(typed('lab-watch', ''))).text ?? '')
  for (const q of ['rsi < 30', 'close > ema 200', 'ema 20 crosses above ema 50 on 4h', '', 'rsi', 'nope < 3']) said.push((await $.command.run(typed('lab-scan', q))).text ?? '')
  said.push((await $.command.run(typed('lab-chart', 'NOPE'))).text ?? '')
  for (const q of ['rsi < 50', 'golden cross on 1d', 'rsi < 50 ahead 5', '', 'rsi is low']) said.push((await $.command.run(typed('lab-after', q))).text ?? '')
  for (const q of ['', 'ETH 4h ahead 5', 'NOPE']) said.push((await $.command.run(typed('lab-like', q))).text ?? '')
  for (const q of ['rsi < 50 exit rsi > 55', 'rsi > 50 hold 3 short fee 0.02', '', 'exit rsi > 50', 'rsi is low']) said.push((await $.command.run(typed('lab-test', q))).text ?? '')
  said.push((await $.command.run(typed('lab-watch', 'off'))).text ?? '')
  said.push((await $.command.run(typed('lab-watch', 'BTC'))).text ?? '')
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    said.push(...texts(await pane.drawn()))
    await pane.unmount()
    const band = await $.ui.mount({ ...BAND, surface })
    said.push(...texts(await band.drawn()))
    await band.unmount()
  }
  said.push(...w.statuses.filter((s): s is string => typeof s === 'string'))
  expect(said.join('\n').length).toBeGreaterThan(200)
  expect(said.filter(s => BANNED.test(s))).toEqual([])
})

test('/lab, /lab-ind, the chips, the Claude tools and the help list use none of the banned words', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  mock.store(on)
  const regs: string[] = []
  on('tool.register', (_, e) => {
    regs.push(e.name, e.description, JSON.stringify(e.inputSchema ?? {}))
    return { value: { tool: `mcp__lab-desk__${e.name}` } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const said: string[] = [...regs]
  said.push((await $.command.run(typed('lab', ''))).text ?? '')
  for (const args of ['help', 'trend', 'momentum', 'volatility', 'breakout', 'supertrend', 'nope', 'remove ema', 'clear', 'macd 30 26 9']) {
    said.push((await $.command.run(typed('lab-ind', args))).text ?? '')
  }
  await $.command.run(typed('lab-ind', 'bb, rsi, macd, vwap, st'))
  const r = await $.tool.call({ tool: 'mcp__lab-desk__chart_read', candles: 3 })
  said.push(String(r.result ?? r.deny))
  for (const input of [{ mode: 'after', when: 'rsi < 50' }, { mode: 'like' }, { mode: 'after' }]) {
    const h = await $.tool.call({ tool: 'mcp__lab-desk__chart_history', ...input })
    said.push(String(h.result ?? h.deny))
  }
  const t = await $.tool.call({ tool: 'mcp__lab-desk__chart_test', enter: 'rsi < 50', exit: 'rsi > 55' })
  said.push(String(t.result ?? t.deny))
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    said.push(...texts(await pane.drawn()))
    await pane.unmount()
  }
  expect(regs.length).toBeGreaterThan(3)
  expect(said.filter(s => BANNED.test(s))).toEqual([])
})
