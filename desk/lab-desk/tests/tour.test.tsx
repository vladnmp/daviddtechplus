// /lab tour: six steps, each one's command put in the prompt box; running it (or one like it) moves the tour on.

import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import { TOUR, TOUR_QUIZ, nextSuggestion } from '../hooks/tour'
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

const banned = /\b(buy|sell|signals?|targets?|edge)\b/i

test('the tour walks chart, set, fib, formula, scan and replay, then hands Claude the quiz', async ($, on) => {
  const w = engine(on)
  mock.clock(on, { now: NOW })
  memStore(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const said: string[] = []
  const start = (await $.command.run(typed('lab', 'tour'))).text ?? ''
  said.push(start)
  expect(start).toMatch(/^Tour 1\/6 · \/lab-chart BTC 1h: a live chart/)
  expect(w.fills.at(-1)).toBe('/lab-chart BTC 1h')
  // Something off the tour leaves it where it is.
  const off = (await $.command.run(typed('lab-ind', 'list'))).text ?? ''
  expect(off).not.toMatch(/Tour \d/)
  // Each step: run what is in the box (the person may change the coin), and the next one comes.
  const runs = ['ETH 4h', 'trend', 'fib', 'plot ta.ema(close, 20) - ta.ema(close, 50)', 'rsi < 30', 'replay']
  for (const [i, step] of TOUR.entries()) {
    const [command, ...rest] = (i === 0 ? `/lab-chart ${runs[0]}` : step.fill).slice(1).split(' ')
    const text = (await $.command.run(typed(command ?? '', i === 0 ? (runs[0] ?? '') : rest.join(' ')))).text ?? ''
    said.push(text)
    if (i + 1 < TOUR.length) {
      expect(text).toMatch(new RegExp(`\\n\\nTour ${i + 2}/6 · `))
      expect(w.fills.at(-1)).toBe(TOUR[i + 1]?.fill)
    } else {
      expect(text).toMatch(/\n\nTour done\. Last one: ask Claude to quiz you/)
      expect(w.fills.at(-1)).toBe(TOUR_QUIZ)
    }
  }
  // Done: commands no longer carry tour words.
  expect((await $.command.run(typed('lab-chart', 'replay off'))).text).not.toMatch(/Tour/)
  for (const t of said) expect(t).not.toMatch(banned)
})

test('a step that did not work keeps the tour where it is; a new tour starts live', async ($, on) => {
  const w = engine(on)
  mock.clock(on, { now: NOW })
  memStore(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  await $.command.run(typed('lab-chart', 'replay 20'))
  const start = (await $.command.run(typed('lab', 'tour'))).text ?? ''
  expect(start).toMatch(/^Tour 1\/6/)
  // The tour turned replay off, so the scan step reads live candles later.
  expect((await $.command.run(typed('lab-scan', 'rsi < 30'))).text).toMatch(/^Scan:/)
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  await $.command.run(typed('lab-ind', 'trend'))
  await $.command.run(typed('lab-mark', 'fib'))
  // A formula that does not read: the tour waits on step 4 and the box keeps its command.
  const bad = (await $.command.run(typed('lab-ind', 'plot eval(1)'))).text ?? ''
  expect(bad).not.toMatch(/Tour 5\/6/)
  expect(w.fills.at(-1)).toBe(TOUR[3]?.fill)
  const good = (await $.command.run(typed('lab-ind', 'plot ta.mom(close, 10)'))).text ?? ''
  expect(good).toMatch(/\n\nTour 5\/6 · \/lab-scan rsi < 30/)
})

test('/lab tour off stops it, and the /lab menu offers it', async ($, on) => {
  engine(on)
  mock.clock(on, { now: NOW })
  memStore(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await $.command.run(typed('lab', ''))).text).toMatch(/\/lab tour: a 2-minute guided try-out/)
  await $.command.run(typed('lab', 'tour'))
  expect((await $.command.run(typed('lab', 'tour off'))).text).toBe('Tour off. /lab tour starts it again.')
  expect((await $.command.run(typed('lab-chart', 'ETH 1h'))).text).not.toMatch(/Tour/)
})

test('off the tour, the reply names its next step and the empty prompt box shows it dim', async ($, on) => {
  const suggested: string[] = []
  on('prompt.suggest', (_, e) => {
    suggested.push(e.text)
    return { isShown: true }
  })
  engine(on)
  mock.clock(on, { now: NOW })
  memStore(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  expect(suggested.at(-1)).toMatch(/^\/lab-watch/)
  await $.command.run(typed('lab-ind', 'what rsi'))
  expect(suggested.at(-1)).toMatch(/^\/lab-ind rsi( 14)?$/)
  await $.command.run(typed('lab-scan', 'close > 1'))
  expect(suggested.at(-1)).toMatch(/^\/lab-chart [A-Z]+ 1h$/)
  // In the tour the box holds the tour's own step instead.
  const n = suggested.length
  await $.command.run(typed('lab', 'tour'))
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  expect(suggested.length).toBe(n)
})

test('nextSuggestion reads the command or the question from a "Next:" line', () => {
  expect(nextSuggestion('Scan: x\nNext: /lab-chart SOL 4h opens it, or /lab-watch changes the coins scanned.')).toBe('/lab-chart SOL 4h')
  expect(nextSuggestion('Next: ask Claude "explain RSI 14 on this chart".')).toBe('explain RSI 14 on this chart')
  expect(nextSuggestion('Next: /lab-watch puts BTC ETH SOL above the prompt.')).toBe('/lab-watch')
  expect(nextSuggestion('Done. Next: /lab-ind lists values, /lab-ind clear removes all.')).toBe('/lab-ind')
  expect(nextSuggestion('Nothing next here.')).toBeNull()
  // Never a step that undoes the one just taken.
  expect(nextSuggestion('Watchlist above the prompt: BTC. Next: press a coin in it to open its chart, or /lab-watch off hides it.')).toBeNull()
  expect(nextSuggestion('Next: /lab-ind clear removes all, or /lab-ind ema 20 paints it.')).toBe('/lab-ind ema 20')
  expect(nextSuggestion('Next: the interval buttons in the pane switch candles, or /lab-chart ETH 15m opens another coin.')).toBe('/lab-chart ETH 15m')
  // Every "Next:" line the desk writes: none offers an undo.
  const lines = [
    'Next: ask Claude "explain RSI 14 on this chart".',
    'Next: /lab-ind rsi 14 paints it.',
    'Next: the interval buttons in the pane switch candles, or /lab-chart ETH 15m opens another coin.',
    'Next: /lab-watch puts BTC ETH SOL HYPE above the prompt.',
    'Next: press a coin in it to open its chart, or /lab-watch off hides it.',
    'Next: /lab-ind lists values, /lab-ind clear removes all.',
    'Next: /lab-chart SOL 1h opens it, or /lab-watch changes the coins scanned.',
    'Next: /lab-watch picks the coins to scan.',
  ]
  for (const l of lines) expect(nextSuggestion(l) ?? '').not.toMatch(/\b(off|clear|remove|reset|close|stop|forget|none)\b/)
  expect(nextSuggestion('Next: the interval buttons in the pane switch candles.')).toBeNull()
})

test('the dim next step never offers a placeholder or a formula cut at its brackets', () => {
  expect(nextSuggestion('Next: /lab-rules add <rule> adds one, or ask Claude "help me write my trading rules".')).toBe(null)
  expect(nextSuggestion('Next: if "opened after a losing trip" rings true, /lab-rules add puts it in your own words as a rule.')).toBe('/lab-rules add')
  expect(nextSuggestion('Next: /lab-second-look long SOL here checks an idea against your own rules.')).toBe('/lab-second-look long SOL here')
  expect(nextSuggestion('Next: /lab-trades review finds the leaks (time of day, after a loss, size, ...)')).toBe('/lab-trades review')
})
