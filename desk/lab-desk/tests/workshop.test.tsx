// The Workshop: the person's idea as one rule, an idea card before anything runs, then one judged search over the rule
// and versions of it, the other coins, the past cases, a TradingView marker and the bench. The verdict is in code.

import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Candle } from '../types'
import { NOW, engine, typed } from './fixtures'
import { parseTest, runTest, seededRandom } from '../hooks/honest'
import type { TestSpec } from '../hooks/honest'
import type { SwarmResult } from '../hooks/swarm'
import { markerPine } from '../hooks/export'
import { parseTestWords, roomyInterval } from '../hooks/register'
import { BANNED_WORDS, WORKSHOP_VERSIONS, benchAdd, cardSvg, cardText, fingerprint, ideaFile, lastingNext, markerOpens, slugOf, verdictLine, verdictOf, versionsOf } from '../hooks/workshop'
import type { Run, Verdict } from '../hooks/workshop'

const H = 3_600_000
const TOOL = 'mcp__lab-desk__chart_workshop'
const PLANT = 'ta.roc(close, 1) > 0.5 hold 1'

/** A random walk; with `plant`, a candle up more than 0.5% is followed by a push of that size the same way. */
function walk(n: number, seed: number, plant: number | false): Candle[] {
  const rand = seededRandom(seed)
  const out: Candle[] = []
  let p = 100
  let last = 0
  for (let i = 0; i < n; i++) {
    const o = p
    const z = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
    const r = 0.008 * z + (plant !== false && last > 0.005 ? plant : 0)
    p *= 1 + r
    last = r
    out.push({ t: NOW - (n - i) * H, o, h: Math.max(o, p), l: Math.min(o, p), c: p, v: 1 })
  }
  return out
}

const rowsOf = (c: readonly Candle[], coin: string) => c.map(k => ({ t: k.t, T: k.t + H - 1, s: coin, i: '1h', o: String(k.o), c: String(k.c), h: String(k.h), l: String(k.l), v: '1', n: 1 }))
const seedOf = (coin: string) => [...coin].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) % 1000

function spec(words: string): TestSpec {
  const t = parseTestWords(words)
  const s = t ? parseTest(t) : null
  if (!s || 'error' in s) throw new Error(words)
  return s
}

/** A data folder and a working folder in memory; the plugin's own files read as they are. */
function folders(on: On): Map<string, string> {
  const m = new Map<string, string>()
  const key = (p: string) => p.replaceAll('\\', '/')
  on('process.hookEnv', () => ({ value: { CLAUDE_PLUGIN_DATA: '/data/lab-desk' } }))
  on('fs.write', (_, e) => (m.set(key(e.path), e.text), { value: undefined }))
  on('fs.read', (_, e, next) => {
    const got = m.get(key(e.path))
    if (got !== undefined) return { value: got }
    if (key(e.path).startsWith('/data/')) throw new Error(`read ${e.path} failed: ENOENT`)
    return next(e)
  })
  return m
}

function memStore(on: On): Map<string, unknown> {
  const m = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: m.get(e.key) }))
  on('store.set', (_, e) => (m.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_, e) => (m.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...m.keys()] }))
  return m
}

const fileOf = (m: Map<string, string>, end: string) => [...m.entries()].find(([k]) => k.endsWith(end))?.[1] ?? ''

test('slugOf: a short folder name, the words the desk never prints dropped', () => {
  expect(slugOf('Pullback on SOL!')).toBe('pullback-on-sol')
  expect(slugOf('Buy the dip')).toBe('the-dip')
  expect(slugOf('  ')).toBe('idea')
  expect(slugOf('x'.repeat(80)).length).toBe(40)
})

test('the versions stay inside the idea: the same words, only its own numbers and hold moved, never the rule itself', () => {
  const rule = { enter: 'close > ema 200 and rsi < 40', exit: 'rsi > 55', hold: 12 }
  const vs = versionsOf(rule)
  expect(vs.length).toBeGreaterThan(10)
  expect(vs.length).toBeLessThanOrEqual(WORKSHOP_VERSIONS - 1)
  const shape = (s: string) => s.replace(/\d+(\.\d+)?/g, '#')
  for (const v of vs) {
    expect(shape(v.enter)).toBe(shape(rule.enter))
    expect(shape(v.exit ?? '')).toBe(shape(rule.exit))
    expect(v.hold).not.toBe(null)
  }
  const keys = vs.map(v => `${v.enter}|${v.exit}|${v.hold}`)
  expect(new Set(keys).size).toBe(keys.length)
  expect(keys).not.toContain(`${rule.enter}|${rule.exit}|${rule.hold}`)
  // Nothing to move but the hold: a few holds, the same entry.
  const bare = versionsOf({ enter: 'ema 20 crosses above ema 50', hold: null })
  expect(bare.every(v => v.enter.startsWith('ema'))).toBe(true)
  // An interval word is never moved.
  expect(versionsOf({ enter: 'rsi < 30 on 4h', hold: 10 }).every(v => v.enter.endsWith('on 4h'))).toBe(true)
})

test('the marker opens where the Lab test enters, candle for candle (one trade at a time, closes by condition or hold)', () => {
  const c = walk(3000, 5, false)
  for (const w of ['rsi < 35 exit rsi > 55', 'ema 20 crosses above ema 50 hold 24', 'close > ema 200 and rsi < 45 hold 8 short', 'ta.roc(close, 3) > 1 exit ta.roc(close, 3) < 0 hold 30']) {
    const s = spec(w)
    const opens = markerOpens(s, c).filter(i => i < c.length - 1)
    expect(opens).toEqual(runTest(s, c, []).map(t => t.i))
    expect(opens.length).toBeGreaterThan(5)
  }
})

test('the marker in Pine: alerts on closed candles, parts only the desk reads are left out and named', () => {
  const s = spec('rsi < 30 and funding < 0 exit rsi > 50 hold 24')
  const m = markerPine({ enter: s.enter, exit: s.exit, hold: s.hold, side: 'long', name: 'dip', rule: 'rsi < 30 and funding < 0 exit rsi > 50 hold 24', coin: 'SOL', interval: '4h' })
  expect(m?.left).toEqual(['funding < 0'])
  const code = m?.code ?? ''
  expect(code).toMatch(/^\/\/ Written with the DaviddTech Aid rules/)
  expect(code).toContain('//@version=6')
  expect(code).toContain('opens_if = ta.rsi(close, 14) < 30')
  expect(code).not.toMatch(/^opens_if = .*funding/m)
  expect(code).toContain('// Left out, watched by the desk only (not the tested rule): funding < 0')
  expect(code).toContain('if barstate.isconfirmed')
  expect(code).toContain('    else if closes_if or bar_index - opened_at >= 24')
  expect(code).toContain('alertcondition(opened, "opens"')
  expect(code).toContain('alertcondition(closed, "closes"')
  expect(code).not.toMatch(BANNED_WORDS)
  const cross = spec('ema 20 crosses below ema 50 hold 6 short')
  expect(markerPine({ enter: cross.enter, exit: null, hold: 6, side: 'short', name: 'x', rule: '', coin: 'BTC', interval: '1h' })?.code).toContain('opens_if = ta.crossunder(ta.ema(close, 20), ta.ema(close, 50))')
  // Only what the desk reads: no marker at all.
  const only = spec('funding < 0 hold 24')
  expect(markerPine({ enter: only.enter, exit: null, hold: 24, side: 'long', name: 'x', rule: '', coin: 'BTC', interval: '1h' })).toBe(null)
})

const part = (n: number, avg: number) => ({ n, winShare: 0.55, avg, total: avg * n, maxDrawdown: -0.05, hold: 0, tStat: 2, trades: [] })
function result(o: { survives: boolean; seenN?: number; unseen?: { n: number; held: boolean; avg: number } }): SwarmResult {
  const s = spec('rsi < 30 hold 12')
  return {
    rows: [{ spec: s, words: 'rsi < 30 hold 12 fee 0.045', seen: part(o.seenN ?? 60, 0.003), t: 2, p: 0.01, survives: o.survives }],
    unseenP: o.unseen ? { p: 0.01, held: o.unseen.held, best: 'rsi < 30 hold 12 fee 0.045', n: o.unseen.n, avg: o.unseen.avg, earlier: 0 } : null,
    few: (o.seenN ?? 60) < 30 ? 1 : 0,
  } as unknown as SwarmResult
}
const coinRow = (coin: string, held: boolean) => ({ coin, r: { unseen: part(40, held ? 0.002 : -0.001), luck: { survives: held } } }) as never

test('the verdict is worked out in code, with every way it can fall', () => {
  expect(verdictOf(result({ survives: false, seenN: 12 }), null).kind).toBe('few')
  expect(verdictOf(result({ survives: false }), null).kind).toBe('seen-no')
  expect(verdictOf(result({ survives: true, unseen: { n: 20, held: true, avg: 0.01 } }), null).kind).toBe('unseen-few')
  expect(verdictOf(result({ survives: true, unseen: { n: 40, held: false, avg: 0.01 } }), null).kind).toBe('unseen-no')
  expect(verdictOf(result({ survives: true, unseen: { n: 40, held: true, avg: -0.001 } }), null).kind).toBe('unseen-no')
  const home = result({ survives: true, unseen: { n: 40, held: true, avg: 0.002 } })
  expect(verdictOf(home, ['BTC', 'ETH', 'XRP', 'DOGE'].map((c, i) => coinRow(c, i < 2))).kind).toBe('home-only')
  const passed = verdictOf(home, ['BTC', 'ETH', 'XRP', 'DOGE'].map((c, i) => coinRow(c, i < 3)))
  expect(passed.kind).toBe('passed')
  expect(passed.held).toBe(3)
  expect(passed.best?.words).toBe('rsi < 30 hold 12 fee 0.045')
})

function runOf(v: Verdict): Run {
  return {
    name: 'dip',
    rule: 'rsi < 30 hold 12',
    coin: 'SOL',
    interval: '4h',
    side: 'long',
    venue: 'Binance',
    fee: 0.0005,
    from: NOW - 900 * 24 * H,
    to: NOW,
    versions: 17,
    few: 2,
    verdict: v,
    isRule: true,
    luck: ['Luck check across all 17 (…): luck alone gives the strongest of the 17 this strong about 31% of the time.'],
    mood: null,
    cases: 140,
    pinned: 30,
    marker: { file: 'workshop/dip/marker.pine', left: [] },
    aid: 'DaviddTech Aid check: 96/100.',
    since: NOW,
    tries: { total: 57, resets: 1 },
    version: 'Lab desk 1.4.0',
    judging: 'judging files 0a1b2c3d (unchanged)',
    folder: 'workshop/dip',
  }
}

test('every card, idea file and picture is free of the words the desk never prints, whatever the verdict', () => {
  const best = result({ survives: true }).rows[0] ?? null
  const kinds: Verdict[] = [
    { kind: 'passed', best, others: [{ coin: 'BTC', held: true, note: 'held' }, { coin: 'ETH', held: true, note: 'held' }, { coin: 'XRP', held: true, note: 'held' }, { coin: 'DOGE', held: false, note: 'no better than luck' }], held: 3 },
    { kind: 'home-only', best, others: [{ coin: 'BTC', held: true, note: 'held' }], held: 1 },
    { kind: 'home-only', best, others: [], held: 0 },
    { kind: 'unseen-no', best, others: [], held: 0 },
    { kind: 'unseen-few', best, others: [], held: 0 },
    { kind: 'seen-no', best: null, others: [], held: 0 },
    { kind: 'few', best: null, others: [], held: 0 },
  ]
  for (const v of kinds) {
    const run = runOf(v)
    const text = cardText(run, '/lab-workshop check')
    expect(text).not.toMatch(BANNED_WORDS)
    expect(text).toMatch(/^Next: /m)
    expect(text).toContain('Tries on SOL, all intervals: 57 (kept for good; 1 desk reset seen)')
    expect(verdictLine(run)).toMatch(v.kind === 'passed' ? /^Passed the history checks/ : /^Not (passed|judged)/)
    const svg = cardSvg(run, text)
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1200" height="675"/)
    expect(svg).not.toMatch(BANNED_WORDS)
    expect(svg).not.toContain('Luck check')
  }
  expect(verdictLine(runOf(kinds[2] as Verdict))).toContain('the other coins could not be checked just now')
  expect(cardText(runOf(kinds[2] as Verdict), '/lab-workshop check')).toContain('Next: say go again later')
  // Nothing judged: the verdict says why once, with no "too few" fragment or luck line saying it again.
  const few = cardText(runOf(kinds[6] as Verdict), '/lab-workshop check')
  expect(few).not.toContain('had too few trades to judge')
  expect(few).not.toContain('Luck check')
  expect(cardText(runOf(kinds[5] as Verdict), '/lab-workshop check')).toContain(' 2 had too few trades to judge.')
  // Too few trades on Hyperliquid's own candles: the next step is the years of history.
  expect(cardText({ ...runOf(kinds[6] as Verdict), moreHistory: true }, '/lab-workshop check')).toMatch(/^Next: the same idea on years of Binance history \(the card again with deep on/m)
  expect(few).toMatch(/^Next: a looser open condition/m)
  // A short rule says "short" once; a long warm-up says where the read began, a short one says nothing.
  const short = { ...runOf(kinds[5] as Verdict), side: 'short' as const, rule: 'rsi > 75 exit rsi < 50 short' }
  expect(cardSvg(short, cardText(short, '/lab-workshop check'))).toContain('>SOL 4h · rsi &gt; 75 exit rsi &lt; 50 short</text>')
  expect(cardSvg(runOf(kinds[5] as Verdict), '')).toContain('>SOL 4h long · rsi &lt; 30 hold 12</text>')
  const warmed = { ...runOf(kinds[5] as Verdict), readFrom: NOW - 1500 * 24 * H }
  expect(cardText(warmed, '/lab-workshop check')).toMatch(/ on Binance \(read from \d{4}-\d\d-\d\d; the candles before \d{4}-\d\d-\d\d only warm up its averages\), fee /)
  expect(cardText({ ...warmed, readFrom: NOW - 950 * 24 * H }, '/lab-workshop check')).not.toContain('read from')
  // The picture: the name alone up top (40 characters fit), the rule cut to fit, no line wider than the card.
  const long = { ...runOf(kinds[0] as Verdict), name: 'x'.repeat(40), rule: `${'close > ema 200 and '.repeat(8)}rsi < 30 hold 12` }
  const pic = cardSvg(long, cardText(long, '/lab-workshop check'))
  expect(pic).toContain(`>${'x'.repeat(40)}</text>`)
  expect(pic).toContain('…</text>')
  for (const m of pic.matchAll(/font-size="(\d+)"[^>]*>([^<]*)<\/text>/g)) expect(Number(m[1]) * 0.5 * (m[2] ?? '').replace(/&\w+;/g, '_').length).toBeLessThan(1120)
  const idea = ideaFile({ name: 'dip', idea: 'RSI dips in an uptrend bounce', source: 'my own', rule: 'rsi < 30 hold 12', coin: 'SOL', interval: '4h', side: 'long', venue: 'Binance', versions: ['rsi < 24 hold 12'], left: [], others: ['BTC', 'ETH', 'XRP', 'DOGE'], at: NOW })
  expect(idea).toContain('Written 2026-11-16 12:00 UTC, before the run.')
  expect(idea).not.toMatch(BANNED_WORDS)
})

test('the bench keeps a rule\'s first date; the lasting try count never drops, a reset adds all the desk counts again', () => {
  const row = { name: 'dip', words: 'rsi < 30 hold 12', coin: 'SOL', interval: '4h', deep: true, since: 1000 }
  const once = benchAdd([], row)
  expect(benchAdd(once, { ...row, since: 9000 })).toEqual([row])
  expect(benchAdd(once, { ...row, words: 'rsi < 25 hold 12', since: 9000 })[0]?.since).toBe(9000)
  let book = lastingNext({ resets: 0, coins: {} }, { SOL: 40 }, false)
  expect(book.coins.SOL?.total).toBe(40)
  book = lastingNext(book, { SOL: 52, BTC: 3 }, false)
  expect(book.coins.SOL?.total).toBe(52)
  // After a reset the desk counts from 0 again: those tries are new, the old ones stay.
  book = lastingNext(book, { SOL: 10 }, true)
  expect(book.coins.SOL?.total).toBe(62)
  expect(book.coins.BTC?.total).toBe(3)
  expect(book.resets).toBe(1)
  expect(fingerprint('')).toBe('811c9dc5')
  expect(fingerprint('a')).toBe('e40c292c')
})

test('on noise: the card first (nothing counted), then the run says not passed, writes its files and puts the rule on the bench', { timeoutMs: 120_000 }, async ($, on) => {
  engine(on, { candles: coin => rowsOf(walk(2500, seedOf(coin), false), coin) })
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  const files = folders(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const call = async (input: Record<string, unknown>) => String((await $.tool.call({ tool: TOOL, ...input } as never)).result ?? '')
  expect(await call({ action: 'run', name: 'dip' })).toMatch(/^Workshop: no idea card named "dip"\. The card comes first/)
  const card = await call({ action: 'card', name: 'Dip', rule: 'rsi < 30 exit rsi > 50', idea: 'RSI dips bounce', source: 'my own', coin: 'ETH', interval: '1h', deep: false })
  expect(card).toMatch(/^Workshop idea card: dip\. Nothing has run and nothing is counted yet\.$/m)
  expect(card).toMatch(/^Rule: rsi < 30 exit rsi > 50 on ETH 1h, long\.$/m)
  // The test market lists BTC ETH SOL HYPE kPEPE, so three other coins from the fixed list.
  expect(card).toMatch(/checked on BTC, SOL, HYPE at 2x the fee, and passes at 3 of 3\./)
  expect(card).toMatch(/each a try on ETH, judged together with every earlier try on ETH 1h \(none yet\)\./)
  expect(card).not.toMatch(BANNED_WORDS)
  expect(store.get('triesTotal')).toBe(undefined)
  expect(fileOf(files, 'workshop/dip/idea.md')).toMatch(/^# dip\n/)
  expect(fileOf(files, '/data/lab-desk/workshop/cards.json')).toContain('"rule": "rsi < 30 exit rsi > 50"')
  const text = await call({ action: 'run', name: 'dip' })
  expect(text).toMatch(/^Workshop: dip, built and tested \(ETH 1h, long\)\.$/m)
  expect(text).toMatch(/^Not (passed|judged)/m)
  expect(text).toMatch(/^Tested: \d+ versions of your idea/m)
  expect(text).toMatch(/^Tries on ETH, all intervals: \d+ \(kept for good\)\. Lab desk/m)
  expect(text).toMatch(/^Files: workshop\/dip\/ \(idea\.md, card\.md, card\.svg, result\.json, marker\.pine\)\.$/m)
  expect(text).toMatch(/^Next: /m)
  expect(text).toMatch(/^Market data: Hyperliquid public API$/m)
  expect(text.match(/^Next: /gm)?.length).toBe(1)
  expect(text).not.toMatch(BANNED_WORDS)
  expect(fileOf(files, 'workshop/dip/marker.pine')).toContain('alertcondition(opened, "opens"')
  expect(JSON.parse(fileOf(files, 'workshop/dip/result.json')).verdict).not.toBe('passed')
  const bench = JSON.parse(fileOf(files, '/data/lab-desk/workshop/bench.json')) as { since: number }[]
  expect(bench.length).toBe(1)
  // The check scores the bench and counts no try.
  const tries = JSON.stringify([store.get('tries'), store.get('triesTotal'), store.get('ledger')])
  const check = await call({ action: 'check' })
  expect(check).toMatch(/^Workshop bench: 1 rule, each scored only on trades opened after its date/)
  expect(check).toMatch(/^· dip \(rsi < 30 exit rsi > 50 on ETH 1h, from 2026-11-16 1\d:00 UTC\): 0 forward trades so far; numbers at 30\.$/m)
  expect(JSON.stringify([store.get('tries'), store.get('triesTotal'), store.get('ledger')])).toBe(tries)
  // A second run keeps the bench date, and the same versions add no tries.
  const firstTries = /^Tries on ETH, all intervals: (\d+) /m.exec(text)?.[1]
  const again = await call({ action: 'run', name: 'dip' })
  expect(/^Tries on ETH, all intervals: (\d+) /m.exec(again)?.[1]).toBe(firstTries)
  expect(JSON.stringify(store.get('triesTotal'))).toBe(JSON.stringify((JSON.parse(tries) as unknown[])[1]))
  expect((JSON.parse(fileOf(files, '/data/lab-desk/workshop/bench.json')) as { since: number }[])[0]?.since).toBe(bench[0]?.since)
  // A desk reset keeps the bench (it lives in the data folder) and says so.
  const reset = (await $.command.run(typed('lab-chart', 'reset'))).text ?? ''
  expect(reset).toMatch(/ The Workshop bench \(1 rule\) and its try count stay, as they are yours/)
  expect(await call({ action: 'forget', name: 'dip' })).toMatch(/^Workshop: "dip" is off the bench\./)
  expect(await call({ action: 'check' })).toMatch(/^Workshop bench: empty\./)
  // The same name with another rule says it replaces the card; the person's own fee and side stay as they said them.
  expect(await call({ action: 'card', name: 'pair', rule: 'rsi < 30 exit rsi > 50', coin: 'ETH', interval: '1h', deep: false })).not.toContain('This replaces')
  const second = await call({ action: 'card', name: 'pair', rule: 'rsi > 70 exit rsi < 50 short fee 0.1', coin: 'ETH', interval: '1h', deep: false })
  expect(second).toMatch(/^This replaces the earlier card named pair \(rsi < 30 exit rsi > 50 on ETH 1h\); a different name keeps both\.$/m)
  expect(second).toMatch(/^Rule: rsi > 70 exit rsi < 50 short fee 0\.1 on ETH 1h\.$/m)
  expect(second).toMatch(/judged together with (the \d+ earlier tries|every earlier try) on ETH 1h/)
  expect(await call({ action: 'card', name: 'pair', rule: 'rsi > 70 exit rsi < 50 short fee 0.1', coin: 'ETH', interval: '1h', deep: false })).not.toContain('This replaces')
  // A forgotten card's idea file is still there, and the run says so instead of "no card".
  expect(await call({ action: 'run', name: 'dip' })).toMatch(/^Workshop: no card named "dip" is kept now \(forgotten, or it made room: the newest 20 are kept\), but its idea file is in workshop\/dip\/idea\.md\.\nNext: Claude makes the card again/)
  // The shelf keeps the newest 20 cards and says which one made room.
  let last = ''
  for (let i = 0; i < 20; i++) last = await call({ action: 'card', name: `shelf ${i}`, rule: 'rsi < 30 hold 12', coin: 'ETH', interval: '1h', deep: false })
  expect(last).toMatch(/^The newest 20 cards are kept, so pair made room \(its idea file stays in workshop\/\)\.$/m)
})

test('a planted pattern passes: held on the home coin and on the other coins at twice the fee, cases pinned, marker built', { timeoutMs: 180_000 }, async ($, on) => {
  engine(on, { candles: coin => rowsOf(walk(2500, seedOf(coin), 0.006), coin) })
  mock.clock(on, { now: NOW })
  memStore(on)
  const files = folders(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const call = async (input: Record<string, unknown>) => String((await $.tool.call({ tool: TOOL, ...input } as never)).result ?? '')
  expect(await call({ action: 'card', name: 'push', rule: PLANT, coin: 'BTC', interval: '1h', deep: false })).toMatch(/^Workshop idea card: push\./)
  const text = await call({ action: 'run', name: 'push' })
  expect(text).toMatch(/^Passed the history checks: your rule beat luck on BTC across every counted try, held on the unseen part, and held on 3 of 3 other coins at 2x the fee \(ETH held, SOL held, HYPE held\)\. Still only history\.$/m)
  expect(text).toMatch(/^Past cases: the open condition turned true \d+ times in the history read, the \d+ in view pinned on the chart \(layer "cases"\)\./m)
  expect(text).toMatch(/^Built: a TradingView marker with "opens" and "closes" alerts \(workshop\/push\/marker\.pine\)\. With the DaviddTech Aid connector added \(davidd\.link\/daviddtechaid\), the marker is checked by it too\.$/m)
  expect(text).toMatch(/^Next: paste workshop\/push\/marker\.pine into TradingView/m)
  expect(text.match(/^Next: /gm)?.length).toBe(1)
  expect(text).not.toMatch(BANNED_WORDS)
  expect(JSON.parse(fileOf(files, 'workshop/push/result.json')).verdict).toBe('passed')
  expect(fileOf(files, 'workshop/push/card.svg')).toContain('Passed the history checks')
})

test('the Workshop waits in bar replay, says so when Hyperliquid is down, and /lab-workshop fills the prompt for the card', async ($, on) => {
  const w = engine(on, { candles: coin => rowsOf(walk(600, seedOf(coin), false), coin) })
  mock.clock(on, { now: NOW })
  memStore(on)
  folders(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const help = (await $.command.run(typed('lab-workshop', ''))).text ?? ''
  expect(help).toMatch(/^The Workshop: your own trading idea/)
  expect(help).not.toMatch(BANNED_WORDS)
  expect((await $.command.run(typed('lab-workshop', 'SOL 4h: drops under the 200 EMA bounce'))).text).toMatch(/^Workshop ready in the prompt box/)
  expect(w.fills.at(-1)).toMatch(/^Workshop this idea: SOL 4h: drops under the 200 EMA bounce\. Use chart_workshop: write the idea card first/)
  await $.command.run(typed('lab-chart', 'BTC 1h'))
  await $.command.run(typed('lab-chart', 'replay'))
  expect(String((await $.tool.call({ tool: TOOL, action: 'card', name: 'x', rule: 'rsi < 30 hold 6', deep: false } as never)).result)).toMatch(/waits while bar replay is on/)
})

test('Hyperliquid down: a plain line, nothing kept', async ($, on) => {
  engine(on, { isFetchDown: true })
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  folders(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const text = String((await $.tool.call({ tool: TOOL, action: 'card', name: 'x', rule: 'rsi < 30 hold 6', deep: false } as never)).result)
  expect(text).toMatch(/^Hyperliquid is not answering just now/)
  expect(store.get('ws_cards')).toBe(undefined)
})

test('a young coin: on 1w the card says so at once, and a run with too few candles says nothing ran or counted', async ($, on) => {
  // 120 candles a week apart: all closed on 1w and on 4h alike.
  engine(on, { candles: coin => rowsOf(walk(120, seedOf(coin), false).map((k, i) => ({ ...k, t: NOW - (120 - i) * 168 * H })), coin) })
  mock.clock(on, { now: NOW })
  const store = memStore(on)
  folders(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const call = async (input: Record<string, unknown>) => String((await $.tool.call({ tool: TOOL, ...input } as never)).result ?? '')
  const weekly = await call({ action: 'card', name: 'young', rule: 'rsi < 30 hold 4', coin: 'HYPE', interval: '1w', deep: false })
  expect(weekly).toMatch(/^Workshop: HYPE 1w has only 120 closed candles on Hyperliquid, too few to test \(300 needed\), so no card was made\.\nNext: the same idea on 1d, or with deep on for years of Binance candles\.$/)
  expect(await call({ action: 'card', name: 'young', rule: 'rsi < 30 hold 4', coin: 'HYPE', interval: '4h', deep: false })).toMatch(/^Workshop idea card: young\./)
  const run = await call({ action: 'run', name: 'young' })
  expect(run).toMatch(/^Workshop: HYPE 4h has only 120 closed candles on Hyperliquid, too few to test \(300 needed\)\. Nothing ran and nothing is counted\.\nNext: the same idea on 1h, or the card again with deep on for years of Binance candles\.$/)
  expect(run).not.toMatch(BANNED_WORDS)
  expect(store.get('triesTotal')).toBe(undefined)
  // The hint names the first shorter interval with the candles, so a young coin is not sent on to a second no.
  expect([roomyInterval('1w', 78), roomyInterval('1w', 30), roomyInterval('1d', 40), roomyInterval('4h', 200), roomyInterval('1h', 5)]).toEqual(['1d', '4h', '1h', '1h', '1m'])
  // A left-out note that ends in a full stop gets just the one.
  const card = await call({ action: 'card', name: 'note', rule: 'rsi < 30 hold 4', coin: 'HYPE', interval: '4h', deep: false, left_out: 'the news filter.' })
  expect(card).toMatch(/^Left out \(no Lab words for it\): the news filter\.$/m)
})
