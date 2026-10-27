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

// KAN-829. A new install's theme: Chalk on every OS (KAN-731 picked Charcoal on a dark one); public/theme-ground.js repeats it.
export function defaultTheme(): Theme {
  return Theme.CHALK;
}

// Whether a value is one of this build's themes.
export function isTheme(value: unknown): value is Theme {
  return Object.values(Theme).some((theme) => theme === value);
}

// A stored theme this build knows, else the default.
export function asTheme(value: unknown): Theme {
  return isTheme(value) ? value : defaultTheme();
}

// KAN-731. Where the one-time move takes a stored theme: Paper to Chalk, Graphite to Charcoal, the rest kept.
export function afterChalkCharcoalMove(theme: Theme): Theme {
  if (theme === Theme.LIGHT) return Theme.CHALK;
  if (theme === Theme.DARKENHEIMER) return Theme.CHARCOAL;
  return theme;
}
