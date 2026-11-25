---
description: "Plan check. How the member's own trade plans on one symbol could play out by a day: the chance each opens, which exit comes first and how often each profit exit is reached."
argument-hint: "<symbol and plan, e.g. NVDA open 180, loss exit 172, profit exits 190 200, by Friday>"
---

Please run the DaviddTech+ plan check recipe for this plan: $ARGUMENTS. Look up its live price yourself first and pass it as price_now, then show the chance it opens, which exit comes first and how often each profit exit is reached, with the levels as prices.
The get_recipe tool (name "plan_check") has its steps, what it shows and its cost in daily requests. At the end, one line on routines that pair well with this one: Close check (/daviddtechplus:desk) and Rule journal (/daviddtechplus:journal).
