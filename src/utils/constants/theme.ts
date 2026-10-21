// KAN-370. Outside the settings slice, which reads localStorage on import:
// the palettes need this enum, and e2e specs load them into Node.
export enum Theme {
  LIGHT = 'Light',
  WARM_LIGHT = 'WarmLight',
  BB_PINK = 'BBPink',
  DARKENHEIMER = 'Darkenheimer',
  BLUE = 'Blue',
  CHALK = 'Chalk',
  CHARCOAL = 'Charcoal',
}

// KAN-731. A new install's theme: Charcoal on a dark OS, else Chalk. No DOM (Node, a worker): Chalk.
// public/theme-ground.js repeats this rule in plain JS.
export function defaultTheme(): Theme {
  const dark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return dark ? Theme.CHARCOAL : Theme.CHALK;
}

// A stored theme this build knows, else the default.
export function asTheme(value: unknown): Theme {
  return Object.values(Theme).includes(value as Theme)
    ? (value as Theme)
    : defaultTheme();
}
