# DaviddTech+ charts

A Claude Code mod that draws your last DaviddTech+ forecast as a chart, in a pane beside the chat.

Ask for a forecast as usual ("Analyze NVDA with DaviddTech+"). When the answer comes back, the mod reads it and draws:

- **analyze_asset**: the forecast fan (80% range, a thin middle line) with the levels and their touch odds. Under the chart, in the same box, the 80% range in words: "80% range -6.1% to +8.0% · 1 in 10 ends above +8.0%, 1 in 10 below -6.1% (10 sessions)". A narrow pane gets a shorter form or two lines, never a wrapped one. The card view shows the numbers and levels; ask for the full brief to see the fan.
- **level_odds**: touch odds by day, one line per level, up to the end date.
- **plan_check**: each plan's exits, with bars for "profit exit 1 first" and "loss exit first" (if opened).
- **scan_assets**: each symbol's 80% range and middle, side by side.

The summary above the prompt and the hover text lead with the 80% range, then the middle.

It never calls a DaviddTech+ tool by itself, so it never uses one of your daily requests. It only reads answers you asked for.

## Install

In Claude Code:

```
/plugin marketplace add vladnmp/daviddtechplus
/plugin install daviddtech-charts@daviddtechplus
```

Then open a new session.

## What draws where

| Where | What you see |
| --- | --- |
| Desktop app | The pane opens by itself as a sidebar, with a sharp chart (hover a day for its numbers). |
| Mobile app | The same chart in the pane. |
| Terminal | A chart drawn with shade characters in one blue ink (light shade 80% range, medium shade 50% range, a thin line for the middle, a dotted zero line), levels on top, labels on the right, dates below. On a narrow screen the pane waits: use the **Chart** button in the line above the prompt, or `/daviddtech-chart`. |
| VS Code | The chart as a picture in the pane (no hover numbers, no line above the prompt). |

After each new forecast, a one-line summary sits above the prompt with **Chart** and **Hide** buttons (terminal, desktop and mobile).

## Commands

- `/daviddtech-chart`: open the chart pane with the last forecast (it also comes back in later sessions).
- `/daviddtech-chart close`: close the pane.

## Settings

In `/config`:

- **Open the chart pane** (`autoOpen`): `sidebar` (default) opens by itself only where it fits beside the chat (the desktop app, or a fullscreen terminal at least 144 columns wide); `always` tries every time; `never` waits for the command.
- **Line above the prompt** (`band`): `on` (default) or `off`.

## Try it

It works with the DaviddTech+ connector from claude.ai, or a local DaviddTech+ server.

```
claude --plugin-dir "<this folder>"
```

Or, for a session the desktop app starts, name the folder in `CLAUDE_CODE_PLUGIN_DIRS` (in your environment or the `env` block of `~/.claude/settings.json`).

Then try: "Analyze NVDA with DaviddTech+", then "Odds on +5% and -4% by the end date", then `/daviddtech-chart`.

## Checks

```
claude plugin validate "<this folder>"
claude plugin test "<this folder>"
```

Source: DaviddTech+ (skool.com/daviddtech/about)
