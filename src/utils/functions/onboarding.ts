import type { SettingsData } from '../../redux/slices/settingsDataStateSlice';
import type { ToolbarPin } from './toolbarPin';

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

// §4. Unpinned on this machine and not dismissed here; 'unknown' never shows it.
export function shouldShowPinGuide(
  s: Pick<SettingsData, 'isPinGuideDismissed'>,
  pin: ToolbarPin
): boolean {
  return !s.isPinGuideDismissed && pin === 'unpinned';
}

// §5. A new install between the welcome and Done or Skip setup.
export function shouldShowSetup(s: Pick<SettingsData, 'setupState'>): boolean {
  return s.setupState === 'pending';
}
