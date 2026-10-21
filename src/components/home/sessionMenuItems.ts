import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { OverflowMenuItem } from '../common/MenuPanel';
import type { AppDispatch } from '../../redux/store';
import {
  deleteTabContainer,
  removeDuplicateTabs,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { showToast } from '../../redux/slices/globalStateSlice';
import { copySessionLinks } from '../../utils/functions/copySessionLinks';
import { tidySessionForExport } from '../../utils/functions/sessionExportHtml';
import { countDuplicateTabs } from '../../utils/functions/duplicateTabs';
import { openBesideActiveTab } from '../../utils/functions/openBesideActiveTab';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import {
  deleteKeyShortcutsFor,
  isDeleteKey,
} from '../../utils/functions/deleteKey';
import { useMacKeys } from '../../hooks/useIsMac';

type DeleteKey = NonNullable<OverflowMenuItem['shortcut']>;

// KAN-592, KAN-638, KAN-708. Delete session's key, for its row, its ⋮ and its right-click menu; the PC form until Chrome says.
export function useSessionDeleteKey(): DeleteKey {
  const { t } = useTranslation();
  const isMac = useMacKeys();
  return {
    hint: isMac ? '⌫' : t('Del'),
    ariaKeyShortcuts: deleteKeyShortcutsFor(isMac),
    matches: isDeleteKey,
  };
}

// KAN-708. The one item source for the header ⋮ and the row's right-click; every item acts on `session`, never the selection.
export function sessionMenuItems(
  session: tabContainerData,
  ctx: {
    t: TFunction;
    language: string;
    dispatch: AppDispatch;
    deleteKey: DeleteKey;
  }
): OverflowMenuItem[] {
  const { t, language, dispatch, deleteKey } = ctx;
  const { tabGroupId } = session;
  const duplicateCount = countDuplicateTabs(session);
  return [
    {
      // KAN-209. The one output that needs no preview: Copy ignores
      // the layout and colour choices the export page exists to
      // offer, so reaching it through a new tab was a detour.
      //
      // FIRST, because it is the only item here that finishes where
      // it started -- Export opens a tab, Delete changes the session
      // -- so the menu reads cheap, heavier, destructive.
      //
      // TIDIED, exactly as the export page's Copy is (KAN-210).
      // KAN-202's clean-ups -- dropping a site's notification count
      // from a title, and unwrapping a suspended tab's real address
      // -- are not a preview concern: they are wrong in anything
      // anyone shares, whichever button produced it. This shipped
      // passing the raw session, so the shortcut gave the worse of
      // two answers for the same command.
      //
      // No edits applied: there is no preview here to respect, which
      // is the only difference left between the two call sites.
      key: 'copy',
      label: t('Copy all links'),
      icon: 'link',
      onSelect: async () => {
        const count = await copySessionLinks(
          tidySessionForExport(session),
          t,
          language
        );
        // KAN-713. Nothing on the clipboard, so nothing to announce.
        if (count === null) return;
        // The clipboard says nothing of its own, and unlike the
        // export page there is no room here for an inline note.
        dispatch(
          showToast({
            toastText: TOAST_MESSAGES.COPY_LINKS_SUCCESS,
            toastParams: { count },
            stacksOnTwin: true,
          })
        );
      },
    },
    {
      key: 'export',
      label: t('Export session'),
      icon: 'ios_share',
      onSelect: () => {
        // Opening a tab takes focus, which destroys the popup.
        // Nothing may be sequenced after this call -- the whole
        // address is built first, so there is nothing left to do
        // when the context dies.
        void openBesideActiveTab(
          chrome.runtime.getURL(
            `export.html?session=${encodeURIComponent(tabGroupId)}`
          )
        );
      },
    },
    // KAN-609. Only while there is one to remove: the menu has no
    // dimmed item, and "Remove 0" would say what it isn't doing.
    // Before Delete, which stays last as the heaviest.
    ...(duplicateCount > 0
      ? [
          {
            key: 'duplicates',
            label: t('RemoveDuplicateTabs', { count: duplicateCount }),
            icon: 'stack_off' as const,
            onSelect: () => void dispatch(removeDuplicateTabs({ tabGroupId })),
          },
        ]
      : []),
    {
      key: 'delete',
      label: t('Delete session'),
      icon: 'delete',
      danger: true,
      shortcut: deleteKey,
      onSelect: () => void dispatch(deleteTabContainer(tabGroupId)),
    },
  ];
}
