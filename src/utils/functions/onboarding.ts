import type { SettingsData } from '../../redux/slices/settingsDataStateSlice';

// KAN-7. When each first-open surface applies, from settingsData alone.

type FullViewUse = Pick<
  SettingsData,
  'hasOpenedFullView' | 'openNowWidth' | 'foldSavedSessionInTabView'
>;

// §6. Only the full view writes the other two, so either one means it was used before KAN-7.
export function hasUsedFullView(s: FullViewUse): boolean {
  return (
    s.hasOpenedFullView ||
    s.openNowWidth !== null ||
    s.foldSavedSessionInTabView === false
  );
}

// §3. A new install, until either answer or until the full view has been used.
export function shouldOfferFullView(
  s: Pick<SettingsData, 'setupState' | 'isFullViewOfferAnswered'> & FullViewUse
): boolean {
  return (
    s.setupState !== 'none' && !s.isFullViewOfferAnswered && !hasUsedFullView(s)
  );
}
