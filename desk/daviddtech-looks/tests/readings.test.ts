import { expect, test } from 'claude-code/testing'

import {
  aidOf,
  aidServer,
  backdropServer,
  levelsOf,
  marketsOf,
  marketsOfText,
  moodOfMarkets,
  moodOf,
  moodOfLevels,
  moodOfText,
  textOf,
  word,
} from '../hooks/readings'
import { AID_CLEAN, AID_ERROR, AID_RED, AID_YELLOW, BACKDROP_CALM, BACKDROP_STORM, BACKDROP_STRUCTURED, BACKDROP_REAL_2026_11_16, BACKDROP_WINDY } from './fixtures'

test('the mood follows the storm levels', () => {
  const table: [number[], string | null][] = [
    [[1, 2, 2], 'clear'],
    [[3, 2], 'windy'],
    [[4, 4, 2], 'storm'],
    [[5, 1], 'storm'],
    [[4, 2], 'windy'],
    [[], null],
  ]
  for (const [levels, mood] of table) {
    expect(moodOfLevels(levels)).toBe(mood)
  }
  expect(word('storm')).toBe('stormy')
  expect(word('clear')).toBe('calm')
})

test('the mood reads from the backdrop text and its structured result', () => {
  expect(moodOfText(BACKDROP_STORM)).toBe('storm')
  expect(moodOfText(BACKDROP_WINDY)).toBe('windy')
  expect(moodOfText(BACKDROP_CALM)).toBe('clear')
  expect(moodOfText('Storm levels: SPY 3, QQQ 3, BTC/USD 4.')).toBe('windy')
  expect(moodOfText('no weather here')).toBe(null)
  expect(levelsOf(BACKDROP_STRUCTURED)).toEqual([5, 1])
  expect(moodOf(BACKDROP_STRUCTURED)).toBe('storm')
  expect(moodOf({ markets: [] })).toBe(null)
})

test('only DaviddTech servers match', () => {
  expect(backdropServer('mcp__claude_ai_DaviddTech___market_backdrop')).toBe('claude_ai_DaviddTech_')
  expect(backdropServer('mcp__plugin_daviddtechplus_daviddtechplus__market_backdrop')).toBe('plugin_daviddtechplus_daviddtechplus')
  expect(backdropServer('mcp__weather__market_backdrop')).toBe(null)
  expect(aidServer('mcp__claude_ai_DaviddTech_Aid__check_pine')).toBe('claude_ai_DaviddTech_Aid')
  expect(aidServer('mcp__x__check_pine')).toBe(null)
  expect(aidServer('Bash')).toBe(null)
})

test('an Aid check reads as its worst color and score', () => {
  expect(aidOf(AID_RED)).toEqual({ word: 'red', score: 58, red: 1, orange: 1, yellow: 0 })
  expect(aidOf(AID_CLEAN)?.word).toBe('clean')
  expect(aidOf(AID_YELLOW)?.word).toBe('yellow')
  expect(aidOf(AID_ERROR)).toBe(null)
  expect(aidOf('not json at all')).toBe(null)
  expect(textOf([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }])).toBe('a\nb')
  expect(textOf({ content: [{ type: 'text', text: 'c' }] })).toBe('c')
})

test('a market that is already rough reads stormy even when the storm levels are low', () => {
  const markets = marketsOfText(BACKDROP_REAL_2026_11_16)
  expect(markets.length).toBe(8)
  expect(markets[0]).toEqual({ level: 1, regime: 'stressed', move20: -1.16 })
  expect(markets[6]).toEqual({ level: 2, regime: 'elevated', move20: -19.86 })
  expect(moodOfText(BACKDROP_REAL_2026_11_16)).toBe('storm')
})

test('volatility and big 20-session moves move the mood', () => {
  const calm = { level: 1, regime: 'normal' as const, move20: 2 }
  expect(moodOfMarkets([calm, calm, calm])).toBe('clear')
  expect(moodOfMarkets([calm, { ...calm, regime: 'elevated' }, { ...calm, regime: 'stressed' }])).toBe('windy')
  expect(moodOfMarkets([calm, calm, { ...calm, move20: -16 }])).toBe('windy')
  expect(moodOfMarkets([calm, calm, { ...calm, move20: 14.9 }])).toBe('clear')
  const stressed = { ...calm, regime: 'stressed' as const }
  expect(moodOfMarkets([stressed, stressed, stressed, calm, calm, calm])).toBe('storm')
  expect(moodOfMarkets([stressed, stressed, calm, calm, calm, calm])).toBe('windy')
  expect(moodOfMarkets([])).toBe(null)
  expect(marketsOf({ markets: [{ swing_5d: { storm_level: 2 }, volatility_regime: 'stressed', change_20_pct: -3 }, null] }))
    .toEqual([{ level: 2, regime: 'stressed', move20: -3 }])
  expect(moodOfText('Storm levels: SPY 1, QQQ 2.')).toBe('clear')
})
