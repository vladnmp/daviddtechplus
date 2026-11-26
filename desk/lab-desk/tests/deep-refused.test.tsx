// A place Binance does not serve: the deep read says so plainly, once, and points to the same run without "deep".
import { expect, mock, test } from 'claude-code/testing'

import { NOW, engine } from './fixtures'

const GEO = JSON.stringify({ code: 0, msg: 'Service unavailable from a restricted location.' })
const binance = (status: number, text: string) => (url: string) => (url.includes('binance.com') ? { status, text } : undefined)

test('a 451 from Binance says the location is not served and ends with a Next line without deep', { timeoutMs: 30_000 }, async ($, on) => {
  engine(on, { get: binance(451, GEO) })
  mock.clock(on, { now: NOW })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const one = String((await $.tool.call({ tool: 'mcp__lab-desk__chart_test', mark: false, deep: true, enter: 'rsi < 30', hold: 6, coin: 'BTC', interval: '1d' } as never)).result ?? '')
  expect(one).toContain('Binance does not serve this location')
  expect(one).toContain('Next: the same without "deep"')
  expect(one).not.toContain('try again in a minute')
  const across = String((await $.tool.call({ tool: 'mcp__lab-desk__chart_test', mark: false, deep: true, enter: 'rsi < 30', hold: 6, coins: ['BTC', 'ETH'], interval: '1d' } as never)).result ?? '')
  expect(across).toContain('does not serve this location')
  expect(across).not.toMatch(/Next:[^\n]* deep\./)
})
