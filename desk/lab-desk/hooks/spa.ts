// The luck check across every rule tried: Hansen's test for superior predictive ability (SPA), studentized, with a
// circular block bootstrap so the calm and wild stretches of a market stay together, and Hsu, Hsu and Kuan's
// stepwise version to say which rules stand out. One answer for the whole search, so 200 tries cost what they
// should and near-copies of a rule don't count as many. Pure: no `$`.
//
// Each rule is a row of per-candle returns over the same candles: what holding it earned on each candle (0 when out).
// The question: does the best of them beat 0 by more than the best of that many could by luck?

import type { Candle } from '../types'
import type { Trade } from './honest'

/** A small seeded random source (the same as the honest test's), so the same rows always give the same answer. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Draws for the verdict. 1/(B+1) is the smallest chance it can say, far under any bar for 200 tries. */
export const SPA_DRAWS = 2000
export const SPA_ALPHA = 0.05
/** Fewer trades than this and no score is shown: too few to tell anything from luck. */
export const MIN_SCORED = 30
/** Under this many, the verdict comes with a word that a real effect can still be missed. */
export const LOW_POWER = 50

/**
 * Per-candle returns of a rule's trades over candles [start, end): each candle held earns the price change over the
 * trade's entry price (so a trade's candles add up to its move exactly), its share of the funding, and a fee on its
 * first and last candle. With `drift`, the window's average candle move is taken off each candle held, so a rule
 * that only rides the market's own trend (always long in a rising stretch) scores about 0, not luck-free skill.
 */
export function barReturns(trades: readonly Trade[], candles: readonly Candle[], start: number, end: number, side: 'long' | 'short', fee: number, drift = false): Float64Array {
  const T = Math.max(0, end - start)
  const out = new Float64Array(T)
  const sign = side === 'long' ? 1 : -1
  let mu = 0
  if (drift) {
    let n = 0
    for (let q = Math.max(start, 1); q < end; q++) {
      mu += (candles[q] as Candle).c / (candles[q - 1] as Candle).c - 1
      n++
    }
    mu = n > 0 ? mu / n : 0
  }
  for (const t of trades) {
    if (t.i < start || t.i >= end) continue
    const k0 = (candles[t.i] as Candle).c
    const held = Math.max(1, t.j - t.i)
    const last = Math.min(t.j, end - 1)
    const fund = t.funding / held
    for (let q = t.i + 1; q <= last; q++) {
      const prev = (candles[q - 1] as Candle).c
      out[q - start] = (out[q - start] as number) + (sign * ((candles[q] as Candle).c - prev - mu * prev)) / k0 + fund
    }
    if (t.i + 1 < end) out[t.i + 1 - start] = (out[t.i + 1 - start] as number) - fee
    if (t.j < end) out[t.j - start] = (out[t.j - start] as number) - fee
  }
  return out
}

/** Block length: about a day of candles (5 to 48), or the typical time in a trade when that is longer; at most a quarter. */
export function blockLength(stepMs: number, holds: readonly number[], T: number): number {
  const day = Math.min(48, Math.max(5, Math.round(86_400_000 / stepMs)))
  const sorted = [...holds].sort((a, b) => a - b)
  const median = sorted.length ? (sorted[Math.floor(sorted.length / 2)] as number) : 0
  return Math.max(1, Math.min(Math.max(day, median), Math.floor(T / 4)))
}

export type Spa = {
  /** The chance luck alone gives a best rule this strong, out of all the rules. 1 when none beat 0. */
  p: number
  /** Each rule's own chance, adjusted for all the others (single-step max-t). 1 for a rule not in the test. */
  adjusted: number[]
  /** Each rule's studentized average (0 for a rule not in the test). */
  t: number[]
  /** The rules that beat luck, stepwise, at SPA_ALPHA. */
  survivors: number[]
  /** Rules that traded in the window and went in the test. */
  used: number
  draws: number
  block: number
}

/**
 * The test. `rows` are per-candle returns over the same T candles. Rows that never trade there sit out of the max
 * (they can't be best) but the caller still counts them as tries. Same rows and seed, same answer.
 */
const W = 8

export function spaTest(rows: readonly Float64Array[], opts: { draws?: number; block: number; seed?: number; alpha?: number }): Spa {
  const B = Math.max(99, Math.round(opts.draws ?? SPA_DRAWS))
  const alpha = opts.alpha ?? SPA_ALPHA
  const T = rows[0]?.length ?? 0
  const M = rows.length
  const none: Spa = { p: 1, adjusted: rows.map(() => 1), t: rows.map(() => 0), survivors: [], used: 0, draws: B, block: opts.block }
  if (T < 8 || M === 0) return none
  const blk = Math.max(1, Math.min(opts.block, T))
  const ids: number[] = []
  for (let k = 0; k < M; k++) {
    const r = rows[k] as Float64Array
    let any = false
    for (let q = 0; q < T; q++) {
      if (r[q] !== 0) {
        any = true
        break
      }
    }
    if (any) ids.push(k)
  }
  const K = ids.length
  if (K === 0) return none
  const rand = seededRandom(opts.seed ?? 1)
  const nb = Math.ceil(T / blk)
  const lastLen = T - (nb - 1) * blk
  const starts = new Int32Array(nb * B)
  for (let x = 0; x < starts.length; x++) starts[x] = Math.floor(rand() * T)
  const mstar = new Float64Array(K * B)
  const mean0 = new Float64Array(K)
  const tiles = Math.ceil(K / W)
  const P = new Float64Array((T + 1) * W)
  const tot = new Float64Array(W)
  const acc = new Float64Array(W)
  const D = new Float64Array(T * W)
  for (let tile = 0; tile < tiles; tile++) {
    const k0 = tile * W
    const n = Math.min(W, K - k0)
    P.fill(0)
    tot.fill(0)
    for (let w = 0; w < n; w++) {
      const r = rows[ids[k0 + w] as number] as Float64Array
      let s = 0
      for (let q = 0; q < T; q++) {
        s += r[q] as number
        P[(q + 1) * W + w] = s
      }
      tot[w] = s
      mean0[k0 + w] = s / T
    }
    // Each full block's sum from each start, worked out once per rule (the same arithmetic as in the loop, so the
    // same bits): one load per block instead of two, and 8 rules side by side in one cache line.
    for (let q = 0; q < T; q++) {
      const e = q + blk
      for (let w = 0; w < 8; w++) {
        D[q * 8 + w] = e <= T ? (P[e * 8 + w] as number) - (P[q * 8 + w] as number) : (tot[w] as number) - (P[q * 8 + w] as number) + (P[(e - T) * 8 + w] as number)
      }
    }
    for (let b = 0; b < B; b++) {
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, s5 = 0, s6 = 0, s7 = 0
      const o = b * nb
      for (let s = 0; s < nb - 1; s++) {
        const ia = (starts[o + s] as number) * 8
        s0 += D[ia] as number
        s1 += D[ia + 1] as number
        s2 += D[ia + 2] as number
        s3 += D[ia + 3] as number
        s4 += D[ia + 4] as number
        s5 += D[ia + 5] as number
        s6 += D[ia + 6] as number
        s7 += D[ia + 7] as number
      }
      {
        const a = starts[o + nb - 1] as number
        const e = a + lastLen
        const ia = a * 8
        const ie = (e <= T ? e : e - T) * 8
        const wrap = e > T
        const one = (w: number) => (wrap ? (tot[w] as number) - (P[ia + w] as number) + (P[ie + w] as number) : (P[ie + w] as number) - (P[ia + w] as number))
        s0 += one(0); s1 += one(1); s2 += one(2); s3 += one(3); s4 += one(4); s5 += one(5); s6 += one(6); s7 += one(7)
      }
      const got = [s0, s1, s2, s3, s4, s5, s6, s7]
      for (let w = 0; w < n; w++) mstar[(k0 + w) * B + b] = (got[w] as number) / T
    }
  }
  const sqT = Math.sqrt(T)
  const omega = new Float64Array(K)
  const tk = new Float64Array(K)
  const g = new Float64Array(K)
  const live: number[] = []
  const bar = Math.sqrt(2 * Math.log(Math.max(Math.E, Math.log(T))))
  for (let k = 0; k < K; k++) {
    const m = mean0[k] as number
    let s1 = 0
    let s2 = 0
    for (let b = 0; b < B; b++) {
      const x = mstar[k * B + b] as number
      s1 += x
      s2 += x * x
    }
    const v = s2 / B - (s1 / B) ** 2
    const w = sqT * Math.sqrt(Math.max(0, v))
    omega[k] = w
    if (!(w > 1e-15) || !Number.isFinite(w)) continue
    tk[k] = (sqT * m) / w
    g[k] = (tk[k] as number) >= -bar ? m : 0
    live.push(k)
  }
  const t = rows.map(() => 0)
  for (const k of live) t[ids[k] as number] = tk[k] as number
  if (live.length === 0) return { ...none, used: 0 }
  const maxOver = (set: readonly number[]) => {
    const out = new Float64Array(B)
    for (let b = 0; b < B; b++) {
      let mx = 0
      for (const k of set) {
        const z = (sqT * ((mstar[k * B + b] as number) - (g[k] as number))) / (omega[k] as number)
        if (z > mx) mx = z
      }
      out[b] = mx
    }
    return out
  }
  const all = maxOver(live)
  const chance = (x: number) => {
    if (!(x > 0)) return 1
    let c = 0
    for (let b = 0; b < B; b++) if ((all[b] as number) >= x) c++
    return (1 + c) / (B + 1)
  }
  const best = Math.max(0, ...live.map(k => tk[k] as number))
  const adjusted = rows.map(() => 1)
  for (const k of live) adjusted[ids[k] as number] = chance(tk[k] as number)
  const survivors: number[] = []
  let rest = [...live]
  for (let round = 0; round < live.length && rest.length > 0; round++) {
    const dist = Array.from(maxOver(rest)).sort((a, b) => a - b)
    const crit = dist[Math.min(B - 1, Math.ceil((1 - alpha) * (B + 1)) - 1)] as number
    const over = rest.filter(k => (tk[k] as number) > crit && (tk[k] as number) > 0)
    if (over.length === 0) break
    survivors.push(...over.map(k => ids[k] as number))
    rest = rest.filter(k => !over.includes(k))
  }
  return { p: chance(best), adjusted, t, survivors: survivors.sort((a, b) => (t[b] as number) - (t[a] as number)), used: live.length, draws: B, block: blk }
}
