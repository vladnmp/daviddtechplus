import { expect, mock, test } from 'claude-code/testing'

import { MAX_SVG, SNOW, pineSvg, weatherSvg, winterSvg } from '../hooks/scenes'
import { BACKDROP_CALM, BACKDROP_STORM, BACKDROP_TOOL } from './fixtures'

const GLASS = { blur: 18, opacity: 0.55 }

function backdrop(scene: string, plugin = 'daviddtech-looks') {
  return {
    plugin: 'daviddtech-looks',
    component: 'Backdrop',
    requestId: 'backdrop',
    props: { scene, plugin, glass: GLASS },
  } as const
}

function checkScene(source: string) {
  expect(source.startsWith('<svg')).toBe(true)
  expect(source).toContain('viewBox="0 0 1600 1000"')
  expect(source).toContain('xMidYMid slice')
  expect(source).toContain('prefers-reduced-motion')
  expect(source).not.toContain('<script')
  expect(/\son\w+=/.test(source)).toBe(false)
  expect(source.length).toBeLessThan(MAX_SVG)
}

test('every scene draws on desktop and mobile within the Svg rules', async $ => {
  for (const surface of ['desktop', 'mobile'] as const) {
    for (const scene of ['winter', 'market-weather', 'pine']) {
      const ui = await $.ui.mount({ ...backdrop(scene), surface })
      const svg = await ui.find({ type: 'Svg' })
      expect(svg).toBeDefined()
      expect(String(svg?.props.alt ?? '').length).toBeGreaterThan(0)
      checkScene(String(svg?.props.source ?? ''))
      await ui.unmount()
    }
  }
})

test('every mood and pulse stays within the Svg rules, and the scenes are the same every time', () => {
  for (const source of [
    winterSvg(),
    weatherSvg('clear'),
    weatherSvg('windy'),
    weatherSvg('storm'),
    pineSvg(null),
    pineSvg({ kind: 'red', at: 1731700000000 }),
  ]) {
    checkScene(source)
  }
  expect(winterSvg()).toBe(winterSvg())
  expect(weatherSvg('storm')).toBe(weatherSvg('storm'))
  // Generic winter art: snow in three depths (each drawn twice for its seamless loop), 24 lights, trees.
  const flakes = SNOW.reduce((sum, layer) => sum + layer.count, 0)
  expect((winterSvg().match(/<circle cx="[^"]+" cy="[^"]+" r="[^"]+"\/>/g) ?? []).length).toBe(40 + flakes * 2)
  expect((winterSvg().match(/class="bulb"/g) ?? []).length).toBe(24)
})

test('each scene animates a dozen elements at most: things that move together move as one group', () => {
  const animated = /class="(s|b|c|m|sun|pulse|rain|gust|flash|snow\d)"/g
  const counts = [
    winterSvg(),
    weatherSvg('clear'),
    weatherSvg('windy'),
    weatherSvg('storm'),
    pineSvg({ kind: 'green', at: 5 }),
  ].map(source => (source.match(animated) ?? []).length)
  expect(counts).toEqual([9, 3, 5, 6, 4])
  // No per-drop delays and no stroke-dashoffset (a repaint per frame).
  for (const source of [winterSvg(), weatherSvg('windy'), weatherSvg('storm')]) {
    expect(source).not.toContain('stroke-dashoffset')
    expect((source.match(/animation-delay/g) ?? []).length).toBeLessThanOrEqual(12)
  }
})

test('a redraw carries the loops on from the time it is drawn for, and stays the same for the same time', () => {
  expect(weatherSvg('storm', 1731700000)).toBe(weatherSvg('storm', 1731700000))
  expect(weatherSvg('storm', 1731700000)).not.toBe(weatherSvg('storm', 1731700003))
  expect(pineSvg(null, 12)).not.toBe(pineSvg(null, 0))
  // A cloud of 70s three seconds later is three seconds further into its loop (15s start).
  expect(weatherSvg('storm', 3)).toContain('animation-duration:70s;animation-delay:-18s')
  // Delays always fall inside one loop, however large the time.
  for (const match of weatherSvg('windy', 1731700000.4).matchAll(/animation-duration:([\d.]+)s;animation-delay:-([\d.]+)s/g)) {
    expect(Number(match[2])).toBeLessThanOrEqual(Number(match[1]))
  }
})

test('the weather scene follows a market_backdrop reading the model asked for', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000_000 })
  let text = BACKDROP_STORM
  on('tool.call', () => ({ result: [{ type: 'text', text }], text }))

  const ran = await $.tool.call({ tool: BACKDROP_TOOL } as never)
  expect(ran.text).toBe(BACKDROP_STORM)
  const ui = await $.ui.mount({ ...backdrop('market-weather'), surface: 'desktop' })
  const stormy = String((await ui.find({ type: 'Svg' }))?.props.source ?? '')
  expect(stormy).toContain('class="rain"')

  // One calm reading waits; a second one 6 hours later agrees and the sky clears.
  text = BACKDROP_CALM
  await $.tool.call({ tool: BACKDROP_TOOL } as never)
  expect(String((await ui.find({ type: 'Svg' }))?.props.source ?? '')).toContain('class="rain"')
  await clock.advance(6 * 60 * 60 * 1000)
  await $.tool.call({ tool: BACKDROP_TOOL } as never)
  const calm = String((await ui.find({ type: 'Svg' }))?.props.source ?? '')
  expect(calm).not.toContain('class="rain"')
  expect(calm).toContain('class="sun"')
  await ui.unmount()
})

test("another mod's backdrop and an unknown scene go to the engine", async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  for (const target of [backdrop('winter', 'someone-else'), backdrop('aurora')]) {
    const ui = await $.ui.mount({ ...target, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
    expect(await ui.find({ type: 'Svg' })).toBe(undefined)
    await ui.unmount()
  }
})
