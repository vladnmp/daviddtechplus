import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { AID_CLEAN, AID_ERROR, AID_RED, AID_TOOL, AID_YELLOW } from './fixtures'

const PINE = {
  plugin: 'daviddtech-looks',
  component: 'Backdrop',
  requestId: 'backdrop',
  props: { scene: 'pine', plugin: 'daviddtech-looks', glass: { blur: 18, opacity: 0.55 } },
} as const

/** The engine beneath the mod: the Aid tool answers `text` (JSON, as FastMCP sends a dict), the status line is recorded. */
function engine(on: On, text: string) {
  const lines: (string | undefined)[] = []
  on('ui.status', (_, e) => {
    lines.push(e.text)

    return { value: undefined }
  })
  on('tool.call', () => ({ result: [{ type: 'text', text }], text }))

  return lines
}

async function pineSource(ui: { find: (q: { type: string }) => Promise<{ props: Record<string, unknown> } | undefined> }) {
  return String((await ui.find({ type: 'Svg' }))?.props.source ?? '')
}

test('a red check shows in the status line and pulses the pine look red, then the pulse ends', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const lines = engine(on, AID_RED)

  const ran = await $.tool.call({ tool: AID_TOOL, code: 'strategy("x")' } as never)
  expect(ran.text).toBe(AID_RED)
  expect(lines).toEqual(['Aid: red · 58/100'])

  const ui = await $.ui.mount({ ...PINE, surface: 'desktop' })
  const lit = await pineSource(ui)
  expect(lit).toContain('id="pulse-1000"')
  expect(lit).toContain('#e5484d')

  await clock.advance(2600)
  expect(await pineSource(ui)).not.toContain('pulse-')
  await ui.unmount()
})

test('a clean check reads clean and pulses green', async ($, on) => {
  mock.clock(on)
  const lines = engine(on, AID_CLEAN)
  await $.tool.call({ tool: AID_TOOL, code: 'indicator("x")' } as never)
  expect(lines).toEqual(['Aid: clean · 100/100'])

  const ui = await $.ui.mount({ ...PINE, surface: 'mobile' })
  expect(await pineSource(ui)).toContain('#30a46c')
  await ui.unmount()
})

test('a yellow check shows in the status line with no pulse; an error answer changes nothing', async ($, on) => {
  mock.clock(on)
  const lines = engine(on, AID_YELLOW)
  await $.tool.call({ tool: AID_TOOL, code: 'strategy("x")' } as never)
  expect(lines).toEqual(['Aid: yellow · 90/100'])

  const ui = await $.ui.mount({ ...PINE, surface: 'desktop' })
  expect(await pineSource(ui)).not.toContain('pulse-')
  await ui.unmount()
})

test('an Aid error answer leaves the status line alone', async ($, on) => {
  mock.clock(on)
  const lines = engine(on, AID_ERROR)
  await $.tool.call({ tool: AID_TOOL, code: '' } as never)
  expect(lines).toEqual([])
})

test('a check_pine tool on another server is left alone', async ($, on) => {
  mock.clock(on)
  const lines = engine(on, AID_RED)
  await $.tool.call({ tool: 'mcp__someone__check_pine', code: 'x' } as never)
  expect(lines).toEqual([])
})

test('with the Aid status off there is no status line, but the pulse still fires', { options: { aidStatus: 'off' } }, async ($, on) => {
  mock.clock(on, { now: 5 })
  const lines = engine(on, AID_RED)
  await $.tool.call({ tool: AID_TOOL, code: 'strategy("x")' } as never)
  expect(lines).toEqual([])

  const ui = await $.ui.mount({ ...PINE, surface: 'desktop' })
  expect(await pineSource(ui)).toContain('id="pulse-5"')
  await ui.unmount()
})
