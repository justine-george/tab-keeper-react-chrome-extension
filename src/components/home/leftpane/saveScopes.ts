import type { IconName } from '../../common/iconNames';
import type { CaptureScope } from '../../../utils/functions/capture';

// KAN-635. Each scope's save as the row draws it: its i18n key and glyph. Settings, Open now and the tour draw the same glyphs.
// KAN-780. One window with a plus, two windows with the same plus: custom SVG glyphs (Glyph.tsx).
export const SAVE_OF: Record<
  CaptureScope,
  { labelKey: string; icon: IconName }
> = {
  'all-windows': {
    labelKey: 'Save every open window as a session',
    icon: 'two_windows_add',
  },
  'current-window': {
    labelKey: 'Save current window as a session',
    icon: 'window_add',
  },
};

// The scope the ⋮ menu saves: whichever the button does not.
export const otherScope = (scope: CaptureScope): CaptureScope =>
  scope === 'all-windows' ? 'current-window' : 'all-windows';
