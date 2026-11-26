// Trade review: where the person's own finished trips did worse than their own usual (by hour, weekday, coin, side,
// after a loss or a win, size, how long held), each gap checked against chance with the number of splits looked at
// allowed for. And the "second look": an idea set against the person's own rules file, the market now and the leaks
// that apply right now, handed to their AI for the 3 strongest reasons against. Pure: no `$`.

import type { Trip } from './fills'
import { shortWallet } from './fills'
import { seededRandom } from './honest'

/** Trips a split and the rest each need before a gap is shown. */
export const REVIEW_MIN = 10
export const REVIEW_DRAWS = 2000
/** Leaks shown (every one that stands out, and others up to this many); the rest are counted. */
export const LEAKS_SHOWN = 3
/** The shuffle stops once this many draws are as far off: the chance is then plainly not small (Besag-Clifford). */
const FAR_ENOUGH = 50
/** A rules file longer than this is cut (the AI reads it all in one go). */
export const RULES_MAX = 8000
export const RULES_FILE = 'my-trading-rules.md'

const HOUR = 3_600_000

/** What is known about a trip when it opens (and, for the last splits, once it is done). */
export type TripCtx = { trip: Trip; prev: Trip | null; sizeThird: 0 | 1 | 2 | null }

type Split = { key: string; label: string; atOpen: boolean; has: (x: TripCtx) => boolean }

const notional = (t: Trip) => Math.abs(t.entry * t.size)
const utcHour = (ms: number) => new Date(ms).getUTCHours()
const isWeekend = (ms: number) => {
  const d = new Date(ms).getUTCDay()
  return d === 0 || d === 6
}

function splitsFor(coins: readonly string[]): Split[] {
  const blocks: Split[] = [0, 6, 12, 18].map(h => ({
    key: `h${h}`,
    label: `Opened ${String(h).padStart(2, '0')}:00–${String(h + 6).padStart(2, '0')}:00 UTC`,
    atOpen: true,
    has: x => Math.floor(utcHour(x.trip.open) / 6) * 6 === h,
  }))
  return [
    ...blocks,
    { key: 'weekend', label: 'Opened on a weekend (Sat–Sun UTC)', atOpen: true, has: x => isWeekend(x.trip.open) },
    ...coins.map(c => ({ key: `coin:${c}`, label: `On ${c}`, atOpen: true, has: (x: TripCtx) => x.trip.coin === c })),
    { key: 'long', label: 'Longs', atOpen: true, has: x => x.trip.side === 'long' },
    { key: 'short', label: 'Shorts', atOpen: true, has: x => x.trip.side === 'short' },
    { key: 'afterLoss', label: 'Opened after a losing trip', atOpen: true, has: x => x.prev !== null && x.prev.net < 0 },
    { key: 'afterWin', label: 'Opened after a winning trip', atOpen: true, has: x => x.prev !== null && x.prev.net > 0 },
    {
      key: 'soonAfterLoss',
      label: 'Opened within an hour of closing a loss',
      atOpen: true,
      has: x => x.prev !== null && x.prev.net < 0 && x.prev.close !== null && x.trip.open - x.prev.close <= HOUR,
    },
    { key: 'big', label: 'Your biggest third by size', atOpen: false, has: x => x.sizeThird === 2 },
    { key: 'small', label: 'Your smallest third by size', atOpen: false, has: x => x.sizeThird === 0 },
    { key: 'quick', label: 'Closed within 15 minutes', atOpen: false, has: x => x.trip.close !== null && x.trip.close - x.trip.open <= 15 * 60_000 },
    { key: 'overDay', label: 'Held over a day', atOpen: false, has: x => x.trip.close !== null && x.trip.close - x.trip.open > 24 * HOUR },
  ]
}

/**
 * Each finished trip (with a size in dollars) with the trip closed last before it opened (any coin) and its size
 * third: by rank, the smallest third and the biggest third of the trips, ties in the order opened. Null for all when
 * the smallest third's biggest trip is as big as the biggest third's smallest (sizes too alike to split).
 */
export function tripContexts(trips: readonly Trip[]): TripCtx[] {
  const done = trips.filter(t => t.close !== null && notional(t) > 0 && Number.isFinite(t.net)).sort((a, b) => a.open - b.open)
  const byClose = [...done].sort((a, b) => (a.close as number) - (b.close as number))
  const third = Math.floor(done.length / 3)
  const ranked = done.map((t, i) => ({ i, n: notional(t) })).sort((a, b) => a.n - b.n || a.i - b.i)
  const thirds = new Array<0 | 1 | 2 | null>(done.length).fill(1)
  ranked.forEach((x, k) => {
    thirds[x.i] = k < third ? 0 : k >= done.length - third ? 2 : 1
  })
  const isSplit = third > 0 && (ranked[third - 1]?.n ?? 0) < (ranked[done.length - third]?.n ?? 0)
  let at = 0
  let last: Trip | null = null
  let before: Trip | null = null
  return done.map((trip, i) => {
    // byClose and done both run forward in time: the last trip closed by this one's open (not itself), in one pass.
    while (at < byClose.length && ((byClose[at] as Trip).close as number) <= trip.open) {
      before = last
      last = byClose[at] as Trip
      at++
    }
    return { trip, prev: last === trip ? before : last, sizeThird: isSplit ? (thirds[i] as 0 | 1 | 2) : null }
  })
}

export type Gap = {
  key: string
  label: string
  atOpen: boolean
  n: number
  net: number
  won: number
  /** Average net a trip in the split, and in all the other trips. */
  avg: number
  restAvg: number
  /** Average net per $1,000 traded (net over the trip's size in dollars) in the split, and in all the other trips. */
  perK: number
  restPerK: number
  /** What the split made against the same trips at the rest's result per dollar: below 0 is a leak. */
  cost: number
  /** The split holding exactly the other trips (longs and shorts), if looked at too. */
  twin?: string
  /** Chance a random set of as many trips is this far off, before and after allowing for the splits looked at. */
  p: number
  adjusted: number
}

export type Review = { n: number; net: number; looked: number; leaks: Gap[]; strengths: Gap[]; all: Gap[] }

/** Welch's t: how far apart two averages are, in units of their own spread (from sums and sums of squares). */
function welch(sa: number, qa: number, na: number, sb: number, qb: number, nb: number): number {
  const ma = sa / na
  const mb = sb / nb
  const va = Math.max(0, (qa - sa * ma) / (na - 1))
  const vb = Math.max(0, (qb - sb * mb) / (nb - 1))
  const se = Math.sqrt(va / na + vb / nb)
  const d = ma - mb
  return Math.abs(d) < 1e-15 ? 0 : d / Math.max(se, 1e-300)
}

/**
 * The splits with enough trips in them and outside them, and how far each is off the person's own usual, per dollar
 * traded (so bigger trips don't look worse only for being bigger). The chance check: shuffle which trips are in the
 * split, REVIEW_DRAWS times, and see how often the gap is as wide in units of its own spread (Welch's t, so trips
 * that swing more, held longer or sized bigger, don't make a gap look real). It stops early once FAR_ENOUGH draws are
 * as far off. Allowing for the splits looked at multiplies the chance by their number (Bonferroni: on the safe side).
 */
export function reviewTrips(trips: readonly Trip[], draws = REVIEW_DRAWS): Review {
  const ctx = tripContexts(trips)
  const N = ctx.length
  const nets = ctx.map(x => x.trip.net)
  const total = nets.reduce((a, b) => a + b, 0)
  const sizes = ctx.map(x => notional(x.trip))
  const rs = ctx.map((x, i) => x.trip.net / (sizes[i] as number))
  const rSum = rs.reduce((a, b) => a + b, 0)
  const rSq = rs.reduce((a, b) => a + b * b, 0)
  const counts = new Map<string, number>()
  for (const x of ctx) counts.set(x.trip.coin, (counts.get(x.trip.coin) ?? 0) + 1)
  const coins = [...counts.entries()].filter(([, k]) => k >= REVIEW_MIN && N - k >= REVIEW_MIN).map(([c]) => c)
  const rand = seededRandom(N * 7919 + Math.round(Math.abs(total)))
  const gaps: Gap[] = []
  const members = new Map<string, boolean[]>()
  const pool = [...rs]
  for (const s of splitsFor(coins)) {
    const flags = ctx.map(s.has)
    const n = flags.filter(Boolean).length
    if (n < REVIEW_MIN || N - n < REVIEW_MIN) continue
    let net = 0
    let size = 0
    let sIn = 0
    let qIn = 0
    let won = 0
    flags.forEach((f, i) => {
      if (!f) return
      const r = rs[i] as number
      net += nets[i] as number
      size += sizes[i] as number
      sIn += r
      qIn += r * r
      if ((nets[i] as number) > 0) won++
    })
    const tSeen = Math.abs(welch(sIn, qIn, n, rSum - sIn, rSq - qIn, N - n))
    // Shuffle: the smaller side drawn without putting back (a partial Fisher-Yates), the other side is the rest.
    const k = Math.min(n, N - n)
    let far = 0
    let done = 0
    while (done < draws && far < FAR_ENOUGH) {
      let sum = 0
      let sq = 0
      for (let i = 0; i < k; i++) {
        const j = i + Math.floor(rand() * (N - i))
        const v = pool[j] as number
        pool[j] = pool[i] as number
        pool[i] = v
        sum += v
        sq += v * v
      }
      const t = k === n ? welch(sum, sq, n, rSum - sum, rSq - sq, N - n) : welch(rSum - sum, rSq - sq, n, sum, sq, N - n)
      if (Math.abs(t) >= tSeen - 1e-9) far++
      done++
    }
    const p = far >= FAR_ENOUGH ? far / done : (1 + far) / (draws + 1)
    const perIn = sIn / n
    const perRest = (rSum - sIn) / (N - n)
    members.set(s.key, flags)
    gaps.push({ key: s.key, label: s.label, atOpen: s.atOpen, n, net, won, avg: net / n, restAvg: (total - net) / (N - n), perK: perIn * 1000, restPerK: perRest * 1000, cost: size * (perIn - perRest), p, adjusted: 1 })
  }
  for (const g of gaps) g.adjusted = Math.min(1, g.p * gaps.length)
  // Twins: two splits that hold exactly the other's trips (longs and shorts) say the same thing twice.
  for (const g of gaps)
    for (const h of gaps) {
      if (g === h || g.n + h.n !== N) continue
      const a = members.get(g.key) as boolean[]
      const b = members.get(h.key) as boolean[]
      if (a.every((x, i) => x !== b[i])) g.twin = h.key
    }
  // Leaks that stand out come first, then by what they cost; strengths the same way.
  const order = (x: Gap, y: Gap) => Number(y.adjusted < 0.05) - Number(x.adjusted < 0.05) || Math.abs(y.cost) - Math.abs(x.cost)
  return {
    n: N,
    net: total,
    looked: gaps.length,
    leaks: gaps.filter(g => g.cost < 0).sort(order),
    strengths: gaps.filter(g => g.cost > 0).sort(order),
    all: gaps,
  }
}

const usd = (x: number) => (Math.abs(x) < 0.5 ? '$0' : `${x >= 0 ? '+' : '-'}$${Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 })}`)
/** Dollars per $1,000 traded: cents under $10. */
const perK = (x: number) => (Math.abs(x) < 0.005 ? '$0' : `${x >= 0 ? '+' : '-'}$${Math.abs(x) < 10 ? Math.abs(x).toFixed(2) : Math.abs(x).toFixed(0)}`)
const share = (k: number, n: number) => `${Math.round((k / n) * 100)}%`
const chance = (p: number) => (p < 0.001 ? 'under 0.1%' : p < 0.01 ? `${(p * 100).toFixed(1)}%` : `${Math.round(p * 100)}%`)

function gapLine(g: Gap, looked: number): string {
  const verdict =
    g.adjusted < 0.05
      ? `Stands out even allowing for the ${looked} splits looked at.`
      : `Could be chance: a random ${g.n} of your trips are this far off ${chance(g.p)} of the time${g.p < 0.05 ? `, and with ${looked} splits looked at one like it turns up easily` : ''}.`
  return `· ${g.label}: ${g.n} trips, net ${usd(g.net)}, made money ${share(g.won, g.n)} of the time; per $1,000 traded ${perK(g.perK)} against ${perK(g.restPerK)} on your other trips, about ${usd(g.cost)} in all. ${verdict}`
}

export function reviewText(r: Review, wallet: string, days: number, since?: string): string {
  const span = since ? `since ${since}` : `last ${days} days`
  const head = `Trade review of ${shortWallet(wallet)}, ${span}: ${r.n} finished trip${r.n === 1 ? '' : 's'}, net ${usd(r.net)} (after fees; funding not counted).`
  if (r.n < 2 * REVIEW_MIN) return `${head}\nUnder ${2 * REVIEW_MIN} finished trips: too few to split into parts and compare. The review fills in as you trade.`
  const lines = [head, `${r.looked} splits looked at (time of day, weekday, coin, long or short, after a loss or a win, size, how long held), each against your own other trips, per dollar traded.`]
  // Only a gap that stands out from chance is called a leak; every one is shown. The rest are shown as what they are.
  const stand = r.leaks.filter(g => g.adjusted < 0.05)
  const maybe = r.leaks.filter(g => g.adjusted >= 0.05)
  const room = Math.max(0, LEAKS_SHOWN - stand.length)
  if (r.leaks.length === 0) lines.push('No split did worse than your usual.')
  if (stand.length) {
    lines.push('Leaks (worse than your own usual, and it stands out from chance):')
    for (const g of stand) lines.push(gapLine(g, r.looked))
  }
  if (room && maybe.length) {
    lines.push(stand.length ? 'Worse than usual, but could be chance:' : 'No leak stands out from chance yet. Worse than usual, but could be chance:')
    for (const g of maybe.slice(0, room)) lines.push(gapLine(g, r.looked))
  }
  const shown = stand.length + Math.min(maybe.length, room)
  if (r.leaks.length > shown) lines.push(`… and ${r.leaks.length - shown} smaller, all could be chance.`)
  // A best split that is only the other side of a leak shown (longs against shorts) says nothing new.
  const said = new Set([...stand, ...maybe.slice(0, room)].map(g => g.key))
  const best = r.strengths.find(g => !(g.twin && said.has(g.twin)))
  if (best) lines.push(`Best split: ${gapLine(best, r.looked).slice(2)}`)
  return lines.join('\n')
}

/** The leaks that stand out from chance and would apply to a trip opened now on `coin`, after the last trip closed. */
export function leaksNow(r: Review, trips: readonly Trip[], coin: string, side: 'long' | 'short' | null, now: number): Gap[] {
  const done = trips.filter(t => t.close !== null && (t.close as number) <= now).sort((a, b) => (a.close as number) - (b.close as number))
  const prev = done.at(-1) ?? null
  const counts = new Map<string, number>()
  for (const t of done) counts.set(t.coin, (counts.get(t.coin) ?? 0) + 1)
  const probe: TripCtx = { trip: { coin, side: side ?? 'long', open: now, close: null, entry: 0, exit: null, size: 0, net: 0, fees: 0, fills: 0 }, prev, sizeThird: null }
  const splits = new Map(splitsFor([coin]).map(s => [s.key, s]))
  return r.leaks.filter(g => {
    if (g.adjusted >= 0.05) return false
    const s = splits.get(g.key)
    if (!s || !s.atOpen) return false
    if ((g.key === 'long' || g.key === 'short') && side === null) return false
    return s.has(probe)
  })
}

/** The head of a rules file: what a first rule added starts the file with. */
export const RULES_HEAD = ['# My trading rules', '', 'One rule a line. The Lab desk reads this file for a second look before a trade; Claude can edit it with you.', ''].join('\n')

/** The 4 examples a rules file shown for the first time starts with. */
export const RULES_EXAMPLES = [
  'No new trade within an hour of closing a loss.',
  'Risk at most 1% of the account on one trade.',
  'Only with the 1d trend (price above the 200 ema for longs, below for shorts).',
  'No trade when funding is above 50%/yr in my direction.',
]

/** The words a rules file starts with when the person asks to see their rules first: the head and the examples. */
export const RULES_TEMPLATE = [RULES_HEAD, ...RULES_EXAMPLES.map(x => `- ${x}`), ''].join('\n')

/**
 * One line of a rules file as a rule, or null: headings ("# ", "## "), blank lines, dividers ("---") and the head's
 * help line are not rules. List marks ("- ", "* ", "1. ", "- [ ] ") and bold are taken off; "1.5% risk" and
 * "#1 rule: ..." stay whole.
 */
export function ruleLine(raw: string): string | null {
  const x = raw.trim()
  if (x === '' || /^#{1,6}(\s|$)/.test(x) || /^[-*_=\s]{3,}$/.test(x) || x.startsWith('One rule a line.')) return null
  const out = x
    .replace(/^(?:[-*+•]\s+|\d+[.)]\s+)+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_m, a: string | undefined, b: string | undefined) => a ?? b ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return out === '' ? null : out
}

/** Every rule line a person wrote. */
export function allRulesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(ruleLine)
    .filter((x): x is string => x !== null)
}

/** The rules handed on: whole lines from the top while they fit in RULES_MAX characters, never one cut in half. */
export function rulesOf(text: string): string[] {
  const out: string[] = []
  let used = 0
  for (const r of allRulesOf(text)) {
    if (used + r.length > RULES_MAX) break
    out.push(r)
    used += r.length + 1
  }
  return out
}

export type SecondLook = { idea: string; coin: string; side: 'long' | 'short' | null; rules: string[]; rulesPath: string | null; facts: string[]; leaks: Gap[]; looked: number; hasTrades: boolean; left?: number }

/** The brief the person's AI answers from: the idea, their rules, the market now, their leaks that apply now. */
export function secondLookText(x: SecondLook): string {
  const lines = [`Second look at: ${x.idea} (${x.coin}${x.side ? `, ${x.side}` : ''}).`]
  lines.push(x.rules.length ? `Their own rules${x.rulesPath ? ` (${x.rulesPath})` : ''}:` : `No rules written yet${x.rulesPath ? ` (the file is ${x.rulesPath})` : ''}; judge from the facts alone and offer to write a few rules with them.`)
  x.rules.forEach((r, k) => lines.push(`${k + 1}. ${r}`))
  if (x.left) lines.push(`(${x.left} more rule line${x.left === 1 ? '' : 's'} left out here for length${x.rulesPath ? `; the whole file is ${x.rulesPath}` : ''}.)`)
  lines.push('The market now:', ...x.facts.map(f => `· ${f}`))
  if (x.leaks.length) {
    lines.push(`Their own trade review, leaks that stand out from chance and apply right now (of ${x.looked} splits looked at):`)
    for (const g of x.leaks) lines.push(`· ${g.label}: ${g.n} trips, ${perK(g.perK)} per $1,000 traded against ${perK(g.restPerK)} for the rest.`)
  } else if (x.hasTrades) lines.push('Their own trade review: no leak that stands out from chance applies right now (gaps that could be chance are not reasons).')
  lines.push(
    'Answer with exactly the 3 strongest reasons against this idea, strongest first, each one line naming the rule it breaks or the fact it rests on. No reasons for it. Then one line: what would take the strongest reason away. Plain words; the decision is theirs.',
  )
  return lines.join('\n')
}
