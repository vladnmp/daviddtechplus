// The chart's indicators (and marks) as code to take elsewhere: Pine Script v6 for TradingView, Python for a
// notebook or a backtest. Same math as the chart (TradingView ta.* conventions). Pure: no `$`.

import type { Mark } from '../types'
import type { Spec } from './indicators'
import type { Node } from './formula'
import { LAB_SERIES, PY_FORMULA_HELPERS, parseFormula, printFormula, pythonFormula } from './formula'
import type { Condition } from './history'
import { paneOf, specLabel, specsOf } from './indicators'
import { fibPrices } from './marks'
import type { Scan } from './scan'
import { INKS } from './svg'

const AID_LINE = '// Written with the DaviddTech Aid rules (skool.com/daviddtech/about)'
const CHECKS =
  '// Checks: v6 · indicator only, no orders, so no costs or size · no higher timeframes · no future data · nothing live-only · no alerts'
const UP = '#26a69a'
const DOWN = '#ef5350'

export type ExportLang = 'pine' | 'python'

/** The line between two Pine scripts in one export. */
export const EXPORT_SPLIT = '// ---- next script: paste as its own indicator ----'

/** "ema 50" → "ema_50", "bb 20 2" → "bb_20_2", "supertrend 10 2.5" → "supertrend_10_2_5". */
function varName(spec: Spec): string {
  // Pine has a built-in `vwap`; the desk's is the day's.
  if (spec.kind === 'vwap') return 'vwap_day'
  // A formula: a short name from its text, the same for the same formula.
  if (spec.kind === 'plot') {
    let h = 5381
    for (const ch of spec.expr ?? '') h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0
    return `plot_${h.toString(36).slice(0, 5)}`
  }
  return [spec.kind, ...spec.params.map(p => String(p).replace('.', '_'))].join('_')
}

/** Line studies take ink slots 1-4 in order, Supertrend its own two: as the chart does. */
function inksFor(specs: readonly Spec[]): Map<Spec, string> {
  const out = new Map<Spec, string>()
  let slot = 0
  for (const s of specs) if (s.kind !== 'supertrend') out.set(s, INKS.classic[slot++ % 4] ?? '#8d8d99')
  return out
}

const num = (n: number) => String(Number(n.toPrecision(10)))

function pricePine(s: Spec, ink: string): string[] {
  const v = varName(s)
  const label = specLabel(s)
  const p = s.params
  switch (s.kind) {
    case 'plot':
      return [`${v} = ${s.expr ?? 'close'}`, `plot(${v}, "${label}", color = ${ink}, linewidth = 2)`]
    case 'sma':
    case 'ema':
      return [`${v} = ta.${s.kind}(close, ${p[0]})`, `plot(${v}, "${label}", color = ${ink}, linewidth = 2)`]
    case 'bb':
      return [
        `[${v}_basis, ${v}_upper, ${v}_lower] = ta.bb(close, ${p[0]}, ${num(p[1] ?? 2)})`,
        `${v}_u = plot(${v}_upper, "${label} upper", color = ${ink})`,
        `plot(${v}_basis, "${label} basis", color = color.new(${ink}, 40))`,
        `${v}_l = plot(${v}_lower, "${label} lower", color = ${ink})`,
        `fill(${v}_u, ${v}_l, color = color.new(${ink}, 92))`,
      ]
    case 'donchian':
      return [
        `${v}_upper = ta.highest(high, ${p[0]})`,
        `${v}_lower = ta.lowest(low, ${p[0]})`,
        `${v}_u = plot(${v}_upper, "${label} upper", color = ${ink})`,
        `plot((${v}_upper + ${v}_lower) / 2, "${label} middle", color = color.new(${ink}, 40))`,
        `${v}_l = plot(${v}_lower, "${label} lower", color = ${ink})`,
        `fill(${v}_u, ${v}_l, color = color.new(${ink}, 92))`,
      ]
    case 'hma':
      return [`${v} = ta.hma(close, ${p[0]})`, `plot(${v}, "${label}", color = ${ink}, linewidth = 2)`]
    case 'keltner':
      // TradingView's Keltner Channels: EMA basis, bands at mult × ta.atr(atrLength).
      return [
        `${v}_basis = ta.ema(close, ${p[0]})`,
        `${v}_range = ta.atr(${p[2]})`,
        `${v}_upper = ${v}_basis + ${num(p[1] ?? 2)} * ${v}_range`,
        `${v}_lower = ${v}_basis - ${num(p[1] ?? 2)} * ${v}_range`,
        `${v}_u = plot(${v}_upper, "${label} upper", color = ${ink})`,
        `plot(${v}_basis, "${label} basis", color = color.new(${ink}, 40))`,
        `${v}_l = plot(${v}_lower, "${label} lower", color = ${ink})`,
        `fill(${v}_u, ${v}_l, color = color.new(${ink}, 92))`,
      ]
    case 'vwap':
      return [`${v} = ta.vwap(hlc3)`, `plot(${v}, "VWAP", color = ${ink}, linewidth = 2)`]
    case 'supertrend':
      return [
        `[${v}, ${v}_dir] = ta.supertrend(${num(p[1] ?? 3)}, ${p[0]})`,
        `plot(${v}_dir < 0 ? ${v} : na, "${label} under price", color = ${INKS.classic[4]}, style = plot.style_linebr, linewidth = 2)`,
        `plot(${v}_dir > 0 ? ${v} : na, "${label} over price", color = ${INKS.classic[5]}, style = plot.style_linebr, linewidth = 2)`,
      ]
    default:
      return []
  }
}

function lowerPine(s: Spec, ink: string): string[] {
  const v = varName(s)
  const label = specLabel(s)
  const p = s.params
  switch (s.kind) {
    case 'plot':
      return [`${v} = ${s.expr ?? 'close'}`, `plot(${v}, "${label}", color = ${ink}, linewidth = 2)`]
    case 'rsi':
      return [
        `${v} = ta.rsi(close, ${p[0]})`,
        `plot(${v}, "${label}", color = ${ink}, linewidth = 2)`,
        'hline(70, "70", color = color.gray, linestyle = hline.style_dotted)',
        'hline(50, "50", color = color.new(color.gray, 60), linestyle = hline.style_dotted)',
        'hline(30, "30", color = color.gray, linestyle = hline.style_dotted)',
      ]
    case 'macd':
      return [
        `[${v}_line, ${v}_avg, ${v}_hist] = ta.macd(close, ${p[0]}, ${p[1]}, ${p[2]})`,
        `${v}_grows = ${v}_hist > nz(${v}_hist[1])`,
        `plot(${v}_hist, "hist", style = plot.style_columns, color = ${v}_hist >= 0 ? (${v}_grows ? ${UP} : color.new(${UP}, 50)) : (${v}_grows ? color.new(${DOWN}, 50) : ${DOWN}))`,
        `plot(${v}_line, "MACD", color = ${ink}, linewidth = 2)`,
        `plot(${v}_avg, "avg ${p[2]}", color = color.new(${ink}, 50))`,
        'hline(0, "0", color = color.gray, linestyle = hline.style_dotted)',
      ]
    case 'atr':
      return [`${v} = ta.atr(${p[0]})`, `plot(${v}, "${label}", color = ${ink}, linewidth = 2)`]
    case 'stochrsi':
    case 'stoch': {
      const lines =
        s.kind === 'stochrsi'
          ? [`${v}_rsi = ta.rsi(close, ${p[2]})`, `${v}_raw = ta.stoch(${v}_rsi, ${v}_rsi, ${v}_rsi, ${p[3]})`, `${v}_k = ta.sma(${v}_raw, ${p[0]})`, `${v}_d = ta.sma(${v}_k, ${p[1]})`]
          : [`${v}_raw = ta.stoch(close, high, low, ${p[0]})`, `${v}_k = ta.sma(${v}_raw, ${p[1]})`, `${v}_d = ta.sma(${v}_k, ${p[2]})`]
      return [
        ...lines,
        `plot(${v}_k, "%K", color = ${ink}, linewidth = 2)`,
        `plot(${v}_d, "%D", color = ${INKS.classic[3]})`,
        `${v}_hi = hline(80, "80", color = color.gray, linestyle = hline.style_dotted)`,
        'hline(50, "50", color = color.new(color.gray, 60), linestyle = hline.style_dotted)',
        `${v}_lo = hline(20, "20", color = color.gray, linestyle = hline.style_dotted)`,
        `fill(${v}_hi, ${v}_lo, color = color.new(${ink}, 94))`,
      ]
    }
    case 'adx':
      return [
        `[${v}_plus, ${v}_minus, ${v}_adx] = ta.dmi(${p[1]}, ${p[0]})`,
        `plot(${v}_adx, "ADX", color = ${ink}, linewidth = 2)`,
        `plot(${v}_plus, "+DI", color = ${UP})`,
        `plot(${v}_minus, "-DI", color = ${DOWN})`,
      ]
    case 'obv':
      return [`${v} = ta.obv`, `plot(${v}, "OBV", color = ${ink}, linewidth = 2)`]
    default:
      return []
  }
}

function marksPine(marks: readonly Mark[]): string[] {
  const out: string[] = []
  const text = (s: string) => s.replace(/["\\]/g, '')
  marks.forEach((m, k) => {
    if (m.kind === 'fib') {
      for (const f of fibPrices(m)) out.push(`hline(${num(f.price)}, "fib ${f.r}", color = color.new(color.orange, ${f.r === 0.5 || f.r === 0.618 ? 0 : 40}), linestyle = hline.style_dotted)`)
      return
    }
    if (m.kind === 'trend') {
      if (m.t === undefined || m.t2 === undefined || m.price2 === undefined) return
      out.push(`// Trend line through ${new Date(m.t).toISOString().slice(0, 16).replace('T', ' ')} and ${new Date(m.t2).toISOString().slice(0, 16).replace('T', ' ')} UTC, carried right`)
      out.push(`var line trend_${k} = line.new(${m.t}, ${num(m.price)}, ${m.t2}, ${num(m.price2)}, xloc = xloc.bar_time, extend = extend.right, color = color.gray, width = 2)`)
      return
    }
    if (m.kind === 'level') out.push(`hline(${num(m.price)}, "${text(m.label) || 'level'}", color = color.gray, linestyle = hline.style_dashed)`)
    else if (m.kind === 'zone') {
      out.push(`zone_${k}_lo = hline(${num(m.price)}, "${text(m.label) || 'zone'} low", color = color.new(color.gray, 50))`)
      out.push(`zone_${k}_hi = hline(${num(m.price2 ?? m.price)}, "${text(m.label) || 'zone'} high", color = color.new(color.gray, 50))`)
      out.push(`fill(zone_${k}_lo, zone_${k}_hi, color = color.new(color.gray, 90))`)
    } else if (m.t !== undefined) {
      out.push(`// ${new Date(m.t).toISOString().slice(0, 16).replace('T', ' ')} UTC on this timeframe`)
      out.push(`if time == ${m.t}`)
      out.push(`    label.new(bar_index, high, "${text(m.label)}", style = label.style_label_down, color = color.gray, textcolor = color.white)`)
    }
  })
  return out
}

function header(title: string, overlay: boolean): string[] {
  return [AID_LINE, '//@version=6', `indicator("${title}", overlay = ${overlay})`]
}

/**
 * Pine Script v6: one indicator for the price pane (its studies and the marks), then one per lower pane, as the
 * chart lays them out. Each block pastes into TradingView's Pine editor as its own script.
 */
export function pineScript(ids: readonly string[], coin: string, interval: string, marks: readonly Mark[] = []): string {
  const specs = specsOf(ids)
  const inks = inksFor(specs)
  const price = specs.filter(s => paneOf(s) === 'price')
  const lower = specs.filter(s => !price.includes(s))
  const blocks: string[][] = []
  if (price.length > 0 || marks.length > 0 || lower.length === 0) {
    const body = [...header(`Lab desk · ${coin} ${interval}`, true)]
    for (const s of price) body.push('', `// ${specLabel(s)}`, ...pricePine(s, inks.get(s) ?? '#8d8d99'))
    if (marks.length > 0) body.push('', '// Marks drawn on the desk', ...marksPine(marks))
    if (price.length === 0 && marks.length === 0) body.push('', '// No indicators on the chart yet: /lab-ind ema 50, rsi', 'plot(close, "close", color = color.gray)')
    body.push('', CHECKS)
    blocks.push(body)
  }
  for (const s of lower) {
    blocks.push([...header(`Lab desk · ${specLabel(s)}`, false), '', ...lowerPine(s, inks.get(s) ?? '#8d8d99'), '', CHECKS])
  }
  return blocks.map(b => b.join('\n')).join(`\n\n${EXPORT_SPLIT}\n\n`)
}

const PY_HEAD = `# Lab desk indicators: the same math as the chart (TradingView ta.* conventions).
# Needs Python 3.9+ and pandas (pip install pandas). Run: python {file}
# Candles: Hyperliquid public API, read-only. Source: DaviddTech+ (skool.com/daviddtech/about)
import json
import math
import time
import urllib.request

import pandas as pd

COIN, INTERVAL, CANDLES = "{coin}", "{interval}", 1000
MS = {"1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000, "1w": 604_800_000}


def fetch(coin=COIN, interval=INTERVAL, n=CANDLES):
    """The last n candles as a DataFrame indexed by UTC open time."""
    end = int(time.time() * 1000)
    req = {"coin": coin, "interval": interval, "startTime": end - n * MS[interval], "endTime": end}
    body = json.dumps({"type": "candleSnapshot", "req": req}).encode()
    r = urllib.request.Request("https://api.hyperliquid.xyz/info", data=body, headers={"Content-Type": "application/json"})
    rows = json.load(urllib.request.urlopen(r, timeout=20))
    df = pd.DataFrame(
        {k: [float(x[s]) for x in rows] for k, s in (("open", "o"), ("high", "h"), ("low", "l"), ("close", "c"), ("volume", "v"))},
        index=pd.to_datetime([x["t"] for x in rows], unit="ms", utc=True),
    )
    df.index.name = "time"
    return df


# ---- ta.* in plain Python (None where TradingView shows na) ----

def sma(src, n):
    out, s, k = [None] * len(src), 0.0, 0
    for i, v in enumerate(src):
        if v is None:
            s, k = 0.0, 0
            continue
        s += v
        k += 1
        if k > n:
            s -= src[i - n]
        if k >= n:
            out[i] = s / n
    return out


def _smooth(src, n, alpha):
    # Started from the SMA of the first n values, as ta.ema and ta.rma are.
    out, prev, seed, k = [None] * len(src), None, 0.0, 0
    for i, v in enumerate(src):
        if v is None:
            continue
        if prev is None:
            seed += v
            k += 1
            if k == n:
                prev = out[i] = seed / n
            continue
        prev = out[i] = alpha * v + (1 - alpha) * prev
    return out


def ema(src, n):
    return _smooth(src, n, 2 / (n + 1))


def rma(src, n):
    return _smooth(src, n, 1 / n)


def stdev(src, n):
    # Biased, as TradingView's Bollinger Bands use.
    mean = sma(src, n)
    return [None if m is None else math.sqrt(sum((src[k] - m) ** 2 for k in range(i - n + 1, i + 1)) / n) for i, m in enumerate(mean)]


def true_range(h, l, c):
    return [h[i] - l[i] if i == 0 else max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1])) for i in range(len(c))]


def rsi(src, n):
    up = [None] + [max(src[i] - src[i - 1], 0) for i in range(1, len(src))]
    down = [None] + [max(src[i - 1] - src[i], 0) for i in range(1, len(src))]
    u, d = rma(up, n), rma(down, n)
    out = []
    for a, b in zip(u, d):
        out.append(None if a is None or b is None else 100.0 if b == 0 else 0.0 if a == 0 else 100 - 100 / (1 + a / b))
    return out


def wma(src, n):
    out = [None] * len(src)
    for i in range(n - 1, len(src)):
        win = src[i - n + 1 : i + 1]
        if None not in win:
            out[i] = sum((k + 1) * x for k, x in enumerate(win)) / (n * (n + 1) / 2)
    return out


def hma(src, n):
    half, full = wma(src, max(1, n // 2)), wma(src, n)
    return wma([None if a is None or b is None else 2 * a - b for a, b in zip(half, full)], max(1, math.isqrt(n)))


def stoch(src, hi, lo, n):
    # ta.stoch: None where the window's range is 0, as Pine's x / 0 is na.
    out = [None] * len(src)
    for i in range(n - 1, len(src)):
        a, b = hi[i - n + 1 : i + 1], lo[i - n + 1 : i + 1]
        if src[i] is None or None in a or None in b or max(a) == min(b):
            continue
        out[i] = 100 * (src[i] - min(b)) / (max(a) - min(b))
    return out


def dmi(h, l, c, n, adx_n):
    """ta.dmi(n, adx_n): +DI, -DI and ADX."""
    plus_dm, minus_dm = [None], [None]
    for i in range(1, len(c)):
        up, down = h[i] - h[i - 1], l[i - 1] - l[i]
        plus_dm.append(up if up > down and up > 0 else 0.0)
        minus_dm.append(down if down > up and down > 0 else 0.0)
    trur = rma([None] + true_range(h, l, c)[1:], n)

    def held(dm):
        out, last = [], None
        for a, t in zip(rma(dm, n), trur):
            if a is None or t is None:
                out.append(None)
                continue
            if t != 0:
                last = 100 * a / t
            out.append(last)
        return out

    p, m = held(plus_dm), held(minus_dm)
    dx = [None if a is None or b is None else abs(a - b) / ((a + b) or 1) for a, b in zip(p, m)]
    return p, m, [None if x is None else 100 * x for x in rma(dx, adx_n)]


def obv(c, v):
    # ta.obv: volume added on a higher close, taken off on a lower one; 0 on the first candle.
    out, total = [0.0], 0.0
    for i in range(1, len(c)):
        total += ((c[i] > c[i - 1]) - (c[i] < c[i - 1])) * v[i]
        out.append(total)
    return out


def highest(h, n):
    return [None if i < n - 1 else max(h[i - n + 1 : i + 1]) for i in range(len(h))]


def lowest(l, n):
    return [None if i < n - 1 else min(l[i - n + 1 : i + 1]) for i in range(len(l))]


def vwap(t_ms, h, l, c, v):
    # Restarts each UTC day, typical price hlc3.
    out, day, pv, vol = [], None, 0.0, 0.0
    for i in range(len(c)):
        d = t_ms[i] // 86_400_000
        if d != day:
            day, pv, vol = d, 0.0, 0.0
        pv += (h[i] + l[i] + c[i]) / 3 * v[i]
        vol += v[i]
        out.append(pv / vol if vol > 0 else None)
    return out


def supertrend(h, l, c, n, factor):
    """ta.supertrend(factor, n) on hl2: the line, and side 1 when it is under price, -1 when over."""
    atr = rma(true_range(h, l, c), n)
    line, side = [None] * len(c), [None] * len(c)
    upper = lower = 0.0
    tv = prev_line = None
    for i in range(len(c)):
        a = atr[i]
        if a is None:
            continue
        mid = (h[i] + l[i]) / 2
        up, lo = mid + factor * a, mid - factor * a
        prev_close = c[i - 1] if i > 0 else c[i]
        if tv is not None:
            lo = lo if lo > lower or prev_close < lower else lower
            up = up if up < upper or prev_close > upper else upper
        if tv is None:
            tv = 1
        elif prev_line == upper:
            tv = -1 if c[i] > up else 1
        else:
            tv = 1 if c[i] < lo else -1
        upper, lower = up, lo
        prev_line = lo if tv == -1 else up
        line[i] = prev_line
        side[i] = 1 if tv == -1 else -1
    return line, side

${PY_FORMULA_HELPERS}

def add_studies(df):
    """The chart's indicators as columns."""
    h, l, c, v = (df[k].tolist() for k in ("high", "low", "close", "volume"))
    t_ms = [int(x.timestamp() * 1000) for x in df.index]
{body}
    return df.astype(float)


if __name__ == "__main__":
    data = add_studies(fetch())
    print(data.tail(10).round(4).to_string())
    data.to_csv("{csv}")
    print("Saved {csv}")
`

function pyLines(s: Spec): string[] {
  const v = varName(s)
  const label = specLabel(s)
  const p = s.params
  const col = (name: string) => JSON.stringify(name)
  switch (s.kind) {
    case 'plot': {
      const n = parseFormula(s.expr ?? 'close')
      return [
        'o = df["open"].tolist()',
        'hl2, hlc3 = [(a + b) / 2 for a, b in zip(h, l)], [(a + b + x) / 3 for a, b, x in zip(h, l, c)]',
        'ohlc4 = [(w + a + b + x) / 4 for w, a, b, x in zip(o, h, l, c)]',
        `df[${col(`plot ${s.expr ?? ''}`)}] = ${'error' in n ? 'c' : pythonFormula(n)}`,
      ]
    }
    case 'sma':
    case 'ema':
      return [`df[${col(label)}] = ${s.kind}(c, ${p[0]})`]
    case 'bb':
      return [
        `${v}_mid, ${v}_dev = sma(c, ${p[0]}), stdev(c, ${p[0]})`,
        `df[${col(label + ' upper')}] = [None if m is None else m + ${num(p[1] ?? 2)} * d for m, d in zip(${v}_mid, ${v}_dev)]`,
        `df[${col(label + ' basis')}] = ${v}_mid`,
        `df[${col(label + ' lower')}] = [None if m is None else m - ${num(p[1] ?? 2)} * d for m, d in zip(${v}_mid, ${v}_dev)]`,
      ]
    case 'donchian':
      return [
        `${v}_hi, ${v}_lo = highest(h, ${p[0]}), lowest(l, ${p[0]})`,
        `df[${col(label + ' upper')}] = ${v}_hi`,
        `df[${col(label + ' middle')}] = [None if a is None else (a + b) / 2 for a, b in zip(${v}_hi, ${v}_lo)]`,
        `df[${col(label + ' lower')}] = ${v}_lo`,
      ]
    case 'vwap':
      return [`df["VWAP"] = vwap(t_ms, h, l, c, v)`]
    case 'supertrend':
      return [`df[${col(label)}], df[${col(label + ' side')}] = supertrend(h, l, c, ${p[0]}, ${num(p[1] ?? 3)})`]
    case 'rsi':
      return [`df[${col(label)}] = rsi(c, ${p[0]})`]
    case 'atr':
      return [`df[${col(label)}] = rma(true_range(h, l, c), ${p[0]})`]
    case 'hma':
      return [`df[${col(label)}] = hma(c, ${p[0]})`]
    case 'keltner':
      return [
        `${v}_mid, ${v}_atr = ema(c, ${p[0]}), rma(true_range(h, l, c), ${p[2]})`,
        `df[${col(label + ' upper')}] = [None if m is None or a is None else m + ${num(p[1] ?? 2)} * a for m, a in zip(${v}_mid, ${v}_atr)]`,
        `df[${col(label + ' basis')}] = ${v}_mid`,
        `df[${col(label + ' lower')}] = [None if m is None or a is None else m - ${num(p[1] ?? 2)} * a for m, a in zip(${v}_mid, ${v}_atr)]`,
      ]
    case 'stochrsi':
      return [
        `${v}_rsi = rsi(c, ${p[2]})`,
        `${v}_k = sma(stoch(${v}_rsi, ${v}_rsi, ${v}_rsi, ${p[3]}), ${p[0]})`,
        `df[${col(label + ' %K')}] = ${v}_k`,
        `df[${col(label + ' %D')}] = sma(${v}_k, ${p[1]})`,
      ]
    case 'stoch':
      return [
        `${v}_k = sma(stoch(c, h, l, ${p[0]}), ${p[1]})`,
        `df[${col(label + ' %K')}] = ${v}_k`,
        `df[${col(label + ' %D')}] = sma(${v}_k, ${p[2]})`,
      ]
    case 'adx':
      return [`df[${col(label + ' +DI')}], df[${col(label + ' -DI')}], df[${col(label)}] = dmi(h, l, c, ${p[1]}, ${p[0]})`]
    case 'obv':
      return [`df["OBV"] = obv(c, v)`]
    case 'macd':
      return [
        `${v}_line = [None if a is None or b is None else a - b for a, b in zip(ema(c, ${p[0]}), ema(c, ${p[1]}))]`,
        `${v}_avg = ema(${v}_line, ${p[2]})`,
        `df[${col(label + ' MACD')}] = ${v}_line`,
        `df[${col(label + ` avg ${p[2]}`)}] = ${v}_avg`,
        `df[${col(label + ' hist')}] = [None if a is None or b is None else a - b for a, b in zip(${v}_line, ${v}_avg)]`,
      ]
  }
}

/** A Python file that fetches the same candles and adds the chart's indicators as DataFrame columns. */
export function pythonScript(ids: readonly string[], coin: string, interval: string): string {
  const specs = specsOf(ids)
  const file = `lab_${coin.toLowerCase().replace(/[^a-z0-9]/g, '')}_${interval}`
  const body = specs.length > 0 ? specs.flatMap(pyLines).map(l => '    ' + l).join('\n') : '    pass  # no indicators on the chart yet: /lab-ind ema 50, rsi'
  return PY_HEAD.replaceAll('{file}', `${file}.py`)
    .replaceAll('{coin}', coin)
    .replaceAll('{interval}', interval)
    .replaceAll('{csv}', `${file}.csv`)
    .replace('{body}', body)
}

/** The file name a person would save it as. */
export function exportFile(lang: ExportLang, coin: string, interval: string): string {
  return `lab_${coin.toLowerCase().replace(/[^a-z0-9]/g, '')}_${interval}.${lang === 'pine' ? 'pine' : 'py'}`
}

/** Does a formula read a series only the desk has (funding, open interest, the fear gauges)? */
function readsDesk(n: Node): boolean {
  switch (n.t) {
    case 'num':
      return false
    case 'var':
      return (LAB_SERIES as readonly string[]).includes(n.name)
    case 'call':
      return n.args.some(readsDesk)
    case 'neg':
      return readsDesk(n.a)
    case 'bin':
      return readsDesk(n.a) || readsDesk(n.b)
  }
}

/** One part of a condition as Pine: "a < b", or ta.crossover / ta.crossunder (the same as the desk's crosses). */
function partPine(p: Scan): string {
  const a = printFormula(p.left)
  const b = printFormula(p.right)
  if (p.op === 'crosses above') return `ta.crossover(${a}, ${b})`
  if (p.op === 'crosses below') return `ta.crossunder(${a}, ${b})`
  return `${a} ${p.op} ${b}`
}

/**
 * A Workshop rule as a TradingView marker: it marks where the rule opens and closes (one trade at a time, on closed
 * candles, as the Lab test reads it) and has an "opens" and a "closes" alert. Parts that read what only the desk
 * watches are left out and named. Null when nothing of the open condition is left, or nothing would ever close it.
 */
export function markerPine(o: { enter: Condition; exit: Condition | null; hold: number | null; side: 'long' | 'short'; name: string; rule: string; coin: string; interval: string }): { code: string; left: string[] } | null {
  const left: string[] = []
  const keep = (c: Condition) => {
    const out: string[] = []
    for (const p of c.parts) {
      if (readsDesk(p.left) || readsDesk(p.right)) left.push(p.text)
      else out.push(partPine(p))
    }
    return out
  }
  const opens = keep(o.enter)
  const closes = o.exit ? keep(o.exit) : []
  if (opens.length === 0 || (closes.length === 0 && o.hold === null)) return null
  const long = o.side === 'long'
  const closeIf = [...(closes.length > 0 ? [`closes_if`] : []), ...(o.hold !== null ? [`bar_index - opened_at >= ${o.hold}`] : [])].join(' or ')
  const code = [
    ...header(`Workshop · ${o.name} · ${o.coin} ${o.interval}`, true),
    '',
    `// The tested rule (${o.side}): ${o.rule}`,
    ...(left.length > 0 ? [`// Left out, watched by the desk only (not the tested rule): ${left.join('; ')}`] : []),
    '// One trade at a time, read on closed candles, as the Lab test reads it.',
    '',
    `opens_if = ${opens.join(' and ')}`,
    ...(closes.length > 0 ? [`closes_if = ${closes.join(' and ')}`] : []),
    '',
    'var int opened_at = na',
    'bool opened = false',
    'bool closed = false',
    'if barstate.isconfirmed',
    '    if na(opened_at)',
    '        if bar_index >= 1 and opens_if',
    '            opened_at := bar_index',
    '            opened := true',
    `    else if ${closeIf}`,
    '        opened_at := na',
    '        closed := true',
    '',
    `plotshape(opened, "opens", ${long ? 'shape.triangleup' : 'shape.triangledown'}, ${long ? 'location.belowbar' : 'location.abovebar'}, color = ${long ? UP : DOWN}, size = size.small)`,
    `plotshape(closed, "closes", shape.xcross, ${long ? 'location.abovebar' : 'location.belowbar'}, color = color.gray, size = size.tiny)`,
    `alertcondition(opened, "opens", "${o.name}: the rule opens on {{ticker}} {{interval}}")`,
    `alertcondition(closed, "closes", "${o.name}: the rule closes on {{ticker}} {{interval}}")`,
    '',
    '// Checks: v6 · marks only, no orders · same interval as the test · no future data · alerts on closed candles',
  ].join('\n')
  return { code, left }
}
