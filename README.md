# DaviddTech+ add-ons

Forecast ranges, key levels with the chance each is touched, volatility, storm levels and DCA pacing for US
stocks, ETFs, currency pairs and crypto, inside your own Claude. For members of
[DaviddTech+](https://www.skool.com/daviddtech/about); the data comes from the DaviddTech+ connector after you sign in with your
membership email.

## 1. The connector (once, for every Claude app)
Add the connector once in claude.ai: Settings > Connectors > Add custom connector, name `DaviddTech+`, URL `https://vlad-64070--daviddtech-plus.modal.run/mcp`, keep the detected options, then Connect and sign in with the email of the DaviddTech+ membership (the sign-in page then asks to allow access). It then works in claude.ai, the desktop and mobile apps and Claude Code. In claude.ai chats, set + > Connectors > Tool access to Tools already loaded so Claude uses it by itself. On a Team or Enterprise plan an organization owner adds it.

## 2. Claude Code extras (optional)
```
/plugin marketplace add vladnmp/daviddtechplus
/plugin install daviddtechplus@daviddtechplus
```
Then open a new session and type `/daviddtechplus-weather`. Ready routines as slash commands:
- `/daviddtechplus:desk`: A short end-of-day read of the member's own list: market mood, the list in one table, details only where the member wants them.
- `/daviddtechplus:triage`: Sort a list of up to 10 symbols into calm, normal and stormy groups before looking closer.
- `/daviddtechplus:storm`: How bumpy the coming week could be: the market first, then the member's own symbols.
- `/daviddtechplus:journal`: The member's own rules, written in plain words over brief fields, checked after each close and logged with the values used.
- `/daviddtechplus:dca`: For members investing a set amount on a schedule: the pacing reading per symbol at their usual time.
- `/daviddtechplus:earnings`: A single stock around its next earnings report: what the estimated date means for its odds.
- `/daviddtechplus:night`: A daily after-close review of the member's watchlist: what changed since the last briefs, with details only where something moved.
- `/daviddtechplus:recipes`: every routine in one line.

Details: [plugin/README.md](plugin/README.md).

## 3. The skill (optional)
`skill/daviddtechplus` holds the same routines as an Agent Skill, for apps that load skill folders.

## What is in here
No data and no keys: text that tells your assistant how to use the DaviddTech+ connector, slash
commands, and a small read-only module for the Claude Code weather report.

*Source: DaviddTech+ (skool.com/daviddtech/about)*
