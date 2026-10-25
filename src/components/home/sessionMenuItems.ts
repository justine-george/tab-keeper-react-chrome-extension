import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { OverflowMenuItem } from '../common/MenuPanel';
import type { AppDispatch } from '../../redux/store';
import {
  deleteTabContainer,
  openAllTabContainer,
  removeDuplicateTabs,
  replaceSessionWithOpenWindows,
  requestFocusTabContainer,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { showSessionAndAddCurrentWindow } from '../../redux/showSessionAndAddCurrentWindow';
import { copySessionLinks } from '../../utils/functions/copySessionLinks';
import { copyAllLinksItem } from '../common/rowMenu/copyAllLinksItem';
import { tidySessionForExport } from '../../utils/functions/sessionExportHtml';
import { countDuplicateTabs } from '../../utils/functions/duplicateTabs';
import { openBesideActiveTab } from '../../utils/functions/openBesideActiveTab';
import {
  deleteKeyShortcutsFor,
  isDeleteKey,
} from '../../utils/functions/deleteKey';
import { useMacKeys } from '../../hooks/useIsMac';
import { isTabView } from '../../utils/functions/viewMode';

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

// KAN-775. Where the menu opened: the header, the row of the session on screen, or any other row.
export type SessionMenuPlace = 'header' | 'onScreenRow' | 'offScreenRow';

// KAN-708. The one item source for the header ⋮ and the row's right-click; every item acts on `session`, never the selection.
export function sessionMenuItems(
  session: tabContainerData,
  ctx: {
    t: TFunction;
    language: string;
    dispatch: AppDispatch;
    deleteKey: DeleteKey;
    place: SessionMenuPlace;
  }
): OverflowMenuItem[] {
  const { t, language, dispatch, deleteKey, place } = ctx;
  const { tabGroupId } = session;
  const duplicateCount = countDuplicateTabs(session);
  // KAN-775. A row off screen has no buttons of its own, so its menu leads with them; Switch is popup only, as the row's.
  const rowButtons: OverflowMenuItem[] =
    place !== 'offScreenRow'
      ? []
      : [
          {
            key: 'open',
            actionRowLabel: t('Open'),
            label: t('Open session'),
            icon: 'reopen_window',
            onSelect: () =>
              void dispatch(
                openAllTabContainer({ tabGroupId, goToURLText: t('Go to URL') })
              ),
          },
          ...(isTabView()
            ? []
            : [
                {
                  key: 'switch',
                  actionRowLabel: t('Switch'),
                  label: t('Switch to session'),
                  icon: 'filter_center_focus' as const,
                  onSelect: () =>
                    void dispatch(
                      requestFocusTabContainer({
                        tabGroupId,
                        goToURLText: t('Go to URL'),
                        saveTitle: t('FocusAutoSaveTitle'),
                      })
                    ),
                },
              ]),
          {
            key: 'replace',
            actionRowLabel: t('Replace'),
            label: t('Replace this session with open windows'),
            icon: 'browser_updated',
            onSelect: () =>
              void dispatch(replaceSessionWithOpenWindows(tabGroupId)),
          },
        ];
  // KAN-775. The header has its own Add chip beside the ⋮.
  const add: OverflowMenuItem[] =
    place === 'header'
      ? []
      : [
          {
            key: 'add',
            label: t('Add current window'),
            icon: 'playlist_add',
            onSelect: () =>
              void dispatch(showSessionAndAddCurrentWindow(tabGroupId)),
          },
        ];
  return [
    ...rowButtons,
    ...add,
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
    copyAllLinksItem(
      () => copySessionLinks(tidySessionForExport(session), t, language),
      { t, dispatch }
    ),
    {
      key: 'export',
      label: t('Save session as PDF'),
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
