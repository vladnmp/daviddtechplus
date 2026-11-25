// "/lab-ind what rsi": a plain-words card per indicator, with its value on the chart now. Neutral words only.

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import { KINDS } from '../hooks/indicators'
import type { Kind } from '../hooks/indicators'
import { LEARN } from '../hooks/learn'
import { NOW, engine, typed } from './fixtures'

const BANNED = /\b(buy|buying|sell|selling|signal|signals|target|targets|edge)\b|expected move/i

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

test('every indicator has a card, in neutral words', () => {
  for (const k of Object.keys(KINDS) as Kind[]) {
    expect(LEARN[k].reads.length).toBeGreaterThan(20)
    expect(LEARN[k].watch.length).toBeGreaterThan(10)
    expect(`${LEARN[k].reads} ${LEARN[k].watch} ${KINDS[k].what}`).not.toMatch(BANNED)
  }
})

test('/lab-ind what rsi explains it and gives its value on the chart now', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  memStore(on)
  const bare = (await $.command.run(typed('lab-ind', 'what'))).text ?? ''
  expect(bare).toMatch(/^Ask about one: \/lab-ind what rsi\. Any of: SMA, EMA/)
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  const said: string[] = []
  for (const q of ['what rsi', 'what is stoch rsi?', 'explain macd', 'learn plot', 'what ema 200', 'what plot ta.ema(close, 5) - close']) said.push((await $.command.run(typed('lab-ind', q))).text ?? '')
  expect(said[0]).toMatch(/^RSI 14: relative strength index, 0 to 100\.\nHow people read it: .+\nWatch: .+\nBTC 1h now: \d+\.\d\.\nNext: \/lab-ind rsi 14 paints it\.$/)
  expect(said[1]).toMatch(/^Stoch RSI 3 3 14 14: /)
  expect(said[3]).toMatch(/^Plot: your own formula/)
  expect(said[3]).toMatch(/Next: \/lab-ind plot ta\.ema\(close, 20\) - ta\.ema\(close, 50\) paints it/)
  expect(said[5]).toMatch(/BTC 1h now: -?[\d,.]+\./)
  expect((await $.command.run(typed('lab-ind', 'what nope'))).text).toMatch(/^No indicator called "nope"/)
  // Once painted, the card says so and points to Claude.
  await $.command.run(typed('lab-ind', 'rsi'))
  expect((await $.command.run(typed('lab-ind', 'what rsi'))).text).toMatch(/\(on the chart\)\.\nNext: ask Claude "explain RSI 14 on this chart"\./)
  expect(said.join('\n') + bare).not.toMatch(BANNED)
})
