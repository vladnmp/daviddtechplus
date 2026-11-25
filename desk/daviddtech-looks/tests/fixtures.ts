// Fake tool results shaped like the real ones: DaviddTech+ market_backdrop (markdown from backdrop.py's
// render_backdrop, structured from BackdropResult) and DaviddTech Aid check_pine (the dict from checker.py's
// check_pine, which FastMCP sends as JSON text).

function backdropMd(levels: readonly [string, number][]): string {
  const rows = levels.map(
    ([symbol, level]) =>
      `| ${symbol} | ${symbol} | 2026-11-13 | +0.40% / -1.10% / +2.30% | normal (48) | above avg, avg rising | 31.0% vs 24.0% (1.29x), storm ${level} |`,
  )
  const line = `Storm levels: ${levels.map(([symbol, level]) => `${symbol} ${level}`).join(', ')}.`

  return [
    '## DaviddTech+ Market Backdrop: 3 reference markets',
    'Data: end-of-day; each market as of its last completed session; rows are sessions (days for crypto).',
    [
      '| Market | Symbol | As of | Change 1 / 5 / 20 | Volatility (1y pct) | 200-row trend | Swing 5 (x usual), storm |',
      '|---|---|---|---|---|---|---|',
      ...rows,
    ].join('\n'),
    line,
    'Next scheduled events: US jobs report on 2026-12-04 at 08:30 ET.',
    'Storm level: the chance of bigger-than-usual moves over the next 5 sessions against its usual rate.',
    '*Source: DaviddTech+ (skool.com/daviddtech/about)*',
  ].join('\n\n') + '\n'
}

export const BACKDROP_STORM = backdropMd([
  ['SPY', 4],
  ['QQQ', 4],
  ['BTC/USD', 3],
])
export const BACKDROP_WINDY = backdropMd([
  ['SPY', 3],
  ['QQQ', 2],
  ['BTC/USD', 2],
])
export const BACKDROP_CALM = backdropMd([
  ['SPY', 1],
  ['QQQ', 2],
  ['BTC/USD', 2],
])

export const BACKDROP_STRUCTURED = {
  product: 'DaviddTech+ Market Backdrop',
  markets: [
    { symbol: 'SPY', label: 'S&P 500', asof: '2026-11-13', swing_5d: { chance_pct: 31, usual_pct: 24, vs_usual: 1.29, storm_level: 5 } },
    { symbol: 'QQQ', label: 'Nasdaq 100', asof: '2026-11-13', swing_5d: { chance_pct: 22, usual_pct: 24, vs_usual: 0.92, storm_level: 1 } },
    { symbol: 'BTC/USD', label: 'Bitcoin', asof: '2026-11-15', swing_5d: null },
  ],
}

function aid(counts: { red: number; orange: number; yellow: number }, score: number): string {
  const findings = [
    ...Array.from({ length: counts.red }, (_, i) => ({ rule: 'lookahead_on', severity: 'red', line: 12 + i, why: 'Reads future bars.', fix: 'lookahead = barmerge.lookahead_off' })),
    ...Array.from({ length: counts.orange }, (_, i) => ({ rule: 'calc_on_every_tick', severity: 'orange', line: 3 + i, why: 'Live fills differ from the backtest.', fix: 'calc_on_every_tick = false' })),
    ...Array.from({ length: counts.yellow }, (_, i) => ({ rule: 'no_slippage', severity: 'yellow', line: 2 + i, why: 'No slippage.', fix: 'slippage = 2' })),
  ]

  return JSON.stringify({
    verdict:
      counts.red > 0
        ? "Fix the red items first: as written, the backtest can't be trusted."
        : 'No issues found by the code check.',
    score,
    counts,
    kind: 'strategy',
    findings,
    reminders: [],
    severity_meaning: { red: 'The backtest is wrong.', orange: 'Live differs.', yellow: 'Flatters the backtest.' },
    not_checked: 'Market logic.',
    next_step: 'Apply the fixes, then run check_pine again until red and orange are gone.',
    source: 'DaviddTech Aid (skool.com/daviddtech/about)',
  })
}

export const AID_RED = aid({ red: 1, orange: 1, yellow: 0 }, 58)
export const AID_CLEAN = aid({ red: 0, orange: 0, yellow: 0 }, 100)
export const AID_YELLOW = aid({ red: 0, orange: 0, yellow: 2 }, 90)
export const AID_ERROR = JSON.stringify({ error: 'Send the full Pine Script in `code`.', source: 'DaviddTech Aid (skool.com/daviddtech/about)' })

export const BACKDROP_TOOL = 'mcp__claude_ai_DaviddTech___market_backdrop'
export const AID_TOOL = 'mcp__claude_ai_DaviddTech_Aid__check_pine'

// The real market_backdrop text from 2026-11-16 (rows trimmed to the table and the storm line): storm levels all
// 1-2, yet four markets in stressed volatility and crypto down about 20% in 20 sessions.
export const BACKDROP_REAL_2026_11_16 = [
  '| Market | Symbol | As of | Close | Change 1 / 5 / 20 | Volatility (1y pct) | 200-row trend | Swing 5 (x usual), storm |',
  '|---|---|---|---|---|---|---|---|',
  '| US large caps | SPY | 2026-11-13 | 754.37 | -0.36% / +2.59% / -1.16% | stressed (99) | above avg, avg rising | 7.1% vs 23.6% (0.30x), storm 1 |',
  '| US tech-heavy | QQQ | 2026-11-13 | 679.89 | -1.20% / +3.63% / -4.21% | stressed (99) | below avg, avg rising | 8.1% vs 23.6% (0.34x), storm 1 |',
  '| US small caps | IWM | 2026-11-13 | 277.54 | -0.32% / +1.41% / +2.63% | stressed (95) | below avg, avg rising | 8.3% vs 23.6% (0.35x), storm 1 |',
  '| long-term US Treasuries | TLT | 2026-11-13 | 79.38 | -0.43% / -3.10% / -0.42% | stressed (96) | below avg, avg falling | 11.0% vs 23.6% (0.47x), storm 1 |',
  '| gold | GLD | 2026-11-13 | 355.45 | +0.16% / -4.58% / -6.95% | normal (68) | below avg, avg falling | 9.1% vs 23.6% (0.39x), storm 1 |',
  '| US dollar index fund | UUP | 2026-11-13 | 29.5 | +0.27% / +1.27% / +2.01% | normal (65) | above avg, avg rising | 16.5% vs 23.6% (0.70x), storm 2 |',
  '| bitcoin | BTC/USD | 2026-11-14 | 64128.1 | -6.04% / -14.75% / -19.86% | elevated (82) | below avg, avg rising | 20.7% vs 24.9% (0.83x), storm 2 |',
  '| ether | ETH/USD | 2026-11-14 | 1769.12 | -8.22% / -17.00% / -23.97% | normal (69) | below avg, avg falling | 26.8% vs 24.9% (1.08x), storm 2 |',
  '',
  'Storm levels: SPY 1, QQQ 1, IWM 1, TLT 1, GLD 1, UUP 2, BTC/USD 2, ETH/USD 2.',
].join('\n')
