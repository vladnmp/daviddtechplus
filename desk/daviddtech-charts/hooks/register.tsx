// daviddtech-charts: draws the last DaviddTech+ forecast as a chart in a pane
// beside the chat. Reads the answer of analyze_asset, level_odds, plan_check
// and scan_assets as it passes; never calls those tools itself (they can cost
// the member a daily unit).

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { Chart } from '../types'
import { chartFrom, matchTool } from './parse'
import { PANE_ID, PANE_TITLE, SOURCE, captionOf, chance, headerOf, levelLine, pct, suggestionsOf } from './model'
import { axisLine, rasterFor, rasterSize } from './raster'
import { svgFor } from './svg'

// Change the tag when Chart's fields change: it declines what an earlier version stored.
const SHAPE = 'chart-1'
const last = atom({ plugin: 'daviddtech-charts', key: 'last' } as const, null, { shape: SHAPE })
const isNew = atom({ plugin: 'daviddtech-charts', key: 'isNew' } as const, false)
const isBandHidden = atom({ plugin: 'daviddtech-charts', key: 'isBandHidden' } as const, false)

export const NO_CHART =
  'No DaviddTech+ forecast yet. Ask for one, e.g. "Analyze NVDA with DaviddTech+", and the chart opens here.'

type AutoOpen = 'sidebar' | 'always' | 'never'

function reasonOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.trim().slice(0, 120) || 'unknown reason'
}

function optionOf<T extends string>(options: unknown, key: string, allowed: readonly T[], fallback: T): T {
  const v = (options as Record<string, unknown> | null)?.[key]
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

/** A chart this version wrote to the store, else null. */
export function savedChart(raw: unknown): Chart | null {
  const box = raw as { shape?: unknown; chart?: Partial<Chart> } | null
  const c = box?.chart
  if (!box || box.shape !== SHAPE || !c || typeof c !== 'object') return null
  const kinds = ['brief', 'odds', 'plan', 'scan']
  const isOk =
    kinds.includes(String(c.kind)) && typeof c.symbol === 'string' && typeof c.at === 'number' &&
    typeof c.summary === 'string' && [c.path, c.levels, c.odds, c.rows, c.plans].every(Array.isArray)
  return isOk ? (c as Chart) : null
}

// A hint only (lost on reload): what the band last saw of the terminal.
let lastSeen: { surface: RenderSurface | null; isFullscreen: boolean; columns: number } = {
  surface: null,
  isFullscreen: false,
  columns: 0,
}

// The engine places an unasked pane only from this many terminal columns; below
// it the pane waits undrawn and could pop up long after the forecast.
const UNASKED_MIN_COLUMNS = 144

/** Whether a new chart opens the pane unasked: only where it can be a sidebar, under "sidebar". */
async function shouldOpen($: EngineInterface, autoOpen: AutoOpen): Promise<boolean> {
  if (autoOpen === 'never') return false
  if (autoOpen === 'always') return true
  if (lastSeen.isFullscreen && (lastSeen.surface !== 'terminal' || lastSeen.columns >= UNASKED_MIN_COLUMNS)) return true
  const surfaces = await $.session.surfaces().catch(() => [] as readonly RenderSurface[])
  return surfaces.some(s => s !== 'terminal')
}

export const register: Register = (on, options) => {
  const autoOpen = optionOf<AutoOpen>(options, 'autoOpen', ['sidebar', 'always', 'never'], 'sidebar')
  const band = optionOf(options, 'band', ['on', 'off'] as const, 'on')
  on('session.start', async ($, e, next) => {
    await $.command
      .register({
        name: 'daviddtech-chart',
        description: 'Show the last DaviddTech+ forecast as a chart',
        argumentHint: '[close]',
        immediate: true,
      })
      .catch(() => undefined)
    // A chart from an earlier session comes back quietly: no pane, no band.
    if ((await read($, last)) === null) {
      const saved = savedChart(await $.store.get('last').catch(() => undefined))
      if (saved) await update($, last, () => saved)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const m = matchTool(String(e.tool))
    if (!m) return next(e)
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    try {
      const now = await $.clock.now().catch(() => Date.now())
      const chart = chartFrom(m.tool, ran, now)
      if (chart) {
        await update($, last, () => chart)
        await update($, isNew, () => true)
        await update($, isBandHidden, () => false)
        void $.store.set('last', { shape: SHAPE, chart }).catch(() => undefined)
        if (await shouldOpen($, autoOpen)) {
          // ui.open answers at once (placed or waiting), so awaiting it does not hold the answer back.
          const r = await $.ui.open({ id: PANE_ID, title: PANE_TITLE }).catch(() => null)
          if (r?.isPlaced) await update($, isNew, () => false)
        }
      }
    } catch {
      // The chart is extra: the member's tool answer always goes through as it came.
    }
    // The object core gave, unchanged, so core keeps its own messages (ref, text).
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'daviddtech-chart' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'close') {
      await $.ui.close({ id: PANE_ID }).catch(() => undefined)
      return { text: 'Chart pane closed.' }
    }
    const chart = await read($, last)
    if (!chart) return { text: NO_CHART }
    const r = await $.ui
      .open({ id: PANE_ID, title: PANE_TITLE, focus: true })
      .catch((err: unknown) => ({ isPlaced: false as const, reason: reasonOf(err) }))
    if (!r.isPlaced) return { text: `The chart pane could not open here (${r.reason}). ${chart.summary}` }
    await update($, isNew, () => false)
    return { text: `Chart: ${chart.summary}` }
  })

  on('ui.render', { component: 'Pane', requestId: 'daviddtech-chart' }, async ($, e) => {
    const chart = await read($, last)
    const { Box, Text, Button, Progress } = $.ui.resolve(e)
    if (!chart) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No DaviddTech+ forecast yet.</Text>
          <Text dimColor>Ask for one, e.g. "Analyze NVDA with DaviddTech+", and the chart shows here.</Text>
        </Box>
      )
    }
    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="column">
          <Text bold>{chart.kind === 'scan' ? 'DaviddTech+ scan' : chart.symbol}</Text>
          <Text wrap="truncate-end">{chart.summary}</Text>
        </Box>
      )
    }
    const size = rasterSize(e.props.bodyColumns, e.props.scroll.bodyRows)
    let picture = null
    let axis = null
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      const r = rasterFor(chart, size.columns, size.rows)
      if (r) {
        picture = <Raster key="chart" columns={r.columns} rows={r.rows} cells={r.cells} />
        if (chart.kind !== 'scan') axis = <Text dimColor>{axisLine(chart, size.columns)}</Text>
      }
    } else {
      const { Svg } = $.ui.resolve(e)
      const source = svgFor(chart)
      if (source) picture = <Svg source={source} alt={chart.summary} isInteractive />
    }
    // The 80% range in words, directly under the date axis or the picture, in the same column box.
    const caption = picture ? captionOf(chart, Math.max(20, Math.floor(e.props.bodyColumns))) : []
    const isCard = chart.kind === 'brief' && chart.path.length === 0
    const levels = chart.kind === 'brief' || chart.kind === 'odds' ? chart.levels.slice(0, 6) : []
    const scanRows =
      chart.kind === 'scan' && e.surface === 'vscode'
        ? chart.rows.slice(0, 8).map(r => `${r.symbol}: 80% range ${pct(r.range80[0])} to ${pct(r.range80[1])} · middle ${pct(r.middle)}`)
        : []
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>{headerOf(chart)}</Text>
          <Text>{chart.summary}</Text>
        </Box>
        {picture && (
          <Box flexDirection="column">
            {picture}
            {axis}
            {caption.map((line, i) => (
              <Text key={`caption-${i}`} wrap="truncate-end">
                {line}
              </Text>
            ))}
          </Box>
        )}
        {isCard && <Text dimColor>Ask for the full brief to see the fan chart.</Text>}
        {levels.length > 0 && (
          <Box flexDirection="column">
            {levels.map(l => (
              <Text>{levelLine(l)}</Text>
            ))}
          </Box>
        )}
        {scanRows.length > 0 && (
          <Box flexDirection="column">
            {scanRows.map(line => (
              <Text>{line}</Text>
            ))}
          </Box>
        )}
        {chart.plans.map(p => (
          <Box flexDirection="column">
            <Text bold>
              Plan {p.plan} ({p.direction}): opens at {p.openAt}, loss exit {p.loss.name}
            </Text>
            {p.exits.map((x, i) => (
              <Text>
                Profit exit {i + 1}: {x.name} ({x.pct >= 0 ? '+' : ''}
                {x.pct.toFixed(2)}%){x.reached === null ? '' : ` · reached by ${chart.endLabel ?? 'the end date'} ${chance(x.reached)}`}
              </Text>
            ))}
            {p.profitFirstIfOpened !== null && (
              <Progress label="Profit exit 1 first (if opened)" value={p.profitFirstIfOpened} valueText={chance(p.profitFirstIfOpened)} />
            )}
            {p.lossFirstIfOpened !== null && (
              <Progress label="Loss exit first (if opened)" value={p.lossFirstIfOpened} valueText={chance(p.lossFirstIfOpened)} />
            )}
          </Box>
        ))}
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {suggestionsOf(chart).map(s => (
            <Button key={s.key} label={s.label} dimColor onPress={() => void $.prompt.fill({ text: s.text, mode: 'replace' })} />
          ))}
        </Box>
        <Text dimColor>{SOURCE}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    lastSeen = { surface: e.surface, isFullscreen: e.viewport?.isFullscreen === true, columns: e.viewport?.columns ?? 0 }
    if (band === 'off' || e.props.hasSurvey) return next(e)
    const chart = await read($, last)
    if (!chart || !(await read($, isNew)) || (await read($, isBandHidden))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" width={e.props.bodyColumns} gap={1}>
        <Box flexShrink={1} flexGrow={1}>
          <Text wrap="truncate-end">DaviddTech+ {chart.summary}</Text>
        </Box>
        <Button
          key="chart"
          label="Chart"
          onPress={async () => {
            const r = await $.ui
              .open({ id: PANE_ID, title: PANE_TITLE, focus: true })
              .catch((err: unknown) => ({ isPlaced: false as const, reason: reasonOf(err) }))
            if (r.isPlaced) await update($, isNew, () => false)
            else $.ui.toast(`The chart pane could not open here (${r.reason}).`)
          }}
        />
        <Button key="hide" label="Hide" dimColor onPress={() => update($, isBandHidden, () => true)} />
      </Box>
    )
  })
}
