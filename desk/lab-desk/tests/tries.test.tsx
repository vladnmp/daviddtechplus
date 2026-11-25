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
