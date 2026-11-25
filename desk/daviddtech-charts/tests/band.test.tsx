import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { BRIEF_MD } from './fixtures'

const TOOL = 'mcp__plugin_daviddtechplus_daviddtechplus__analyze_asset'

const BAND = {
  plugin: 'daviddtech-charts',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

/** Beneath the plugin: the tool answers a brief; the band left alone draws "engine". */
function engine(on: On, opened: string[] = []) {
  on('tool.call', () => ({ result: [{ type: 'text', text: BRIEF_MD }], text: BRIEF_MD }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
}

test('after a forecast the band shows the summary, Chart and Hide', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: TOOL, symbol: 'NVDA' })
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /DaviddTech\+ NVDA · next 10 sessions/ }))?.text).toContain('chance higher 56%')
    expect(await ui.find({ type: 'Button', key: 'chart' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'hide' })).toBeDefined()
    await ui.unmount()
  }
})

test('Hide empties the band; Chart opens the pane and retires the band', async ($, on) => {
  const opened: string[] = []
  engine(on, opened)
  await $.tool.call({ tool: TOOL, symbol: 'NVDA' })
  expect(opened).toHaveLength(0) // terminal only: no pane opened unasked

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'hide' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()

  await $.tool.call({ tool: TOOL, symbol: 'NVDA' })
  const again = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await again.press({ key: 'chart' })
  expect(opened).toEqual(['daviddtech-chart'])
  expect((await again.find({ type: 'Text' }))?.text).toBe('engine')
  await again.unmount()
})

test('a survey holds the band', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: TOOL, symbol: 'NVDA' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('band off leaves the band to the engine', { options: { band: 'off' } }, async ($, on) => {
  engine(on)
  await $.tool.call({ tool: TOOL, symbol: 'NVDA' })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('no forecast yet: the band stays the engine\'s', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('a refused open from the band says why in a toast and keeps the band', async ($, on) => {
  const toasts: string[] = []
  on('tool.call', () => ({ result: [{ type: 'text', text: BRIEF_MD }], text: BRIEF_MD }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('ui.open', () => ({ deny: 'the id is held by another plugin' }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.tool.call({ tool: TOOL, symbol: 'NVDA' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'chart' })
  expect(toasts[0]).toContain('could not open here')
  expect(await ui.find({ type: 'Button', key: 'chart' })).toBeDefined()
  await ui.unmount()
})
