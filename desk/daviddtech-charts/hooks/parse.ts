// Reads a DaviddTech+ answer into a Chart. In a tool.call hook an MCP tool's
// answer arrives as its text blocks (the markdown the server renders), so the
// text route is the one that runs today; the structured route reads the same
// shapes the in-chat chart (widget.py) reads, for the day a hook sees them.

import type { Chart, ChartLevel, ChartOddsLine, ChartPlan, ChartPoint, ChartScanRow } from '../types'
import { MONTHS, day, isNum, plain, readChance, summaryOf } from './model'

export const TOOLS = ['analyze_asset', 'level_odds', 'scan_assets', 'plan_check'] as const
export type ToolName = (typeof TOOLS)[number]

const TOOL_NAME = /^mcp__(.+)__(analyze_asset|level_odds|scan_assets|plan_check)$/

/** The DaviddTech+ server and tool a call names, or null for any other tool. */
export function matchTool(name: string): { server: string; tool: ToolName } | null {
  const m = TOOL_NAME.exec(name)
  if (!m || !/daviddtech/i.test(m[1] ?? '')) return null
  return { server: m[1] ?? '', tool: m[2] as ToolName }
}

type Ran = { result?: unknown; text?: string }

/** The text blocks of an MCP answer, joined. */
export function joinedText(result: unknown): string {
  if (typeof result === 'string') return result
  const blocks = Array.isArray(result)
    ? result
    : Array.isArray((result as { content?: unknown } | null)?.content)
      ? (result as { content: unknown[] }).content
      : []
  return blocks
    .map(b => ((b as { type?: unknown })?.type === 'text' ? String((b as { text?: unknown }).text ?? '') : ''))
    .filter(Boolean)
    .join('\n')
}

/** The chart in a tool call's answer, or null when it holds none. */
export function chartFrom(tool: ToolName, ran: Ran, at: number): Chart | null {
  const r = ran.result
  if (r !== null && typeof r === 'object' && !Array.isArray(r)) {
    const direct = fromStructured(tool, r, at)
    if (direct) return direct
    const inner = (r as { structuredContent?: unknown }).structuredContent
    const nested = inner && typeof inner === 'object' ? fromStructured(tool, inner, at) : null
    if (nested) return nested
  }
  const text = typeof ran.text === 'string' && ran.text.length > 0 ? ran.text : joinedText(r)
  return text ? fromText(tool, text, at) : null
}

// ---------------------------------------------------------------- helpers

type Obj = Record<string, unknown>

function obj(v: unknown): Obj | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function num(v: unknown): number | null {
  return isNum(v) ? v : null
}

function pair(v: unknown): [number, number] | null {
  const a = arr(v)
  return a.length === 2 && isNum(a[0]) && isNum(a[1]) ? [a[0], a[1]] : null
}

function isoDay(v: unknown): string | null {
  const s = str(v)
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

function plural(unit: string): string {
  return unit.endsWith('s') ? unit : `${unit}s`
}

function finish(c: Omit<Chart, 'summary'>): Chart {
  return { ...c, summary: summaryOf({ ...c, summary: '' }) }
}

function base(tool: ToolName, kind: Chart['kind'], from: Chart['from'], at: number): Omit<Chart, 'summary'> {
  return {
    kind, tool, symbol: '', assetClass: null, asOf: null, endDate: null, fromLabel: null, endLabel: null,
    steps: 0, stepUnit: 'steps', path: [], levels: [], odds: [], range80: null, middle: null, chanceHigher: null,
    rows: [], plans: [], from, at,
  }
}

function priceOf(text: string | undefined): number | null {
  if (text === undefined) return null
  const n = Number(text.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

const PCT = '([+-]\\d+(?:\\.\\d+)?)'
const CH = '(<1%|>99%|\\d+%)'

/** The csv code fence after `title`, as rows of lines (header first), or []. */
function csvAfter(text: string, title: string): string[] {
  const at = text.indexOf(title)
  if (at < 0) return []
  const open = text.indexOf('```csv', at)
  if (open < 0) return []
  const close = text.indexOf('```', open + 6)
  const body = text.slice(open + 6, close < 0 ? undefined : close)
  return body.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
}

/** "14 Nov" to an ISO date, the year read off `after` (a later ISO date). */
function isoFromShort(short: string | null, after: string | null): string | null {
  if (!short || !after) return null
  const m = /^(\d{1,2}) ([A-Z][a-z]{2})$/.exec(short)
  const month = m ? MONTHS.indexOf(m[2] ?? '') + 1 : 0
  if (!m || month < 1) return null
  const laterMonth = Number(after.slice(5, 7))
  const year = Number(after.slice(0, 4)) - (month > laterMonth ? 1 : 0)
  return `${year}-${String(month).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`
}

// ---------------------------------------------------------------- structured

/** A chart from a structured result (widget.py's detection order, plans first). */
export function fromStructured(tool: ToolName, raw: unknown, at: number): Chart | null {
  const d = obj(raw)
  if (!d) return null
  if (Array.isArray(d.plans)) return planStructured(tool, d, at)
  if (Array.isArray(d.forecast_path) && obj(d.instrument)) return briefStructured(tool, d, at)
  if (Array.isArray(d.rows)) return scanStructured(tool, d, at)
  if (Array.isArray(d.levels) && d.end_date) return oddsStructured(tool, d, at)
  return null
}

function levelFrom(l: unknown, kind: 'resistance' | 'support'): ChartLevel | null {
  const o = obj(l)
  const p = num(o?.pct_from_reference)
  if (!o || p === null) return null
  return {
    name: str(o.basis) ?? kind, pct: p, price: num(o.price), touch: num(o.touch_probability), kind,
    major: o.strength === 'major',
  }
}

function briefStructured(tool: ToolName, d: Obj, at: number): Chart | null {
  const inst = obj(d.instrument)
  const horizon = obj(d.horizon)
  const data = obj(d.data)
  const lv = obj(d.levels)
  const head = obj(d.headline)
  const symbol = str(inst?.symbol)
  if (!symbol) return null
  const asOf = isoDay(data?.last_session)
  const points = arr(d.forecast_path).flatMap((p, i): ChartPoint[] => {
    const o = obj(p)
    const v = ['p10', 'p25', 'p50', 'p75', 'p90', 'prob_up'].map(k => num(o?.[k]))
    if (!o || v.some(x => x === null)) return []
    const [p10, p25, p50, p75, p90, probUp] = v as number[]
    return [{ step: num(o.step) ?? i + 1, session: isoDay(o.session) ?? '', p10: p10!, p25: p25!, p50: p50!, p75: p75!, p90: p90!, probUp: probUp! }]
  })
  const path = points.length ? [startPoint(asOf), ...points] : []
  const levels: ChartLevel[] = [
    ...arr(lv?.resistances).map(l => levelFrom(l, 'resistance')),
    ...arr(lv?.supports).map(l => levelFrom(l, 'support')),
  ].filter((l): l is ChartLevel => l !== null)
  const inv = obj(lv?.invalidation)
  const invPct = num(inv?.pct_from_reference)
  if (inv && invPct !== null) {
    levels.push({
      name: `Break level (${str(inv.applies_to) ?? 'lean'})`, pct: invPct, price: num(inv.price),
      touch: num(inv.touch_probability), kind: 'break', major: false,
    })
  }
  const endDate = points.length ? points[points.length - 1]!.session || null : null
  return finish({
    ...base(tool, 'brief', 'structured', at),
    symbol, assetClass: str(inst?.asset_class), asOf, endDate, fromLabel: asOf ? day(asOf) : null,
    endLabel: endDate ? day(endDate) : null, steps: num(horizon?.steps) ?? points.length,
    stepUnit: plural(str(horizon?.unit) ?? 'steps'), path, levels, range80: pair(head?.range_80_pct),
    middle: num(head?.expected_move_pct), chanceHigher: num(head?.prob_up_at_horizon),
  })
}

function startPoint(asOf: string | null): ChartPoint {
  return { step: 0, session: asOf ?? '', p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, probUp: 0.5 }
}

function oddsStructured(tool: ToolName, d: Obj, at: number): Chart | null {
  const symbol = str(d.symbol)
  if (!symbol) return null
  const sessions = arr(d.sessions).map(isoDay).filter((s): s is string => s !== null)
  const levels: ChartLevel[] = []
  const odds: ChartOddsLine[] = []
  for (const raw of arr(d.levels)) {
    const o = obj(raw)
    const p = num(o?.pct_from_reference)
    if (!o || p === null) continue
    const price = num(o.price)
    const name = price !== null ? plain(price) : (str(o.level) ?? '')
    levels.push({ name, pct: p, price, touch: num(o.touch_chance), kind: 'level', major: false })
    odds.push({ name, values: [o.side === 'at' ? 1 : 0, ...arr(o.touch_by_step).map(v => num(v) ?? 0)] })
  }
  const asOf = isoDay(d.reference_date)
  const endDate = isoDay(d.end_date)
  return finish({
    ...base(tool, 'odds', 'structured', at),
    symbol, assetClass: str(d.asset_class), asOf, endDate, fromLabel: asOf ? day(asOf) : null,
    endLabel: endDate ? day(endDate) : null, steps: num(d.steps) ?? sessions.length,
    stepUnit: plural(str(d.step_unit) ?? 'steps'), levels, odds, range80: pair(d.range_80_at_end_pct),
    middle: num(d.middle_at_end_pct), chanceHigher: num(d.chance_higher_at_end),
  })
}

function planLevelName(o: Obj | null): string {
  const price = num(o?.price)
  return price !== null ? plain(price) : (str(o?.level) ?? '')
}

function planStructured(tool: ToolName, d: Obj, at: number): Chart | null {
  const symbol = str(d.symbol)
  if (!symbol) return null
  const plans = arr(d.plans).flatMap((raw, i): ChartPlan[] => {
    const p = obj(raw)
    if (!p) return []
    const loss = obj(p.loss_exit)
    const open = obj(p.open_level)
    return [{
      plan: num(p.plan) ?? i + 1,
      direction: p.direction === 'down' ? 'down' : 'up',
      openAt: open ? planLevelName(open) : 'the last close',
      profitFirstIfOpened: num(p.profit_first_if_opened),
      lossFirstIfOpened: num(p.loss_first_if_opened),
      neitherIfOpened: num(p.neither_if_opened),
      exits: arr(p.profit_exits).map(x => {
        const o = obj(x)
        return { name: planLevelName(o), pct: num(o?.pct_from_reference) ?? 0, reached: num(o?.reached_chance), reachedIfOpened: num(o?.reached_if_opened) }
      }),
      loss: { name: planLevelName(loss), pct: num(loss?.pct_from_reference) ?? 0 },
    }]
  })
  if (!plans.length) return null
  const asOf = isoDay(d.reference_date)
  const endDate = isoDay(d.end_date)
  return finish({
    ...base(tool, 'plan', 'structured', at),
    symbol, assetClass: str(d.asset_class), asOf, endDate, fromLabel: asOf ? day(asOf) : null,
    endLabel: endDate ? day(endDate) : null, steps: num(d.steps) ?? 0, stepUnit: plural(str(d.step_unit) ?? 'steps'),
    plans,
  })
}

function scanStructured(tool: ToolName, d: Obj, at: number): Chart | null {
  const rows = arr(d.rows).flatMap((raw): ChartScanRow[] => {
    const o = obj(raw)
    const middle = num(o?.expected_move_pct)
    const range80 = pair(o?.range_80_pct)
    const symbol = str(o?.symbol)
    if (!o || middle === null || range80 === null || !symbol) return []
    return [{ symbol, middle, range80, storm: num(o.storm_level) }]
  })
  if (!rows.length) return null
  return finish({
    ...base(tool, 'scan', 'structured', at),
    symbol: 'Scan', steps: num(d.horizon) ?? num(d.steps) ?? 0, rows,
  })
}

// ---------------------------------------------------------------- text

/** A chart from the markdown a DaviddTech+ tool answers with, or null. */
export function fromText(tool: ToolName, text: string, at: number): Chart | null {
  try {
    if (tool === 'analyze_asset') return briefText(tool, text, at) ?? cardText(tool, text, at)
    if (tool === 'level_odds') return oddsText(tool, text, at)
    if (tool === 'plan_check') return planText(tool, text, at)
    return scanText(tool, text, at)
  } catch {
    return null
  }
}

const BRIEF_HEAD = /^## DaviddTech\+ Alpha Brief: (.+?) \((equity|etf|fx|crypto)\), next (\d+) (.+?)\s*$/m
const CARD_HEAD = /^## (.+?): next (\d+) (.+?) \(card\)\s*$/m
const LEVEL_ITEM = new RegExp(`^${PCT}%( major)? \\((?:=([-\\d.,e+]+), )?(.*?)\\)(?: — touch ${CH})?$`)
const BREAK = new RegExp(`^- (?:\\*\\*)?Break level \\(([^)]+)\\) ${PCT}%(?: \\(=([^)]+)\\))?(?: — touch ${CH})?`, 'm')

function headline(body: string): Pick<Chart, 'range80' | 'middle' | 'chanceHigher' | 'asOf'> {
  const range = new RegExp(`80% range ${PCT}% to ${PCT}%`).exec(body)
  const middle = new RegExp(`[Cc]entral path ${PCT}%`).exec(body)
  const up = /P\(up\) (\d+(?:\.\d+)?)/.exec(body)
  const asOf = /reference = (\d{4}-\d{2}-\d{2}) close/.exec(body)
  return {
    range80: range ? [Number(range[1]), Number(range[2])] : null,
    middle: middle ? Number(middle[1]) : null,
    chanceHigher: up ? Number(up[1]) : null,
    asOf: asOf?.[1] ?? null,
  }
}

function breakLevel(body: string): ChartLevel | null {
  const m = BREAK.exec(body)
  if (!m) return null
  return {
    name: `Break level (${m[1]})`, pct: Number(m[2]), price: priceOf(m[3]),
    touch: m[4] ? readChance(m[4]) : null, kind: 'break', major: false,
  }
}

function briefText(tool: ToolName, text: string, at: number): Chart | null {
  const head = BRIEF_HEAD.exec(text)
  if (!head) return null
  const body = text.slice(head.index)
  const h = headline(body)
  const rows = csvAfter(body, '### Forecast path')
  const points: ChartPoint[] = []
  if (rows[0]?.startsWith('step,session,p10')) {
    for (const line of rows.slice(1)) {
      const c = line.split(',')
      const v = c.slice(2, 8).map(Number)
      if (c.length < 8 || v.some(x => !Number.isFinite(x))) continue
      points.push({ step: Number(c[0]), session: c[1] ?? '', p10: v[0]!, p25: v[1]!, p50: v[2]!, p75: v[3]!, p90: v[4]!, probUp: v[5]! })
    }
  }
  const levels: ChartLevel[] = []
  for (const kind of ['resistance', 'support'] as const) {
    const line = new RegExp(`^- ${kind === 'resistance' ? 'Resistance' : 'Support'}: (.+)$`, 'm').exec(body)
    if (!line || line[1] === 'none mapped nearby') continue
    for (const item of (line[1] ?? '').split('; ')) {
      const m = LEVEL_ITEM.exec(item.trim())
      if (!m) continue
      levels.push({
        name: m[4] || kind, pct: Number(m[1]), price: priceOf(m[3]), touch: m[5] ? readChance(m[5]) : null,
        kind, major: m[2] === ' major',
      })
    }
  }
  const brk = breakLevel(body)
  if (brk) levels.push(brk)
  const endDate = points.length ? points[points.length - 1]!.session : null
  return finish({
    ...base(tool, 'brief', 'text', at),
    symbol: head[1] ?? '', assetClass: head[2] ?? null, asOf: h.asOf, endDate,
    fromLabel: h.asOf ? day(h.asOf) : null, endLabel: endDate ? day(endDate) : null,
    steps: Number(head[3]), stepUnit: plural(head[4] ?? 'steps'),
    path: points.length ? [startPoint(h.asOf), ...points] : [], levels,
    range80: h.range80, middle: h.middle, chanceHigher: h.chanceHigher,
  })
}

function cardText(tool: ToolName, text: string, at: number): Chart | null {
  const head = CARD_HEAD.exec(text)
  if (!head) return null
  const body = text.slice(head.index)
  const h = headline(body)
  const levels: ChartLevel[] = []
  const near = /^- Nearest (.+)\.\s*$/m.exec(body)
  for (const item of (near?.[1] ?? '').split(/, (?=resistance|support)/)) {
    const m = new RegExp(`^(resistance|support) ${PCT}%(?: \\(=([^)]+)\\))?(?: — touch ${CH})?$`).exec(item.trim())
    if (!m) continue
    const kind = m[1] as 'resistance' | 'support'
    levels.push({ name: kind, pct: Number(m[2]), price: priceOf(m[3]), touch: m[4] ? readChance(m[4]) : null, kind, major: false })
  }
  const brk = breakLevel(body)
  if (brk) levels.push(brk)
  return finish({
    ...base(tool, 'brief', 'text', at),
    symbol: head[1] ?? '', asOf: h.asOf, fromLabel: h.asOf ? day(h.asOf) : null,
    steps: Number(head[2]), stepUnit: plural(head[3] ?? 'steps'), levels,
    range80: h.range80, middle: h.middle, chanceHigher: h.chanceHigher,
  })
}

const SHORT = '(\\d{1,2} [A-Z][a-z]{2})'

function oddsText(tool: ToolName, text: string, at: number): Chart | null {
  const head = new RegExp(`^## (.+?) odds by ${SHORT} \\((\\d+) (.+?) from the ${SHORT} close(?: = [^)]+)?\\)\\s*$`, 'm').exec(text)
  if (!head || / plan$/.test(head[1] ?? '')) return null
  const body = text.slice(head.index)
  const table = [...body.matchAll(new RegExp(`^\\| (.+?) \\| ${PCT}% \\| ${CH} \\| ${CH} \\((.+?)\\) \\|\\s*$`, 'gm'))]
  const csv = csvAfter(body, 'Touch chance by step (CSV):')
  const sessions: string[] = []
  const columns: number[][] = []
  if (csv[0]?.startsWith('step,session,')) {
    for (const line of csv.slice(1)) {
      const c = line.split(',')
      sessions.push(c[1] ?? '')
      c.slice(2).forEach((v, j) => (columns[j] ??= []).push(Number(v)))
    }
  }
  const levels: ChartLevel[] = []
  const odds: ChartOddsLine[] = []
  table.forEach((m, j) => {
    const name = m[1] ?? ''
    levels.push({ name, pct: Number(m[2]), price: priceOf(name), touch: readChance(m[3] ?? ''), kind: 'level', major: false })
    odds.push({ name, values: [m[5] === 'higher' ? 1 : 0, ...(columns[j] ?? [])] })
  })
  if (!levels.length) return null
  const end = new RegExp(`On .+?: 80% range ${PCT}% to ${PCT}%, middle ${PCT}%, chance higher ${CH}\\.`).exec(body)
  const endDate = sessions.length ? sessions[sessions.length - 1]! : null
  return finish({
    ...base(tool, 'odds', 'text', at),
    symbol: head[1] ?? '', asOf: isoFromShort(head[5] ?? null, sessions[0] ?? null), endDate,
    fromLabel: head[5] ?? null, endLabel: head[2] ?? null, steps: Number(head[3]), stepUnit: plural(head[4] ?? 'steps'),
    levels, odds, range80: end ? [Number(end[1]), Number(end[2])] : null,
    middle: end ? Number(end[3]) : null, chanceHigher: end ? readChance(end[4] ?? '') : null,
  })
}

function planText(tool: ToolName, text: string, at: number): Chart | null {
  const head = new RegExp(`^## (.+?) plan odds by ${SHORT} \\((\\d+) (.+?) from the ${SHORT} close(?: = [^)]+)?\\)\\s*$`, 'm').exec(text)
  if (!head) return null
  const body = text.slice(head.index)
  const plans: ChartPlan[] = []
  for (const chunk of body.split(/^### Plan /m).slice(1)) {
    const top = /^(\d+) \((up|down)\): opens at (.+?), loss exit (.+?)\s*$/m.exec(chunk)
    if (!top) continue
    const part = chunk.split(/^### /m)[0] ?? chunk
    const exits = [...part.matchAll(new RegExp(`^\\| Profit exit \\d+: (.+?) \\| ${PCT}% \\| [^|]* \\| ${CH} \\| ${CH} \\|\\s*$`, 'gm'))]
      .map(m => ({ name: m[1] ?? '', pct: Number(m[2]), reached: readChance(m[3] ?? ''), reachedIfOpened: readChance(m[4] ?? '') }))
    const loss = new RegExp(`^\\| Loss exit: (.+?) \\| ${PCT}% \\|`, 'm').exec(part)
    const opened = new RegExp(`If opened: profit exit 1 first ${CH}, loss exit first ${CH}, neither by .+? ${CH}\\.`).exec(part)
    plans.push({
      plan: Number(top[1]), direction: top[2] === 'down' ? 'down' : 'up', openAt: top[3] ?? '',
      profitFirstIfOpened: opened ? readChance(opened[1] ?? '') : null,
      lossFirstIfOpened: opened ? readChance(opened[2] ?? '') : null,
      neitherIfOpened: opened ? readChance(opened[3] ?? '') : null,
      exits, loss: { name: loss?.[1] ?? top[4] ?? '', pct: loss ? Number(loss[2]) : 0 },
    })
  }
  if (!plans.length) return null
  return finish({
    ...base(tool, 'plan', 'text', at),
    symbol: head[1] ?? '', fromLabel: head[5] ?? null, endLabel: head[2] ?? null,
    steps: Number(head[3]), stepUnit: plural(head[4] ?? 'steps'), plans,
  })
}

function scanText(tool: ToolName, text: string, at: number): Chart | null {
  const head = /^## DaviddTech\+ Scan: (\d+) symbols?, (\d+) steps ahead\s*$/m.exec(text)
  if (!head) return null
  const body = text.slice(head.index)
  const rows: ChartScanRow[] = []
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('| ') || line.startsWith('| Symbol')) continue
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    if (cells.length < 12) continue
    const middle = new RegExp(`^${PCT}%$`).exec(cells[3] ?? '')
    const range = new RegExp(`^${PCT}% to ${PCT}%$`).exec(cells[4] ?? '')
    if (!middle || !range) continue
    const storm = /storm (\d)/.exec(cells[11] ?? '')
    rows.push({ symbol: cells[0] ?? '', middle: Number(middle[1]), range80: [Number(range[1]), Number(range[2])], storm: storm ? Number(storm[1]) : null })
  }
  if (!rows.length) return null
  return finish({ ...base(tool, 'scan', 'text', at), symbol: 'Scan', steps: Number(head[2]), rows })
}
