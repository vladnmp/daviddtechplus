import { expect, test } from 'claude-code/testing'

import { chartFrom, fromStructured, fromText, matchTool } from '../hooks/parse'
import { chance, headerOf, levelLine, readChance } from '../hooks/model'
import { BRIEF_JSON, BRIEF_MD, CARD_MD, ERROR_TEXT, ODDS_JSON, ODDS_MD, PATH, PLAN_MD, SCAN_MD } from './fixtures'

test('the full brief text reads into a fan chart', () => {
  const c = fromText('analyze_asset', BRIEF_MD, 1)
  expect(c?.kind).toBe('brief')
  expect(c?.symbol).toBe('NVDA')
  expect(c?.assetClass).toBe('equity')
  expect(c?.steps).toBe(10)
  expect(c?.stepUnit).toBe('trading sessions')
  expect(c?.asOf).toBe('2026-11-13')
  expect(c?.endDate).toBe('2026-11-30')
  expect(c?.path).toHaveLength(11)
  expect(c?.path[0]).toEqual({ step: 0, session: '2026-11-13', p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, probUp: 0.5 })
  expect(c?.path[3]?.p10).toBe(PATH[2]!.p10)
  expect(c?.path[3]?.p90).toBe(PATH[2]!.p90)
  expect(c?.middle).toBe(1.2)
  expect(c?.range80).toEqual([-6.1, 8])
  expect(c?.chanceHigher).toBe(0.56)
  expect(c?.levels.map(l => [l.kind, l.pct, l.touch, l.major])).toEqual([
    ['resistance', 5, 0.41, true],
    ['resistance', 8.2, 0.18, false],
    ['support', -3, 0.47, false],
    ['support', -9.5, 0.03, true],
    ['break', -4, 0.35, false],
  ])
  expect(c?.levels[0]?.name).toBe('swing high 12 sessions ago')
  expect(c?.levels[0]?.price).toBe(643.02)
  expect(c?.summary).toBe('NVDA · next 10 sessions from 13 Nov · 80% range -6.1% to +8.0% · middle +1.2% · chance higher 56%')
})

test('the card view reads without a path, "<1%" back as "<1%"', () => {
  const c = fromText('analyze_asset', CARD_MD, 1)
  expect(c?.kind).toBe('brief')
  expect(c?.path).toEqual([])
  expect(c?.levels.map(l => [l.kind, l.pct, l.touch])).toEqual([
    ['resistance', 5, 0.41],
    ['support', -3, 0.004],
    ['break', -4, 0.35],
  ])
  expect(levelLine(c!.levels[1]!)).toMatch(/touch <1%$/)
  expect(c?.summary).toContain('NVDA · next 10 sessions from 13 Nov')
})

test('structured and text routes give the same brief chart', () => {
  const a = fromStructured('analyze_asset', BRIEF_JSON, 1)
  const b = fromText('analyze_asset', BRIEF_MD, 1)
  expect(a).toEqual({ ...b, from: 'structured' })
})

test('level_odds text: levels, touch by step, end-date numbers', () => {
  const c = fromText('level_odds', ODDS_MD, 1)
  expect(c?.kind).toBe('odds')
  expect(c?.levels.map(l => l.name)).toEqual(['650', '560', '1,000'])
  expect(c?.levels.map(l => l.price)).toEqual([650, 560, 1000])
  expect(c?.levels.map(l => l.touch)).toEqual([0.41, 0.22, 0.01])
  expect(c?.odds[0]?.values).toHaveLength(11)
  expect(c?.odds[0]?.values[0]).toBe(0)
  expect(c?.odds[0]?.values[10]).toBe(0.41)
  expect(c?.range80).toEqual([-6.1, 8])
  expect(c?.middle).toBe(1.2)
  expect(c?.chanceHigher).toBe(0.56)
  expect(c?.endLabel).toBe('30 Nov')
  expect(c?.asOf).toBe('2026-11-13')
  expect(c?.endDate).toBe('2026-11-30')
  expect(c?.summary).toBe('NVDA odds by 30 Nov · 650 touch 41% · 560 touch 22%')
  const s = fromStructured('level_odds', ODDS_JSON, 1)
  expect(s?.levels).toEqual(c?.levels)
  expect(s?.odds).toEqual(c?.odds)
  expect(s?.summary).toBe(c?.summary)
})

test('plan_check text: exits, reached odds, if-opened odds', () => {
  const c = fromText('plan_check', PLAN_MD, 1)
  expect(c?.kind).toBe('plan')
  expect(c?.plans).toHaveLength(2)
  const [one, two] = c!.plans
  expect(one?.direction).toBe('up')
  expect(one?.openAt).toBe('the last close')
  expect(one?.exits).toEqual([
    { name: '650', pct: 6.14, reached: 0.31, reachedIfOpened: 0.31 },
    { name: '680', pct: 11.04, reached: 0.12, reachedIfOpened: 0.12 },
  ])
  expect(one?.loss).toEqual({ name: '590', pct: -3.66 })
  expect([one?.profitFirstIfOpened, one?.lossFirstIfOpened, one?.neitherIfOpened]).toEqual([0.44, 0.31, 0.25])
  expect(two?.direction).toBe('down')
  expect(two?.openAt).toBe('630')
  expect(two?.exits).toHaveLength(1)
  expect(c?.summary).toBe('NVDA plan 1 (up) (+1 more) · if opened: profit exit 1 first 44%, loss exit first 31%')
})

test('scan text: rows, storm null for n/a', () => {
  const c = fromText('scan_assets', SCAN_MD, 1)
  expect(c?.kind).toBe('scan')
  expect(c?.steps).toBe(10)
  expect(c?.rows).toEqual([
    { symbol: 'TSLA', middle: 0.8, range80: [-14, 16.2], storm: 4 },
    { symbol: 'NVDA', middle: 1.2, range80: [-6.1, 8], storm: 3 },
    { symbol: 'BTC/USD', middle: -0.4, range80: [-5, 4.1], storm: null },
  ])
  expect(c?.summary).toBe('Scan · 3 symbols · widest 80% range TSLA -14.0% to +16.2%')
})

test('junk, errors and the wrong tool give no chart', () => {
  expect(fromText('analyze_asset', 'hello', 1)).toBeNull()
  expect(fromText('analyze_asset', ERROR_TEXT, 1)).toBeNull()
  expect(fromText('level_odds', PLAN_MD, 1)).toBeNull()
  expect(fromText('scan_assets', BRIEF_MD, 1)).toBeNull()
  expect(chartFrom('analyze_asset', { result: [{ type: 'text', text: ERROR_TEXT }] }, 1)).toBeNull()
})

test('a tool answer of text blocks, or a structured object, both read', () => {
  expect(chartFrom('analyze_asset', { result: [{ type: 'text', text: BRIEF_MD }] }, 1)?.from).toBe('text')
  expect(chartFrom('analyze_asset', { result: { structuredContent: BRIEF_JSON }, text: 'x' }, 1)?.from).toBe('structured')
})

test('only DaviddTech+ forecast tools match', () => {
  expect(matchTool('mcp__claude_ai_DaviddTech___analyze_asset')).toEqual({ server: 'claude_ai_DaviddTech_', tool: 'analyze_asset' })
  expect(matchTool('mcp__plugin_daviddtechplus_daviddtechplus__level_odds')?.tool).toBe('level_odds')
  expect(matchTool('mcp__daviddtechplus__scan_assets')?.tool).toBe('scan_assets')
  expect(matchTool('mcp__daviddtechplus__plan_check')?.tool).toBe('plan_check')
  expect(matchTool('mcp__other__analyze_asset')).toBeNull()
  expect(matchTool('mcp__claude_ai_DaviddTech___get_usage')).toBeNull()
  expect(matchTool('Bash')).toBeNull()
})

test('chance and readChance round-trip the ends, and one scan row is "1 symbol"', () => {
  for (const t of ['<1%', '>99%', '0%', '41%', '100%']) expect(chance(readChance(t)!)).toBe(t)
  const one = fromText('scan_assets', SCAN_MD, 1)
  expect(one?.kind).toBe('scan')
  expect(headerOf({ ...one!, rows: one!.rows.slice(0, 1) })).toContain('· 1 symbol ·')
  expect(headerOf(one!)).toMatch(/· \d+ symbols ·/)
})
