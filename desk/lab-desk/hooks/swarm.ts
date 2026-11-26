// The Swarm: the person's AI writes 10 to 200 rules, the desk runs them all on the PC in a second or two, and the
// luck check across all of them (SPA) says which, if any, beat luck on the seen part. A walk-forward inside the seen
// part asks whether picking the best rule with only what was known then would have held up. The unseen part stays
// sealed except for the rules that beat luck, so one search doesn't wear it out. "None beat luck" is a normal answer.
// Pure: no `$`.

import type { Candle } from '../types'
import { MIN_CASES, conditionWarmup, day, pct } from './history'
import { chanceText, partResult, runTest, sealIndex, seedOf, specKey, specWords } from './honest'
import type { Funding, PartResult, TestSpec, Trade } from './honest'
import { LOW_POWER, MIN_SCORED, SPA_DRAWS, barReturns, blockLength, spaTest } from './spa'

export const SWARM_MIN = 2
export const SWARM_MAX = 200
/** Rules shown in the table; the rest are counted. */
export const SWARM_SHOWN = 10
/** Most rules whose unseen part is opened (the strongest of those that beat luck). */
export const SWARM_OPEN = 5
export const WALK_FOLDS = 5

export type SwarmRow = {
  spec: TestSpec
  words: string
  seen: PartResult
  /** The per-candle score (studentized, drift taken off) on the seen part; 0 when it sat out. */
  t: number
  /** Its chance of looking this good by luck, out of all the rules. */
  p: number
  survives: boolean
  /** Beat luck with the market's own move taken off, but lost money after fees: not counted, not opened. */
  lostAnyway?: boolean
  /** Opened only for the rules that beat luck. */
  unseen?: PartResult
}

export type Walk = {
  /** The rule picked before each stretch, with what it made in it. */
  steps: { words: string; total: number; from: number }[]
  made: number
  total: number
}

export type SwarmResult = {
  rows: SwarmRow[]
  cut: number
  warm: number
  from: number
  cutT: number
  to: number
  /** The chance luck alone gives this swarm's strongest rule (30+ trades) its strength, judged against every try (earlier ones too). */
  p: number
  used: number
  draws: number
  block: number
  walk: Walk | null
  /** The luck check across the opened rules and the earlier tries that saw the unseen part (null when none was opened). */
  unseenP: { p: number; held: boolean; best: string; n: number; avg: number; earlier: number } | null
  few: number
  /** Earlier tries on this coin and interval, judged with this swarm on the seen part. */
  earlier: number
}

/** An earlier try on the same coin and interval, from the ledger: run again so a new search can't forget it. */
export type Prior = { spec: TestSpec; sawUnseen: boolean; s?: number }

/** "rsi < 30 hold 10; rsi < 25 hold 10" or one rule a line, as separate rules. */
export function splitRules(text: string): string[] {
  return text
    .split(/\s*(?:;|\n)\s*/)
    .map(x => x.trim().replace(/^[^:]{1,40}:\s*/, '').replace(/^[-*•\d.)\s]+(?=[a-z])/i, ''))
    .filter(x => x !== '')
}

/** Every rule on the same candles; the seen part judged together, the unseen part opened only for those that beat luck. */
export function runSwarm(specs: readonly TestSpec[], candles: readonly Candle[], funding: readonly Funding[], draws = SPA_DRAWS, prior: readonly Prior[] = []): SwarmResult {
  // Earlier tries join the luck check: on the seen part all of them (each was a look at it), on the unseen part those
  // that saw it. A rule tried again counts once.
  const mine = new Set(specs.map(specKey))
  const seenPrior: TestSpec[] = []
  const keys = new Set<string>()
  for (const x of prior) {
    const k = specKey(x.spec)
    if (mine.has(k) || keys.has(k)) continue
    keys.add(k)
    seenPrior.push(x.spec)
  }
  // On the unseen part: earlier tries that saw it, and those whose own search ran past this swarm's seal (s = the first
  // candle a try did not look at), e.g. a Hyperliquid swarm inside the last 30% of years of Binance candles.
  const sealT = (candles[sealIndex(candles.length)] as Candle | undefined)?.t ?? Infinity
  const unseenPrior = seenPrior.filter(sp => prior.some(x => (x.sawUnseen || (x.s ?? 0) > sealT) && specKey(x.spec) === specKey(sp)))
  const all = [...specs, ...seenPrior]
  // The seen part starts once this swarm's own rules have warmed up; an earlier try with a longer warm-up just has no
  // trades before its own (the seal no longer depends on any of them).
  const warm = Math.max(0, ...specs.map(s => Math.max(conditionWarmup(s.enter), s.exit ? conditionWarmup(s.exit) : 0)))
  const cut = sealIndex(candles.length)
  const seenCandles = candles.slice(0, cut)
  const step = candles.length > 1 ? (candles[1] as Candle).t - (candles[0] as Candle).t : 3_600_000
  const allTrades: Trade[][] = all.map(s => runTest(s, seenCandles, funding, warm))
  const trades = allTrades.slice(0, specs.length)
  const fair = all.map((s, k) => barReturns(allTrades[k] as Trade[], seenCandles, warm, cut, s.side, s.fee, true))
  const holds = trades.flat().map(t => t.j - t.i)
  const block = blockLength(step, holds, cut - warm)
  const spa = spaTest(fair, { draws, block, seed: seedOf(`${all.map(specKey).join('|')}|${candles.length}|${candles.at(-1)?.t ?? 0}`) })
  const rows: SwarmRow[] = specs.map((spec, k) => {
    const seen = partResult(trades[k] as Trade[], seenCandles, warm, cut, spec.side)
    const beat = seen.n >= MIN_SCORED && spa.survivors.includes(k)
    const lost = seen.avg <= 0 || seen.total <= 0
    return { spec, words: specWords(spec), seen, t: spa.t[k] ?? 0, p: spa.adjusted[k] ?? 1, survives: beat && !lost, ...(beat && lost ? { lostAnyway: true } : {}) }
  })
  // Walk-forward: before each of the last 4 of 5 stretches, the rule that did best so far (a gap of a typical trade
  // left out before the stretch, so no trade spans the line), then what it made in the stretch.
  // Picked and scored with the market's own drift taken off, like the luck check: the drift of the past window for
  // the pick (nothing from later), the stretch's own drift for the score. Raw money would reward riding a rising market.
  const raw = specs.map((s, k) => barReturns(trades[k] as Trade[], seenCandles, warm, cut, s.side, s.fee, false))
  const span = cut - warm
  const held = specs.map((s, k) => {
    const out = new Float64Array(span)
    const sign = s.side === 'long' ? 1 : -1
    for (const t of trades[k] as Trade[]) {
      if (t.i < warm || t.i >= cut) continue
      const k0 = (seenCandles[t.i] as Candle).c
      for (let q = t.i + 1; q <= Math.min(t.j, cut - 1); q++) out[q - warm] = (out[q - warm] as number) + (sign * (seenCandles[q - 1] as Candle).c) / k0
    }
    return out
  })
  const meanMove = (lo: number, hi: number): number => {
    let m = 0
    let n = 0
    for (let q = Math.max(lo + warm, 1); q < hi + warm; q++) {
      m += (seenCandles[q] as Candle).c / (seenCandles[q - 1] as Candle).c - 1
      n++
    }
    return n > 0 ? m / n : 0
  }
  const gap = Math.max(1, holds.length ? ([...holds].sort((a, b) => a - b)[Math.floor(holds.length / 2)] as number) : 1)
  let walk: Walk | null = null
  if (span >= WALK_FOLDS * 50) {
    const size = Math.floor(span / WALK_FOLDS)
    const steps: Walk['steps'] = []
    for (let f = 1; f < WALK_FOLDS; f++) {
      const a = f * size
      const b = f === WALK_FOLDS - 1 ? span : a + size
      const trainEnd = Math.max(0, a - gap)
      const muT = meanMove(0, trainEnd)
      let best = -1
      let bestSum = -Infinity
      raw.forEach((r, k) => {
        const h = held[k] as Float64Array
        let s = 0
        let any = false
        for (let q = 0; q < trainEnd; q++) {
          const x = r[q] as number
          if (x !== 0) any = true
          s += x - muT * (h[q] as number)
        }
        if (any && s > bestSum) {
          bestSum = s
          best = k
        }
      })
      if (best < 0) continue
      const r = raw[best] as Float64Array
      const h = held[best] as Float64Array
      const muS = meanMove(a, b)
      let made = 0
      for (let q = a; q < b; q++) made += (r[q] as number) - muS * (h[q] as number)
      steps.push({ words: rows[best]?.words ?? '', total: made, from: (candles[warm + a] as Candle).t })
    }
    walk = { steps, made: steps.filter(s => s.total > 0).length, total: steps.reduce((x, s) => x + s.total, 0) }
  }
  // The unseen part, only for the strongest rules that beat luck; judged together there too.
  const open = rows
    .map((r, k) => ({ r, k }))
    .filter(x => x.r.survives)
    .sort((a, b) => b.r.t - a.r.t)
    .slice(0, SWARM_OPEN)
  let unseenP: SwarmResult['unseenP'] = null
  if (open.length > 0) {
    const unseenRows = open.map(({ r }) => {
      const tr = runTest(r.spec, candles, funding, cut)
      r.unseen = partResult(tr, candles, cut, candles.length, r.spec.side)
      return barReturns(tr, candles, cut, candles.length, r.spec.side, r.spec.fee, true)
    })
    const earlierRows = unseenPrior.map(sp => barReturns(runTest(sp, candles, funding, cut), candles, cut, candles.length, sp.side, sp.fee, true))
    const u = spaTest([...unseenRows, ...earlierRows], { draws, block: blockLength(step, holds, candles.length - cut), seed: 7 })
    // The strongest of the opened rules on the unseen part; the verdict is about it.
    const ts = u.t.slice(0, open.length)
    const at = Math.max(0, ts.indexOf(Math.max(...ts)))
    const best = open[at]?.r
    unseenP = { p: u.adjusted[at] ?? 1, held: u.survivors.includes(at), best: best?.words ?? '', n: best?.unseen?.n ?? 0, avg: best?.unseen?.avg ?? 0, earlier: earlierRows.length }
  }
  return {
    rows,
    cut,
    warm,
    from: (candles[warm] as Candle | undefined)?.t ?? 0,
    cutT: (candles[cut] as Candle | undefined)?.t ?? 0,
    to: candles.at(-1)?.t ?? 0,
    p: Math.min(1, ...rows.filter(r => r.seen.n >= MIN_SCORED).map(r => r.p)),
    used: spa.used,
    draws: spa.draws,
    block: spa.block,
    walk,
    unseenP,
    few: rows.filter(r => r.seen.n < MIN_SCORED).length,
    earlier: seenPrior.length,
  }
}

function rowLine(r: SwarmRow, k: number): string {
  const s = r.seen
  if (s.n < MIN_CASES) return `${k}. ${r.words}: ${s.n} trade${s.n === 1 ? '' : 's'}: under ${MIN_CASES}, no numbers.`
  if (s.n < MIN_SCORED) return `${k}. ${r.words}: ${s.n} trade${s.n === 1 ? '' : 's'}, all together ${pct(s.total, 1)}, deepest drop ${pct(s.maxDrawdown, 1)}; too few to judge.`
  const luck = r.survives
    ? `luck alone ${chanceText(r.p)}: beats luck`
    : r.lostAnyway
      ? `luck alone ${chanceText(r.p)} with the market's own move taken off, but it lost money after fees, so not counted`
      : r.t <= 0
        ? `no better than the market's own drift`
        : `luck alone ${chanceText(r.p)}`
  return `${k}. ${r.words}: ${s.n} trades, ${Math.round(s.winShare * 100)}% won, average ${pct(s.avg)} a trade, all together ${pct(s.total, 1)}, deepest drop ${pct(s.maxDrawdown, 1)}; ${luck}${s.n < LOW_POWER ? ' (under 50 trades)' : ''}.`
}

export function swarmText(x: SwarmResult, coin: string, interval: string, venue: string, skipped: readonly string[]): string {
  const n = x.rows.length
  const lines = [
    `Swarm: ${n} rules on ${coin} ${interval} on ${venue}, ${day(x.from)} to ${day(x.to)} UTC. All searched on the seen part (to ${day(x.cutT)}); the unseen part after it stays sealed except for rules that beat luck.`,
  ]
  // Scored rules by their score; the ones with too few trades after, by what they made.
  const ranked = [...x.rows].sort((a, b) => {
    const sa = a.seen.n >= MIN_SCORED
    const sb = b.seen.n >= MIN_SCORED
    if (sa !== sb) return sa ? -1 : 1
    return sa ? b.t - a.t : b.seen.total - a.seen.total
  })
  const hold = x.rows.find(r => r.spec.side === 'long')?.seen.hold ?? -(x.rows[0]?.seen.hold ?? 0)
  lines.push(`Best on the seen part (just holding: ${pct(hold, 1)}; by a per-candle score with the market's own drift taken off):`)
  ranked.slice(0, SWARM_SHOWN).forEach((r, k) => lines.push(rowLine(r, k + 1)))
  if (n > SWARM_SHOWN) lines.push(`… and ${n - SWARM_SHOWN} more.`)
  if (x.few > 0) lines.push(`${x.few} of the ${n} had under ${MIN_SCORED} trades on the seen part: in the luck check, never named as beating it.`)
  const survivors = x.rows.filter(r => r.survives)
  const earlier = x.earlier > 0 ? ` and the ${x.earlier} earlier tr${x.earlier === 1 ? 'y' : 'ies'} on ${coin} ${interval}` : ''
  const lostAnyway = x.rows.filter(r => r.lostAnyway).length
  const judged = n - x.few
  if (judged === 0) lines.push(`Luck check: none of the ${n} had ${MIN_SCORED} trades on the seen part${x.used === 0 ? ' (none traded at all)' : ''}, so nothing to judge yet.`)
  else
    lines.push(
      `Luck check across all ${n}${earlier} (${x.used} traded; block reshuffles of ${x.block} candles, ${x.draws} times): luck alone gives the strongest of the ${n} this strong ${chanceText(x.p)} of the time${survivors.length ? `; ${survivors.length} beat luck one by one` : ''}${lostAnyway ? `${survivors.length ? ', and' : ';'} ${lostAnyway} more ran ahead of the market's own move but lost money after fees, so not counted` : ''}.`,
    )
  if (x.walk && x.walk.steps.length > 0)
    lines.push(
      `Walk-forward (seen part in 5 stretches; before each of the last 4, the rule best so far, then how it did in the stretch, all with the market's own drift taken off): beat the market's own move in ${x.walk.made} of ${x.walk.steps.length}, all together ${pct(x.walk.total, 1)} beyond it. Picked: ${[...new Set(x.walk.steps.map(s => s.words))].join(' · ')}.`,
    )
  if (survivors.length === 0) {
    if (judged === 0) lines.push(`Nothing is crossed off yet, and the unseen part stays sealed.`)
    else lines.push(`Honest empty: none of the ${n} beat luck${lostAnyway ? ' and made money' : ''} on the seen part. That is the usual answer, and a useful one: ${judged === n ? 'these ideas are' : `the ${judged} with enough trades are`} crossed off${judged === n ? '' : ` (the other ${x.few} had too few to judge)`}, and the unseen part stays sealed for the next ones.`)
  } else {
    const opened = x.rows.filter(r => r.unseen).sort((a, b) => b.t - a.t)
    lines.push(`Unseen part, opened for the ${opened.length} strongest that beat luck (the part that counts):`)
    for (const r of opened) {
      const u = r.unseen as PartResult
      if (u.n < MIN_CASES) lines.push(`· ${r.words}: ${u.n} trade${u.n === 1 ? '' : 's'}: under ${MIN_CASES}, no numbers.`)
      else lines.push(`· ${r.words}: ${u.n} trade${u.n === 1 ? '' : 's'}, all together ${pct(u.total, 1)}, deepest drop ${pct(u.maxDrawdown, 1)}${u.n >= MIN_SCORED ? `, average ${pct(u.avg)} a trade` : '; too few to judge'}.`)
    }
    const u = x.unseenP
    if (u) {
      const across = `across those ${opened.length}${u.earlier > 0 ? ` and the ${u.earlier} earlier tr${u.earlier === 1 ? 'y' : 'ies'} that saw it` : ''}`
      if (u.n < MIN_SCORED) lines.push(`Luck check on the unseen part: the strongest (${u.best}) has ${u.n} unseen trade${u.n === 1 ? '' : 's'}, under ${MIN_SCORED}, so no luck verdict there yet.`)
      else if (u.avg <= 0) lines.push(`Luck check on the unseen part: the strongest (${u.best}) lost on it, so whatever the seen part showed did not carry over.`)
      else lines.push(`Luck check on the unseen part, ${across}: luck alone gives the strongest (${u.best}) this strong ${chanceText(u.p)} of the time${u.held ? `: it held where it was never tuned${u.n < LOW_POWER ? ' (under 50 trades, so a weak check)' : ''}. Still only history.` : ', so on the unseen part it does not stand out from luck.'}`)
    }
  }
  if (skipped.length > 0) lines.push(`Left out, not understood: ${skipped.slice(0, 5).join(' · ')}${skipped.length > 5 ? ` and ${skipped.length - 5} more` : ''}.`)
  return lines.join('\n')
}
