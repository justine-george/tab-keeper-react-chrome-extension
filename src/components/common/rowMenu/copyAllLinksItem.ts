import type { TFunction } from 'i18next';

import type { OverflowMenuItem } from '../MenuPanel';
import type { AppDispatch } from '../../../redux/store';
import { showToast } from '../../../redux/slices/globalStateSlice';
import { TOAST_MESSAGES } from '../../../utils/constants/common';

// KAN-783. Every Copy all links, session, window or group: `copy` puts the links on the clipboard and resolves how many, or null when refused (KAN-713), which stays quiet.
export function copyAllLinksItem(
  copy: () => Promise<number | null>,
  ctx: { t: TFunction; dispatch: AppDispatch }
): OverflowMenuItem {
  return {
    key: 'copy',
    label: ctx.t('Copy all links'),
    icon: 'link',
    onSelect: async () => {
      const count = await copy();
      if (count === null) return;
      // The clipboard says nothing of its own (KAN-401).
      ctx.dispatch(
        showToast({
          toastText: TOAST_MESSAGES.COPY_LINKS_SUCCESS,
          toastParams: { count },
          stacksOnTwin: true,
        })
      );
    },
  };
}
