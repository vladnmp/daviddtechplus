// "/lab tour": a short guided try-out. Each step says what the next command does and puts it in the prompt box;
// running it (or one like it) moves the tour on. Pure: no `$`.

export type TourStep = {
  /** What goes in the prompt box. */
  fill: string
  /** One line on what it does. */
  say: string
  /** Whether the person's command counts as this step (they may pick another coin or formula). */
  done: (command: string, args: string) => boolean
}

const first = (args: string) => (args.trim().toLowerCase().split(/\s+/)[0] ?? '')

export const TOUR: readonly TourStep[] = [
  {
    fill: '/lab-chart BTC 1h',
    say: 'a live chart beside the chat. Any coin works: ETH 4h, SOL 15m.',
    done: (c, a) => c === 'lab-chart' && !/^(replay|next|close|reset|save|compare)\b/.test(first(a)),
  },
  {
    fill: '/lab-ind trend',
    say: 'paints a set of indicators: EMA 20, 50 and 200. The chips under the chart do the same.',
    done: (c, a) => c === 'lab-ind' && a.trim() !== '' && !/^(what|explain|learn|plot|export|remove|clear|list|help)\b/.test(first(a)),
  },
  {
    fill: '/lab-mark fib',
    say: 'draws a Fibonacci retracement over the recent swing.',
    done: (c, a) => c === 'lab-mark' && a.trim() !== '',
  },
  {
    fill: '/lab-ind plot ta.ema(close, 20) - ta.ema(close, 50)',
    say: 'your own indicator, written in Pine: the gap between two EMAs, in its own pane. Change the formula if you like.',
    done: (c, a) => c === 'lab-ind' && first(a) === 'plot',
  },
  {
    fill: '/lab-scan rsi < 30',
    say: 'checks every watchlist coin for one condition on the latest candle.',
    done: c => c === 'lab-scan',
  },
  {
    fill: '/lab-chart replay',
    say: 'bar replay: the last candles hide, so you can read the chart without seeing what came next.',
    done: (c, a) => c === 'lab-chart' && first(a) === 'replay',
  },
]

/** The last fill: a question for Claude, not a command. */
export const TOUR_QUIZ =
  "Quiz me on this bar replay: read the Lab desk chart (chart_read), ask me one question about what it shows and what I expect next, and don't say what came next. After I answer, step the replay forward with the chart tool and tell me how it went."

/** Verbs that end the command in a "Next:" line: "/lab-chart SOL 4h opens it". */
const NEXT_VERB = /^(opens|paints|lists|says|puts|picks|changes|removes|hides|jumps|goes|checks|stops|makes|draws|shows|adds|saves|loads|turns|sets|finds|runs|gives)$/

/**
 * The next step a reply names, for the prompt box's dim suggestion (Tab takes it): the first command in its
 * "Next:" line, or the question in `ask Claude "..."`. Null when the reply names none.
 */
export function nextSuggestion(text: string): string | null {
  const at = text.lastIndexOf('Next: ')
  if (at < 0) return null
  const line = text.slice(at + 6).split('\n')[0] ?? ''
  const ask = /^ask Claude "([^"]+)"/.exec(line)
  if (ask) return ask[1] ?? null
  // The first command that does not undo what was just done ("/lab-watch off hides it" is not a next step).
  for (const cmd of line.matchAll(/\/lab(?:-[a-z]+)*\b/g)) {
    const words = [cmd[0]]
    for (const w of line.slice((cmd.index ?? 0) + cmd[0].length).trim().split(/\s+/)) {
      if (w === '' || NEXT_VERB.test(w) || w === 'or') break
      const clean = w.replace(/[,.;:]+$/, '')
      // A placeholder ("<rule>") or a formula cut at its brackets is not a command to run as it is.
      if (/<[a-z]+>/i.test(clean)) return null
      if (/[()"]/.test(clean) && !/^[("]/.test(clean)) return null
      if (clean === '' || /[()"]/.test(clean)) break
      words.push(clean)
      if (clean !== w) break
    }
    if (!words.slice(1).some(w => UNDO_WORD.test(w))) return words.join(' ')
  }
  return null
}

/** Words that take something away: never offered as the next step. */
const UNDO_WORD = /^(off|clear|remove|reset|close|stop|forget|none)$/i

/** The words for step `i` (0-based), and whether the line went into the prompt box. */
export function tourText(i: number, isFilled: boolean): string {
  const total = TOUR.length
  const step = TOUR[i]
  if (!step) {
    const where = isFilled ? 'It is in the prompt box: Enter sends it to Claude.' : `Type it in the chat: ${TOUR_QUIZ}`
    return `Tour done. Last one: ask Claude to quiz you on the replay. ${where} /lab lists everything else.`
  }
  const where = isFilled ? 'It is in the prompt box: press Enter.' : `Type: ${step.fill}`
  return `Tour ${i + 1}/${total} · ${step.fill}: ${step.say} ${where}${i === 0 ? ' (/lab tour off stops the tour.)' : ''}`
}
