import type { ThemeSetArgs } from 'claude-code'

import type { LookName } from '../types'
import { makeColors } from './make-colors.js'

/** Scene names as `$.theme.set` gets them and the Backdrop hook reads them back. */
export const SCENES: Record<LookName, string> = { winter: 'winter', weather: 'market-weather', pine: 'pine' }

/** Frosted panels over every scene; no tint, so each surface frosts with its own panel color in both modes. */
const GLASS = { blur: 18, opacity: 0.55 }

// A winter night: cold blue grays, warm amber for the lights.
const WINTER = makeColors({
  label: 'DaviddTech winter',
  roles: { accent: '#5b8def', danger: '#d1495b', success: '#3a9d6e', warning: '#d9a441', pro: '#8a6fd1' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#e6ecf4',
        'surface-1': '#edf2f8',
        'surface-2': '#f5f8fc',
        'text-primary': '#14202f',
        'text-secondary': '#33435a',
        'text-muted': '#4f5f76',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#0f1724',
        'surface-1': '#152033',
        'surface-2': '#1b2840',
        'surface-3': '#213049',
        'text-primary': '#e8eef7',
        'text-secondary': '#c3cede',
        'text-muted': '#9aa8bd',
      },
    },
  },
})

// A pine forest: moss-tinted grays by day, deep forest by night.
const PINE = makeColors({
  label: 'DaviddTech pine',
  roles: { accent: '#3f8f5f', danger: '#c2453d', success: '#4c9a52', warning: '#c99a2e', pro: '#7a6bb0' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#e7ede7',
        'surface-1': '#eef3ee',
        'surface-2': '#f6f9f6',
        'text-primary': '#16231a',
        'text-secondary': '#34473a',
        'text-muted': '#4e6354',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#0f1813',
        'surface-1': '#15211a',
        'surface-2': '#1b2a21',
        'surface-3': '#203127',
        'text-primary': '#e6f0e8',
        'text-secondary': '#c1d1c5',
        'text-muted': '#98ab9d',
      },
    },
  },
})

// Market weather: slate grays that sit under a clear, windy or stormy sky.
const WEATHER = makeColors({
  label: 'DaviddTech market weather',
  roles: { accent: '#4a90b8', danger: '#c8504a', success: '#3f9a6c', warning: '#c9952f', pro: '#7f72b8' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#e5eaef',
        'surface-1': '#ecf0f4',
        'surface-2': '#f4f7f9',
        'text-primary': '#17202a',
        'text-secondary': '#35424f',
        'text-muted': '#505e6c',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#11161c',
        'surface-1': '#171e26',
        'surface-2': '#1d2530',
        'surface-3': '#222b37',
        'text-primary': '#e7ecf1',
        'text-secondary': '#c2cbd5',
        'text-muted': '#99a5b2',
      },
    },
  },
})

/** What `makeColors` said about each look's colors (contrast notes), for the tests and while building. */
export const PROBLEMS: Record<LookName, string[]> = {
  winter: WINTER.problems,
  weather: WEATHER.problems,
  pine: PINE.problems,
}

/** Each look as one whole `$.theme.set` call: a moving scene, frosted panels and a palette for both modes. */
export const LOOKS: Record<LookName, ThemeSetArgs> = {
  winter: { backdrop: { scene: SCENES.winter, glass: GLASS }, colors: WINTER.theme },
  weather: { backdrop: { scene: SCENES.weather, glass: GLASS }, colors: WEATHER.theme },
  pine: { backdrop: { scene: SCENES.pine, glass: GLASS }, colors: PINE.theme },
}

export const NAMES: readonly LookName[] = ['winter', 'weather', 'pine']

export function isLook(value: unknown): value is LookName {
  return value === 'winter' || value === 'weather' || value === 'pine'
}
