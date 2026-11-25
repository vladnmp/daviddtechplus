// Fake DaviddTech+ answers, written the way the server renders them
// (brief/render.py, server/odds.py, plans.py, scan.py) and the structured
// content it sends beside them (the shapes widget.py reads).

export const SESSIONS = [
  '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20',
  '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-27', '2026-11-30',
]

const two = (v: number) => Number(v.toFixed(2))
const sign = (v: number) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(2)}`

/** The forecast path, step 1..10, already at the server's 2 decimals. */
export const PATH = SESSIONS.map((session, k) => {
  const i = k + 1
  const f = Math.sqrt(i / 10)
  return {
    step: i, session,
    p10: two(-6.1 * f), p25: two(-2.6 * f), p50: two(1.2 * (i / 10)), p75: two(4.1 * f), p90: two(8 * f),
    prob_up: Number((0.5 + 0.06 * (i / 10)).toFixed(3)),
  }
})

const csvRows = PATH.map(p =>
  [p.step, p.session, ...[p.p10, p.p25, p.p50, p.p75, p.p90].map(v => (v + 0).toFixed(2)), p.prob_up.toFixed(3)].join(','),
).join('\n')

export const BRIEF_MD = `Note: read "nvidia" as NVDA.

## DaviddTech+ Alpha Brief: NVDA (equity), next 10 trading sessions
**Slightly upward lean, moderate conviction.** Central path +1.20% by session 10, 80% range -6.10% to +8.00%, P(up) 0.560.
*Working with this brief: the numbers are a range of outcomes, not a call.*
Data: end-of-day; reference = 2026-11-13 close (=612.4).
Last sessions (day change): 2026-11-12 -0.80% (=609.1), 2026-11-13 +0.54% (=612.4).

### What changed since 2026-11-06 (5 steps)
- Close +2.10% since then, inside the earlier 80% range (-5.20% to +6.90%).

### Forecast path — spreadsheet-ready CSV (% from the reference close)
\`\`\`csv
step,session,p10,p25,p50,p75,p90,prob_up
${csvRows}
\`\`\`
Price = reference × (1 + %/100); reference = 2026-11-13 close (=612.4).

### By horizon
- Session 1 (2026-11-16): p50 +0.12%, 80% range -1.93% to +2.53%, P(up) 0.506
- Session 5 (2026-11-20): p50 +0.60%, 80% range -4.31% to +5.66%, P(up) 0.530

### Agreement
**Medium (61/100)**; 3 of 4 lean up. The parts of the system mostly agree.

### Volatility and trend
- **Volatility: normal.** Daily moves sit near their usual size.
- **Trend: up.** 20-session +4.10%, 60-session +9.80%; 3.20% above the 50-day average; 6.10% below the 52-week high, 48.00% above the low.

### Levels (% from reference)
- Resistance: +5.00% major (=643.02, swing high 12 sessions ago) — touch 41%; +8.20% (=662.62, 52-week high) — touch 18%
- Support: -3.00% (=594.03, swing low 6 sessions ago) — touch 47%; -9.50% major (=554.22, 200-day average) — touch 3%
- **Break level (upward lean) -4.00% (=587.9) — touch 35%:** A close below this level ends the upward lean.

### Scenarios by session 10
- **Base**, likely: the range holds.

### How to read
- The fan is the 80% range; the middle line is the median path.

*Source: DaviddTech+ (skool.com/daviddtech/about)*
`

/** The structured content beside BRIEF_MD (same numbers). */
export const BRIEF_JSON = {
  product: 'DaviddTech+ Alpha Brief',
  instrument: { symbol: 'NVDA', asset_class: 'equity' },
  horizon: { steps: 10, unit: 'trading sessions', sessions: SESSIONS },
  data: { last_session: '2026-11-13', reference_price: 612.4 },
  headline: { lean: 'slightly upward', expected_move_pct: 1.2, range_80_pct: [-6.1, 8.0], prob_up_at_horizon: 0.56 },
  forecast_path: PATH,
  levels: {
    resistances: [
      { kind: 'resistance', pct_from_reference: 5.0, price: 643.02, strength: 'major', basis: 'swing high 12 sessions ago', touch_probability: 0.41 },
      { kind: 'resistance', pct_from_reference: 8.2, price: 662.62, strength: 'minor', basis: '52-week high', touch_probability: 0.18 },
    ],
    supports: [
      { kind: 'support', pct_from_reference: -3.0, price: 594.03, strength: 'minor', basis: 'swing low 6 sessions ago', touch_probability: 0.47 },
      { kind: 'support', pct_from_reference: -9.5, price: 554.22, strength: 'major', basis: '200-day average', touch_probability: 0.03 },
    ],
    invalidation: { pct_from_reference: -4.0, price: 587.9, applies_to: 'upward lean', rule: 'A close below this level ends the upward lean.', touch_probability: 0.35 },
  },
  source: 'Source: DaviddTech+ (skool.com/daviddtech/about)',
}

export const CARD_MD = `## NVDA: next 10 trading sessions (card)
**Slightly upward lean, moderate conviction.** 80% range -6.10% to +8.00%, central path +1.20%, P(up) 0.560; reference = 2026-11-13 close (=612.4).
- Storm level 3 of 5; volatility normal, typical daily move 2.10%.
- Nearest resistance +5.00% (=643.02) — touch 41%, support -3.00% (=594.03) — touch <1%.
- Break level (upward lean) -4.00% (=587.9) — touch 35%.
Ask for the full brief for the path, every level and the scenarios.
*Source: DaviddTech+ (skool.com/daviddtech/about)*
`

/** Touch chance by step for the three odds levels, ending at their touch chance. */
const TOUCH = { '650': 0.41, '560': 0.22, '1,000': 0.01 }
export const TOUCH_BY_STEP = Object.fromEntries(
  Object.entries(TOUCH).map(([k, end]) => [k, SESSIONS.map((_, j) => Number((end * Math.pow((j + 1) / 10, 1.3)).toFixed(3)))]),
) as Record<keyof typeof TOUCH, number[]>

const oddsCsv = SESSIONS.map(
  (s, j) => `${j + 1},${s},${(['650', '560', '1,000'] as const).map(k => TOUCH_BY_STEP[k][j]!.toFixed(3)).join(',')}`,
).join('\n')

export const ODDS_MD = `## NVDA odds by 30 Nov (10 trading sessions from the 13 Nov close = 612.4)

| Level | From close | Touch by 30 Nov | Finish beyond on 30 Nov |
|---|---|---|---|
| 650 | +6.14% | 41% | 22% (at or above) |
| 560 | -8.56% | 22% | 9% (at or below) |
| 1,000 | +63.29% | 1% | 0% (at or above) |

On 30 Nov: 80% range -6.10% to +8.00%, middle +1.20%, chance higher 56%.

Touch chance by step (CSV):
\`\`\`csv
step,session,touch 650,touch 560,touch 1,000
${oddsCsv}
\`\`\`

### How to read
- Touch: the chance the price trades at or beyond the level at some point by the end date.

Builds on this: a spreadsheet or chart of the chance by day.

*Source: DaviddTech+ (skool.com/daviddtech/about)*
`

export const ODDS_JSON = {
  product: 'DaviddTech+ Odds',
  symbol: 'NVDA', asset_class: 'equity', reference_date: '2026-11-13', reference_price: 612.4,
  steps: 10, step_unit: 'trading sessions', end_date: '2026-11-30', sessions: SESSIONS,
  levels: [
    { level: '650', price: 650, pct_from_reference: 6.14, side: 'above', touch_chance: 0.41, finish_beyond_chance: 0.22, touch_by_step: TOUCH_BY_STEP['650'] },
    { level: '560', price: 560, pct_from_reference: -8.56, side: 'below', touch_chance: 0.22, finish_beyond_chance: 0.09, touch_by_step: TOUCH_BY_STEP['560'] },
    { level: '1000', price: 1000, pct_from_reference: 63.29, side: 'above', touch_chance: 0.01, finish_beyond_chance: 0, touch_by_step: TOUCH_BY_STEP['1,000'] },
  ],
  range_80_at_end_pct: [-6.1, 8.0], middle_at_end_pct: 1.2, chance_higher_at_end: 0.56,
  how_to_read: [], related: '', source: 'Source: DaviddTech+ (skool.com/daviddtech/about)',
}

export const PLAN_MD = `## NVDA plan odds by 30 Nov (10 trading sessions from the 13 Nov close = 612.4)

### Plan 1 (up): opens at the last close, loss exit 590

| Level | From close | Reward-to-risk | Reached by 30 Nov | If opened |
|---|---|---|---|---|
| Profit exit 1: 650 | +6.14% | 1.68 | 31% | 31% |
| Profit exit 2: 680 | +11.04% | 3.02 | 12% | 12% |
| Loss exit: 590 | -3.66% | | 30% first | 30% first |

If opened: profit exit 1 first 44%, loss exit first 31%, neither by 30 Nov 25%.

Of the plans where profit exit 1 or the loss exit was reached: profit exit 1 first 59%; break-even share 37%.

Still open on 30 Nov: 25% of opened plans.

Decided inside one session: 4% of decided plans.

### Plan 2 (down): opens at 630, loss exit 645

Opens by 30 Nov: 52% (half of that by 18 Nov).

| Level | From close | Reward-to-risk | Reached by 30 Nov | If opened |
|---|---|---|---|---|
| Profit exit 1: 600 | -2.02% | 2 | 20% | 38% |
| Loss exit: 645 | +5.32% | | 18% first | 35% first |

If opened: profit exit 1 first 38%, loss exit first 35%, neither by 30 Nov 27%.

Still open on 30 Nov: 27% of opened plans.

Decided inside one session: 6% of decided plans.

### How to read
- Profit exit 1 first: the share of opened plans that reach profit exit 1 before the loss exit.

*Source: DaviddTech+ (skool.com/daviddtech/about)*
`

const HEAD =
  '| Symbol | Class | Reference close | p50 | 80% range | Width | Volatility (1y pct) | Forecast / realised vol | Nearest support (touch) | Nearest resistance (touch) | Beta | Swing 5 (x usual), storm | Since last |'

export const SCAN_MD = `## DaviddTech+ Scan: 3 symbols, 10 steps ahead

Sorted by range width. Steps: 10. Data: end-of-day; % from each symbol's reference close.

Scheduled events in this window: Fed decision 2026-11-25.

${HEAD}
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TSLA | equity | 2026-11-13 | +0.80% | -14.00% to +16.20% | 30.20 pts | elevated (81) | 62.0% / 58.1% | -5.10% (44%) | +6.30% (39%) | 1.90 vs SPY | 12.1% (1.30x), storm 4 | n/a |
| NVDA | equity | 2026-11-13 | +1.20% | -6.10% to +8.00% | 14.10 pts | normal (55) | 41.0% / 39.5% | -3.00% (47%) | +5.00% (41%) | 1.60 vs SPY | 7.9% (1.05x), storm 3 | n/a |
| BTC/USD | crypto | 2026-11-15 | -0.40% | -5.00% to +4.10% | 9.10 pts | calm (12) | 30.2% / 28.8% | -2.10% (52%) | +2.40% (49%) | n/a | n/a | n/a |

### How to read
- p50: the middle of the forecast at the end.

*Source: DaviddTech+ (skool.com/daviddtech/about)*
`

export const ERROR_TEXT = '{"error": "unknown_symbol", "message": "No data for ZZZZ."}'
