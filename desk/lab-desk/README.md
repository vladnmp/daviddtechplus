# Lab desk

The first piece of the Lab's trading desk inside Claude Code: see the market and read the DaviddTech+ forecast without opening TradingView or an exchange screen. Read-only: it places no orders and never reads keys or wallets. DaviddTech never trades or holds your money. If you trade, you connect your own exchange on your own machine and place your own orders.

## Install

In Claude Code:

```
/plugin marketplace add vladnmp/daviddtechplus
/plugin install lab-desk@daviddtechplus
```

Then open a new session.

**Or just ask Claude Code to do it.** Paste this into the chat:

> Install the Lab desk for me: run `claude plugin marketplace add vladnmp/daviddtechplus`, then `claude plugin install lab-desk@daviddtechplus` (if `claude` is not found, use the Claude Code program the CLAUDE_CODE_EXECPATH variable points to). Then tell me to open a new session and type /lab tour.

Claude runs the two commands (press Allow when it asks), and the desk is there in your next session. It works the same in the terminal and in the desktop app's Code tab. A note that 3 options are not set yet is fine: they start on their defaults (`/plugin configure lab-desk@daviddtechplus` changes them).

## Start here

Type `/lab`. It opens the BTC 1h chart and lists everything below. New here? `/lab tour` walks you through six steps in about two minutes (chart, a set of indicators, a fib, your own formula, a scan, bar replay), each next command already in the prompt box. After most desk commands the empty prompt box shows the next step dim: Tab takes it. Or just ask Claude: "show SOL 4h with RSI and the 200 EMA", "mark the support and resistance on BTC", "tell me when ETH gets to 2,000", "what happened after a golden cross on BTC 1d?".

## Indicators, marks, alerts, export

- **Indicators** (`/lab-ind ema 50, rsi`): SMA, EMA, Hull MA, Bollinger Bands, Keltner Channels, VWAP (restarts each UTC day), Donchian, Supertrend on the price; RSI, Stoch RSI, Stochastic, MACD, ADX (with +DI and -DI), ATR and OBV in panes under it. Type them the way you say them: `stoch rsi`, `kc 20 1.5`, `hull ma 55`, `dmi`. Up to 6 at once, 2 lower panes. One-press sets as chips under the chart: Trend (EMA 20/50/200), Momentum (RSI, MACD), Volatility (BB, ATR), Breakout (Donchian, VWAP), Supertrend, Strength (ADX, Stoch RSI). A lit chip takes its set off again. `/lab-ind remove ema` takes off every EMA, `/lab-ind clear` all of them, `/lab-ind help` lists every kind with its settings. New to one? `/lab-ind what rsi` says in plain words what it measures, how people usually read it, one thing to watch, and its value on your chart now. The math follows TradingView's `ta.*` functions (EMA started from the SMA, Wilder's RSI, ATR and DMI, biased standard deviation, Stoch RSI as `ta.stoch` of the RSI), so the values match TradingView's on the same candles. The list is kept for the next session.
- **Your own indicator** (`/lab-ind plot ta.ema(close, 20) - ta.ema(close, 50)`): write a formula in Pine and the desk paints it. A price level (an average, a midpoint, `close + 2 * ta.atr(14)`) draws on the chart; anything else gets its own pane. It reads `close`, `open`, `high`, `low`, `volume`, `hl2`, `hlc3`, `ohlc4`, numbers, `+ - * / ( )`, `ta.ema/sma/rma/wma/hma/vwma/rsi/cci/roc/mom/atr/stdev/highest/lowest/change` and `math.abs/max/min`, with the same math as the built-ins. Our own small reader, never run as code. The export keeps the formula as you wrote it. Ask Claude: "plot the gap between the 20 and 50 EMA".
- **Marks** (`/lab-mark 65000 resistance`, `/lab-mark 58000 60000 demand`): a dashed level or a shaded zone with its label, per coin, up to 12. Claude can draw them too, and can put a note on a candle when it explains one. `/lab-mark` lists them, `/lab-mark clear` removes this coin's.
- **Drawing tools** (`/lab-mark trend lows`, `/lab-mark fib`): a trend line through the last two swing lows (or `highs`), carried to the right edge, and a Fibonacci retracement over the recent swing (or `/lab-mark fib 58000 65000`), with TradingView's levels and the 0.5–0.618 band tinted. Ask Claude "draw a fib on the last swing" and it uses the same tools. Both come along in the Pine export.
- **Price alerts** (`/lab-alert BTC above 65000`, or `/lab-alert SOL 200` and the desk works out above or below): checked every 30 s while Claude Code is open, said once with a toast and a notification, then dropped. The alert price shows as a line on its coin's chart. `/lab-alert` lists them, `/lab-alert remove 1`, `/lab-alert clear`. Up to 10.
- **Condition alerts** (`/lab-alert SOL rsi < 30`, `/lab-alert ema 20 crosses above ema 50 on 4h`): the same words as a scan, checked on the latest candle every 30 s, said once. Refused if it is already true. Up to 3. Claude can set one too: "tell me when ETH RSI goes under 30".
- **Export** (`/lab-ind export pine` or `/lab-ind export python`): the chart's indicators as code. Pine Script v6 is written with the DaviddTech Aid rules, one script per pane (marks come along as lines), ready to paste into TradingView. Python fetches the same Hyperliquid candles and adds every indicator as a pandas column, with the same math as the chart.
- **Layouts** (`/lab-ind save swing`, `/lab-ind load swing`): keep a set of indicators under a name and put it on any coin or interval in one go, like TradingView's indicator templates. `/lab-ind layouts` lists them, `/lab-ind forget swing` drops one. Claude can do it too: "load my swing layout on SOL 4h".
- **Save** (`/lab-chart save`, or ask Claude "save this chart"): writes the chart as a picture (`lab-charts/btc_1h_<time>.svg`, opens in any browser), a card to post (`_card.svg`, 1200 x 675: coin, price, 24h change, the chart) and its numbers (`.csv`, every candle with every indicator column) into the folder you run Claude Code in.
- **Compare** (`/lab-chart compare ETH`, or ask Claude "how did ETH do against BTC this week?"): lays another coin over the chart as a % line, both starting 100 candles back, like TradingView's Compare. The legend reads it as % change; `/lab-chart compare off` takes it away.
- **Bar replay** (`/lab-chart replay`, or the Replay button): hides the last 100 candles (`replay 50`, or `replay 2026-11-20 08:00` UTC) so you can practise reading a chart without seeing what came next. Next (n) shows one more candle, `/lab-chart next 10` jumps, Live (x) or `/lab-chart replay off` goes back. Indicators, Claude's reads and saves all stop at the replay point, and the live price (pane, status line, watchlist), price alerts and the DaviddTech+ range wait until you are live again. Switching coin or interval ends the replay. Try: "quiz me on BTC 1h from 3 days ago".
- **Scan** (`/lab-scan rsi < 30`, `/lab-scan close > ema 200`, `/lab-scan ema 20 crosses above ema 50 on 4h`): checks one condition on the latest candle of the chart's coin and your watchlist (up to 6), one request at a time, and names the matches with their numbers. Each side is a short word (`rsi`, `ema 50`, `cci`, `atr`, `price`) or a Pine formula like `/lab-ind plot`. Or by name: `/lab-scan oversold`, `overbought`, `uptrend`, `downtrend`, `golden cross`, `death cross` (alerts take the names too: `/lab-alert SOL oversold`). Ask Claude: "which of my coins are oversold on 1h?". It waits while bar replay is on.
- **Claude paints anything.** Whatever Claude works out (a fair-value line, a z-score, the days a pattern showed up, the weeks of a news event) it can draw on your chart as a named layer: a line on the price or in its own pane, pins (▲ ▼ •) on candles, shaded spans. Each layer has a legend row and a CSV column, up to 8 per coin, kept for the next session. Ask: "plot a 24-candle median of the close as fair value", "pin every swing low of the last week", "take the layers off".
- **Claude sees the chart.** The desk gives Claude four tools: `chart` (open or switch the chart, paint indicators or layers, draw marks, set alerts, save), `chart_read` (the latest values, the last candles as CSV with every indicator column, or the export code), `chart_history` and `chart_test` (below). So "what does the MACD say on BTC 4h?" reads the real numbers on your screen.

## History lab

Questions about the past, answered on your own PC from up to 5,000 closed Hyperliquid candles (1h reaches about 7 months back, 4h about 2 years, 1d all of it) and the real hourly funding. Read once per session and kept in memory, nothing written to your folder. In bar replay they only see up to the replay point.

- **What happened after** (`/lab-after rsi < 30`, `/lab-after golden cross on 1d ahead 20`, or ask "what usually happens after BTC RSI drops under 30?"): every time the condition turned true (the first candle of each run, cases never overlapping), the move N candles later as a median, the middle half and the share up with its 95% range, next to the same numbers for any candle. Then the first and second half of the cases, to see if it held over time. Under 10 cases it gives no numbers, just the cases. Every case is pinned on the chart (layer "cases").
- **Moments like now** (`/lab-like`, `/lab-like ETH 4h`, or ask "when did the chart last look like this?"): the 10 past stretches shaped most like the last 20 closes, none overlapping, and what came after each. On the chart they are pinned and shaded where they happened, and what came after each is drawn to the right of the last candle, the middle path in bold (the DaviddTech+ range takes that spot when it shows).
- **Honest test** (`/lab-test rsi < 30 exit rsi > 50`, `/lab-test ema 20 crosses above ema 50 exit ema 20 crosses below ema 50 on 4h`, `/lab-test rsi > 70 hold 12 short`, or ask "would going long at RSI under 30 have worked on SOL?"): enter when one condition holds, exit when another does or after N candles, long or short, with Hyperliquid's fee (0.045% a side unless you say `fee 0.02`) and the real funding paid or got for every hour held. It is honest in four ways:
  - the first 70% of the history is the seen part, the last 30% the unseen part, and the unseen part is reported first;
  - each number in your conditions is moved 10-20% on the seen part, to see whether the result holds around your setting or only on it;
  - every different test you try on a coin counts (`3 tries on BTC 4h so far`), and the luck check gets stricter with each;
  - the luck check runs the same rule on the same unseen candles shuffled into random order, 199 times: "the rule did at least this well 11 of 199 times". A trade still open at the end counts at the latest close, never left out.

  The unseen trades are pinned on the chart (layer "test"). It never places an order.
- **Across coins** (`/lab-test rsi < 30 exit rsi > 50 across BTC ETH SOL`, or ask "does that hold on ETH and SOL too?"): the same test on 2 to 5 coins, a line per coin for its unseen part, then on how many it made money and how likely luck alone gives that many passing the luck check. Every coin counts as a try on that coin. The first read of a coin's funding takes a few seconds on 1h and up to half a minute on 4h or 1d; a note says so, then it is kept for the session. The fairest check of an idea: what holds on one coin only is usually luck.

## What it does

- **Chart pane** (`/lab-chart [coin] [interval]`): live Hyperliquid perp candles beside the chat. The header shows the last price, 24h change, funding (annualised: the hourly rate x 24 x 365), open interest and 24h volume. Under the chart:
  - a readout of the last candle (open, high, low, close, change, volume);
  - `<` and `>` move a cursor back through the candles (hotkeys `h` and `l`), and `Last` jumps back;
  - interval buttons `5m 15m 1h 4h 1d` (hotkeys `1` to `5`).

  The pane refreshes every 15 s (1m to 5m candles), 30 s (15m to 1h) or 60 s (longer). The refresh runs only while the pane is up and stops when it closes. `/lab-chart close` closes it. `/lab-chart reset` closes it, turns the watchlist off and wipes everything the desk saved.
- **DaviddTech+ range on the chart**: when you open a chart, the desk asks DaviddTech+ (`analyze_asset`, e.g. `BTC/USD`, 5 or 20 days) once. It draws the 50% and 80% ranges and a thin middle path to the right of the last candle. Under the buttons, up to three rows say it in words: the 80% range in prices ("80% range 92,700 to 101,600 · 1 in 10 ends above 101,600, 1 in 10 below 92,700 (5 days)"), then a dim legend for the darker 50% shade and the middle (or the second half of the range line when the pane is narrow). Each row is cut to the pane's width, never wrapped. The answer is kept 6 hours, so refreshes and interval changes don't ask again. If DaviddTech+ isn't connected, the chart still works and a short note with the connector URL says how to add it. A missing or failed answer is asked again after a minute when you show the chart again, and changing `forecastHorizon` asks for the new horizon. The desk sends the coin's live Hyperliquid price as `price_now`, so the range and its prices start at that price, the same numbers DaviddTech+ gives in chat (k-coins such as kPEPE included: the price sent is the chart's own). The desk finds DaviddTech+ by its `analyze_asset` tool, then tries `claude.ai DaviddTech+` and `daviddtechplus`.
- **Guest accounts**: before the range, the desk reads the free `get_usage` (only the tier and the requests left; the email in it is never kept). A guest sees `Guest account: the DaviddTech+ range uses 1 daily request (2 of 3 left today).` and a `Show range (1 request)` button; nothing is spent until it is pressed. Members see the range at once, as before.
- **Watchlist above the prompt** (`/lab-watch [coins]`): up to 6 coins with price and 24h change, BTC ETH SOL HYPE by default, refreshed every 30 s. Press a coin to open its chart. The list is kept for later sessions. `/lab-watch off` hides it.
- **Status line**: `Lab desk READ-ONLY · as of 14:32:05 UTC · BTC 65,137 -1.2% · funding +10.95%/yr`. It says `loading` before the first data and `stale 2m` once two refresh periods pass with no new data (one failed refresh is not enough).
- **Stale data**: the same two-period rule adds a row under the readout (`Stale 2m · the error · retrying every 30 s`), shows `stale 2m` as the widget's second line, and adds `stale 2m` to the watchlist. Each is plain words in a grey outline, never a color, so it can't be mistaken for the orange down candles of the colorblind palette. It looks the same in light and dark mode.

Nothing fetches until you run `/lab-chart` or `/lab-watch`. A watchlist you set earlier comes back at the next session start and resumes its 30 s refresh then; `/lab-watch off` stops that. Market data comes from the Hyperliquid public info API (`POST https://api.hyperliquid.xyz/info`, no key). The pane footer says so, with the time of the data: `READ-ONLY · as of 14:32:05 UTC · Market data: Hyperliquid public API` (`loading` before the first data). Under it: an `Ask about BTC` button, which puts a ready question in the prompt box ("Analyze BTC/USD with DaviddTech+ for the next 5 days at the live price 65,137 (price_now)."; press Enter to send it), and the source line.

## Try it / Stop it

**Try it.** Install it (above), then type:

```
/lab-chart BTC 1h
/lab-watch BTC ETH SOL HYPE
```

**Stop it.** `/lab-chart close` closes the chart and `/lab-watch off` hides the watchlist. To remove the desk, `/plugin uninstall lab-desk@daviddtechplus`.

**What stays behind.** Only a small saved note that just the desk reads: your watchlist (if you used `/lab-watch`), your indicators, layouts, marks, alerts and layers, the honest test's try count per coin, and the last DaviddTech+ range per coin (kept 6 hours, so a reopened chart doesn't ask again). It does nothing on its own. To leave nothing at all, type `/lab-chart reset` before you uninstall. No other files are written, except the `lab-charts/` files you ask for with save.

To try it for one window only from a copy of this folder, without installing: `claude --plugin-dir "<this folder>"`.

Settings (`/config`, under lab-desk):
- `forecast`: on or off. Default on.
- `forecastHorizon`: 5 or 20 days.
- `palette`: `classic` (teal up, red down) or `colorblind` (blue up, orange down, a grey range). Default classic.

Check and test:

```
claude plugin validate "<this folder>"
claude plugin test "<this folder>"
```

## Terminal vs desktop

- **Terminal**: the chart is a `Raster`, a grid of cells drawn with block and box characters.
  - Candles are a heavy stroke for the body and a light one for the wick, to half a row, so each stands apart from the next as on TradingView.
  - The DaviddTech+ ranges are shade characters in one blue ink: light shade for the 80% range, medium shade for the 50% range, a thin line for the middle path.
  - The price axis is on the right with round levels (64,000, 62,000), the last price marked; the first and last candle times are below.
  - Under 40 columns the chart turns into a close-price line drawn in braille dots, with a shorter readout. A pane under 20 columns or 4 chart rows shows the readout without the chart.
- **Desktop app, VS Code, phone**: the chart is an SVG in the style of a TradingView chart, following the app's light or dark theme.
  - Filled candles on a dark or light panel, a round-number price grid, volume bars along the bottom, the last price as a dotted line with its tag on the scale. The colorblind palette draws up candles hollow.
  - Indicators are lines and soft fills over the candles; oscillators (RSI, Stoch RSI, MACD, ADX, ATR, OBV) get panes under the chart, the 0-100 ones with their guide band. A legend at the top names each one with its color.
  - Hovering a candle draws a crosshair with the time and price, and the legend shows that candle's OHLC and every indicator's value.
  - The DaviddTech+ ranges are see-through bands with a thin middle line to the right of the last candle. Hovering a band shows its name.
- **Terminal indicators**: price indicators are braille dots in the cells the candles leave free, with a legend row above the chart; oscillators take 6-row panes under it (the panes give way first when the pane is short). Marks are dashed rows with their label, zones two dotted edges, notes a ▼ over the candle, fib levels dotted rows, a trend line • dots.
- In the desktop app's small widget form, the pane shows just the coin's price, change and funding (or `stale 2m` in a grey outline).

The commands are `/lab`, `/lab-chart`, `/lab-ind`, `/lab-mark`, `/lab-alert`, `/lab-scan`, `/lab-watch`, `/lab-after`, `/lab-like` and `/lab-test`, not `/lab-desk:chart`. A command a mod registers in code can't have a colon in its name.

## Roadmap

This is the "See + Read" layer of the Lab's north star, the trading desk inside Claude Code, with the first of "Prove" in it (the history lab and the honest test). Next come Build and Run (a testnet runner, then a panel that shows your own positions from your own exchange connection). The desk itself stays read-only: orders are always yours to place.

© 2026 DaviddTech. All rights reserved.
