// The honest test: enter when A, exit when B (or after N candles), long or short, with fees and funding.
// Every result is split into the part the person could tune on ("seen", the first 70%) and the part held back
// ("unseen", the last 30%), checks nearby settings on the seen part only, counts the tries on each coin, and ends
// with one plain line on how likely luck alone is. Pure: no `$`.

import type { Candle } from '../types'
import { MIN_CASES, conditionSeries, conditionWarmup, parseCondition, pct, day } from './history'
import { evalFormula, parseFormula } from './formula'
import type { Node } from './formula'
import type { Condition } from './history'
import { LOW_POWER, MIN_SCORED, SPA_DRAWS, barReturns, blockLength, spaTest } from './spa'

/** Hyperliquid's base taker fee per side (0.045%); the person can give their own. */
export const FEE_DEFAULT = 0.00045
export const SEEN_SHARE = 0.7
export const HOLD_DEFAULT = 10
/** Fewer unseen trades than this and the luck line says so instead of a number. */
export const MIN_UNSEEN = MIN_SCORED
export const MAX_TRIES_KEPT = 300

export type Funding = { t: number; rate: number }

export type TestSpec = {
  enter: Condition
  exit: Condition | null
  /** Exit after this many candles at most (null: only on the exit condition). */
  hold: number | null
  side: 'long' | 'short'
  /** Fee per side as a fraction (0.00045 is 0.045%). */
  fee: number
}

/** `open`: still running at the last candle, valued at its close (dropping it would hide the trades that never came back). */
export type Trade = { i: number; j: number; t: number; t2: number; ret: number; gross: number; funding: number; open?: boolean }

export type PartResult = {
  trades: Trade[]
  n: number
  winShare: number
  avg: number
  total: number
  maxDrawdown: number
  /** Holding the coin (long) or being short it the whole part, for scale. */
  hold: number
  tStat: number
}

/** "enter when rsi < 30, exit when rsi > 50, short, hold 24, fee 0.02%": the spec from words, or an error. */
export function parseTest(o: { enter?: unknown; exit?: unknown; hold?: unknown; side?: unknown; fee?: unknown }): TestSpec | { error: string } {
  if (typeof o.enter !== 'string' || o.enter.trim() === '') return { error: 'Say when to enter, e.g. enter "rsi < 30", and when to exit, e.g. exit "rsi > 50" or hold 10.' }
  const enter = parseCondition(o.enter)
  if ('error' in enter) return { error: `Enter: ${enter.error}` }
  let exit: Condition | null = null
  if (typeof o.exit === 'string' && o.exit.trim() !== '') {
    const x = parseCondition(o.exit)
    if ('error' in x) return { error: `Exit: ${x.error}` }
    exit = x
  }
  const h = Number(o.hold)
  const hold = Number.isFinite(h) && h >= 1 ? Math.min(1000, Math.round(h)) : exit ? null : HOLD_DEFAULT
  const side = typeof o.side === 'string' && /^short$/i.test(o.side.trim()) ? 'short' : 'long'
  // The fee comes in %, as a word ("0.02%") or a number (0.045 = 0.045%).
  const f = (typeof o.fee === 'string' ? Number(o.fee.replace('%', '')) : Number(o.fee)) / 100
  const fee = o.fee !== undefined && Number.isFinite(f) && f >= 0 && f < 0.01 ? f : FEE_DEFAULT
  return { enter, exit, hold, side, fee }
}

/** One spec as text, the same for the same test: what the try counter counts. */
export function specKey(s: TestSpec): string {
  return [`enter ${s.enter.text}`, s.exit ? `exit ${s.exit.text}` : '', s.hold !== null ? `hold ${s.hold}` : '', s.side].filter(x => x !== '').join(' · ')
}

/** Funding paid by a long over (from, to]: the sum of hourly rates settled in between (a short gets it). */
export function fundingBetween(funding: readonly Funding[], from: number, to: number): number {
  let lo = 0
  let hi = funding.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((funding[mid] as Funding).t <= from) lo = mid + 1
    else hi = mid
  }
  let sum = 0
  for (let k = lo; k < funding.length && (funding[k] as Funding).t <= to; k++) sum += (funding[k] as Funding).rate
  return sum
}

/**
 * The candles with funding attached for conditions that read it: the average hourly rate over each candle's hours
 * (after its open, up to its close) as %/yr, so a candle only knows the funding of its own past. null where no rate
 * was read (before the first row, or a gap).
 */
export function withFunding(candles: readonly Candle[], funding: readonly Funding[]): Candle[] {
  const step = candles.length > 1 ? (candles[1] as Candle).t - (candles[0] as Candle).t : 3_600_000
  let k = 0
  return candles.map(c => {
    while (k < funding.length && (funding[k] as Funding).t <= c.t) k++
    let sum = 0
    let n = 0
    for (let q = k; q < funding.length && (funding[q] as Funding).t <= c.t + step; q++) {
      sum += (funding[q] as Funding).rate
      n++
    }
    return { ...c, f: n > 0 ? (sum / n) * 24 * 365 * 100 : null }
  })
}

/** For a condition that reads funding: from when it was read, and a word if Hyperliquid stopped answering early. */
export function fundingNote(candles: readonly Candle[], isComplete: boolean, venue = 'Hyperliquid'): string {
  const first = candles.find(c => c.f !== null && c.f !== undefined)
  if (!first) return 'No funding could be read for these candles, so a condition on funding never holds. Ask again in a minute.'
  const from = first === candles[0] ? '' : `Funding (%/yr) is read from ${day(first.t)} UTC; candles before it don't count. `
  const short = isComplete ? '' : `${venue} stopped answering before all funding was read, so the latest candles without it don't count. `
  return (from + short).trim()
}

/**
 * Runs the test over closed candles: in at the close of a candle where A holds, out at the close of a later candle
 * where B holds or `hold` candles on, one trade at a time. Each trade pays the fee twice; funding is paid (long, rate
 * above 0) or got per hour held, from `funding` where it reaches. Only entries in [start, end) are taken.
 */
export function runTest(spec: TestSpec, candles: readonly Candle[], funding: readonly Funding[], start = 0, end = candles.length): Trade[] {
  const a = conditionSeries(spec.enter, candles)
  const b = spec.exit ? conditionSeries(spec.exit, candles) : null
  const step = candles.length > 1 ? (candles[1] as Candle).t - (candles[0] as Candle).t : 3_600_000
  const sign = spec.side === 'long' ? 1 : -1
  const trades: Trade[] = []
  let i = Math.max(1, start)
  while (i < end && i < candles.length - 1) {
    if (a[i] !== true) {
      i++
      continue
    }
    let j = -1
    for (let q = i + 1; q < candles.length; q++) {
      if ((b && b[q] === true) || (spec.hold !== null && q - i >= spec.hold)) {
        j = q
        break
      }
    }
    // A trade still open at the last candle is valued at its close. Leaving it out would drop exactly the trades
    // that went against the rule and never came back, and make any rule look better than it is.
    const open = j < 0
    if (open) j = candles.length - 1
    const k = candles[i] as Candle
    const x = candles[j] as Candle
    const gross = sign * (x.c / k.c - 1)
    const fund = -sign * fundingBetween(funding, k.t + step, x.t + step)
    trades.push({ i, j, t: k.t, t2: x.t, gross, funding: fund, ret: gross + fund - 2 * spec.fee, ...(open ? { open: true } : {}) })
    i = j + 1
  }
  return trades
}

export function partResult(trades: readonly Trade[], candles: readonly Candle[], from: number, to: number, side: 'long' | 'short'): PartResult {
  const rets = trades.map(t => t.ret)
  const n = rets.length
  const avg = n ? rets.reduce((p, q) => p + q, 0) / n : 0
  const sd = n > 1 ? Math.sqrt(rets.reduce((p, q) => p + (q - avg) ** 2, 0) / (n - 1)) : 0
  let eq = 1
  let peak = 1
  let dd = 0
  for (const r of rets) {
    eq *= 1 + r
    peak = Math.max(peak, eq)
    dd = Math.min(dd, eq / peak - 1)
  }
  const a = candles[from]
  const b = candles[Math.min(to, candles.length) - 1]
  const hold = a && b ? (side === 'long' ? 1 : -1) * (b.c / a.c - 1) : 0
  return { trades: [...trades], n, winShare: n ? rets.filter(r => r > 0).length / n : 0, avg, total: eq - 1, maxDrawdown: dd, hold, tStat: sd > 0 ? avg / (sd / Math.sqrt(n)) : 0 }
}

/** The standard normal's upper tail: the chance noise alone gives a t this high (one side). */
export function upperTail(z: number): number {
  // Abramowitz-Stegun 7.1.26 through erfc; good to about 1e-7.
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const erfc = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x)
  return z >= 0 ? erfc / 2 : 1 - erfc / 2
}

/** The chance that the best of `tries` tries looks at least this good when each one alone does so with chance `p`. */
export function luckChance(p: number, tries: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), Math.max(1, tries))
}

/** How many shuffled runs the luck check makes. */
export const SHUFFLES = 199

/** A small seeded random source, so the same test on the same candles always gives the same answer. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seedOf(text: string): number {
  let h = 2166136261
  for (let k = 0; k < text.length; k++) h = Math.imul(h ^ text.charCodeAt(k), 16777619)
  return h >>> 0
}

/**
 * The same candles from `from` on in a random order: each candle kept as its moves from the close before (open,
 * high, low, close) and its volume, the order shuffled, prices rebuilt. Times and everything before `from` stay.
 * Any pattern in the order is gone; the size of the moves and the overall drift are the same.
 */
export function shuffledCandles(candles: readonly Candle[], from: number, rand: () => number): Candle[] {
  const out = candles.slice(0, from)
  const start = Math.max(1, from)
  const moves: { o: number; h: number; l: number; c: number; v: number }[] = []
  for (let i = start; i < candles.length; i++) {
    const prev = (candles[i - 1] as Candle).c
    const k = candles[i] as Candle
    moves.push({ o: k.o / prev, h: k.h / prev, l: k.l / prev, c: k.c / prev, v: k.v })
  }
  for (let k = moves.length - 1; k > 0; k--) {
    const r = Math.floor(rand() * (k + 1))
    const x = moves[k] as (typeof moves)[number]
    moves[k] = moves[r] as (typeof moves)[number]
    moves[r] = x
  }
  if (from < 1 && candles[0]) out.push(candles[0])
  let prev = (out.at(-1) as Candle | undefined)?.c ?? 1
  // Funding stays with its time, like the funding paid: only the order of the price moves is shuffled.
  moves.forEach((m, q) => {
    const src = candles[start + q] as Candle
    const t = src.t
    out.push({ t, o: prev * m.o, h: prev * m.h, l: prev * m.l, c: prev * m.c, v: m.v, ...(src.f !== undefined ? { f: src.f } : {}) })
    prev = prev * m.c
  })
  return out
}

export type Shuffle = { beat: number; runs: number; p: number }

/**
 * The luck check: the same rule, with the same fees and funding, on the unseen candles shuffled into a random order,
 * `runs` times. `p` is the share of runs (counting the real one) that did at least as well on average a trade.
 * If the rule only rode noise, the real order is just one more shuffle, so `p` is fair whatever the trades look like.
 */
export function shuffleCheck(spec: TestSpec, candles: readonly Candle[], funding: readonly Funding[], cut: number, avg: number, runs = SHUFFLES, seed = 1): Shuffle {
  const rand = seededRandom(seed)
  let beat = 0
  for (let r = 0; r < runs; r++) {
    const fake = shuffledCandles(candles, cut, rand)
    const trades = runTest(spec, fake, funding, cut)
    const a = trades.length ? trades.reduce((p, t) => p + t.ret, 0) / trades.length : -Infinity
    if (a >= avg) beat++
  }
  return { beat, runs, p: (beat + 1) / (runs + 1) }
}

/** Numbers in a condition that a person might have tuned, with where they sit in the text. */
function tunables(text: string): { at: number; len: number; value: number }[] {
  const out: { at: number; len: number; value: number }[] = []
  for (const m of text.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g)) {
    const v = Number(m[1])
    const before = text.slice(0, m.index).trimEnd()
    if (/\bon$/i.test(before)) continue
    if (v === 0) continue
    out.push({ at: m.index ?? 0, len: (m[1] ?? '').length, value: v })
  }
  return out
}

export type Nearby = { tried: number; positive: number; worst: number; best: number }

/**
 * Nearby settings, on the seen part only: each number in A, B and the hold moved by -20%, -10%, +10%, +20%, one at
 * a time. A setting whose neighbours mostly lose was likely tuned to noise.
 */
export function nearby(raw: { enter: string; exit?: string; hold: number | null; side: 'long' | 'short'; fee: number }, candles: readonly Candle[], funding: readonly Funding[], cut: number): Nearby {
  const variants: { enter: string; exit?: string; hold: number | null }[] = []
  const steps = [0.8, 0.9, 1.1, 1.2]
  const move = (v: number, s: number) => (Number.isInteger(v) ? Math.max(1, Math.round(v * s)) : Number((v * s).toPrecision(4)))
  for (const which of ['enter', 'exit'] as const) {
    const text = which === 'enter' ? raw.enter : raw.exit
    if (!text) continue
    for (const n of tunables(text)) {
      for (const s of steps) {
        const v = move(n.value, s)
        if (v === n.value) continue
        const changed = text.slice(0, n.at) + String(v) + text.slice(n.at + n.len)
        variants.push({ enter: which === 'enter' ? changed : raw.enter, ...(raw.exit !== undefined ? { exit: which === 'exit' ? changed : raw.exit } : {}), hold: raw.hold })
      }
    }
  }
  if (raw.hold !== null) for (const s of steps) {
    const v = move(raw.hold, s)
    if (v !== raw.hold) variants.push({ enter: raw.enter, ...(raw.exit !== undefined ? { exit: raw.exit } : {}), hold: v })
  }
  let positive = 0
  let tried = 0
  let worst = Infinity
  let best = -Infinity
  const seen = candles.slice(0, cut)
  for (const v of variants.slice(0, 40)) {
    const spec = parseTest({ enter: v.enter, exit: v.exit, hold: v.hold ?? undefined, side: raw.side, fee: raw.fee * 100 })
    if ('error' in spec) continue
    const r = partResult(runTest(spec, seen, funding), candles, 0, cut, raw.side)
    if (r.n === 0) continue
    tried++
    if (r.total > 0) positive++
    worst = Math.min(worst, r.total)
    best = Math.max(best, r.total)
  }
  return { tried, positive, worst, best }
}

export type TestResult = {
  spec: TestSpec
  seen: PartResult
  unseen: PartResult
  cut: number
  near: Nearby
  /** The luck check on the unseen part across every try there (null when it had too few trades, or lost). */
  luck: Luck | null
  tries: number
  fundingFrom: number | null
  from: number
  to: number
  /** The first unseen candle's time. */
  cutT: number
  /** Earlier tries that count but could not be run again in the luck check. */
  older?: number
  /** The venue stopped answering before the funding was all read: the latest hours count none. */
  isFundingShort?: boolean
  /** An extra series the rule reads (open interest, DVOL, VIX) could not be read just now. */
  isExtraMissing?: boolean
  /** Where the candles and funding came from: Hyperliquid, or Binance for deep history. */
  venue: string
  /** Every trade, seen and unseen, by the market's mood when it opened. */
  moods: MoodRow[]
}

/** Where the unseen part starts on these candles: the last 30%, the same for every rule, test and swarm. */
export function sealIndex(length: number): number {
  return Math.min(length - 1, Math.max(1, Math.floor(length * SEEN_SHARE)))
}

/** Where the unseen part starts for a test: the shared seal, never moved by the rule's warm-up. */
export function cutIndex(_spec: TestSpec, length: number): number {
  return sealIndex(length)
}

/** The whole honest test: seen and unseen parts, the nearby check on the seen part, the try count given. */
const share = (x: number) => `${Math.round(x * 100)}%`

/** One market mood and the trades that opened in it. */
export type MoodRow = { name: string; what: string; n: number; avg: number; win: number; sd: number }

const formulaOf = (text: string): Node => parseFormula(text) as Node

/**
 * The trades by the market's mood on the candle each opened at, read from that candle and the ones before only:
 * rising or falling (the close over or under its 200 EMA), calm or wild (the ATR, as a share of price, under or over
 * its own 200-candle average). A trade before either has settled is in no mood.
 */
export function moodSplit(trades: readonly Trade[], candles: readonly Candle[]): MoodRow[] {
  const ema = evalFormula(formulaOf('ta.ema(close, 200)'), candles)
  const vol = evalFormula(formulaOf('ta.atr(14) / close'), candles)
  const usual = evalFormula(formulaOf('ta.sma(ta.atr(14) / close, 200)'), candles)
  const close = (i: number) => (candles[i] as Candle).c
  const both = (a: number | null | undefined, b: number | null | undefined, f: (x: number, y: number) => boolean) => (a === null || a === undefined || b === null || b === undefined ? false : f(a, b))
  const moods: { name: string; what: string; is: (i: number) => boolean }[] = [
    { name: 'rising', what: 'close over its 200 EMA', is: i => both(close(i), ema[i], (x, y) => x > y) },
    { name: 'falling', what: 'close under it', is: i => both(close(i), ema[i], (x, y) => x <= y) },
    { name: 'calm', what: 'ATR under its 200-candle average', is: i => both(vol[i], usual[i], (x, y) => x <= y) },
    { name: 'wild', what: 'ATR over it', is: i => both(vol[i], usual[i], (x, y) => x > y) },
  ]
  return moods.map(m => {
    const rets = trades.filter(t => m.is(t.i)).map(t => t.ret)
    const n = rets.length
    const avg = n ? rets.reduce((a, b) => a + b, 0) / n : 0
    const sd = n > 1 ? Math.sqrt(rets.reduce((a, r) => a + (r - avg) ** 2, 0) / (n - 1)) : 0
    return { name: m.name, what: m.what, n, avg, win: n ? rets.filter(r => r > 0).length / n : 0, sd }
  })
}

/**
 * The mood of a pair the rule made money in, when the other side lost and the gap between them is over twice its
 * standard error (what noise alone rarely gives); null otherwise, so a small wobble around zero is never a verdict.
 */
export function moodCarries(a: MoodRow, b: MoodRow): MoodRow | null {
  if (a.n < MIN_CASES || b.n < MIN_CASES) return null
  const [good, bad] = a.avg >= b.avg ? [a, b] : [b, a]
  if (!(good.avg > 0 && bad.avg < 0)) return null
  const se = Math.sqrt(good.sd ** 2 / good.n + bad.sd ** 2 / bad.n)
  return good.avg - bad.avg > 2 * se ? good : null
}

/** The moods in a line (no numbers under MIN_CASES trades), and a plain word when one mood clearly carries the result. */
export function moodLine(moods: readonly MoodRow[], all: number): string | null {
  if (all < MIN_CASES || moods.every(m => m.n === 0)) return null
  const row = (m: MoodRow) => `${m.name} (${m.what}) ${m.n} trade${m.n === 1 ? '' : 's'}${m.n < MIN_CASES ? ': under 10, no numbers' : `, average ${pct(m.avg)}, ${share(m.win)} won`}`
  const parts = [`Market mood (${all} trades, seen and unseen, by the mood when each opened; one before the 200-candle averages settle has none): ${moods.map(row).join(' · ')}.`]
  const carry = [moods[0] && moods[1] ? moodCarries(moods[0], moods[1]) : null, moods[2] && moods[3] ? moodCarries(moods[2], moods[3]) : null].filter((m): m is MoodRow => m !== null)
  if (carry.length > 0) parts.push(`It made money only while the market was ${carry.map(m => m.name).join(', and only while it was ')}, by more than noise usually gives: it may just ride ${carry.length > 1 ? 'those moods' : 'that mood'}.`)
  return parts.join(' ')
}

/** The luck check's answer for one rule, judged together with every other try on the same unseen candles. */
export type Luck = {
  /** This rule's chance of looking this good by luck, out of all the tries (adjusted for them). */
  p: number
  /** It beats luck stepwise at SPA_ALPHA. */
  survives: boolean
  /** Tries in the check (this one included) that traded on these candles. */
  family: number
  draws: number
  block: number
  /** Under LOW_POWER trades: a real effect can still be missed. */
  isLowPower: boolean
}

export type HonestOptions = {
  /** Bootstrap draws (SPA_DRAWS unless given). */
  draws?: number
  /** Every other try on this coin and interval that has looked at the unseen part, run again here on the same candles. */
  others?: readonly TestSpec[]
  venue?: string
}

/**
 * The luck check on candles [cut, end) for `spec` and the `others`: each as per-candle returns with the market's
 * own drift taken off, then Hansen's SPA across them all. Index 0 is `spec`.
 */
export function luckAcross(spec: TestSpec, others: readonly TestSpec[], candles: readonly Candle[], funding: readonly Funding[], cut: number, draws: number, first?: readonly Trade[]): Luck {
  const all = [spec, ...others]
  const holds: number[] = []
  const rows = all.map((s, k) => {
    const trades = k === 0 && first ? first : runTest(s, candles, funding, cut)
    if (k === 0) for (const t of trades) holds.push(t.j - t.i)
    return barReturns(trades, candles, cut, candles.length, s.side, s.fee, true)
  })
  const step = candles.length > 1 ? (candles[1] as Candle).t - (candles[0] as Candle).t : 3_600_000
  const block = blockLength(step, holds, candles.length - cut)
  const r = spaTest(rows, { draws, block, seed: seedOf(`${specKey(spec)}|${candles.length}|${candles.at(-1)?.t ?? 0}`) })
  return { p: r.adjusted[0] ?? 1, survives: r.survivors.includes(0), family: Math.max(1, r.used), draws: r.draws, block: r.block, isLowPower: holds.length < LOW_POWER }
}

export function honestTest(spec: TestSpec, raw: { enter: string; exit?: string }, candles: readonly Candle[], funding: readonly Funding[], tries: number, opts: number | HonestOptions = {}): TestResult {
  const o: HonestOptions = typeof opts === 'number' ? { draws: opts } : opts
  const warm = Math.max(conditionWarmup(spec.enter), spec.exit ? conditionWarmup(spec.exit) : 0)
  const cut = cutIndex(spec, candles.length)
  // The seen part never looks past the cut: its trades run on candles before it only.
  const seenTrades = runTest(spec, candles.slice(0, cut), funding, warm)
  const unseenTrades = runTest(spec, candles, funding, cut)
  const unseen = partResult(unseenTrades, candles, cut, candles.length, spec.side)
  const others = (o.others ?? []).filter(x => specKey(x) !== specKey(spec))
  const luck = unseen.n >= MIN_SCORED && unseen.avg > 0 ? luckAcross(spec, others, candles, funding, cut, o.draws ?? SPA_DRAWS, unseenTrades) : null
  return {
    spec,
    seen: partResult(seenTrades, candles, warm, cut, spec.side),
    unseen,
    luck,
    cut,
    near: nearby({ enter: raw.enter, ...(raw.exit ? { exit: raw.exit } : {}), hold: spec.hold, side: spec.side, fee: spec.fee }, candles, funding, cut),
    tries,
    fundingFrom: funding[0]?.t ?? null,
    from: (candles[warm] as Candle | undefined)?.t ?? 0,
    to: candles.at(-1)?.t ?? 0,
    cutT: (candles[cut] as Candle | undefined)?.t ?? 0,
    moods: moodSplit([...seenTrades, ...unseenTrades], candles),
    venue: o.venue ?? 'Hyperliquid',
  }
}

/** A test as words the desk reads back (the try ledger keeps these to run every try again): the fee always given. */
export function specWords(s: TestSpec): string {
  return `${s.enter.said}${s.exit ? ` exit ${s.exit.said}` : ''}${s.hold !== null ? ` hold ${s.hold}` : ''}${s.side === 'short' ? ' short' : ''} fee ${Number((s.fee * 100).toFixed(4))}`
}

export const chanceText = (c: number) => (c < 0.001 ? 'under 0.1%' : c < 0.01 ? `about ${(c * 100).toFixed(1)}%` : `about ${Math.round(c * 100)}%`)


function partLine(name: string, r: PartResult, side: 'long' | 'short'): string {
  if (r.n === 0) return `${name}: no trades.`
  const open = r.trades.some(t => t.open) ? ' (the last still open, valued at the latest close)' : ''
  if (r.n < MIN_CASES) return `${name}: ${r.n} trade${r.n === 1 ? '' : 's'}${open}: under ${MIN_CASES}, no numbers (${side === 'long' ? 'just holding' : 'just staying short'}: ${pct(r.hold, 1)}).`
  return `${name}: ${r.n} trade${r.n === 1 ? '' : 's'}${open}, ${share(r.winShare)} won, average ${pct(r.avg)} a trade, all together ${pct(r.total, 1)}, deepest drop ${pct(r.maxDrawdown, 1)} (${side === 'long' ? 'just holding' : 'just staying short'}: ${pct(r.hold, 1)}).`
}

/** The plain luck line, from the unseen part only. */
export function luckLine(r: TestResult, where: string): string {
  const u = r.unseen
  const tries = `${r.tries} ${r.tries === 1 ? 'try' : 'tries'} on ${where} so far`
  if (u.n < MIN_SCORED) return `Luck check: ${u.n} unseen trade${u.n === 1 ? '' : 's'}, too few to judge (${MIN_SCORED} needed; ${tries}).${r.isExtraMissing ? '' : r.venue === 'Binance' ? ' A looser entry or a shorter interval gives more.' : ' A looser entry, a shorter interval or "deep" for years of candles gives more.'}`
  if (u.total <= 0 || u.avg <= 0) return `Luck check: on the unseen part it lost (${pct(u.total, 1)}), so whatever the seen part showed did not carry over (${tries}).`
  const l = r.luck
  if (!l) return `Luck check: not run (${tries}).`
  const family = l.family > 1 ? `judged with all ${l.family} tries on ${where} that saw the unseen part` : r.older ? 'judged on its own (earlier tries could not be run again)' : `judged on its own, the first try on ${where} to see the unseen part`
  const how = `Luck check (${family}, the market's own drift taken off, ${l.draws} reshuffles in blocks of ${l.block} candles)`
  return l.survives
    ? `${how}: luck alone gives this ${chanceText(l.p)} of the time, so it beats luck${l.isLowPower ? ` (under ${LOW_POWER} trades, so a weak check)` : ''}. Still only history, so the next step is a new coin or a later stretch.`
    : `${how}: luck alone gives this ${chanceText(l.p)} of the time, so it does not stand out from luck.${l.isLowPower ? ` With under ${LOW_POWER} trades a real effect can still be missed.` : ''}`
}

export function testText(r: TestResult, coin: string, interval: string, onChart: number): string {
  const s = r.spec
  const exitText = [s.exit ? `exit when ${s.exit.said}` : '', s.hold !== null ? `${s.exit ? 'or ' : 'exit '}after ${s.hold} candle${s.hold === 1 ? '' : 's'}` : ''].filter(x => x).join(' ')
  const lines = [
    `Test: ${coin} ${interval} on ${r.venue}, ${s.side}, enter when ${s.enter.said}, ${exitText}. Fee ${(s.fee * 100).toFixed(3)}% a side${r.fundingFrom === null ? (r.isFundingShort ? `, funding not read (${r.venue} was busy; ask again in a minute)` : ', funding not counted (no history)') : `, funding from ${day(r.fundingFrom).slice(0, 10)} on${r.isFundingShort ? ` (${r.venue} was busy, so the latest hours count none; ask again in a minute for all of it)` : ''}`}. ${day(r.from)} to ${day(r.to)} UTC; unseen part from ${day(r.cutT)} on.`,
    partLine('Unseen (last 30%, the part that counts)', r.unseen, s.side),
    partLine('Seen (first 70%)', r.seen, s.side),
  ]
  if (r.unseen.n > 0) {
    const fees = r.unseen.trades.length * 2 * s.fee
    const fund = r.unseen.trades.reduce((p, t) => p + t.funding, 0)
    lines.push(`Unseen costs: fees ${pct(-fees, 2)}, funding ${pct(fund, 2)} (summed over trades).`)
  }
  if (r.near.tried > 0)
    lines.push(`Nearby settings (seen part, each number moved 10-20%): ${r.near.positive} of ${r.near.tried} made money, from ${pct(r.near.worst, 1)} to ${pct(r.near.best, 1)}${r.near.positive / r.near.tried < 0.5 ? ': most neighbours lose, so this setting looks tuned to noise' : ': it holds up around this setting'}.`)
  const mood = moodLine(r.moods, r.seen.n + r.unseen.n)
  if (mood) lines.push(mood)
  lines.push(luckLine(r, `${coin} ${interval}`))
  if (onChart > 0) lines.push(`${onChart} unseen trade${onChart === 1 ? '' : 's'} pinned on the chart (layer "test").`)
  return lines.join('\n')
}

/** The chance at least k of m independent checks pass a bar of p by luck alone. */
export function binomTail(k: number, m: number, p: number): number {
  if (k <= 0) return 1
  let total = 0
  let c = 1
  for (let i = 0; i <= m; i++) {
    if (i > 0) c = (c * (m - i + 1)) / i
    if (i >= k) total += c * p ** i * (1 - p) ** (m - i)
  }
  return Math.min(1, total)
}

/** One coin of a test across coins: its result, or why there is none. */
export type CoinRow = { coin: string; r: TestResult | null; note?: string }

/** The bar each coin's luck check has to pass. */
export const LUCK_BAR = 0.05

/** The same test on several coins: each coin's unseen part in a line, then how many held and how likely luck gives that. */
export function acrossText(rows: readonly CoinRow[], interval: string): string {
  const ok = rows.filter((x): x is CoinRow & { r: TestResult } => x.r !== null)
  const first = ok[0]?.r.spec
  const lines: string[] = []
  if (first) {
    const exitText = [first.exit ? `exit when ${first.exit.said}` : '', first.hold !== null ? `${first.exit ? 'or ' : 'exit '}after ${first.hold} candle${first.hold === 1 ? '' : 's'}` : ''].filter(x => x).join(' ')
    lines.push(`Test across ${rows.length} coins on ${interval}: ${first.side}, enter when ${first.enter.said}, ${exitText}. Fee ${(first.fee * 100).toFixed(3)}% a side and each coin's real funding. Only each coin's unseen last 30% is shown; every coin counts as a try on that coin.`)
  }
  let passed = 0
  let made = 0
  for (const row of rows) {
    if (!row.r) {
      lines.push(`· ${row.coin}: ${row.note ?? 'no result'}.`)
      continue
    }
    const u = row.r.unseen
    const tries = `${row.r.tries} ${row.r.tries === 1 ? 'try' : 'tries'}`
    if (u.n === 0) {
      lines.push(`· ${row.coin}: no unseen trades (${tries}).`)
      continue
    }
    if (u.total > 0) made++
    const head = `· ${row.coin}: ${u.n} trade${u.n === 1 ? '' : 's'}, ${share(u.winShare)} won, average ${pct(u.avg)} a trade, all together ${pct(u.total, 1)}`
    const l = row.r.luck
    if (u.n < MIN_CASES) lines.push(`· ${row.coin}: ${u.n} trade${u.n === 1 ? '' : 's'}: under ${MIN_CASES}, no numbers (${tries}).`)
    else if (u.n < MIN_UNSEEN) lines.push(`${head}; too few trades to judge (${MIN_UNSEEN} needed, ${tries}).`)
    else if (u.total <= 0 || u.avg <= 0 || !l) lines.push(`${head}; lost, so no luck check (${tries}).`)
    else {
      if (l.survives) passed++
      lines.push(`${head}; luck alone gives this ${chanceText(l.p)} of the time, judged with ${l.family} ${l.family === 1 ? 'try' : 'tries'} there${l.survives ? ': beats luck' : ''} (${tries}).`)
    }
  }
  const m = ok.length
  if (m > 0) {
    lines.push(`Made money on the unseen part on ${made} of ${m} coin${m === 1 ? '' : 's'}.`)
    if (passed === 0) lines.push(`Luck check: no coin passed it on its own, so nothing here stands out from luck.`)
    else {
      const tail = binomTail(passed, m, LUCK_BAR)
      const chance = tail < 0.01 ? 'under 1%' : `about ${Math.round(tail * 100)}%`
      lines.push(
        `Luck check: ${passed} of ${m} coin${m === 1 ? '' : 's'} passed it (luck alone under ${Math.round(LUCK_BAR * 100)}% on that coin). With ${m} coins tried, luck alone gives ${passed === 1 ? 'at least one' : `${passed} or more`} like that ${chance} of the time${tail < LUCK_BAR ? ': it holds across coins, still only history' : ', so across coins it could well be luck'}.`,
      )
    }
  }
  return lines.join('\n')
}
