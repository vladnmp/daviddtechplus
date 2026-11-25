import type { Mood, Pulse } from '../types'

/**
 * The three moving scenes as SVG text: CSS keyframes only, no script, seeded so each call gives the same
 * drawing. Art sits along the top and the bottom sides, away from the middle (where the words sit) and the
 * bottom center (the message box). Generic seasonal art: snow, lights, pine trees, sky.
 *
 * Light on the battery: things that move the same way (snow of one depth, rain of one depth, wind streaks,
 * stars, bulbs) move as one group, so each scene animates under a dozen elements.
 */

export const MAX_SVG = 131072

/** A small seeded random number generator, so a scene is the same text every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0

  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One decimal, as short text. */
function n(value: number): string {
  return String(Math.round(value * 10) / 10)
}

const REDUCED = '@media (prefers-reduced-motion: reduce){*{animation:none!important}}'

/**
 * Keeps the corner art in view on tall screens: the root slices the 1600 x 1000 drawing to the screen, so on a
 * phone the sides are cut off. These rules move each side's group inward and make it smaller as the box narrows.
 */
const CORNERS = [
  '.side-l{transform-origin:0 1000px}.side-r{transform-origin:1600px 1000px}',
  '@media (max-aspect-ratio:13/10){.side-l{transform:translate(150px,0)}.side-r{transform:translate(-150px,0)}}',
  '@media (max-aspect-ratio:1/1){.side-l{transform:translate(300px,0) scale(.8)}.side-r{transform:translate(-300px,0) scale(.8)}}',
  '@media (max-aspect-ratio:3/4){.side-l{transform:translate(425px,0) scale(.6)}.side-r{transform:translate(-425px,0) scale(.6)}}',
  '@media (max-aspect-ratio:9/16){.side-l{transform:translate(520px,0) scale(.45)}.side-r{transform:translate(-520px,0) scale(.45)}}',
].join('')

function frame(style: string, body: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">' +
    `<style>${style}${CORNERS}${REDUCED}</style>${body}</svg>`
  )
}

function sky(id: string, stops: readonly string[]): string {
  const parts = stops.map((color, i) => `<stop offset="${n((i / (stops.length - 1)) * 100)}%" stop-color="${color}"/>`)

  return (
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${parts.join('')}</linearGradient></defs>` +
    `<rect width="1600" height="1000" fill="url(#${id})"/>`
  )
}

/** One pine tree: four stacked tiers and a trunk, its foot at (x, foot), `h` tall. */
function tree(x: number, foot: number, h: number): string {
  const w = h * 0.46
  const trunk = h * 0.08
  const top = foot - h
  let d = `M${n(x - trunk / 3)} ${n(foot)}h${n((trunk * 2) / 3)}v${n(-trunk)}h${n((-trunk * 2) / 3)}z`

  for (let tier = 0; tier < 4; tier += 1) {
    const tierTop = top + tier * h * 0.2
    const tierFoot = top + h * 0.34 + tier * h * 0.19
    const half = (w / 2) * (0.5 + tier * 0.17)
    d += `M${n(x)} ${n(tierTop)}L${n(x + half)} ${n(tierFoot)}L${n(x - half)} ${n(tierFoot)}z`
  }

  return d
}

/** A group of trees on one side: x positions within `width` from that side. */
function trees(side: 'l' | 'r', foot: number, list: readonly [number, number][], fill: string): string {
  const d = list.map(([x, h]) => tree(side === 'l' ? x : 1600 - x, foot, h)).join('')

  return `<g class="side-${side}"><path d="${d}" fill="${fill}"/></g>`
}

/**
 * An animation's delay so a redrawn scene carries on where the last one was: `t` is the time in seconds the
 * scene is drawn for (the time of the state change that redrew it), so every loop sits at the same point of
 * its cycle as it would have without the redraw, instead of jumping back to its start.
 */
function delay(base: number, cycle: number, t: number): string {
  const into = (((base + t) % cycle) + cycle) % cycle

  return `-${n(into)}s`
}

/**
 * Many small things moving the same way as ONE moving group: the group holds its drawing twice, the copy one
 * step back along the motion, and slides one step per loop, so the end of each loop looks exactly like its
 * start. One animated element per layer instead of one per drop.
 */
function loopGroup(cls: string, duration: number, t: number, base: number, dx: number, dy: number, drawing: string): string {
  return (
    `<g class="${cls}" style="animation-duration:${n(duration)}s;animation-delay:${delay(base, duration, t)}">` +
    `${drawing}<g transform="translate(${n(-dx)} ${n(-dy)})">${drawing}</g></g>`
  )
}

/** Keyframes for a loop group that slides by (dx, dy). */
function slide(name: string, dx: number, dy: number): string {
  return (
    `.${name}{animation-name:${name};animation-timing-function:linear;animation-iteration-count:infinite}` +
    `@keyframes ${name}{from{transform:translate(0,0)}to{transform:translate(${n(dx)}px,${n(dy)}px)}}`
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Winter: a night sky, three depths of snow, a string of warm lights across the top, pines in the bottom corners.

const LIGHTS = ['#ffcf6e', '#ff8a5b', '#ffe3a8', '#ff6b6b', '#f6e27f', '#ffb347']

/** A point on the quadratic swag from (x0, 60) to (x1, 60) that sags to 120 in the middle. */
function swag(x0: number, x1: number, t: number): [number, number] {
  const cx = (x0 + x1) / 2
  const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1
  const y = (1 - t) * (1 - t) * 60 + 2 * (1 - t) * t * 180 + t * t * 60

  return [x, y]
}

/** The three depths of snow: far flakes small, faint and slow; near ones big and quick. */
export const SNOW = [
  { count: 22, r: 1.3, opacity: 0.45, duration: 24, dx: 40 },
  { count: 18, r: 2.1, opacity: 0.7, duration: 16, dx: -70 },
  { count: 14, r: 3.3, opacity: 0.9, duration: 11, dx: 110 },
] as const

export function winterSvg(t = 0): string {
  const random = mulberry32(2026)
  let style =
    '.b{animation:twinkle 2.6s ease-in-out infinite alternate}' +
    '@keyframes twinkle{from{opacity:.35}to{opacity:1}}' +
    '.s{animation:glint 5s ease-in-out infinite alternate}@keyframes glint{from{opacity:.25}to{opacity:.8}}'

  // Stars in three groups that glint out of step.
  const starGroups: string[][] = [[], [], []]
  for (let i = 0; i < 40; i += 1) {
    const x = random() * 1600
    const y = 140 + random() * 380
    starGroups[i % 3]?.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(0.6 + random() * 0.9)}"/>`)
  }
  const stars = starGroups
    .map((group, i) => `<g class="s" fill="#dfe8ff" style="animation-delay:${delay(i * 1.7, 10, t)}">${group.join('')}</g>`)
    .join('')

  // Snow: each depth is one group of flakes sliding down (and a little sideways) in a seamless loop.
  const snow = SNOW.map((layer, depth) => {
    const dots: string[] = []
    for (let i = 0; i < layer.count; i += 1) {
      const x = random() * 1900 - 150
      const y = random() * 1000
      dots.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(layer.r * (0.8 + random() * 0.4))}"/>`)
    }
    style += slide(`snow${depth}`, layer.dx, 1000)

    return loopGroup(
      `snow${depth}`,
      layer.duration,
      t,
      depth * 3.1,
      layer.dx,
      1000,
      `<g class="flakes" fill="#ffffff" opacity="${layer.opacity}">${dots.join('')}</g>`,
    )
  }).join('')

  // Lights: 24 bulbs in three groups that twinkle out of step.
  const bulbGroups: string[][] = [[], [], []]
  for (let i = 0; i < 24; i += 1) {
    const [x0, x1] = i < 12 ? [-20, 800] : [800, 1620]
    const [x, y] = swag(x0, x1, ((i % 12) + 0.5) / 12)
    const color = LIGHTS[i % LIGHTS.length] ?? '#ffcf6e'
    bulbGroups[i % 3]?.push(
      `<circle cx="${n(x)}" cy="${n(y + 9)}" r="16" fill="${color}" opacity=".22"/>` +
        `<circle class="bulb" cx="${n(x)}" cy="${n(y + 9)}" r="6" fill="${color}"/>`,
    )
  }
  const bulbs = bulbGroups
    .map((group, i) => `<g class="b" style="animation-delay:${delay(i * 0.87, 5.2, t)}">${group.join('')}</g>`)
    .join('')

  const pines: [number, number][] = [
    [60, 250],
    [150, 200],
    [250, 270],
    [320, 160],
  ]
  const ground =
    '<path d="M0 958Q200 940 400 956T800 954T1200 952T1600 950V1000H0z" fill="#dfe7ef" opacity=".92"/>' +
    '<path d="M0 972Q260 962 520 974T1040 970T1600 968V1000H0z" fill="#f4f7fb"/>'

  return frame(
    style,
    sky('winter-sky', ['#0d1b2a', '#1b263b', '#415a77']) +
      stars +
      trees('l', 962, pines, '#0b2016') +
      trees('r', 962, pines, '#0b2016') +
      ground +
      snow +
      '<path d="M-20 60Q390 180 800 60Q1210 180 1620 60" fill="none" stroke="#1a1f26" stroke-width="2.5"/>' +
      bulbs,
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Market weather: clear (soft blue, sun glow top right, slow clouds), windy (faster clouds, wind streaks),
// storm (dark slate, rain, a lightning flash every nine seconds).

function cloud(y: number, scale: number, fill: string, opacity: number, duration: number, base: number, t: number): string {
  const body =
    `<ellipse cx="0" cy="0" rx="${n(110 * scale)}" ry="${n(34 * scale)}"/>` +
    `<ellipse cx="${n(-50 * scale)}" cy="${n(-18 * scale)}" rx="${n(60 * scale)}" ry="${n(38 * scale)}"/>` +
    `<ellipse cx="${n(40 * scale)}" cy="${n(-26 * scale)}" rx="${n(70 * scale)}" ry="${n(46 * scale)}"/>`

  return (
    `<g class="c" style="animation-duration:${n(duration)}s;animation-delay:${delay(base, duration, t)}">` +
    `<g transform="translate(0 ${n(y)})" fill="${fill}" opacity="${opacity}">${body}</g></g>`
  )
}

const CLOUD_STYLE =
  '.c{animation-name:drift;animation-timing-function:linear;animation-iteration-count:infinite}' +
  '@keyframes drift{from{transform:translateX(-320px)}to{transform:translateX(1920px)}}'

/** Rain falls along the slant of its lines (14 across for every 46 down): 304 across per 1000 down. */
const RAIN_DX = -304

export function weatherSvg(mood: Mood, t = 0): string {
  const random = mulberry32(mood === 'clear' ? 11 : mood === 'windy' ? 22 : 33)

  if (mood === 'clear') {
    return frame(
      CLOUD_STYLE +
        '.sun{transform-origin:1420px 130px;animation:glow 8s ease-in-out infinite alternate}' +
        '@keyframes glow{from{transform:scale(.94);opacity:.8}to{transform:scale(1.06);opacity:1}}',
      sky('weather-sky', ['#8fb8de', '#bcd6ec', '#e3eef7']) +
        '<defs><radialGradient id="sun"><stop offset="0%" stop-color="#fff6d0"/><stop offset="35%" stop-color="#ffe9a3" stop-opacity=".75"/>' +
        '<stop offset="100%" stop-color="#ffe9a3" stop-opacity="0"/></radialGradient></defs>' +
        `<circle class="sun" cx="1420" cy="130" r="260" fill="url(#sun)" style="animation-delay:${delay(0, 16, t)}"/>` +
        cloud(110, 1.1, '#ffffff', 0.85, 150, 40, t) +
        cloud(200, 0.8, '#ffffff', 0.7, 190, 130, t),
    )
  }

  if (mood === 'windy') {
    // Wind streaks: two groups of short curved strokes sliding right in a seamless loop, at two speeds.
    const gusts = [
      { count: 6, duration: 4.5, opacity: 0.5 },
      { count: 5, duration: 7, opacity: 0.3 },
    ]
      .map((gust, i) => {
        let d = ''
        for (let k = 0; k < gust.count; k += 1) {
          const x = random() * 1600
          const y = 70 + random() * 260
          const length = 120 + random() * 80
          const bend = 8 + random() * 10
          d += `M${n(x)} ${n(y)}q${n(length / 2)} ${n(-bend)} ${n(length)} 0`
        }

        return loopGroup('gust', gust.duration, t, i * 2.3, 1600, 0, `<path d="${d}" stroke-opacity="${gust.opacity}"/>`)
      })
      .join('')

    return frame(
      CLOUD_STYLE + '.gust{fill:none;stroke:#eef3f7;stroke-width:2;stroke-linecap:round}' + slide('gust', 1600, 0),
      sky('weather-sky', ['#5f7a93', '#8199ae', '#a9bac8']) +
        cloud(90, 1.2, '#e4ebf1', 0.8, 46, 10, t) +
        cloud(180, 0.9, '#d6dfe7', 0.75, 58, 35, t) +
        cloud(260, 0.7, '#e4ebf1', 0.6, 40, 22, t) +
        gusts,
    )
  }

  // Rain: two depths, each one group of slanted lines sliding down along the slant in a seamless loop.
  // Drops start spread over the whole screen height, so the rain is even from top to bottom.
  const rain = [
    { count: 40, duration: 0.8, opacity: 0.35, width: 1.6 },
    { count: 30, duration: 1.15, opacity: 0.22, width: 1.2 },
  ]
    .map((depth, i) => {
      let d = ''
      for (let k = 0; k < depth.count; k += 1) {
        const x = random() * 2000 - 100
        const y = random() * 1000
        d += `M${n(x)} ${n(y)}l-14 46`
      }

      return loopGroup(
        'rain',
        depth.duration,
        t,
        i * 0.4,
        RAIN_DX,
        1000,
        `<path d="${d}" stroke-opacity="${depth.opacity}" stroke-width="${depth.width}"/>`,
      )
    })
    .join('')

  return frame(
    CLOUD_STYLE +
      '.rain{fill:none;stroke:#a9b8c8;stroke-linecap:round}' +
      slide('rain', RAIN_DX, 1000) +
      '.flash{opacity:0;animation:flash 9s linear infinite}' +
      '@keyframes flash{0%,96%{opacity:0}97%{opacity:.6}100%{opacity:0}}',
    sky('weather-sky', ['#1c2530', '#2c3a48', '#3d4b59']) +
      cloud(70, 1.5, '#121921', 0.85, 70, 15, t) +
      cloud(130, 1.2, '#18212b', 0.8, 85, 50, t) +
      cloud(60, 1.3, '#141b24', 0.85, 95, 75, t) +
      rain +
      `<g class="flash" style="animation-delay:${delay(0, 9, t)}"><rect width="1600" height="1000" fill="#e8f0ff"/>` +
      '<path d="M250 40L205 170L245 170L190 320L300 140L255 140L295 40z" fill="#f4f7ff"/></g>',
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Pine: three layers of pines at the bottom sides and slow mist. A DaviddTech Aid check adds one soft red or
// green glow at the edges; its id carries the check's time, so a new check plays the glow again.

const PULSE_COLOR = { red: '#e5484d', green: '#30a46c' } as const

export function pineSvg(pulse: Pulse | null, t = 0): string {
  const random = mulberry32(77)
  const layer = (count: number, min: number, spread: number, reach: number): [number, number][] =>
    Array.from({ length: count }, (): [number, number] => [20 + random() * reach, min + random() * spread])
  const far = layer(7, 110, 70, 330)
  const mid = layer(6, 150, 80, 290)
  const near = layer(4, 200, 80, 240)

  // The mist drifts back and forth (alternate), so one whole round trip is twice its duration.
  const mist = [
    { y: 640, rx: 700, duration: 46, base: 0 },
    { y: 760, rx: 820, duration: 60, base: 20 },
    { y: 860, rx: 900, duration: 38, base: 9 },
  ]
    .map(
      band =>
        `<ellipse class="m" cx="800" cy="${band.y}" rx="${band.rx}" ry="60" fill="url(#mist)" ` +
        `style="animation-duration:${band.duration}s;animation-delay:${delay(band.base, band.duration * 2, t)}"/>`,
    )
    .join('')

  const glow =
    pulse === null
      ? ''
      : `<defs><radialGradient id="glow-${pulse.at}" cx="50%" cy="50%" r="75%">` +
        `<stop offset="45%" stop-color="${PULSE_COLOR[pulse.kind]}" stop-opacity="0"/>` +
        `<stop offset="100%" stop-color="${PULSE_COLOR[pulse.kind]}" stop-opacity="1"/></radialGradient></defs>` +
        `<rect id="pulse-${pulse.at}" class="pulse" width="1600" height="1000" fill="url(#glow-${pulse.at})"/>`

  return frame(
    '.m{animation-name:mist;animation-timing-function:ease-in-out;animation-iteration-count:infinite;animation-direction:alternate}' +
      '@keyframes mist{from{transform:translateX(-90px)}to{transform:translateX(90px)}}' +
      '.pulse{opacity:0;animation:pulse 2.4s ease-in-out;animation-iteration-count:1;animation-fill-mode:forwards}' +
      '@keyframes pulse{0%{opacity:0}50%{opacity:.35}100%{opacity:0}}',
    sky('pine-sky', ['#22332c', '#355446', '#7c9a86']) +
      '<defs><radialGradient id="mist"><stop offset="0%" stop-color="#e9f1ec" stop-opacity=".22"/>' +
      '<stop offset="100%" stop-color="#e9f1ec" stop-opacity="0"/></radialGradient></defs>' +
      trees('l', 1000, far, '#4b6b5a') +
      trees('r', 1000, far, '#4b6b5a') +
      mist +
      trees('l', 1000, mid, '#2f4a3c') +
      trees('r', 1000, mid, '#2f4a3c') +
      trees('l', 1000, near, '#162a20') +
      trees('r', 1000, near, '#162a20') +
      glow,
  )
}

/** What each scene shows, for a reader that cannot see it. */
export function altOf(scene: string, mood: Mood, pulse: Pulse | null): string {
  if (scene === 'winter') {
    return 'A winter night: falling snow, a string of warm lights and pine trees in the corners'
  }
  if (scene === 'market-weather') {
    return mood === 'storm'
      ? 'Market weather: a stormy sky with rain and lightning'
      : mood === 'windy'
        ? 'Market weather: a windy sky with fast clouds'
        : 'Market weather: a calm blue sky with a soft sun'
  }

  return pulse === null
    ? 'A pine forest with drifting mist'
    : `A pine forest with drifting mist and a ${pulse.kind} glow after a DaviddTech Aid check`
}
