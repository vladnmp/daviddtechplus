// Formula indicators: "plot ta.ema(close, 20) - ta.ema(close, 50)". A small piece of Pine, read by our own parser
// (a short whitelist, no eval), computed with the same ta.* math as the built-in indicators, and exported to Pine
// as written. Pure: no `$`.

import type { Candle } from '../types'
import { ema, hma, rma, rsi, sma, stdev, trueRange, wma } from './indicators'

type Num = number | null

export type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'call'; fn: string; args: Node[] }
  | { t: 'neg'; a: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/'; a: Node; b: Node }

/** The price series a formula may read. */
export const SERIES = ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4'] as const

type Arg = 'src' | 'len' | 'len?'
/** The functions a formula may call, with their arguments: a series, or a whole-number length (1 to 1000). */
export const FUNCS: Readonly<Record<string, readonly Arg[]>> = {
  'ta.sma': ['src', 'len'],
  'ta.ema': ['src', 'len'],
  'ta.rma': ['src', 'len'],
  'ta.wma': ['src', 'len'],
  'ta.hma': ['src', 'len'],
  'ta.rsi': ['src', 'len'],
  'ta.stdev': ['src', 'len'],
  'ta.highest': ['src', 'len'],
  'ta.lowest': ['src', 'len'],
  'ta.change': ['src', 'len?'],
  'ta.mom': ['src', 'len'],
  'ta.roc': ['src', 'len'],
  'ta.vwma': ['src', 'len'],
  'ta.cci': ['src', 'len'],
  'ta.atr': ['len'],
  'math.abs': ['src'],
  'math.max': ['src', 'src'],
  'math.min': ['src', 'src'],
}

const MAX_TEXT = 160
const MAX_LEN = 1000
const HINT = `Use ${SERIES.slice(0, 5).join(', ')}, numbers, + - * / ( ) and ${Object.keys(FUNCS).join(', ')}. Example: plot ta.ema(close, 20) - ta.ema(close, 50)`

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string }

function tokens(text: string): Tok[] | { error: string } {
  const out: Tok[] = []
  const re = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)|([-+*/(),]))/gy
  let i = 0
  while (i < text.length) {
    if (/^\s*$/.test(text.slice(i))) break
    re.lastIndex = i
    const m = re.exec(text)
    if (!m) return { error: `"${text.slice(i).trim().slice(0, 12)}" is not part of a formula. ${HINT}` }
    if (m[1] !== undefined) out.push({ k: 'num', v: Number(m[1]) })
    else if (m[2] !== undefined) out.push({ k: 'id', v: m[2] })
    else out.push({ k: 'op', v: m[3] ?? '' })
    i = re.lastIndex
  }
  return out
}

class Bad extends Error {}

/** Reads a formula into a tree, or says in plain words what is wrong. */
export function parseFormula(raw: string, opts: { allowConst?: boolean } = {}): Node | { error: string } {
  const text = raw.trim().toLowerCase()
  if (text === '') return { error: `Write a formula after plot. ${HINT}` }
  if (text.length > MAX_TEXT) return { error: `Formulas are ${MAX_TEXT} characters at most.` }
  const toks = tokens(text)
  if ('error' in toks) return toks
  let p = 0
  const peek = () => toks[p]
  const isOp = (v: string) => peek()?.k === 'op' && peek()?.v === v
  const expect = (v: string) => {
    if (!isOp(v)) throw new Bad(`Expected "${v}"${peek() ? ` before "${peek()?.v}"` : ' at the end'}.`)
    p++
  }
  const expr = (): Node => {
    let a = term()
    while (isOp('+') || isOp('-')) {
      const op = (toks[p++] as Tok).v as '+' | '-'
      a = { t: 'bin', op, a, b: term() }
    }
    return a
  }
  const term = (): Node => {
    let a = unary()
    while (isOp('*') || isOp('/')) {
      const op = (toks[p++] as Tok).v as '*' | '/'
      a = { t: 'bin', op, a, b: unary() }
    }
    return a
  }
  const unary = (): Node => {
    if (isOp('-')) {
      p++
      return { t: 'neg', a: unary() }
    }
    if (isOp('+')) {
      p++
      return unary()
    }
    return primary()
  }
  const primary = (): Node => {
    const tok = peek()
    if (!tok) throw new Bad('The formula ends too soon.')
    if (tok.k === 'num') {
      p++
      return { t: 'num', v: tok.v }
    }
    if (tok.k === 'op' && tok.v === '(') {
      p++
      const inner = expr()
      expect(')')
      return inner
    }
    if (tok.k === 'id') {
      p++
      if (isOp('(')) {
        const spec = FUNCS[tok.v]
        if (!spec) throw new Bad(`${tok.v}() is not one of the functions here. ${HINT}`)
        p++
        const args: Node[] = []
        if (!isOp(')')) {
          args.push(expr())
          while (isOp(',')) {
            p++
            args.push(expr())
          }
        }
        expect(')')
        const need = spec.filter(a => a !== 'len?').length
        if (args.length < need || args.length > spec.length) throw new Bad(`${tok.v} takes ${spec.length === need ? need : `${need} or ${spec.length}`} argument${spec.length > 1 ? 's' : ''}: ${tok.v}(${spec.map(a => (a === 'src' ? 'close' : '14')).join(', ')}).`)
        args.forEach((a, i) => {
          if (spec[i] !== 'src' && !(a.t === 'num' && Number.isInteger(a.v) && a.v >= 1 && a.v <= MAX_LEN))
            throw new Bad(`${tok.v}: the length must be a whole number from 1 to ${MAX_LEN}.`)
        })
        return { t: 'call', fn: tok.v, args }
      }
      if ((SERIES as readonly string[]).includes(tok.v)) return { t: 'var', name: tok.v }
      throw new Bad(`"${tok.v}" is not a series here. ${HINT}`)
    }
    throw new Bad(`"${tok.v}" is out of place.`)
  }
  try {
    const node = expr()
    if (p < toks.length) throw new Bad(`"${toks[p]?.v}" is out of place.`)
    if (!opts.allowConst && !usesSeries(node)) throw new Bad(`The formula needs a series to plot, e.g. close. ${HINT}`)
    return node
  } catch (err) {
    if (err instanceof Bad) return { error: `Formula: ${err.message}` }
    throw err
  }
}

function usesSeries(n: Node): boolean {
  switch (n.t) {
    case 'num':
      return false
    case 'var':
      return true
    case 'call':
      return n.fn === 'ta.atr' || n.args.some(usesSeries)
    case 'neg':
      return usesSeries(n.a)
    case 'bin':
      return usesSeries(n.a) || usesSeries(n.b)
  }
}

const PREC = { '+': 1, '-': 1, '*': 2, '/': 2 } as const

/** The formula as Pine, spaced the standard way: "ta.ema(close, 20) - ta.ema(close, 50)". */
export function printFormula(n: Node, parent = 0, isRight = false): string {
  switch (n.t) {
    case 'num':
      return String(n.v)
    case 'var':
      return n.name
    case 'call':
      return `${n.fn}(${n.args.map(a => printFormula(a)).join(', ')})`
    case 'neg':
      return `-${printFormula(n.a, 3)}`
    case 'bin': {
      const own = PREC[n.op]
      const text = `${printFormula(n.a, own)} ${n.op} ${printFormula(n.b, own, true)}`
      return own < parent || (own === parent && isRight) ? `(${text})` : text
    }
  }
}

/** The short legend name: "ema(close,20)-ema(close,50)", cut to fit. */
export function formulaLabel(n: Node): string {
  const s = printFormula(n).replace(/\bta\.|\bmath\./g, '').replace(/\s+/g, '')
  return s.length > 28 ? `${s.slice(0, 27)}…` : s
}

/** How many candles before the first shown one the formula wants, so its first value is settled. */
export function formulaWarmup(n: Node): number {
  switch (n.t) {
    case 'num':
    case 'var':
      return 0
    case 'neg':
      return formulaWarmup(n.a)
    case 'bin':
      return Math.max(formulaWarmup(n.a), formulaWarmup(n.b))
    case 'call': {
      const len = (n.args.find((a, i) => FUNCS[n.fn]?.[i] !== 'src') as { v?: number } | undefined)?.v ?? 1
      const inner = Math.max(0, ...n.args.filter((_, i) => FUNCS[n.fn]?.[i] === 'src').map(formulaWarmup))
      const own = ['ta.ema', 'ta.rma', 'ta.rsi', 'ta.atr'].includes(n.fn) ? 4 * len : n.fn === 'ta.hma' ? len + Math.ceil(Math.sqrt(len)) : n.fn.startsWith('math.') ? 0 : len
      return Math.min(MAX_LEN, inner + own)
    }
  }
}

type Dim = { k: 'level'; w: number } | { k: 'dist' } | { k: 'const'; v: number } | { k: 'other' }

/** What a formula measures: a price level (weight w of price), a price distance, a plain number, or something else. */
function dim(n: Node): Dim {
  switch (n.t) {
    case 'num':
      return { k: 'const', v: n.v }
    case 'var':
      return n.name === 'volume' ? { k: 'other' } : { k: 'level', w: 1 }
    case 'neg': {
      const a = dim(n.a)
      return a.k === 'level' ? { k: 'level', w: -a.w } : a.k === 'const' ? { k: 'const', v: -a.v } : a
    }
    case 'call': {
      const a = n.args[0] ? dim(n.args[0]) : { k: 'other' as const }
      switch (n.fn) {
        case 'ta.atr':
          return { k: 'dist' }
        case 'ta.stdev':
        case 'ta.change':
        case 'ta.mom':
          return a.k === 'level' || a.k === 'dist' ? { k: 'dist' } : { k: 'other' }
        case 'ta.rsi':
        case 'ta.roc':
        case 'ta.cci':
          return { k: 'other' }
        case 'math.max':
        case 'math.min': {
          const b = n.args[1] ? dim(n.args[1]) : { k: 'other' as const }
          if (a.k === 'level' && b.k === 'level') return Math.abs(a.w - b.w) < 1e-9 ? a : { k: 'other' }
          if (a.k === 'level' && b.k === 'const') return a
          if (b.k === 'level' && a.k === 'const') return b
          return a.k === b.k ? a : { k: 'other' }
        }
        default:
          return a
      }
    }
    case 'bin': {
      const a = dim(n.a)
      const b = dim(n.b)
      if (n.op === '+' || n.op === '-') {
        const s = n.op === '+' ? 1 : -1
        if (a.k === 'level' && b.k === 'level') return { k: 'level', w: a.w + s * b.w }
        if (a.k === 'level' && (b.k === 'dist' || b.k === 'const')) return a
        if (b.k === 'level' && (a.k === 'dist' || a.k === 'const')) return { k: 'level', w: s * b.w }
        if (a.k === 'dist' && (b.k === 'dist' || b.k === 'const')) return a
        if (a.k === 'const' && b.k === 'dist') return b
        if (a.k === 'const' && b.k === 'const') return { k: 'const', v: a.v + s * b.v }
        return { k: 'other' }
      }
      if (n.op === '*') {
        if (a.k === 'level' && b.k === 'const') return { k: 'level', w: a.w * b.v }
        if (b.k === 'level' && a.k === 'const') return { k: 'level', w: b.w * a.v }
        if ((a.k === 'dist' && b.k === 'const') || (b.k === 'dist' && a.k === 'const')) return { k: 'dist' }
        if (a.k === 'const' && b.k === 'const') return { k: 'const', v: a.v * b.v }
        return { k: 'other' }
      }
      if (b.k === 'const' && b.v !== 0) {
        if (a.k === 'level') return { k: 'level', w: a.w / b.v }
        if (a.k === 'dist') return a
        if (a.k === 'const') return { k: 'const', v: a.v / b.v }
      }
      return { k: 'other' }
    }
  }
}

/** On the price chart when the formula is a price level (an average, a midpoint, price ± a distance); else a lower pane. */
export function formulaPane(n: Node): 'price' | 'lower' {
  const d = dim(n)
  return d.k === 'level' && d.w >= 0.5 && d.w <= 2 ? 'price' : 'lower'
}

function seriesOf(name: string, c: readonly Candle[]): Num[] {
  switch (name) {
    case 'open':
      return c.map(k => k.o)
    case 'high':
      return c.map(k => k.h)
    case 'low':
      return c.map(k => k.l)
    case 'volume':
      return c.map(k => k.v)
    case 'hl2':
      return c.map(k => (k.h + k.l) / 2)
    case 'hlc3':
      return c.map(k => (k.h + k.l + k.c) / 3)
    case 'ohlc4':
      return c.map(k => (k.o + k.h + k.l + k.c) / 4)
    default:
      return c.map(k => k.c)
  }
}

function zip(a: readonly Num[], b: readonly Num[], f: (x: number, y: number) => number | null): Num[] {
  return a.map((x, i) => {
    const y = b[i]
    if (x === null || y === null || y === undefined) return null
    const r = f(x, y)
    return r === null || !Number.isFinite(r) ? null : r
  })
}

function window(src: readonly Num[], len: number, f: (w: number[]) => number): Num[] {
  return src.map((_, i) => {
    if (i < len - 1) return null
    const w = src.slice(i - len + 1, i + 1)
    return w.some(x => x === null) ? null : f(w as number[])
  })
}

/** ta.rsi on a series that may start with na: from its first value on, gaps held at the last value. */
function rsiOf(src: readonly Num[], len: number): Num[] {
  const k = src.findIndex(v => v !== null)
  if (k < 0) return src.map(() => null)
  let last = src[k] as number
  const held = src.slice(k).map(v => (v === null ? last : (last = v)))
  return [...new Array<Num>(k).fill(null), ...rsi(held, len)]
}

const OPS: Readonly<Record<'+' | '-' | '*' | '/', (x: number, y: number) => number | null>> = {
  '+': (x, y) => x + y,
  '-': (x, y) => x - y,
  '*': (x, y) => x * y,
  '/': (x, y) => (y === 0 ? null : x / y),
}

/** The formula's value on every candle; null where TradingView shows na. */
export function evalFormula(n: Node, c: readonly Candle[]): Num[] {
  switch (n.t) {
    case 'num':
      return c.map(() => n.v)
    case 'var':
      return seriesOf(n.name, c)
    case 'neg':
      return evalFormula(n.a, c).map(v => (v === null ? null : -v))
    case 'bin':
      return zip(evalFormula(n.a, c), evalFormula(n.b, c), OPS[n.op])
    case 'call': {
      const src = n.args[0] && FUNCS[n.fn]?.[0] === 'src' ? evalFormula(n.args[0], c) : []
      const lenArg = n.args.find((_, i) => FUNCS[n.fn]?.[i] !== 'src') as { v?: number } | undefined
      const len = lenArg?.v ?? 1
      switch (n.fn) {
        case 'ta.sma':
          return sma(src, len)
        case 'ta.ema':
          return ema(src, len)
        case 'ta.rma':
          return rma(src, len)
        case 'ta.wma':
          return wma(src, len)
        case 'ta.hma':
          return hma(src, len)
        case 'ta.rsi':
          return rsiOf(src, len)
        case 'ta.stdev':
          return stdev(src, len)
        case 'ta.highest':
          return window(src, len, w => Math.max(...w))
        case 'ta.lowest':
          return window(src, len, w => Math.min(...w))
        case 'ta.change':
        case 'ta.mom':
          return src.map((v, i) => (i < len || v === null || src[i - len] === null ? null : v - (src[i - len] as number)))
        case 'ta.roc':
          // Pine: 100 * (source - source[length]) / source[length]
          return src.map((v, i) => {
            const was = i < len ? null : src[i - len]
            return v === null || was === null || was === undefined || was === 0 ? null : (100 * (v - was)) / was
          })
        case 'ta.vwma': {
          // Pine: ta.sma(source * volume, length) / ta.sma(volume, length)
          const vol = c.map(k => k.v)
          return src.map((_, i) => {
            if (i < len - 1) return null
            let pv = 0
            let sv = 0
            for (let j = i - len + 1; j <= i; j++) {
              const x = src[j]
              if (x === null || x === undefined) return null
              pv += x * (vol[j] ?? 0)
              sv += vol[j] ?? 0
            }
            return sv === 0 ? null : pv / sv
          })
        }
        case 'ta.cci':
          // Pine: (source - ta.sma(source, length)) / (0.015 * ta.dev(source, length)), ta.dev the mean absolute deviation
          return window(src, len, w => {
            const mean = w.reduce((s, x) => s + x, 0) / w.length
            const dev = w.reduce((s, x) => s + Math.abs(x - mean), 0) / w.length
            return dev === 0 ? Number.NaN : ((w[w.length - 1] as number) - mean) / (0.015 * dev)
          }).map(v => (v === null || Number.isNaN(v) ? null : v))
        case 'ta.atr':
          return rma(trueRange(c), len)
        case 'math.abs':
          return src.map(v => (v === null ? null : Math.abs(v)))
        case 'math.max':
          return zip(src, evalFormula(n.args[1] as Node, c), Math.max)
        case 'math.min':
          return zip(src, evalFormula(n.args[1] as Node, c), Math.min)
      }
      return c.map(() => null)
    }
  }
}

/** The formula as Python over the export's helpers (lists with None for na). */
export function pythonFormula(n: Node): string {
  switch (n.t) {
    case 'num':
      return String(n.v)
    case 'var':
      return { open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v', hl2: 'hl2', hlc3: 'hlc3', ohlc4: 'ohlc4' }[n.name] ?? 'c'
    case 'neg':
      return `_bin(-1, ${pythonFormula(n.a)}, lambda x, y: x * y)`
    case 'bin': {
      const f = { '+': 'x + y', '-': 'x - y', '*': 'x * y', '/': 'None if y == 0 else x / y' }[n.op]
      return `_bin(${pythonFormula(n.a)}, ${pythonFormula(n.b)}, lambda x, y: ${f})`
    }
    case 'call': {
      const args = n.args.map(a => pythonFormula(a))
      const name = n.fn.replace(/^(ta|math)\./, '')
      switch (n.fn) {
        case 'ta.atr':
          return `rma(true_range(h, l, c), ${args[0]})`
        case 'ta.rsi':
          return `_rsi_na(${args[0]}, ${args[1]})`
        case 'ta.highest':
        case 'ta.lowest':
          return `_window(${args[0]}, ${args[1]}, ${n.fn === 'ta.highest' ? 'max' : 'min'})`
        case 'ta.change':
        case 'ta.mom':
          return `_change(${args[0]}, ${args[1] ?? 1})`
        case 'ta.roc':
          return `_roc(${args[0]}, ${args[1]})`
        case 'ta.vwma':
          return `_vwma(${args[0]}, v, ${args[1]})`
        case 'ta.cci':
          return `_window(${args[0]}, ${args[1]}, _cci)`
        case 'math.abs':
          return `_bin(${args[0]}, 0, lambda x, y: abs(x))`
        case 'math.max':
        case 'math.min':
          return `_bin(${args[0]}, ${args[1]}, ${name})`
        default:
          return `${name}(${args.join(', ')})`
      }
    }
  }
}

/** The Python helpers a formula needs: na-aware arithmetic, windows, change and RSI. */
export const PY_FORMULA_HELPERS = `

def _bin(a, b, f):
    # Element by element; None (na) stays None, as in Pine.
    n = max(len(a) if isinstance(a, list) else 0, len(b) if isinstance(b, list) else 0)
    a = a if isinstance(a, list) else [a] * n
    b = b if isinstance(b, list) else [b] * n
    return [None if x is None or y is None else f(x, y) for x, y in zip(a, b)]


def _window(src, n, f):
    return [None if i < n - 1 or None in src[i - n + 1 : i + 1] else f(src[i - n + 1 : i + 1]) for i in range(len(src))]


def _change(src, n=1):
    return [None if i < n or src[i] is None or src[i - n] is None else src[i] - src[i - n] for i in range(len(src))]


def _roc(src, n):
    return [None if i < n or src[i] is None or src[i - n] in (None, 0) else 100 * (src[i] - src[i - n]) / src[i - n] for i in range(len(src))]


def _vwma(src, vol, n):
    out = []
    for i in range(len(src)):
        w = src[i - n + 1 : i + 1] if i >= n - 1 else [None]
        sv = sum(vol[i - n + 1 : i + 1]) if i >= n - 1 else 0
        out.append(None if None in w or sv == 0 else sum(x * y for x, y in zip(w, vol[i - n + 1 : i + 1])) / sv)
    return out


def _cci(w):
    mean = sum(w) / len(w)
    dev = sum(abs(x - mean) for x in w) / len(w)
    return None if dev == 0 else (w[-1] - mean) / (0.015 * dev)


def _rsi_na(src, n):
    k = next((i for i, x in enumerate(src) if x is not None), len(src))
    held, last = [], None
    for x in src[k:]:
        last = x if x is not None else last
        held.append(last)
    return [None] * k + rsi(held, n)
`

/** Splits "ema 20, plot ta.ema(close, 20) - close, rsi" at the commas outside brackets. */
export function splitTop(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if ((ch === ',' || ch === ';') && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.flatMap(s => (/\bplot\b/i.test(s) ? [s] : s.split(/\s+and\s+/))).map(s => s.trim()).filter(s => s !== '')
}
