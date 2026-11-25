// "/lab-ind what rsi": a plain-words card per indicator. What it measures is in KINDS; here is how people usually
// read it and one thing to watch. Neutral words: what the line shows, never what to do. Pure: no `$`.

import type { Kind } from './indicators'

export const LEARN: Readonly<Record<Kind, { reads: string; watch: string }>> = {
  sma: {
    reads: 'Price above the line means recent closes are higher than the average; the slope shows the direction. Many people watch the 50 and the 200.',
    watch: 'It lags: a long SMA turns well after price does.',
  },
  ema: {
    reads: 'Like the SMA, but recent candles count more, so it turns sooner. People watch the 20, 50 and 200, and a fast EMA crossing a slow one as a change in direction.',
    watch: 'In a sideways market the crossings come often and mean little.',
  },
  hma: {
    reads: 'A smooth line that turns quickly; people watch where its slope changes.',
    watch: 'After a sharp move it can overshoot before it settles.',
  },
  bb: {
    reads: 'The bands widen when moves get bigger and squeeze when the market goes quiet. A close at a band shows a stretched move, not a turn by itself.',
    watch: 'In a strong trend price can ride one band for a long time.',
  },
  keltner: {
    reads: 'A calmer channel than Bollinger: closes outside it show a strong push in that direction.',
    watch: 'The multiplier (2 by default) changes how often price leaves the channel.',
  },
  vwap: {
    reads: 'The average price of the UTC day, weighted by volume. Price above it means most of today\'s trading happened lower than now.',
    watch: 'It restarts at 00:00 UTC, so early in the day it follows price closely.',
  },
  donchian: {
    reads: 'The highest high and lowest low of the last candles. A close beyond them is a break out of the recent range.',
    watch: 'Many breaks fall back inside; volume helps tell them apart.',
  },
  supertrend: {
    reads: 'Under price (green) it marks an up-trend mode, over price (red) a down-trend mode. The flip from one side to the other is the moment people watch.',
    watch: 'In a range it flips back and forth, and it always flips after the move has started.',
  },
  rsi: {
    reads: 'Momentum from 0 to 100: above 70 is often called overbought, under 30 oversold. People also watch when price makes a new high and RSI does not.',
    watch: 'In a strong trend it can stay above 70 (or under 30) for a long time.',
  },
  stochrsi: {
    reads: 'Where RSI sits in its own recent range, 0 to 100, so it moves fast. People watch %K crossing %D near 20 and 80.',
    watch: 'It is noisy: many crossings on short intervals.',
  },
  stoch: {
    reads: 'Where the close sits between the recent high and low: above 80 near the top of the range, under 20 near the bottom.',
    watch: 'It reads ranges best; in a trend it stays pinned at one end.',
  },
  macd: {
    reads: 'The gap between EMA 12 and EMA 26, with its own average. Above 0 the fast EMA is over the slow one; the histogram crossing 0 is MACD crossing its average.',
    watch: 'It lags, and small crossings near 0 are mostly noise.',
  },
  adx: {
    reads: 'ADX is trend strength, not direction: above 25 is often called trending, under 20 quiet. +DI over -DI points up, the other way down.',
    watch: 'ADX rises in strong falls too; read the DIs for the direction.',
  },
  atr: {
    reads: 'The average size of a candle (high to low, with gaps). Rising ATR means bigger moves; people use it to set distances that fit the market\'s swing.',
    watch: 'It says nothing about direction.',
  },
  obv: {
    reads: 'A running total of volume, added on up closes and taken off on down closes. OBV rising while price stays flat shows volume leaning to the up side.',
    watch: 'One huge-volume candle can move it more than a week of trading.',
  },
  plot: {
    reads: 'Your own formula, drawn as written. A price level draws on the chart; anything else gets its own pane.',
    watch: 'Export it (/lab-ind export pine) and check the numbers on TradingView: the desk uses the same ta.* math.',
  },
}
