import { expect, test } from 'claude-code/testing'

import { fromText } from '../hooks/parse'
import { fanLevels } from '../hooks/raster'
import { MAX_SVG, esc, fanSvg, svgFor } from '../hooks/svg'
import { BRIEF_MD, CARD_MD, ODDS_MD, PLAN_MD, SCAN_MD } from './fixtures'

function isSafe(svg: string): boolean {
  return svg.startsWith('<svg') && svg.includes('viewBox') && svg.length < MAX_SVG && !/<script/i.test(svg) && !/\son\w+=/i.test(svg)
}

test('the fan svg has its bands, middle line and one line per level', () => {
  const chart = fromText('analyze_asset', BRIEF_MD, 1)!
  const svg = fanSvg(chart)
  expect(isSafe(svg)).toBe(true)
  expect(svg).toContain('class="b90"')
  expect(svg).toContain('class="b50"')
  expect(svg).toContain('class="mid"')
  expect(svg.match(/class="lvl"/g)?.length).toBe(fanLevels(chart).length)
  expect(fanLevels(chart).length).toBe(5)
  expect(svg.match(/<title>/g)?.length).toBe(11)
  expect(svg).toContain('16 Nov (step 1): 80% range -1.9% to +2.5% · middle +0.1% · chance higher 51%')
  // The middle is thin and see-through in the band's own blue, never the strongest mark.
  expect(svg).toContain('.mid{fill:none;stroke:#4c8bf5;stroke-width:1;stroke-opacity:.6}')
  expect(svg).not.toContain('#2f6fd6')
})

test('inserted text is escaped', () => {
  const chart = { ...fromText('analyze_asset', BRIEF_MD, 1)!, symbol: 'A<B&C' }
  const svg = fanSvg(chart)
  expect(svg).toContain('A&lt;B&amp;C')
  expect(svg).not.toContain('A<B&C')
  expect(esc(`"'<>&`)).toBe('&quot;&apos;&lt;&gt;&amp;')
})

test('odds and scan draw safe svg; card and plan draw none', () => {
  const odds = svgFor(fromText('level_odds', ODDS_MD, 1)!)!
  expect(isSafe(odds)).toBe(true)
  expect(odds.match(/class="oline"/g)?.length).toBe(3)
  expect(odds).toContain('1,000 · 1%')
  const scan = svgFor(fromText('scan_assets', SCAN_MD, 1)!)!
  expect(isSafe(scan)).toBe(true)
  expect(scan).toContain('BTC/USD')
  expect(scan.match(/class="tick"/g)?.length).toBe(3)
  expect(scan).toContain('.tick{stroke:#4c8bf5;stroke-width:2;stroke-opacity:.6}')
  expect(svgFor(fromText('analyze_asset', CARD_MD, 1)!)).toBeNull()
  expect(svgFor(fromText('plan_check', PLAN_MD, 1)!)).toBeNull()
})
