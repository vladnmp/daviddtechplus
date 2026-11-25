import { expect, mock, test } from 'claude-code/testing'
import type { On, ThemeSetArgs } from 'claude-code'

import { BACKDROP_CALM, BACKDROP_STORM, BACKDROP_TOOL } from './fixtures'

/** The engine beneath the mod: a session, a command registry, a theme that draws (or not), and the theme calls. */
function engine(on: On, isDrawn = true) {
  const sets: ThemeSetArgs[] = []
  const clears: number[] = []
  const registered: string[] = []

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => {
    registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('theme.set', (_, e) => {
    sets.push(e)

    return isDrawn
      ? { value: { isDrawn: true, requestId: 'backdrop' } }
      : { value: { isDrawn: false, reason: 'the terminal draws no looks' } }
  })
  on('theme.clear', () => {
    clears.push(1)

    return { value: { isDrawn: false, reason: 'cleared' } }
  })

  return { sets, clears, registered }
}

const START = { cwd: '/', surface: 'desktop', isInteractive: true } as const

/** `/daviddtech-looks <args>` as the person types it at the prompt. */
function command(args: string) {
  return {
    command: 'daviddtech-looks',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  } as const
}

test('/daviddtech-looks winter sets the whole look once and saves the choice', async ($, on) => {
  mock.store(on)
  const seen = engine(on)
  await $.session.start(START)
  expect(seen.registered).toEqual(['daviddtech-looks'])

  const answer = await $.command.run(command('winter'))
  expect(answer.text).toContain('Winter look on.')
  expect(seen.sets.length).toBe(1)
  const set = seen.sets[0] as ThemeSetArgs & { backdrop: { scene: string; glass: { blur: number } } }
  expect(set.backdrop.scene).toBe('winter')
  expect(set.backdrop.glass.blur).toBe(18)
  expect((set.colors as { v?: number } | undefined)?.v).toBe(1)
  expect(seen.clears.length).toBe(0)

  // The choice is saved: the next session start (a resume, a reload) sets winter again.
  await $.session.start(START)
  expect(seen.sets.length).toBe(2)
  expect((seen.sets[1]?.backdrop as { scene: string }).scene).toBe('winter')
})

test('off clears once and forgets the choice; anything else is help with no theme call', async ($, on) => {
  mock.store(on, { look: 'pine' })
  const seen = engine(on)
  await $.session.start(START)
  expect(seen.sets.length).toBe(1)

  const off = await $.command.run(command('off'))
  expect(off.text).toBe("Back to the app's own look.")
  expect(seen.clears.length).toBe(1)

  const help = await $.command.run(command('nonsense'))
  expect(help.text).toContain('/daviddtech-looks winter')
  expect(help.text).toContain('Now: none.')
  expect(seen.sets.length).toBe(1)
  expect(seen.clears.length).toBe(1)

  // The choice is forgotten: the next session start sets nothing (and clears nothing).
  await $.session.start(START)
  expect(seen.sets.length).toBe(1)
  expect(seen.clears.length).toBe(1)
})

test('a session start sets the saved look again', async ($, on) => {
  mock.store(on, { look: 'pine' })
  const seen = engine(on)
  await $.session.start(START)
  expect(seen.sets.length).toBe(1)
  expect((seen.sets[0]?.backdrop as { scene: string }).scene).toBe('pine')
})

test('a session start with an empty store never touches the theme', async ($, on) => {
  mock.store(on)
  const seen = engine(on)
  await $.session.start(START)
  expect(seen.sets.length).toBe(0)
  expect(seen.clears.length).toBe(0)
})

test('on a screen that draws no looks the answer says where they draw', async ($, on) => {
  mock.store(on)
  const seen = engine(on, false)
  await $.session.start(START)
  const answer = await $.command.run(command('winter'))
  expect(answer.text).toContain('desktop and mobile apps')
  await $.session.start(START)
  expect((seen.sets[1]?.backdrop as { scene: string }).scene).toBe('winter')
})

test('the weather look reads the free market_backdrop tool once when no reading is saved', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1_000_000 })
  const seen = engine(on)
  const calls: string[] = []
  on('tool.list', () => ({ value: [{ name: BACKDROP_TOOL }, { name: 'mcp__claude_ai_DaviddTech___analyze_asset' }] as never }))
  on('mcp.call', (_, e) => {
    calls.push(`${e.server}/${e.tool}`)

    return { value: { content: [{ type: 'text', text: BACKDROP_STORM }], isError: false } }
  })
  await $.session.start(START)

  const answer = await $.command.run(command('weather'))
  expect(calls).toEqual(['claude_ai_DaviddTech_/market_backdrop'])
  expect(answer.text).toContain('stormy')
  expect((seen.sets[0]?.backdrop as { scene: string }).scene).toBe('market-weather')

  // A fresh saved reading is used as it is: no second call.
  await $.command.run(command('weather'))
  expect(calls.length).toBe(1)
})

test('in a terminal-only session the weather look says the new mood in a toast', async ($, on) => {
  mock.store(on, { look: 'weather' })
  mock.clock(on)
  engine(on)
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('tool.call', () => ({ result: [{ type: 'text', text: BACKDROP_STORM }], text: BACKDROP_STORM }))
  await $.session.start({ ...START, surface: 'terminal' })

  const ran = await $.tool.call({ tool: BACKDROP_TOOL } as never)
  expect(ran.text).toBe(BACKDROP_STORM)
  expect(toasts).toEqual(['Market weather: now stormy'])

  // The same reading again leaves the sky as it is: no second toast.
  await $.tool.call({ tool: BACKDROP_TOOL } as never)
  expect(toasts.length).toBe(1)
})

test('a calm sky and two stormy readings 6 hours apart: one toast, straight to stormy, never windy', async ($, on) => {
  const hour = 60 * 60 * 1000
  mock.store(on, { look: 'weather', weather: { mood: 'clear', seenAt: 0, at: 0, levels: [1], pending: null } })
  const clock = mock.clock(on, { now: hour })
  engine(on)
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('tool.call', () => ({ result: [{ type: 'text', text: BACKDROP_STORM }], text: BACKDROP_STORM }))
  await $.session.start({ ...START, surface: 'terminal' })

  // The first stormy reading waits: the sky stays calm.
  await $.tool.call({ tool: BACKDROP_TOOL } as never)
  expect(toasts).toEqual([])

  // The second, 6 hours later, agrees: the sky goes straight to stormy.
  await clock.advance(6 * hour)
  await $.tool.call({ tool: BACKDROP_TOOL } as never)
  expect(toasts).toEqual(['Market weather: now stormy'])
})

test('off when no DaviddTech look is on clears nothing (a clear would wipe another mod\'s look)', async ($, on) => {
  mock.store(on)
  const seen = engine(on)
  await $.session.start(START)

  const off = await $.command.run(command('off'))
  expect(off.text).toBe('No DaviddTech look is on, so nothing changed.')
  expect(seen.clears.length).toBe(0)
})

const WEATHER_SCENE = {
  plugin: 'daviddtech-looks',
  component: 'Backdrop',
  requestId: 'backdrop',
  surface: 'desktop',
  props: { scene: 'market-weather', plugin: 'daviddtech-looks', glass: { blur: 18, opacity: 0.55 } },
} as const

test('a session start brings back a sky seen in the last 36 hours; an older storm shows a calm sky', async ($, on) => {
  const hour = 60 * 60 * 1000
  mock.store(on, { look: 'weather', weather: { mood: 'storm', levels: [5, 4], at: 0 } })
  mock.clock(on, { now: 37 * hour })
  engine(on)
  await $.session.start(START)

  const ui = await $.ui.mount(WEATHER_SCENE)
  const source = String((await ui.find({ type: 'Svg' }))?.props.source ?? '')
  expect(source).not.toContain('class="rain"')
  expect(source).toContain('class="sun"')
  await ui.unmount()
})

test('a session start brings back a fresh stormy reading', async ($, on) => {
  const hour = 60 * 60 * 1000
  mock.store(on, { look: 'weather', weather: { mood: 'storm', levels: [5, 4], at: 6 * hour } })
  mock.clock(on, { now: 7 * hour })
  engine(on)
  await $.session.start(START)

  const ui = await $.ui.mount(WEATHER_SCENE)
  expect(String((await ui.find({ type: 'Svg' }))?.props.source ?? '')).toContain('class="rain"')
  await ui.unmount()
})

test('a stale weather look reads market_backdrop once, a few seconds after the session starts', async ($, on) => {
  const hour = 60 * 60 * 1000
  mock.store(on, { look: 'weather', weather: { mood: 'clear', levels: [1], at: 0 } })
  const clock = mock.clock(on, { now: 37 * hour })
  engine(on)
  const calls: string[] = []
  on('tool.list', () => ({ value: [{ name: BACKDROP_TOOL }] as never }))
  on('mcp.call', (_, e) => {
    calls.push(e.tool)

    return { value: { content: [{ type: 'text', text: BACKDROP_STORM }], isError: false } }
  })
  await $.session.start(START)
  expect(calls).toEqual([])

  await clock.advance(5000)
  expect(calls).toEqual(['market_backdrop'])
  const ui = await $.ui.mount(WEATHER_SCENE)
  expect(String((await ui.find({ type: 'Svg' }))?.props.source ?? '')).toContain('class="rain"')
  await ui.unmount()
})

test('a stormy sky from 20 hours ago comes back, and its free reading is due', async ($, on) => {
  const hour = 60 * 60 * 1000
  mock.store(on, { look: 'weather', weather: { mood: 'storm', levels: [5, 4], at: 0 } })
  const clock = mock.clock(on, { now: 20 * hour })
  engine(on)
  const calls: string[] = []
  on('tool.list', () => ({ value: [{ name: BACKDROP_TOOL }] as never }))
  on('mcp.call', (_, e) => {
    calls.push(e.tool)

    return { value: { content: [{ type: 'text', text: BACKDROP_CALM }], isError: false } }
  })
  await $.session.start(START)
  const ui = await $.ui.mount(WEATHER_SCENE)
  expect(String((await ui.find({ type: 'Svg' }))?.props.source ?? '')).toContain('class="rain"')

  // One calm reading waits; the sky stays stormy.
  await clock.advance(5000)
  expect(calls).toEqual(['market_backdrop'])
  expect(String((await ui.find({ type: 'Svg' }))?.props.source ?? '')).toContain('class="rain"')
  await ui.unmount()
})

test('the command names a reading that waits, so the member knows why the sky stays', async ($, on) => {
  const hour = 60 * 60 * 1000
  const weather = { mood: 'clear', seenAt: 0, at: 2 * hour, levels: [3], pending: { mood: 'windy', at: 2 * hour } }
  mock.store(on, { look: 'weather', weather })
  mock.clock(on, { now: 3 * hour })
  engine(on)
  const calls: string[] = []
  on('mcp.call', (_, e) => {
    calls.push(e.tool)

    return { value: { content: [{ type: 'text', text: BACKDROP_STORM }], isError: false } }
  })
  await $.session.start(START)

  const answer = await $.command.run(command('weather'))
  expect(answer.text).toContain('The sky is calm. The latest reading was windy; the sky changes when the next reading agrees.')
  expect(calls).toEqual([])
})
