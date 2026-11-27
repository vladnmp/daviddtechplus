// Hyperliquid funding kept on the PC beside the deep files: a later session reads only the hours since the file ends.
// Its own file, so the desk's data folder is read fresh (the module keeps where it is for the session).

import { expect, mock, test } from 'claude-code/testing'

import { NOW, candlesFixture, engine, typed } from './fixtures'

const H = 3_600_000

/** Hourly funding from `start` to NOW, 500 a page. */
function fundingPages(starts: number[]) {
  return (_coin: string, start: number) => {
    starts.push(start)
    const rows: Record<string, unknown>[] = []
    for (let t = Math.ceil(start / H) * H; t < NOW && rows.length < 500; t += H) rows.push({ coin: 'BTC', fundingRate: (t / H) % 5 === 0 ? '-0.00002' : '0.0000125', premium: '0', time: t })
    return rows
  }
}

test('Hyperliquid funding is kept on the PC: a later session reads only the hours since the file ends', async ($, on) => {
  const starts: number[] = []
  engine(on, { candles: () => candlesFixture(400), funding: fundingPages(starts) })
  mock.clock(on, { now: NOW })
  mock.store(on)
  const m = new Map<string, string>()
  // The engine gives Windows paths (D:\data\...): kept here by their path after the drive.
  const key = (p: string) => p.replaceAll('\\', '/').replace(/^[A-Za-z]:/, '')
  const last = NOW - 10 * H
  const kept: [number, number][] = []
  for (let t = NOW - 1000 * H; t <= last; t += H) kept.push([t, 0.0000125])
  m.set('/data/lab-desk/deep/HL_BTC_funding.json', JSON.stringify({ from: NOW - 1000 * H, rows: kept }))
  on('process.hookEnv', () => ({ value: { CLAUDE_PLUGIN_DATA: '/data/lab-desk' } }))
  on('fs.stat', (_, e, next) => (m.has(key(e.path)) ? { value: { kind: 'file' as const, isLink: false, size: (m.get(key(e.path)) ?? '').length, mtimeMs: NOW - H } } : next(e)))
  on('fs.write', (_, e) => (m.set(key(e.path), e.text), { value: undefined }))
  on('fs.read', (_, e, next) => (m.has(key(e.path)) ? { value: m.get(key(e.path)) as string } : next(e)))
  on('fs.list', (_, e) => {
    const dir = `${key(e.path)}/`
    return { value: [...m.keys()].filter(k => k.startsWith(dir)).map(k => ({ name: k.slice(dir.length), kind: 'file' as const, isLink: false, size: (m.get(k) ?? '').length, mtimeMs: NOW - H })) }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const text = (await $.command.run(typed('lab-after', 'funding < 0'))).text ?? ''
  expect(text).toMatch(/^History: BTC 1h, funding < 0/)
  // Only the hours after the file's last row are asked, not the 400 candles' whole span.
  expect(starts).toEqual([last + 1])
  const saved = JSON.parse(m.get('/data/lab-desk/deep/HL_BTC_funding.json') ?? '{}') as { from: number; rows: [number, number][] }
  expect(saved.from).toBe(NOW - 1000 * H)
  expect((saved.rows.at(-1) as [number, number])[0]).toBeGreaterThan(last)
  // /lab-chart reset empties the file and forgets the session's copy, so the next read starts over and never writes the old rows back.
  expect((await $.command.run(typed('lab-chart', 'reset'))).text ?? '').toMatch(/^Desk reset: .*1 deep history file emptied/)
  expect(m.get('/data/lab-desk/deep/HL_BTC_funding.json')).toBe('')
  await $.command.run(typed('lab-after', 'funding < 0'))
  expect(starts.length).toBe(2)
  expect(starts[1] as number).toBeLessThan(NOW - 300 * H)
  const again = JSON.parse(m.get('/data/lab-desk/deep/HL_BTC_funding.json') ?? '{}') as { from: number }
  expect(again.from).toBeGreaterThan(NOW - 1000 * H)
})
