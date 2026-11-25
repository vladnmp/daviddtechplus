import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LookName, Mood } from '../types'
import { LOOKS, SCENES, isLook } from './palettes'
import {
  GAP_MS,
  aidOf,
  aidServer,
  backdropServer,
  levelsOfMarkets,
  marketsOf,
  marketsOfText,
  moodOfMarkets,
  nextWeather,
  parseJson,
  shownMood,
  textOf,
  weatherRecord,
  word,
} from './readings'
import type { WeatherRecord } from './readings'
import { altOf, pineSvg, weatherSvg, winterSvg } from './scenes'

/** How long the pine look keeps a red or green glow after a DaviddTech Aid check. */
const PULSE_MS = 2600
/** How long after a session start a stale weather look waits before reading market_backdrop once. */
const REFRESH_DELAY_MS = 5000

const look = atom({ plugin: 'daviddtech-looks', key: 'look' } as const, null)
const mood = atom({ plugin: 'daviddtech-looks', key: 'mood' } as const, 'clear')
const pulse = atom({ plugin: 'daviddtech-looks', key: 'pulse' } as const, null)
/** When the last redraw-causing change happened (ms): a redrawn scene carries on from there instead of restarting. */
const phase = atom({ plugin: 'daviddtech-looks', key: 'phase' } as const, 0)

const LABEL: Record<LookName, string> = { winter: 'Winter', weather: 'Market weather', pine: 'Pine' }

const HELP = [
  'DaviddTech looks (drawn in the Claude desktop and mobile apps):',
  '/daviddtech-looks winter: snow, warm lights and pine trees',
  '/daviddtech-looks weather: a sky that follows the DaviddTech+ storm levels (calm, windy, stormy)',
  '/daviddtech-looks pine: a pine forest that glows red or green after a DaviddTech Aid check',
  "/daviddtech-looks off: back to the app's own look",
]

/** The saved market weather (sky, latest reading, a reading that waits), or null. */
async function savedWeather($: EngineInterface): Promise<WeatherRecord | null> {
  return weatherRecord(await $.store.get('weather').catch(() => undefined))
}

/** Whether the latest saved reading is under 6 hours old; else the one free reading is due. */
function isRecent(record: WeatherRecord | null, now: number): boolean {
  return record !== null && now - record.at < GAP_MS
}

/** Sets the mood; a change moves the phase first, so the redrawn sky carries on instead of restarting. */
async function setMood($: EngineInterface, next: Mood, at?: number): Promise<void> {
  if ((await read($, mood)) === next) {
    return
  }
  const now = at ?? (await $.clock.now())
  await update($, phase, () => now)
  await update($, mood, () => next)
}

/**
 * Keeps a reading. The sky changes only when two readings agree (see nextWeather); the record goes to the
 * store and the sky to state (the weather scene redraws by itself). True when the sky shown changed.
 */
async function keepWeather($: EngineInterface, reading: Mood, levels: number[]): Promise<{ record: WeatherRecord; isChanged: boolean }> {
  const at = await $.clock.now()
  const record = nextWeather(await savedWeather($), reading, levels, at)
  const isChanged = (await read($, mood)) !== record.mood
  await setMood($, record.mood, at)
  await $.store.set('weather', record).catch(() => undefined)

  return { record, isChanged }
}

/** What the command says about the sky: a waiting reading is named, so a member knows why the sky stays. */
function skyNote(record: WeatherRecord, now: number): string {
  const sky = shownMood(record, now)
  if (record.pending !== null && record.pending.mood !== sky) {
    return ` The sky is ${word(sky)}. The latest reading was ${word(record.pending.mood)}; the sky changes when the next reading agrees.`
  }

  return ` The market is ${word(sky)} right now.`
}

/** Ends a pulse after its glow played, unless a newer check started its own; the pine scene carries on. */
async function endPulse($: EngineInterface, at: number): Promise<void> {
  const now = await read($, pulse)
  if (now === null || now.at !== at) {
    return
  }
  const time = await $.clock.now()
  await update($, phase, () => time)
  await update($, pulse, current => (current !== null && current.at === at ? null : current))
}

/** Forgets this mod's look: the saved choice and the session's own note of it. */
async function forget($: EngineInterface): Promise<void> {
  await $.store.delete('look').catch(() => undefined)
  await update($, look, () => null)
}

/** Whether a look of this mod is on now (in this session, or chosen and saved). */
async function isOurs($: EngineInterface): Promise<boolean> {
  return (await read($, look)) !== null || isLook(await $.store.get('look').catch(() => undefined))
}

/** Reads the free DaviddTech+ market_backdrop tool on whichever DaviddTech server carries it; null if none answers. */
async function refreshWeather($: EngineInterface): Promise<WeatherRecord | null> {
  const tools = await $.tool.list().catch(() => [])
  const servers = [...new Set(tools.flatMap(tool => backdropServer(tool.name) ?? []))]

  for (const server of servers) {
    try {
      const answer = await $.mcp.call(server, 'market_backdrop', {})
      if (answer.isError) {
        continue
      }
      const structured = marketsOf(answer.structuredContent)
      const markets = structured.length > 0 ? structured : marketsOfText(textOf(answer))
      const found = moodOfMarkets(markets)
      if (found !== null) {
        return (await keepWeather($, found, levelsOfMarkets(markets))).record
      }
    } catch {
      // not connected under this name: try the next one
    }
  }

  return null
}

/** True when every surface attached draws no looks (the terminal, the editor). */
async function isPlainOnly($: EngineInterface): Promise<boolean> {
  const surfaces = await $.session.surfaces().catch(() => [])

  return surfaces.length > 0 && surfaces.every(surface => surface === 'terminal' || surface === 'vscode')
}

export const register: Register = (on, options) => {
  const showsAid = options.aidStatus !== 'off'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'daviddtech-looks',
      description: 'Animated looks: winter, market weather, pine (desktop and mobile apps)',
      argumentHint: 'winter | weather | pine | off',
      immediate: true,
    })
    // A look is display only: --resume and a reload bring none back, so the chosen one is set again here.
    // Nothing chosen: no set and never a clear (a clear here would wipe another mod's look).
    // Another mod's look set later forgets this choice (see the theme.set hook), so this never paints over it.
    const chosen = await $.store.get('look').catch(() => undefined)
    if (isLook(chosen)) {
      await update($, look, () => chosen)
      // The saved sky comes back while a reading saw it in the last 36 hours; an older one starts calm.
      const saved = await savedWeather($)
      const now = saved === null ? 0 : await $.clock.now()
      await update($, mood, () => shownMood(saved, now))
      await $.theme.set(LOOKS[chosen])
      if (!isRecent(saved, now) && chosen === 'weather') {
        // A few seconds in, once the connector is up: one free market_backdrop reading for the sky.
        $.clock.after(REFRESH_DELAY_MS, () => refreshWeather($).then(() => undefined, () => undefined))
      }
    }

    return next(e)
  })

  // Another mod set or cleared the session's one theme: this mod's look is no longer showing, so forget the
  // choice. It then never comes back at the next session start over the newer look. This mod's own calls
  // never reach its own hooks; the origin check is a second guard.
  on('theme.set', async ($, e, next) => {
    const result = await next(e)
    if (next.origin.plugin !== 'daviddtech-looks') {
      await forget($)
    }

    return result
  }).catch(($, e, next) => next(e))

  on('theme.clear', async ($, e, next) => {
    const result = await next(e)
    if (next.origin.plugin !== 'daviddtech-looks') {
      await forget($)
    }

    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'daviddtech-looks' }, async ($, e) => {
    const asked = e.args.trim().toLowerCase()

    if (asked === 'off') {
      // A clear wipes whatever theme stands, so it runs only when this mod's look is the one on.
      if (!(await isOurs($))) {
        return { text: 'No DaviddTech look is on, so nothing changed.' }
      }
      await forget($)
      await $.theme.clear()

      return { text: "Back to the app's own look." }
    }

    if (!isLook(asked)) {
      const now = await read($, look)
      const current = now === null ? 'none' : now

      return { text: [...HELP, `Now: ${current}.`].join('\n') }
    }

    await $.store.set('look', asked).catch(() => undefined)
    await update($, look, () => asked)

    let note = ''
    if (asked === 'weather') {
      const now = await $.clock.now()
      const saved = await savedWeather($)
      const record = isRecent(saved, now) ? saved : await refreshWeather($)
      if (record !== null) {
        await setMood($, shownMood(record, now))
        note = skyNote(record, now)
      } else {
        note = ' The sky follows the next DaviddTech+ market weather reading.'
      }
    }

    const set = await $.theme.set(LOOKS[asked])

    if (!set.isDrawn) {
      return {
        text: `Looks draw in the desktop and mobile apps; this screen keeps its own colors (${set.reason}). Your choice is saved for those apps.`,
      }
    }

    return { text: `${LABEL[asked]} look on.${note} /daviddtech-looks off to go back.` }
  })

  // A DaviddTech+ market weather reading the model asked for: the weather scene follows it.
  on('tool.call', { tool: /^mcp__.+__market_backdrop$/ }, async ($, e, next) => {
    if (backdropServer(e.tool) === null) {
      return next(e)
    }
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) {
      return ran
    }
    const text = ran.text ?? textOf(ran.result)
    const fromText = marketsOfText(text)
    const markets = fromText.length > 0 ? fromText : marketsOf(parseJson(text))
    const found = moodOfMarkets(markets)

    if (found !== null) {
      const kept = await keepWeather($, found, levelsOfMarkets(markets))
      if (kept.isChanged && (await read($, look)) === 'weather' && (await isPlainOnly($))) {
        $.ui.toast(`Market weather: now ${word(kept.record.mood)}`)
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  // A DaviddTech Aid check: its result in the status line, and a red or green glow on the pine look.
  on('tool.call', { tool: /^mcp__.+__check_pine$/ }, async ($, e, next) => {
    if (aidServer(e.tool) === null) {
      return next(e)
    }
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) {
      return ran
    }
    const aid = aidOf(ran.text ?? textOf(ran.result))

    if (aid !== null) {
      if (showsAid) {
        $.ui.status(`Aid: ${aid.word} · ${aid.score}/100`)
      }
      const kind = aid.word === 'red' ? 'red' : aid.word === 'clean' ? 'green' : null
      if (kind !== null) {
        const at = await $.clock.now()
        await update($, phase, () => at)
        await update($, pulse, () => ({ kind, at }))
        $.clock.after(PULSE_MS, () => endPulse($, at).then(() => undefined, () => undefined))
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.props.plugin !== 'daviddtech-looks' || (e.surface !== 'desktop' && e.surface !== 'mobile')) {
      return next(e)
    }
    const scene = e.props.scene
    const { Svg } = $.ui.resolve(e)

    if (scene === SCENES.winter) {
      return <Svg source={winterSvg()} alt={altOf(scene, 'clear', null)} isInteractive />
    }
    if (scene === SCENES.weather) {
      const now = await read($, mood)
      const t = (await read($, phase)) / 1000

      return <Svg source={weatherSvg(now, t)} alt={altOf(scene, now, null)} isInteractive />
    }
    if (scene === SCENES.pine) {
      const now = await read($, pulse)
      const t = (await read($, phase)) / 1000

      return <Svg source={pineSvg(now, t)} alt={altOf(scene, 'clear', now)} isInteractive />
    }

    return next(e)
  })
}
