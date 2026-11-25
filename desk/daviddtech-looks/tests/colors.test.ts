import { expect, test } from 'claude-code/testing'

import { checkColors } from '../hooks/make-colors.js'
import { LOOKS, NAMES, PROBLEMS } from '../hooks/palettes'

test('every look paints on desktop and names only real color keys', () => {
  for (const name of NAMES) {
    const blocking = PROBLEMS[name].filter(line => line.startsWith("Desktop won't paint"))
    expect(blocking).toEqual([])
    // checkColors also lists contrast notes under the design system's bar (those still paint); what must be
    // empty is anything that stops the theme painting or names a key the design system doesn't have.
    const wrong = checkColors(LOOKS[name].colors).filter(line => !/ is [\d.]+:1 in (light|dark) mode/.test(line))
    expect(wrong).toEqual([])
  }
})

test('every look is one whole set: a scene, frosted glass and colors', () => {
  const scenes = NAMES.map(name => {
    const look = LOOKS[name]
    const backdrop = look.backdrop as { scene?: string; glass?: { blur?: number; opacity?: number; tint?: string } }
    expect(backdrop.glass?.blur).toBe(18)
    expect(backdrop.glass?.tint).toBe(undefined)
    expect(look.colors).toBeDefined()
    expect(look.overrideColorScheme).toBe(undefined)

    return backdrop.scene
  })
  expect(scenes).toEqual(['winter', 'market-weather', 'pine'])
})
