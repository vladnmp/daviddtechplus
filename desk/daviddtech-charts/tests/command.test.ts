import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { fromText } from '../hooks/parse'
import { BRIEF_MD, SCAN_MD } from './fixtures'

type Open = { id: string; focus?: true }

/** /daviddtech-chart typed in a 90-column terminal. */
function typed(args: string) {
  return { command: 'daviddtech-chart', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 90 } } as const
}

function engine(on: On, opens: Open[], registered: string[], isPlaced = true) {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', (_, e) => {
    opens.push(e)
    return { value: isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'the terminal is 90 columns, under 110' } }
  })
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('tool.call', () => ({ result: [{ type: 'text', text: BRIEF_MD }], text: BRIEF_MD }))
}

test('the command registers, and says when there is no chart yet', async ($, on) => {
  const opens: Open[] = []
  const registered: string[] = []
  engine(on, opens, registered)
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(registered).toEqual(['daviddtech-chart'])
  const r = await $.command.run(typed(''))
  expect(r.text).toContain('No DaviddTech+ forecast yet')
  expect(opens).toHaveLength(0)
})

test('after a forecast the command opens the pane with focus', async ($, on) => {
  const opens: Open[] = []
  engine(on, opens, [])
  mock.store(on)
  await $.tool.call({ tool: 'mcp__daviddtechplus__analyze_asset', symbol: 'NVDA' })
  expect(opens).toHaveLength(0)
  const r = await $.command.run(typed(''))
  expect(opens).toEqual([{ id: 'daviddtech-chart', title: 'DaviddTech+ chart', focus: true }])
  expect(r.text).toContain('Chart: NVDA · next 10 sessions')
})

test('an unplaced pane says why and still gives the summary', async ($, on) => {
  engine(on, [], [], false)
  await $.tool.call({ tool: 'mcp__daviddtechplus__analyze_asset', symbol: 'NVDA' })
  const r = await $.command.run(typed(''))
  expect(r.text).toContain('could not open here (the terminal is 90 columns, under 110)')
  expect(r.text).toContain('NVDA')
})

test('close closes the pane', async ($, on) => {
  const closed: string[] = []
  engine(on, [], [])
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  const r = await $.command.run(typed(' close '))
  expect(closed).toEqual(['daviddtech-chart'])
  expect(r.text).toBe('Chart pane closed.')
})

test('a chart stored by an earlier session comes back quietly', async ($, on) => {
  const opens: Open[] = []
  const chart = fromText('scan_assets', SCAN_MD, 5)
  engine(on, opens, [])
  mock.store(on, { last: { shape: 'chart-1', chart } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(opens).toHaveLength(0)
  const r = await $.command.run(typed(''))
  expect(r.text).toContain('Chart: Scan · 3 symbols')
})

test('a stored value of another shape is declined', async ($, on) => {
  engine(on, [], [])
  mock.store(on, { last: { shape: 'chart-0', chart: { kind: 'brief' } } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await $.command.run(typed(''))
  expect(r.text).toContain('No DaviddTech+ forecast yet')
})

test('a new forecast is saved to the store for later sessions', async ($, on) => {
  const saves: { key: string; value: unknown }[] = []
  engine(on, [], [])
  on('store.set', (_, e) => {
    saves.push(e)
    return { value: undefined }
  })
  await $.tool.call({ tool: 'mcp__daviddtechplus__analyze_asset', symbol: 'NVDA' })
  const saved = saves.find(s => s.key === 'last')?.value as { shape: string; chart: { symbol: string } } | undefined
  expect(saved?.shape).toBe('chart-1')
  expect(saved?.chart.symbol).toBe('NVDA')
})

test('a refused open says why instead of failing the command', async ($, on) => {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('tool.call', () => ({ result: [{ type: 'text', text: BRIEF_MD }], text: BRIEF_MD }))
  on('ui.open', () => ({ deny: 'the id is held by another plugin' }))
  await $.tool.call({ tool: 'mcp__daviddtechplus__analyze_asset', symbol: 'NVDA' })
  const r = await $.command.run(typed(''))
  expect(r.text).toContain('could not open here')
  expect(r.text).toContain('NVDA')
})
