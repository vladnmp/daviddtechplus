// Formatters and the one-line summary of a chart. Member-facing words only:
// level, end date, range, odds, middle, chance higher.

import type { Chart } from '../types'

export const SOURCE = 'Source: DaviddTech+ (skool.com/daviddtech/about)'
export const PANE_ID = 'daviddtech-chart'
export const PANE_TITLE = 'DaviddTech+ chart'
/** Words no member-facing text of this mod may hold. */
export const FORBIDDEN = /\b(buy|sell|signal|target|edge)\b|expected move/i

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** "+1.2%", "-6.1%", "0.0%": ASCII sign, `d` decimals. */
export function pct(v: number, d = 1): string {
  const r = Math.abs(v).toFixed(d)
  const sign = Number(r) === 0 ? '' : v > 0 ? '+' : '-'
  return `${sign}${r}%`
}

/** Whole percent, "<1%" / ">99%" near the ends, as the DaviddTech+ text writes it. */
export function chance(p: number): string {
  const v = p * 100
  if (v > 0 && v < 0.5) return '<1%'
  if (v >= 99.5 && v < 100) return '>99%'
  return `${Math.round(v)}%`
}

/** Reads "41%", "<1%", ">99%" back to 0..1. */
export function readChance(text: string): number | null {
  const t = text.trim()
  // Inside the bands chance() writes back as "<1%" and ">99%".
  if (t === '<1%') return 0.004
  if (t === '>99%') return 0.996
  const m = /^(\d+(?:\.\d+)?)%$/.exec(t)
  return m ? Number(m[1]) / 100 : null
}

/** "2026-11-28" to "28 Nov" (the DaviddTech+ short date). */
export function day(iso: string | null): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const month = Number(m[2])
  return month >= 1 && month <= 12 ? `${Number(m[3])} ${MONTHS[month - 1]}` : iso
}

/** "sessions" for stock-exchange sessions, "days" otherwise. */
export function stepNoun(unit: string, count = 2): string {
  const noun = /session/.test(unit) ? 'session' : 'day'
  return count === 1 ? noun : `${noun}s`
}

/**
 * The 80% range in words, in the first form that fits `columns`: one line
 * (F1, F2) or two (F3a or F4a, then F3b, F3c or F4b). The same ladder as
 * lab-desk; here `lo` and `hi` are percents.
 */
export function rangeCaption(lo: string, hi: string, steps: number, unit: string, columns: number): string[] {
  const u = stepNoun(unit, steps)
  const isDays = u.startsWith('day')
  const f1 = `80% range ${lo} to ${hi} · 1 in 10 ends above ${hi}, 1 in 10 below ${lo} (${steps} ${u})`
  if (f1.length <= columns) return [f1]
  const f2 = `80% range ${lo} to ${hi} · 1 in 10 ends above, 1 in 10 below (${steps} ${u})`
  if (f2.length <= columns) return [f2]
  const f3a = `80% range ${lo} to ${hi} (${steps} ${u})`
  const first = f3a.length <= columns || !isDays ? f3a : `80% ${lo} to ${hi} (${steps}d)`
  const seconds = [`1 in 10 ends above ${hi}, 1 in 10 below ${lo}`, '1 in 10 ends above, 1 in 10 below', '1 in 10 above, 1 in 10 below']
  return [first, seconds.find(t => t.length <= columns) ?? '1 in 10 above, 1 in 10 below']
}

/** The caption under a fan chart, from the brief's 80% range; none without a path or a range. */
export function captionOf(c: Chart, columns: number): string[] {
  if (c.kind !== 'brief' || c.path.length < 2 || !c.range80) return []
  return rangeCaption(pct(c.range80[0]), pct(c.range80[1]), c.steps, c.stepUnit, columns)
}

/** A price as DaviddTech+ prints it: up to 10 significant digits, thousands with commas. */
export function plain(v: number): string {
  let text = v.toPrecision(10)
  if (text.includes('e')) return String(v)
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '')
  const [whole, frac] = text.split('.')
  const sign = (whole ?? '').startsWith('-') ? '-' : ''
  const digits = (whole ?? '').replace('-', '')
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}${grouped}${frac ? `.${frac}` : ''}`
}

/** The one line the band, the pane and the command show. */
export function summaryOf(c: Chart): string {
  if (c.kind === 'brief') {
    const parts = [`${c.symbol}`, `next ${c.steps} ${stepNoun(c.stepUnit, c.steps)}${c.fromLabel ? ` from ${c.fromLabel}` : ''}`]
    if (c.range80) parts.push(`80% range ${pct(c.range80[0])} to ${pct(c.range80[1])}`)
    if (c.middle !== null) parts.push(`middle ${pct(c.middle)}`)
    if (c.chanceHigher !== null) parts.push(`chance higher ${chance(c.chanceHigher)}`)
    return parts.join(' · ')
  }
  if (c.kind === 'odds') {
    const levels = c.levels
      .slice(0, 2)
      .map(l => `${l.name} touch ${l.touch === null ? '?' : chance(l.touch)}`)
    return [`${c.symbol} odds by ${c.endLabel ?? 'the end date'}`, ...levels].join(' · ')
  }
  if (c.kind === 'plan') {
    const p = c.plans[0]
    if (!p) return `${c.symbol} plan odds`
    const odds = [
      p.profitFirstIfOpened === null ? null : `profit exit 1 first ${chance(p.profitFirstIfOpened)}`,
      p.lossFirstIfOpened === null ? null : `loss exit first ${chance(p.lossFirstIfOpened)}`,
    ].filter(Boolean)
    const more = c.plans.length > 1 ? ` (+${c.plans.length - 1} more)` : ''
    return `${c.symbol} plan ${p.plan} (${p.direction})${more} · if opened: ${odds.join(', ')}`
  }
  const widest = c.rows.reduce<Chart['rows'][number] | null>(
    (best, r) => (best === null || r.range80[1] - r.range80[0] > best.range80[1] - best.range80[0] ? r : best),
    null,
  )
  const n = `${c.rows.length} symbol${c.rows.length === 1 ? '' : 's'}`
  return widest
    ? `Scan · ${n} · widest 80% range ${widest.symbol} ${pct(widest.range80[0])} to ${pct(widest.range80[1])}`
    : `Scan · ${n}`
}

/** The pane's header line: "NVDA · next 10 trading sessions · from 14 Nov close". */
export function headerOf(c: Chart): string {
  if (c.kind === 'scan') {
    return `DaviddTech+ scan · ${c.rows.length} ${c.rows.length === 1 ? 'symbol' : 'symbols'} · ${c.steps} steps ahead`
  }
  const parts = [c.symbol, `next ${c.steps} ${c.stepUnit}`]
  if (c.fromLabel) parts.push(`from ${c.fromLabel} close`)
  if ((c.kind === 'odds' || c.kind === 'plan') && c.endLabel) parts.push(`by ${c.endLabel}`)
  return parts.join(' · ')
}

/** "Resistance +5.00% major · touch 41%" for the pane's level rows. */
export function levelLine(l: Chart['levels'][number]): string {
  const word = l.kind === 'level' ? `Level ${l.name}` : l.kind === 'break' ? 'Break level' : l.kind === 'resistance' ? 'Resistance' : 'Support'
  const price = l.price !== null && l.kind !== 'level' ? ` (${plain(l.price)})` : ''
  const touch = l.touch === null ? '' : ` · touch ${chance(l.touch)}`
  return `${word} ${pct(l.pct, 2)}${l.major ? ' major' : ''}${price}${touch}`
}

/** Prompts the pane's buttons put in the prompt box. */
export function suggestionsOf(c: Chart): { key: string; label: string; text: string }[] {
  if (c.kind === 'scan') {
    const first = c.rows[0]?.symbol ?? 'the first symbol'
    return [
      { key: 'brief', label: `Full brief on ${first}`, text: `Use DaviddTech+ analyze_asset on ${first}` },
      { key: 'scan', label: 'Scan related symbols', text: `Use DaviddTech+ scan_assets on symbols related to ${c.rows.map(r => r.symbol).slice(0, 5).join(', ')}` },
    ]
  }
  const end = c.endLabel ? ` by ${c.endLabel}` : ''
  const near = [c.levels.find(l => l.kind === 'resistance'), c.levels.find(l => l.kind === 'support')]
  const levels = near.filter(l => l !== undefined).map(l => pct(l.pct, 0)).join(', ')
  const out = [
    { key: 'odds', label: 'Odds on these levels', text: `Use DaviddTech+ level_odds on ${c.symbol} for ${levels || '+5%, -5%'}${end}` },
    { key: 'plan', label: 'Check a plan', text: `Use DaviddTech+ plan_check on ${c.symbol}: opens at the last close, loss exit -4%, profit exits +4% and +8%${end}` },
    { key: 'scan', label: 'Scan related symbols', text: `Use DaviddTech+ scan_assets on ${c.symbol} and 4 related symbols` },
  ]
  return c.kind === 'odds' ? out.slice(1) : c.kind === 'plan' ? [out[0]!, out[2]!] : out
}
