import { expect, test } from 'claude-code/testing'

import { FORBIDDEN, headerOf, levelLine, suggestionsOf } from '../hooks/model'
import { fromStructured, fromText } from '../hooks/parse'
import { NO_CHART } from '../hooks/register'
import { BRIEF_JSON, BRIEF_MD, CARD_MD, ODDS_JSON, ODDS_MD, PLAN_MD, SCAN_MD } from './fixtures'

const CASES = [
  ['mcp__daviddtechplus__analyze_asset', BRIEF_MD],
  ['mcp__daviddtechplus__analyze_asset', CARD_MD],
  ['mcp__daviddtechplus__level_odds', ODDS_MD],
  ['mcp__daviddtechplus__plan_check', PLAN_MD],
  ['mcp__daviddtechplus__scan_assets', SCAN_MD],
] as const

const PANE = {
  plugin: 'daviddtech-charts',
  component: 'Pane',
  requestId: 'daviddtech-chart',
  props: { title: 'DaviddTech+ chart', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('no summary, header, level line or suggestion uses a banned word', () => {
  const charts = [
    fromText('analyze_asset', BRIEF_MD, 1),
    fromText('analyze_asset', CARD_MD, 1),
    fromText('level_odds', ODDS_MD, 1),
    fromText('plan_check', PLAN_MD, 1),
    fromText('scan_assets', SCAN_MD, 1),
    fromStructured('analyze_asset', BRIEF_JSON, 1),
    fromStructured('level_odds', ODDS_JSON, 1),
  ]
  const words: string[] = [NO_CHART]
  for (const c of charts) {
    expect(c).not.toBeNull()
    words.push(c!.summary, headerOf(c!), ...c!.levels.map(levelLine), ...suggestionsOf(c!).flatMap(s => [s.label, s.text]))
  }
  for (const w of words) expect(FORBIDDEN.test(w)).toBe(false)
})

test('every text and button the pane draws stays in member words', async ($, on) => {
  let text: string = BRIEF_MD
  on('tool.call', () => ({ result: [{ type: 'text', text }], text }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  for (const [tool, md] of CASES) {
    text = md
    await $.tool.call({ tool, symbol: 'NVDA' })
    for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const shown = [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))]
      expect(shown.length).toBeGreaterThan(3)
      for (const el of shown) expect(FORBIDDEN.test(`${el.text} ${String(el.props.label ?? '')}`)).toBe(false)
      await ui.unmount()
    }
  }
})
