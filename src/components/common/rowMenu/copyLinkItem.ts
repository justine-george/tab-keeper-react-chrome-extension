import type { TFunction } from 'i18next';

import type { OverflowMenuItem } from '../MenuPanel';
import type { AppDispatch } from '../../../redux/store';
import { showToast } from '../../../redux/slices/globalStateSlice';
import { copyTabLink } from '../../../utils/functions/copyTabLink';
import { TOAST_MESSAGES } from '../../../utils/constants/common';

// KAN-708. A tab menu's Copy link, saved or live: copies the tab's address and says so, or stays quiet if refused.
export function copyLinkItem(
  url: string,
  ctx: { t: TFunction; dispatch: AppDispatch }
): OverflowMenuItem {
  return {
    key: 'copy-link',
    label: ctx.t('Copy link'),
    icon: 'link',
    onSelect: async () => {
      if (await copyTabLink(url)) {
        ctx.dispatch(
          showToast({
            toastText: TOAST_MESSAGES.COPY_LINKS_SUCCESS,
            toastParams: { count: 1 },
            stacksOnTwin: true,
          })
        );
      }
    },
  };
}
