// The Workshop: the member's own trading idea, built and tested in one go. The pure parts: the versions it tests
// (only the idea's own numbers and hold moved, so it stays inside the idea), the verdict worked out in code, the
// idea file written before the run, the card, the bench (rules frozen with a date and scored from it), and the
// lasting try count. Pure: no `$`.

import type { Candle } from '../types'
import { conditionSeries, day, pct } from './history'
import { MIN_UNSEEN } from './honest'
import type { CoinRow, TestSpec } from './honest'
import { MIN_SCORED } from './spa'
import type { SwarmResult, SwarmRow } from './swarm'

/** The member's rule and up to 39 versions of it, all judged together. */
export const WORKSHOP_VERSIONS = 40
/** The other coins the strongest is checked on, in this order; the home coin is skipped, and only listed perps count. */
export const OTHER_COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'HYPE'] as const
export const OTHER_COUNT = 4
/** Passed the history checks: held on at least this many of the other coins (the home coin never counts toward it). */
export const OTHER_PASS = 3
/** The other coins are checked at this many times the fee, so a thin result has to clear a higher bar. */
export const FEE_TIMES = 2
/** Most rules kept on the bench. */
export const BENCH_MAX = 50
/** Words never printed on a card, in a marker or an alert name. */
export const BANNED_WORDS = /\b(buy|buys|buying|sell|sells|selling|signals?|targets?|edge|expected move)\b/i

/** "Pullback on SOL!" → "pullback-on-sol": the idea's folder and bench name (the words the desk never prints dropped). */
export function slugOf(raw: unknown): string {
  const s = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .split('-')
    .filter(w => w !== '' && !BANNED_WORDS.test(w))
    .join('-')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return s === '' ? 'idea' : s
}

/** The numbers in a condition that a version may move: not an interval ("on 4h"), not 0. */
function numbersIn(text: string): { at: number; len: number; value: number }[] {
  const out: { at: number; len: number; value: number }[] = []
  for (const m of text.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g)) {
    const v = Number(m[1])
    if (/\bon$/i.test(text.slice(0, m.index).trimEnd()) || v === 0) continue
    out.push({ at: m.index ?? 0, len: (m[1] ?? '').length, value: v })
  }
  return out
}

const move = (v: number, s: number) => (Number.isInteger(v) ? Math.max(1, Math.round(v * s)) : Number((v * s).toPrecision(4)))

export type Version = { enter: string; exit?: string; hold: number | null }

/**
 * Versions of the member's rule that stay inside the idea: the same conditions, side and fee, only its own numbers
 * moved 10-20% and its hold halved to doubled; one change at a time first, then two. A rule with nothing to move gets
 * a few holds. Never the rule itself, never twice, at most WORKSHOP_VERSIONS - 1.
 */
export function versionsOf(rule: Version): Version[] {
  const steps = [0.8, 0.9, 1.1, 1.2]
  const holdSteps = [0.5, 0.75, 1.5, 2]
  const seen = new Set<string>()
  const key = (v: Version) => `${v.enter}|${v.exit ?? ''}|${v.hold ?? ''}`
  seen.add(key(rule))
  const out: Version[] = []
  const push = (v: Version) => {
    if (out.length >= WORKSHOP_VERSIONS - 1 || seen.has(key(v))) return
    seen.add(key(v))
    out.push(v)
  }
  const at = (text: string, n: { at: number; len: number }, v: number) => text.slice(0, n.at) + String(v) + text.slice(n.at + n.len)
  const ex = rule.exit !== undefined ? { exit: rule.exit } : {}
  const enterNums = numbersIn(rule.enter)
  const exitNums = rule.exit ? numbersIn(rule.exit) : []
  const holds = rule.hold !== null ? holdSteps.map(s => Math.min(1000, Math.max(1, Math.round((rule.hold as number) * s)))).filter(h => h !== rule.hold) : []
  // One change at a time.
  for (const n of enterNums) for (const s of steps) if (move(n.value, s) !== n.value) push({ enter: at(rule.enter, n, move(n.value, s)), ...ex, hold: rule.hold })
  for (const n of exitNums) for (const s of steps) if (move(n.value, s) !== n.value) push({ enter: rule.enter, exit: at(rule.exit as string, n, move(n.value, s)), hold: rule.hold })
  for (const h of holds) push({ enter: rule.enter, ...ex, hold: h })
  // Two at a time: an entry number with the hold, then an entry number with an exit number.
  for (const n of enterNums) for (const s of steps) for (const h of holds) if (move(n.value, s) !== n.value) push({ enter: at(rule.enter, n, move(n.value, s)), ...ex, hold: h })
  for (const n of enterNums) for (const s of steps) for (const m of exitNums) for (const t of steps) if (move(n.value, s) !== n.value && move(m.value, t) !== m.value) push({ enter: at(rule.enter, n, move(n.value, s)), exit: at(rule.exit as string, m, move(m.value, t)), hold: rule.hold })
  // Nothing to move: a few holds, still the same entry and exit.
  if (out.length < 3) for (const h of [5, 10, 20, 40]) push({ enter: rule.enter, ...ex, hold: h })
  return out
}

export type VerdictKind = 'passed' | 'home-only' | 'unseen-no' | 'unseen-few' | 'seen-no' | 'few'
export type Other = { coin: string; held: boolean; note: string }
export type Verdict = { kind: VerdictKind; best: SwarmRow | null; others: Other[]; held: number }

/** Did the home coin's check pass: a rule beat luck on the seen part and held on the unseen part with enough trades? */
export function homeHeld(x: SwarmResult): boolean {
  const u = x.unseenP
  return u !== null && u.n >= MIN_UNSEEN && u.held && u.avg > 0
}

/** One other coin held: 30+ unseen trades, its own luck check passed, and it made money there. */
export function otherHeld(row: CoinRow): boolean {
  const r = row.r
  return r !== null && r.unseen.n >= MIN_UNSEEN && r.luck?.survives === true && r.unseen.avg > 0
}

/** The other coins as the card says them: held, or why not. */
export function othersOf(rows: readonly CoinRow[]): Other[] {
  return rows.map(row => {
    const r = row.r
    const held = otherHeld(row)
    const note = held
      ? 'held'
      : r === null
        ? (row.note ?? 'could not be checked')
        : r.unseen.n < MIN_UNSEEN
          ? `${r.unseen.n} unseen trades, under ${MIN_UNSEEN}`
          : r.unseen.avg <= 0
            ? 'lost on the unseen part'
            : 'no better than luck'
    return { coin: row.coin, held, note }
  })
}

/**
 * The verdict, in code: "passed" only when the strongest beat luck on the home coin across every counted try, held on
 * the unseen part with 30+ trades, and held on OTHER_PASS of the other coins at FEE_TIMES the fee.
 */
export function verdictOf(x: SwarmResult, across: readonly CoinRow[] | null): Verdict {
  const u = x.unseenP
  const best = u ? (x.rows.find(r => r.words === u.best) ?? null) : null
  if (x.few === x.rows.length) return { kind: 'few', best: null, others: [], held: 0 }
  if (!x.rows.some(r => r.survives) || !u) return { kind: 'seen-no', best: null, others: [], held: 0 }
  if (u.n < MIN_UNSEEN) return { kind: 'unseen-few', best, others: [], held: 0 }
  if (!homeHeld(x)) return { kind: 'unseen-no', best, others: [], held: 0 }
  const others = othersOf(across ?? [])
  const held = others.filter(o => o.held).length
  return { kind: held >= OTHER_PASS ? 'passed' : 'home-only', best, others, held }
}

/** The other coins to check: the fixed list, without the home coin, only those listed on Hyperliquid. */
export function otherCoins(home: string, isListed: (coin: string) => boolean): string[] {
  return OTHER_COINS.filter(c => c !== home && isListed(c)).slice(0, OTHER_COUNT)
}

/** Times the open condition turned true (the first candle of each run), from the first candle it could be read. */
export function caseTimes(spec: TestSpec, candles: readonly Candle[]): number[] {
  const a = conditionSeries(spec.enter, candles)
  const out: number[] = []
  for (let i = 1; i < candles.length; i++) if (a[i] === true && a[i - 1] !== true) out.push((candles[i] as Candle).t)
  return out
}

/**
 * The marker's opens as its Pine code decides them, mirrored here so a test can hold it to the Lab test's own entries:
 * on a closed candle with no trade running, open when the open condition holds; while one runs, close when the close
 * condition holds or `hold` candles on (and open nothing on that candle).
 */
export function markerOpens(spec: TestSpec, candles: readonly Candle[]): number[] {
  const a = conditionSeries(spec.enter, candles)
  const b = spec.exit ? conditionSeries(spec.exit, candles) : null
  const out: number[] = []
  let openedAt: number | null = null
  for (let i = 0; i < candles.length; i++) {
    if (openedAt === null) {
      if (a[i] === true && i >= 1) {
        out.push(i)
        openedAt = i
      }
    } else if ((b && b[i] === true) || (spec.hold !== null && i - openedAt >= spec.hold)) openedAt = null
  }
  return out
}

/** FNV-1a over UTF-16 code units, as 8 hex digits: the judging files' fingerprint on the card. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

/** The files that judge (the test, the luck check, the swarm, conditions and this verdict), in this order. */
export const JUDGING_FILES = ['honest.ts', 'spa.ts', 'swarm.ts', 'history.ts', 'workshop.ts'] as const

/** One frozen rule: its words, where it runs, and the first candle time it is scored from. */
export type BenchRow = { name: string; words: string; coin: string; interval: string; deep: boolean; since: number }

/** Puts a rule on the bench: the same name and words keep their first date (a date never moves); new words replace it. */
export function benchAdd(rows: readonly BenchRow[], row: BenchRow): BenchRow[] {
  const old = rows.find(r => r.name === row.name)
  if (old && old.words === row.words && old.coin === row.coin && old.interval === row.interval && old.deep === row.deep) return [...rows]
  return [...rows.filter(r => r.name !== row.name), row].slice(-BENCH_MAX)
}

/**
 * The tries kept for good, per coin (all intervals): the desk's own count can be wiped by a reset, this one never
 * drops. `seen` is the desk's count when last looked; `resets` the desk resets noticed.
 */
export type Lasting = { resets: number; coins: Record<string, { seen: number; total: number }> }

/** Adds what the desk counted since the last look; after a reset (or a desk count that went down) all of it is new. */
export function lastingNext(book: Lasting, desk: Readonly<Record<string, number>>, isReset: boolean): Lasting {
  const coins: Lasting['coins'] = {}
  for (const coin of new Set([...Object.keys(book.coins), ...Object.keys(desk)])) {
    const old = book.coins[coin] ?? { seen: 0, total: 0 }
    const now = desk[coin] ?? 0
    const from = isReset || now < old.seen ? 0 : old.seen
    coins[coin] = { seen: now, total: old.total + Math.max(0, now - from) }
  }
  return { resets: book.resets + (isReset ? 1 : 0), coins }
}

/** The lasting book as read back from a file or the saved notes; anything else is a fresh book. */
export function lastingOf(raw: unknown): Lasting {
  const o = raw as Partial<Lasting> | null
  const coins: Lasting['coins'] = {}
  if (o && typeof o.coins === 'object' && o.coins !== null)
    for (const [k, v] of Object.entries(o.coins)) {
      const r = v as { seen?: unknown; total?: unknown }
      if (typeof r?.seen === 'number' && typeof r.total === 'number') coins[k] = { seen: r.seen, total: r.total }
    }
  return { resets: typeof o?.resets === 'number' ? o.resets : 0, coins }
}

/** The bench as read back; rows that don't read are dropped. */
export function benchOf(raw: unknown): BenchRow[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is BenchRow => {
    const o = x as Partial<BenchRow> | null
    return !!o && typeof o.name === 'string' && typeof o.words === 'string' && typeof o.coin === 'string' && typeof o.interval === 'string' && typeof o.deep === 'boolean' && typeof o.since === 'number'
  })
}

/** What the run hands the card: every number on it comes from here. */
export type Run = {
  name: string
  rule: string
  coin: string
  interval: string
  side: 'long' | 'short'
  venue: string
  fee: number
  from: number
  to: number
  versions: number
  few: number
  verdict: Verdict
  /** The strongest is the member's own rule (not one of the versions). */
  isRule: boolean
  luck: string[]
  mood: string | null
  cases: number
  pinned: number
  marker: { file: string; left: string[] } | null
  aid: string
  since: number
  tries: { total: number; resets: number }
  version: string
  judging: string
  folder: string
}

const fee = (f: number) => `${Number((f * 100).toFixed(4))}%`

/** The verdict as one plain line. */
export function verdictLine(r: Run): string {
  const v = r.verdict
  const who = !v.best ? '' : r.isRule ? 'your rule' : `the version "${v.best.words.replace(/ fee [\d.]+$/, '')}"`
  const list = v.others.map(o => `${o.coin} ${o.note}`).join(', ')
  switch (v.kind) {
    case 'passed':
      return `Passed the history checks: ${who} beat luck on ${r.coin} across every counted try, held on the unseen part, and held on ${v.held} of ${v.others.length} other coins at ${FEE_TIMES}x the fee (${list}). Still only history.`
    case 'home-only':
      if (v.others.length === 0) return `Not judged yet: ${who} beat luck on ${r.coin} and held on the unseen part, but the other coins could not be checked just now.`
      return `Not passed: ${who} held on ${r.coin}, but on only ${v.held} of ${v.others.length} other coins at ${FEE_TIMES}x the fee (${list}); what holds on one coin only is usually luck.`
    case 'unseen-no':
      return `Not passed: ${who} beat luck on the seen part, but the unseen part said no.`
    case 'unseen-few':
      return `Not judged yet: ${who} beat luck on the seen part, but has under ${MIN_UNSEEN} trades on the unseen part.`
    case 'seen-no':
      return `Not passed: none of the ${r.versions} versions beat luck on the seen part. That is the usual answer, and an honest one.`
    case 'few':
      return `Not judged: none of the ${r.versions} versions had ${MIN_SCORED} trades on the seen part.`
  }
}

/** The one next thing to try, from the verdict. */
export function nextLine(r: Run, check: string): string {
  switch (r.verdict.kind) {
    case 'passed':
      return `Next: paste ${r.marker ? r.marker.file : 'the rule'} into TradingView and set its alerts, then ${check} in a week: live numbers come at ${MIN_UNSEEN} trades.`
    case 'home-only':
      if (r.verdict.others.length === 0) return `Next: say go again later and the other coins decide it (the same versions add no tries); ${check} scores the bench meanwhile.`
    // falls through
    case 'unseen-no':
    case 'seen-no':
      return `Next: ask Claude for a different idea through the Workshop, or the same idea on another interval; ${check} scores the bench since its date (no try counted).`
    case 'unseen-few':
    case 'few':
      return `Next: a looser open condition or a shorter interval through the Workshop again (each version counts as a try), or ${check} in a few weeks.`
  }
}

/** The card: built, tested, the verdict, the tries kept for good, and one next thing. */
export function cardText(r: Run, check: string): string {
  const built = r.marker
    ? `a TradingView marker with "opens" and "closes" alerts (${r.marker.file})${r.marker.left.length ? `; it leaves out ${r.marker.left.join(', ')} (watched by the desk only), so it shows more opens than the tested rule` : ''}`
    : 'no TradingView marker: the open condition reads only what the desk watches (funding, open interest or the fear gauges)'
  const lines = [
    `Workshop: ${r.name}, built and tested (${r.coin} ${r.interval}, ${r.side}).`,
    `Built: ${built}. ${r.aid}`.trim(),
    `Past cases: the open condition turned true ${r.cases} time${r.cases === 1 ? '' : 's'} in the history read${r.pinned > 0 ? `, the ${r.pinned} in view pinned on the chart (layer "cases")` : ''}. On the bench from ${day(r.since)} UTC: ${check} scores it from there.`,
    `Tested: ${r.versions} versions of your idea (only its own numbers and hold moved), ${day(r.from).slice(0, 10)} to ${day(r.to).slice(0, 10)} on ${r.venue}, fee ${fee(r.fee)} a side and funding.${r.few > 0 ? ` ${r.few} had too few trades to judge.` : ''}`,
    verdictLine(r),
    ...r.luck,
    ...(r.mood ? [r.mood] : []),
    `Tries on ${r.coin}, all intervals: ${r.tries.total} (kept for good${r.tries.resets > 0 ? `; ${r.tries.resets} desk reset${r.tries.resets === 1 ? '' : 's'} seen` : ''}). ${r.version}${r.judging ? ` · ${r.judging}` : ''}.`,
    `Files: ${r.folder}/ (idea.md, card.md, card.svg, result.json${r.marker ? ', marker.pine' : ''}).`,
    nextLine(r, check),
  ]
  return lines.join('\n')
}

/** The idea file, written before anything runs: what will be tested and how it will be judged. */
export function ideaFile(o: { name: string; idea: string; source: string; rule: string; coin: string; interval: string; side: string; venue: string; versions: readonly string[]; left: readonly string[]; others: readonly string[]; at: number }): string {
  return [
    `# ${o.name}`,
    '',
    `Written ${day(o.at)} UTC, before the run. Nothing here changes once it runs.`,
    '',
    `- Idea (the person's words): ${o.idea || '(not given)'}`,
    ...(o.source ? [`- Source: ${o.source}`] : []),
    `- Rule (Lab words): ${o.rule}`,
    `- Where: ${o.coin} ${o.interval}, ${o.side}, on ${o.venue}`,
    `- Left out (no Lab words for it): ${o.left.length ? o.left.join('; ') : 'nothing'}`,
    '',
    `## Versions tested with it (${o.versions.length}, only its own numbers and hold moved)`,
    '',
    ...o.versions.map(v => `- ${v}`),
    '',
    '## How it is judged (in code)',
    '',
    `- Every version counts as a try on ${o.coin}; the luck check judges them together with every earlier try there.`,
    `- The last 30% of history (the unseen part) opens only for versions that beat luck on the first 70%.`,
    `- Passed the history checks: the strongest holds on the unseen part (${MIN_UNSEEN}+ trades) and on ${OTHER_PASS} of ${o.others.join(', ')} at ${FEE_TIMES}x the fee.`,
    `- Past cases are found only after the verdict.`,
    '',
  ].join('\n')
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`)

/** Lines cut to a width at spaces. */
function wrap(text: string, width: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const w of para.split(' ')) {
      if (line !== '' && line.length + 1 + w.length > width) {
        out.push(line)
        line = w
      } else line = line === '' ? w : `${line} ${w}`
    }
    out.push(line)
  }
  return out
}

/** The card as a picture to post (1200 x 675): the title, the verdict large, what was tested and built; the rest stays in card.md. */
export function cardSvg(r: Run, card: string): string {
  const rest = card.split('\n').slice(1)
  const passed = r.verdict.kind === 'passed'
  const head = wrap(verdictLine(r), 94).slice(0, 4)
  const top = 184 + head.length * 32 + 18
  const body = wrap(rest.filter(l => /^(Tested|Built):/.test(l)).join('\n'), 124).slice(0, Math.floor((590 - top) / 26) + 1)
  const text = [
    ...head.map((l, i) => `<text x="56" y="${184 + i * 32}" font-size="23" font-weight="600" fill="${passed ? '#26a69a' : '#e0e3eb'}">${esc(l)}</text>`),
    ...body.map((l, i) => `<text x="56" y="${top + i * 26}" font-size="17" fill="#9598a1">${esc(l)}</text>`),
  ].join('\n')
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" font-family="Segoe UI, Helvetica, Arial, sans-serif">',
    '<rect width="1200" height="675" fill="#131722"/>',
    `<rect x="0" y="0" width="8" height="675" fill="${passed ? '#26a69a' : '#ff9800'}"/>`,
    `<text x="56" y="84" font-size="30" font-weight="700" fill="#e0e3eb">${esc(r.name)}</text>`,
    `<text x="56" y="122" font-size="18" fill="#9598a1">${esc(cut(`${r.coin} ${r.interval} ${r.side} · ${r.rule}`, 112))}</text>`,
    text,
    `<text x="56" y="640" font-size="14" fill="#787b86">${esc(`My own run · ${r.version}${r.judging ? ` · ${r.judging}` : ''} · tries on ${r.coin} kept for good: ${r.tries.total} · re-check: /lab-workshop check`)}</text>`,
    '</svg>',
    '',
  ].join('\n')
}

/** A bench rule's forward score: trades opened after its date, no numbers under MIN_UNSEEN. */
export function forwardLine(row: BenchRow, rets: readonly number[], held: number): string {
  const n = rets.length
  const head = `· ${row.name} (${row.words} on ${row.coin} ${row.interval}, from ${day(row.since)} UTC)`
  if (n < MIN_UNSEEN) return `${head}: ${n} forward trade${n === 1 ? '' : 's'} so far; numbers at ${MIN_UNSEEN}.`
  let eq = 1
  for (const x of rets) eq *= 1 + x
  const avg = rets.reduce((a, b) => a + b, 0) / n
  const won = rets.filter(x => x > 0).length / n
  return `${head}: ${n} forward trades, ${Math.round(won * 100)}% won, average ${pct(avg)} a trade, all together ${pct(eq - 1, 1)} (just holding: ${pct(held, 1)}).`
}
