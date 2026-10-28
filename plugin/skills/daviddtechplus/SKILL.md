---
name: daviddtechplus
description: DaviddTech+ market data routines for US stocks, ETFs, FX and crypto (forecast ranges, levels with touch chances, volatility, storm levels, swing odds, DCA pacing and the market backdrop) through the DaviddTech+ connector. Fits requests about how markets look today, a watchlist, an after-close routine, what changed since the last close, a calm or stormy week, earnings week for a stock, which symbols on a list moved almost as one, DCA check-ins or a journal of the member's own rules.
---

# DaviddTech+

Quantitative Alpha Briefs for US stocks, ETFs, currency pairs and crypto pairs: forecast ranges for the next 1-20 steps from a forecasting system, with volatility, trend, key levels and the chance each is touched, a benchmark comparison and scenarios, in percent from the last close. Each brief presents numbers and neutral metric definitions; the interpretation is the assistant's.

Connector: `DaviddTech+` in claude.ai under Settings > Connectors, URL `https://vlad-64070--daviddtech-plus.modal.run/mcp`, signed in with
the member's DaviddTech+ email. Without the connector these routines have no data to read.

## Tools and daily units
- `analyze_asset` (1 daily unit): One asset in depth: the full Alpha Brief (forecast path, 1/5/20-step view, levels with touch chances, volatility, trend, benchmark, scenarios).
- `level_odds` (1 daily unit): The odds at the member's own prices (1-10 levels or % moves) by a day or date: the chance each is touched by then, the chance the close ends beyond it and the touch chance by day; free when the symbol's brief was pulled today.
- `scan_assets` (1 daily unit): 1-10 symbols side by side in one table: median move, 80% range and width, volatility, nearest levels with touch chances, beta; sorted by range width. For 2+ symbols, a same-bet check: how strongly they moved together lately vs usually, pairs that moved almost as one and how many independent bets they moved like.
- `dca_pacing` (1 daily unit): 1-10 symbols: market-side multipliers of a usual recurring (DCA) contribution (steady, dip, defensive profiles) with their readings, tested trade-offs vs plain DCA, the rules as tested and, for 1-3 symbols, 52 weekly rows as CSV.
- `market_backdrop` (free): How markets look today: eight reference markets (SPY, QQQ, IWM, TLT, GLD, UUP, BTC, ETH) with 1/5/20-session change, volatility regime, 200-row trend state and 5-session swing odds vs usual, plus the next scheduled events.
- `get_capabilities` (free): This overview.
- `get_recipe` (free): Ready routines that chain these tools (after-close desk, watchlist triage, storm check, rule journal, DCA check-in, earnings week, night desk, same-bet check): the list, or one in full.
- `list_supported_assets` (free): Symbol formats, examples and market hours per asset type.
- `get_usage` (free): The member's daily limit, requests left today and when the count resets.

Daily units: a brief, a scan (up to 10 symbols) or a DCA pacing call is 1 unit each; re-reading a brief already pulled today (same symbol, horizon and data) is free; the market backdrop, capabilities, recipes, the supported list and the usage check are free. Data refreshes after each close: stocks, ETFs and FX after the New York close, crypto days at 00:00 UTC.

## Recipes
Opt-in routines that chain the tools. The member picks one; the assistant reads its file (or calls
`get_recipe` with its name) and runs the steps with the member's own symbols and rules.

- [After-close desk](recipes/after_close_desk.md): A short end-of-day read of the member's own list: market mood, the list in one table, details only where the member wants them.
- [Watchlist triage](recipes/watchlist_triage.md): Sort a list of up to 10 symbols into calm, normal and stormy groups before looking closer.
- [Storm check](recipes/storm_check.md): How bumpy the coming week could be: the market first, then the member's own symbols.
- [Rule journal](recipes/rule_journal.md): The member's own rules, written in plain words over brief fields, checked after each close and logged with the values used.
- [DCA check-in](recipes/dca_check_in.md): For members investing a set amount on a schedule: the pacing reading per symbol at their usual time.
- [Earnings week](recipes/earnings_week.md): A single stock around its next earnings report: what the estimated date means for its odds.
- [Night desk](recipes/night_desk.md): A daily after-close review of the member's watchlist: what changed since the last briefs, with details only where something moved.
- [Same-bet check](recipes/same_bet.md): Which symbols on the member's list moved almost as one, and how many independent bets the list moved like, lately vs usually.

## Reading the numbers
- Every figure is in percent from the last close, at the stated horizon (steps are trading sessions for
  stocks, ETFs and FX, calendar days for crypto).
- Storm level 1-5: the 5-step swing chance as a multiple of its usual rate (1 under 0.7x calm, 2 normal, 3 from 1.15x choppy, 4 from 1.55x stormy, 5 from 2x very stormy); the size of moves only, up or down alike.
- Briefs present numbers and neutral definitions; the interpretation, and any decision, stays with the
  member.

*Source: DaviddTech+ (skool.com/daviddtech/about)*
