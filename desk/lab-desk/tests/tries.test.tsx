// The try counter: each different test on a coin counts once; running the same one again does not add a try.

import { expect, mock, test } from 'claude-code/testing'

import { NOW, candlesFixture, engine, typed } from './fixtures'

test('the same test twice is one try; a different one is the next; another coin starts over', async ($, on) => {
  engine(on, { candles: () => candlesFixture(400) })
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const run = async (args: string) => (await $.command.run(typed('lab-test', args))).text ?? ''
  expect(await run('rsi < 50 exit rsi > 55')).toMatch(/1 try on BTC 1h so far/)
  expect(await run('rsi < 50 exit rsi > 55')).toMatch(/1 try on BTC 1h so far/)
  expect(await run('rsi < 45 exit rsi > 55')).toMatch(/2 tries on BTC 1h so far/)
  expect(await run('rsi < 50 exit rsi > 55 on 4h')).toMatch(/1 try on BTC 4h so far/)
})

test('a first test on a fresh desk names no earlier tries', async ($, on) => {
  engine(on, { candles: () => candlesFixture(400) })
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const out = (await $.command.run(typed('lab-test', 'rsi < 50 exit rsi > 55'))).text ?? ''
  expect(out).not.toMatch(/earlier tr(y|ies) on/)
})

test('swarms never push out a test that saw the unseen part; the try count runs past 300; swarm rules keep how far they searched', { timeoutMs: 120_000 }, async ($, on) => {
  engine(on, { candles: () => candlesFixture(1200) })
  mock.clock(on, { now: NOW })
  const kept = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: kept.get(e.key) }))
  on('store.set', (_, e) => (kept.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_, e) => (kept.delete(e.key), { value: undefined }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const run = async (name: string, args: string) => (await $.command.run(typed(name, args))).text ?? ''
  await run('lab-test', 'rsi < 52 hold 3 on 1h')
  for (const e of [1, 2]) await run('lab-swarm', `BTC 1h: ${Array.from({ length: 200 }, (_, i) => `rsi < ${e} hold ${i + 1}`).join('; ')}`)
  const rows = (kept.get('ledger') as Record<string, { k: string; w: string; u: number; s?: number }[]>)['BTC 1h'] ?? []
  expect(rows.length).toBe(300)
  expect(rows.some(r => r.u === 1 && r.w.startsWith('rsi < 52'))).toBe(true)
  expect(rows.filter(r => r.u === 0).every(r => typeof r.s === 'number' && r.s > 0)).toBe(true)
  expect(await run('lab-test', 'rsi < 45 exit rsi > 55 on 1h')).toMatch(/402 tries on BTC 1h so far/)
})
