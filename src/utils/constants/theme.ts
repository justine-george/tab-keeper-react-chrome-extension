// KAN-370. Outside the settings slice, which reads localStorage on import:
// the palettes need this enum, and e2e specs load them into Node.
export enum Theme {
  LIGHT = 'Light',
  WARM_LIGHT = 'WarmLight',
  BB_PINK = 'BBPink',
  DARKENHEIMER = 'Darkenheimer',
  BLUE = 'Blue',
}
