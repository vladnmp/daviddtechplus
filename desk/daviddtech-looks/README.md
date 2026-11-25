# DaviddTech looks

Animated looks for Claude Code, drawn in the Claude desktop and mobile apps.

- **Winter**: a night sky, falling snow in three depths, a string of warm lights across the top, pine trees in the bottom corners.
- **Market weather**: a sky that follows how rough the DaviddTech+ reference markets are now. Calm is a soft blue sky with a sun glow, windy has fast clouds and wind streaks, stormy has rain and a lightning flash.
- **Pine**: a pine forest with slow mist. After a DaviddTech Aid check it glows red (red items found) or green (clean) for a moment.

Each look comes with its own colors for light and dark mode, and the app's panels are frosted over the scene. Things that move together (each depth of snow or rain, the wind streaks, the lights) move as one group, to go easy on the battery.

## Install

In Claude Code:

```
/plugin marketplace add vladnmp/daviddtechplus
/plugin install daviddtech-looks@daviddtechplus
```

Then open a new session.

## Commands

```
/daviddtech-looks winter
/daviddtech-looks weather
/daviddtech-looks pine
/daviddtech-looks off       back to the app's own look
/daviddtech-looks           the options and the look you have now
```

Your choice is saved and comes back in every new session. `off` clears it, and so does picking another mod's look (so this one never paints over it later). `off` changes nothing when no DaviddTech look is on.

## What draws where

| Where | What you get |
| --- | --- |
| Desktop app | The moving scene and its colors, with frosted panels |
| Mobile app | The scene under one soft veil, and its colors |
| Terminal and VS Code | No scene and no colors (these screens keep their own). You still get the DaviddTech Aid result in the status line (`Aid: red · 58/100`), a short toast when the sky changes while the weather look is on, and the command's own text |
| Anywhere | Permission prompts keep the app's own look |

## Where the data comes from

- **Market weather** uses the free DaviddTech+ `market_backdrop` tool (no daily request). The look reads it once when you pick it and the last reading is 6 hours old or more, once a few seconds into a new session in the same case, and again whenever your AI calls that tool.
- **Two readings move the sky.** The first reading sets it. After that, one different reading only waits; the sky changes when a second reading at least 6 hours later agrees. From calm, a windy reading then a stormy one move the sky to windy first, and the storm waits for one more reading; two stormy readings move it straight to stormy, with no stop at windy (and two calm readings take a stormy sky straight back to calm). Readings on opposite sides (one calmer, one rougher) leave it as it is. A new session shows the saved sky while a reading saw it in the last 36 hours, else calm; after 36 hours the next reading sets the sky at once. The toast (`Market weather: now windy`) comes only when the sky shown changes. While a reading waits, `/daviddtech-looks weather` says so: "The sky is calm. The latest reading was windy; the sky changes when the next reading agrees."
- **How rough is rough.** Stormy: two or more markets at storm level 4+, any at 5, or half the markets (at least 3) in stressed volatility. Windy: any at storm level 3+, two markets elevated or stressed, or a market that moved 15% or more in 20 sessions. Else calm. Storm levels look ahead (will the next 5 sessions get rougher than the past 20?), so in a market that is already rough they read low; the volatility check covers that.
- **Pine glow and the status line** read the result of each DaviddTech Aid `check_pine` call your AI makes. Nothing is called on its own.
- Both need the DaviddTech+ or DaviddTech Aid connector (any server name containing "daviddtech").

Settings: `aidStatus` (`on` by default) turns the Aid line in the status bar on or off. The pine glow works either way.

## Try it

```
claude --plugin-dir "<this folder>"
```

Or name the folder in `CLAUDE_CODE_PLUGIN_DIRS` (for a session the desktop app starts). Then run `/daviddtech-looks winter`, and try `/daviddtech-looks weather` after asking your AI for the DaviddTech+ market weather.

## Checks

```
claude plugin validate "<this folder>"
claude plugin test "<this folder>"
```

Source: DaviddTech+ (skool.com/daviddtech/about)
