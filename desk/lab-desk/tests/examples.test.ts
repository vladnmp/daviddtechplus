// Every example the README, the /lab menu and the command hints give for the history lab parses as written.

import { expect, test } from 'claude-code/testing'

import { parseTest } from '../hooks/honest'
import { parseCondition } from '../hooks/history'
import { parseTestWords } from '../hooks/register'

/** What /lab-after does with its words: a trailing "ahead N" is the look ahead, the rest the condition. */
function afterWords(args: string) {
  const m = /\s+ahead\s+(\d+)\s*$/i.exec(args)
  return { cond: parseCondition(m ? args.slice(0, m.index) : args), ahead: m ? Number(m[1]) : undefined }
}

test('/lab-after examples parse', () => {
  for (const [args, interval, ahead] of [
    ['rsi < 30', null, undefined],
    ['golden cross on 1d', '1d', undefined],
    ['golden cross on 1d ahead 20', '1d', 20],
    ['close crosses above ema 200', null, undefined],
    ['close crosses above ema 200 on 4h ahead 20', '4h', 20],
    ['rsi < 30 and close > ema 200', null, undefined],
  ] as const) {
    const r = afterWords(args)
    expect('error' in r.cond ? `${args}: ${r.cond.error}` : args).toBe(args)
    if (!('error' in r.cond)) expect(r.cond.interval).toBe(interval)
    expect(r.ahead).toBe(ahead)
  }
})

test('/lab-test examples parse into a test', () => {
  const cases: [string, Partial<ReturnType<typeof parseTestWords>>][] = [
    ['rsi < 30 exit rsi > 50', { enter: 'rsi < 30', exit: 'rsi > 50' }],
    ['ema 20 crosses above ema 50 exit ema 20 crosses below ema 50 on 4h', { enter: 'ema 20 crosses above ema 50', exit: 'ema 20 crosses below ema 50', interval: '4h' }],
    ['rsi > 70 hold 12 short', { enter: 'rsi > 70', hold: 12, side: 'short' }],
    ['rsi < 30 exit rsi > 50 fee 0.02', { enter: 'rsi < 30', exit: 'rsi > 50', fee: 0.02 }],
  ]
  for (const [args, want] of cases) {
    const w = parseTestWords(args)
    expect(w).not.toBe(null)
    expect(w).toMatchObject(want as object)
    const s = parseTest(w as NonNullable<typeof w>)
    expect('error' in s ? `${args}: ${s.error}` : args).toBe(args)
  }
  // The fee in % (0.02 means 0.02%).
  const s = parseTest(parseTestWords('rsi < 30 exit rsi > 50 fee 0.02') as NonNullable<ReturnType<typeof parseTestWords>>)
  if (!('error' in s)) expect(Math.abs(s.fee - 0.0002) < 1e-12).toBe(true)
})
