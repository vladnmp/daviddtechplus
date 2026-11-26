// The rules file and the second look, at their edges: a file that can't be read is never written over, a first
// "add" never makes the examples theirs, a wallet the AI reads once never replaces their own, the coin comes from the
// idea's words without everyday words, and bar replay or a Hyperliquid outage gets a plain answer.

import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { NOW, candlesFixture, engine, typed } from './fixtures'

const H = 3_600_000
const W = '0x1234567890abcdef1234567890abcdef12345678'
const W2 = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'

function memStore(on: On, refuse?: (key: string) => boolean): Map<string, unknown> {
  const m = new Map<string, unknown>()
  on('store.get', (_, e) => {
    if (refuse?.(e.key)) throw new Error('store busy')
    return { value: m.get(e.key) }
  })
  on('store.set', (_, e) => (m.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_, e) => (m.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...m.keys()] }))
  return m
}

function fills(): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (let i = 0; i < 25; i++) {
    const t = NOW - 1500 * H + i * 30 * H
    out.push({ coin: 'BTC', px: '95000', sz: '0.1', side: 'B', time: t, startPosition: '0', dir: 'Open Long', closedPnl: '0', fee: '2', oid: i, tid: i })
    out.push({ coin: 'BTC', px: '95000', sz: '0.1', side: 'A', time: t + 3 * H, startPosition: '0.1', dir: 'Close Long', closedPnl: i % 3 ? '30' : '-40', fee: '2', oid: i, tid: 100 + i })
  }
  return out
}

test('a first "add" starts the file with its head only; several lines add several rules, list marks and bold off', async ($, on) => {
  engine(on, { candles: () => candlesFixture(400) })
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const run = async (name: string, args: string) => (await $.command.run(typed(name, args))).text ?? ''
  expect(await run('lab-rules', 'add no trades on Sunday')).toMatch(/^Rule added: no trades on Sunday\. 1 rule now, kept by the desk on this PC\./)
  expect(String(store.get('myRules'))).not.toMatch(/Risk at most 1%/)
  expect(await run('lab-rules', 'add - max 3 trades a day\n- **no revenge trades**\n1.5% risk at most')).toMatch(/^3 rules added: max 3 trades a day; no revenge trades; 1\.5% risk at most\. 4 rules now/)
  const shown = await run('lab-rules', '')
  expect(shown).toMatch(/^Your 4 trading rules/)
  expect(shown).toMatch(/^4\. 1\.5% risk at most$/m)
  expect(shown).not.toMatch(/starting example/)
})

test('rules that cannot be read are never written over', async ($, on) => {
  engine(on, { candles: () => candlesFixture(400) })
  mock.clock(on, { now: NOW })
  const store = memStore(on, key => key === 'myRules')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const run = async (name: string, args: string) => (await $.command.run(typed(name, args))).text ?? ''
  expect(await run('lab-rules', '')).toMatch(/^Could not read your rules just now; nothing was changed\.\nNext: /)
  expect(await run('lab-rules', 'add max 3 trades a day')).toMatch(/^Could not read your rules just now; nothing was changed\./)
  expect(store.has('myRules')).toBe(false)
})

test('a wallet the AI reads once never replaces their own; the coin and side come from the idea, not everyday words', async ($, on) => {
  engine(on, { fills: user => (user === W ? fills() : []), candles: () => candlesFixture(400) })
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(typed('lab-trades', W))
  const other = String((await $.tool.call({ tool: 'mcp__lab-desk__chart_trades', wallet: W2 } as never)).result ?? '')
  expect(other).toMatch(/0xabcd…abcd was read once and not kept; their own address stays 0x1234…5678\.\)$/)
  expect(store.get('tvWallet')).toBe(W)
  const look = async (idea: string) => String((await $.tool.call({ tool: 'mcp__lab-desk__chart_second_look', idea } as never)).result ?? '')
  expect(await look('too much hype around, long eth here')).toMatch(/^Second look at: too much hype around, long eth here \(ETH, long\)\./)
  expect(await look('long SOL for a short-term bounce')).toMatch(/\(SOL, long\)\./)
  expect(await look('the BTC dominance is falling, long SOL')).toMatch(/\(SOL, long\)\./)
  expect(await look('long $hype, not sure')).toMatch(/\(HYPE, long\)\./)
  expect(await look('long ZZZQ here')).toMatch(/^· No Hyperliquid perp named ZZZQ, so this brief is on BTC; ask which coin they meant if that is not it\.$/m)
  // Their own trades are still the ones in the brief.
  expect(await look('long BTC here')).toMatch(/^· Their last trip: long BTC, closed \d+ days ago/m)
})

test('the second look waits in bar replay, and says so plainly when Hyperliquid is down', async ($, on) => {
  const w = engine(on, { candles: () => candlesFixture(400) })
  mock.clock(on, { now: NOW })
  memStore(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  expect((await $.command.run(typed('lab-chart', 'replay 10'))).text).toMatch(/10 later candles hidden/)
  const inReplay = String((await $.tool.call({ tool: 'mcp__lab-desk__chart_second_look', idea: 'long BTC here' } as never)).result ?? '')
  expect(inReplay).toMatch(/^Second look reads the market now, so it waits while bar replay is on\.\nNext: /)
  expect((await $.command.run(typed('lab-second-look', 'long BTC here'))).text).toMatch(/^Second look reads the market now, so it waits/)
  void w
})

test('Hyperliquid down: the second look answers in a line instead of failing', async ($, on) => {
  engine(on, { isFetchDown: true })
  mock.clock(on, { now: NOW })
  memStore(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const down = String((await $.tool.call({ tool: 'mcp__lab-desk__chart_second_look', idea: 'long sol here' } as never)).result ?? '')
  expect(down).toMatch(/^Second look: Hyperliquid could not be read just now, so the coin in the idea can't be checked\.\nNext: /)
  const named = String((await $.tool.call({ tool: 'mcp__lab-desk__chart_second_look', idea: 'long sol here', coin: 'SOL' } as never)).result ?? '')
  expect(named).toMatch(/^· SOL: Hyperliquid's prices could not be read just now/m)
})
