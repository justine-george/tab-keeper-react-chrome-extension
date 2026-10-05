import type { TFunction } from 'i18next';

import { Theme } from '../../../redux/slices/settingsDataStateSlice';
import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
  type ThemeColors,
} from '../../../hooks/useThemeColors';

// The five themes in picker order, Settings' and the setup's. t() takes a
// literal on each row, so keyCoverage sees every key.
export function themeChoices(
  t: TFunction
): ReadonlyArray<readonly [Theme, ThemeColors, string]> {
  return [
    [Theme.LIGHT, LIGHT_THEME, t('Paper')],
    [Theme.WARM_LIGHT, WARM_LIGHT_THEME, t('Parchment')],
    [Theme.BB_PINK, BB_PINK_THEME, t('Petal')],
    [Theme.DARKENHEIMER, DARKENHEIMER_THEME, t('Graphite')],
    [Theme.BLUE, BLUE_THEME, t('Ink')],
  ];
}
