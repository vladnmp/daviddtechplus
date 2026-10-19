# DaviddTech+ for Claude Code

DaviddTech+ in Claude Code, on top of the DaviddTech+ connector from claude.ai: ready routines as slash commands (after-close desk, storm check, watchlist triage, rule journal, DCA check-in, earnings week) and a market weather report with storm levels.

## Install
1. The connector (once, for every Claude app). Add the connector once in claude.ai: Settings > Connectors > Add custom connector, name `DaviddTech+`, URL `https://vlad-64070--daviddtech-plus.modal.run/mcp`, keep the detected options, then Connect and sign in with the email of the DaviddTech+ membership (the sign-in page then asks to allow access). It then works in claude.ai, the desktop and mobile apps and Claude Code. On a Team or Enterprise plan an organization owner adds it.
2. Add the DaviddTech+ marketplace, then install the plugin:
   `/plugin marketplace add DaviddTech/daviddtechplus`
   `/plugin install daviddtechplus@daviddtechplus`
3. Open a new session and run `/daviddtechplus-weather`.

Claude Code signed in with an API key instead of a claude.ai account has no claude.ai connectors: add it
there with `claude mcp add --transport http daviddtechplus https://vlad-64070--daviddtech-plus.modal.run/mcp`, then sign in under `/mcp`.

## Slash commands (ready routines)
- `/daviddtechplus:recipes`: every routine in one line.
- `/daviddtechplus:desk <symbols, e.g. NVDA AMD BTC>`: A short end-of-day read of the member's own list: market mood, the list in one table, details only where the member wants them.
- `/daviddtechplus:triage <up to 10 symbols>`: Sort a list of up to 10 symbols into calm, normal and stormy groups before looking closer.
- `/daviddtechplus:storm [symbols, optional]`: How bumpy the coming week could be: the market first, then the member's own symbols.
- `/daviddtechplus:journal [symbols or a rule in plain words]`: The member's own rules, written in plain words over brief fields, checked after each close and logged with the values used.
- `/daviddtechplus:dca <symbols> [usual amount]`: For members investing a set amount on a schedule: the pacing reading per symbol at their usual time.
- `/daviddtechplus:earnings <stock symbol>`: A single stock around its next earnings report: what the estimated date means for its odds.

## Market weather (Claude Code 2.1.287 or later)
- `/daviddtechplus-weather`: the storm levels of eight reference markets, stormiest first, with what they mean and
  what to try next, with no model turn and no daily unit. With the `band` option on `auto` (the default) the
  short line appears in the status line when a session starts, refreshed at most every 6 hours.
- `/daviddtechplus-units`: daily units left today. Still free: the market backdrop, ready routines (recipes), the capabilities overview and briefs already pulled today.

The weather line is a small read-only module: it calls only the free DaviddTech+ tools (`market_backdrop`,
`get_usage`) through your DaviddTech+ connector, found by its tools whatever its name, keeps the last
reading in the plugin's own store and
writes no files. Set `band` to `off` in the plugin options to turn it off.

## Costs
Daily units: a brief, a scan (up to 10 symbols) or a DCA pacing call is 1 unit each; re-reading a brief already pulled today (same symbol, horizon and data) is free; the market backdrop, capabilities, recipes, the supported list and the usage check are free. Data refreshes after each close: stocks, ETFs and FX after the New York close, crypto days at 00:00 UTC.

*Source: DaviddTech+ (skool.com/daviddtech/about) — Informational only, not financial advice.*
