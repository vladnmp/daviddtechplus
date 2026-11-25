// The two-readings rule: the sky changes only when two readings agree, 6 hours apart.

import { expect, test } from 'claude-code/testing'

import { GAP_MS, STAND_MS, nextWeather, shownMood, weatherRecord } from '../hooks/readings'
import type { WeatherRecord } from '../hooks/readings'

const H = 60 * 60 * 1000

test('the gap is 6 hours and a sky stands for 36 hours', () => {
  expect(GAP_MS).toBe(6 * H)
  expect(STAND_MS).toBe(36 * H)
})

test('the first reading sets the sky at once', () => {
  const r = nextWeather(null, 'storm', [5], 0)
  expect(r).toEqual({ mood: 'storm', seenAt: 0, at: 0, levels: [5], pending: null })
})

test('one odd reading changes nothing; it waits', () => {
  const sky = nextWeather(null, 'clear', [1], 0)
  const r = nextWeather(sky, 'windy', [3], 8 * H)
  expect(r.mood).toBe('clear')
  expect(r.pending).toEqual({ mood: 'windy', at: 8 * H })
  expect(r.at).toBe(8 * H)
  expect(r.seenAt).toBe(0)
})

test('a second reading under 6 hours after the first does not count', () => {
  let r = nextWeather(null, 'clear', [1], 0)
  r = nextWeather(r, 'windy', [3], 8 * H)
  r = nextWeather(r, 'windy', [3], 13 * H)
  expect(r.mood).toBe('clear')
  expect(r.pending).toEqual({ mood: 'windy', at: 8 * H })
})

test('a second reading 6 hours or more later that agrees moves the sky', () => {
  let r = nextWeather(null, 'clear', [1], 0)
  r = nextWeather(r, 'windy', [3], 8 * H)
  r = nextWeather(r, 'windy', [3], 14 * H)
  expect(r).toEqual({ mood: 'windy', seenAt: 14 * H, at: 14 * H, levels: [3], pending: null })
})

test('calm, then windy, then stormy steps through windy; the storm waits for one more reading', () => {
  let r = nextWeather(null, 'clear', [1], 0)
  r = nextWeather(r, 'windy', [3], 6 * H)
  r = nextWeather(r, 'storm', [5], 12 * H)
  expect(r.mood).toBe('windy')
  expect(r.pending).toEqual({ mood: 'storm', at: 12 * H })
  r = nextWeather(r, 'storm', [5], 18 * H)
  expect(r.mood).toBe('storm')
  expect(r.pending).toBe(null)
})

test('readings on opposite sides of the sky leave it where it is', () => {
  let r = nextWeather(null, 'windy', [3], 0)
  r = nextWeather(r, 'storm', [5], 6 * H)
  r = nextWeather(r, 'clear', [1], 12 * H)
  expect(r.mood).toBe('windy')
  expect(r.pending).toEqual({ mood: 'clear', at: 12 * H })
})

test('a reading that matches the sky clears what waits', () => {
  let r = nextWeather(null, 'clear', [1], 0)
  r = nextWeather(r, 'storm', [5], 6 * H)
  r = nextWeather(r, 'clear', [1], 7 * H)
  expect(r).toEqual({ mood: 'clear', seenAt: 7 * H, at: 7 * H, levels: [1], pending: null })
})

test('a sky not seen for 36 hours stands no more: the next reading sets it, and a session shows calm', () => {
  const sky = nextWeather(null, 'storm', [5], 0)
  expect(shownMood(sky, 35 * H)).toBe('storm')
  expect(shownMood(sky, 36 * H)).toBe('clear')
  expect(shownMood(null, 0)).toBe('clear')
  expect(nextWeather(sky, 'windy', [3], 36 * H)).toEqual({ mood: 'windy', seenAt: 36 * H, at: 36 * H, levels: [3], pending: null })
})

test('a saved reading in the old shape reads as seen at its time, with nothing waiting', () => {
  expect(weatherRecord({ mood: 'storm', levels: [5, 4], at: 10 })).toEqual({ mood: 'storm', seenAt: 10, at: 10, levels: [5, 4], pending: null })
  expect(weatherRecord(null)).toBe(null)
  expect(weatherRecord({ mood: 'sunny', at: 1 })).toBe(null)
  const full: WeatherRecord = { mood: 'clear', seenAt: 1, at: 2, levels: [1], pending: { mood: 'windy', at: 2 } }
  expect(weatherRecord(full)).toEqual(full)
})

test('calm, then two stormy readings 6 hours apart, moves the sky straight to stormy', () => {
  let r = nextWeather(null, 'clear', [1], 0)
  r = nextWeather(r, 'storm', [5], 6 * H)
  expect(r.mood).toBe('clear')
  r = nextWeather(r, 'storm', [5], 12 * H)
  expect(r).toEqual({ mood: 'storm', seenAt: 12 * H, at: 12 * H, levels: [5], pending: null })
})

test('the straight jump to stormy needs no windy reading at any point', () => {
  const moods: string[] = []
  let r = nextWeather(null, 'clear', [1], 0)
  moods.push(r.mood)
  for (const t of [10 * H, 20 * H]) {
    r = nextWeather(r, 'storm', [5, 4], t)
    moods.push(r.mood)
  }
  expect(moods).toEqual(['clear', 'clear', 'storm'])
  expect(moods).not.toContain('windy')
})

test('two stormy readings under 6 hours apart are one reading; the jump comes with the next one 6 hours after the first', () => {
  let r = nextWeather(null, 'clear', [1], 0)
  r = nextWeather(r, 'storm', [5], 8 * H)
  r = nextWeather(r, 'storm', [5], 10 * H)
  expect(r.mood).toBe('clear')
  expect(r.pending).toEqual({ mood: 'storm', at: 8 * H })
  r = nextWeather(r, 'storm', [5], 14 * H)
  expect(r).toEqual({ mood: 'storm', seenAt: 14 * H, at: 14 * H, levels: [5], pending: null })
})

test('the other way too: two calm readings move a stormy sky straight to calm', () => {
  let r = nextWeather(null, 'storm', [5], 0)
  r = nextWeather(r, 'clear', [1], 6 * H)
  expect(r.mood).toBe('storm')
  r = nextWeather(r, 'clear', [1], 12 * H)
  expect(r).toEqual({ mood: 'clear', seenAt: 12 * H, at: 12 * H, levels: [1], pending: null })
})

test('a stormy reading then a windy one, 6 hours apart, still moves a calm sky only to windy', () => {
  let r = nextWeather(null, 'clear', [1], 0)
  r = nextWeather(r, 'storm', [5], 6 * H)
  r = nextWeather(r, 'windy', [3], 12 * H)
  expect(r).toEqual({ mood: 'windy', seenAt: 12 * H, at: 12 * H, levels: [3], pending: null })
})

test('the two stormy readings must both come inside 36 hours of the calm sky being seen, else the sky resets', () => {
  let r = nextWeather(null, 'clear', [1], 0)
  r = nextWeather(r, 'storm', [5], 31 * H)
  expect(r.mood).toBe('clear')
  // The two stormy readings are only 5 h apart, so the two-readings rule cannot explain the jump.
  // It comes from the 36 h reset: calm was last seen 36 h ago, so this reading sets the sky at once.
  r = nextWeather(r, 'storm', [5], 36 * H)
  expect(r).toEqual({ mood: 'storm', seenAt: 36 * H, at: 36 * H, levels: [5], pending: null })
})
