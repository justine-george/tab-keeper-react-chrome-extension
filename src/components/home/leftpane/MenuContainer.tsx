import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import FullViewCallout from './FullViewCallout';
import { useThemeColors } from '../../../hooks/useThemeColors';

import Icon from '../../common/Icon';
import OverflowMenu from '../../common/OverflowMenu';
import type { OverflowMenuItem } from '../../common/OverflowMenu';
import {
  resetSessionOrder,
  sortSessions,
} from '../../../redux/slices/tabContainerDataStateSlice';
import { AppDispatch, RootState } from '../../../redux/store';
import {
  closeAllToasts,
  closePlainToasts,
  openSettingsPage,
  syncNowWhenSignedIn,
  closeFullViewCallout,
  openCloudConsentModal,
} from '../../../redux/slices/globalStateSlice';
import {
  isRedoableSelector,
  isUndoableSelector,
  redo,
  undo,
} from '../../../redux/slices/undoRedoSlice';
import { SettingsCategory } from '../../../redux/slices/settingsCategoryStateSlice';
import {
  markFullViewCalloutSeen,
  setSessionDateBasis,
} from '../../../redux/slices/settingsDataStateSlice';
import { useTranslation } from 'react-i18next';
import { DURATION, ICON } from '../../../styles/scale';
import type { IconName } from '../../common/iconNames';
import {
  describeSyncState,
  type SyncKind,
} from '../../settings/rightpane/Account/describeSyncState';
import { isTabView } from '../../../utils/functions/viewMode';
import { getPrettyDate } from '../../../utils/functions/local';
import { requestTabView } from '../../../utils/functions/popOut';
import { endRunAtFullViewButton } from '../../../redux/firstRun';

export default function MenuContainer() {
  const syncStatus = useSelector(
    (state: RootState) => state.globalState.syncStatus
  );
  const cloudConsent = useSelector(
    (state: RootState) => state.settingsDataState.cloudConsent
  );

  const isSignedIn = useSelector(
    (state: RootState) => state.globalState.isSignedIn
  );
  const isCloudConfigured = useSelector(
    (state: RootState) => state.globalState.isCloudConfigured
  );
  const isAutoSync = useSelector(
    (state: RootState) => state.settingsDataState.isAutoSync
  );
  const lastSyncedTime = useSelector(
    (state: RootState) => state.settingsDataState.lastSyncedTime
  );

  const COLORS = useThemeColors();
  const isFullViewCalloutOpen = useSelector(
    (state: RootState) => state.globalState.isFullViewCalloutOpen
  );

  // i18n.language feeds the reducer's title collation; see sortItems below.
  const { t, i18n } = useTranslation();
  const dispatch: AppDispatch = useDispatch();

  const isUndoable = useSelector(isUndoableSelector);
  const isRedoable = useSelector(isRedoableSelector);

  function handleClickUndo() {
    dispatch(undo());
    dispatch(closePlainToasts());
  }

  function handleClickRedo() {
    dispatch(redo());
    dispatch(closePlainToasts());
  }

  // KAN-259. Manual sync is a sync: without consent it asks the cloud
  // question instead of uploading, and with it the Firebase session is
  // started here if this is the first time (the boot effect starts it only
  // when Auto Sync is on).
  //
  // KAN-266. Started AND waited for. The boot sync waits for isFirebaseAuthed;
  // this used to dispatch in the same tick as ensureCloudSession, so the read
  // went out before sign-in landed, the rules denied it, and the denial was
  // read as "no document yet" -- after which the write, by now authorised,
  // replaced the other device's document with local state.
  function handleClickSync() {
    if (cloudConsent !== 'granted') {
      dispatch(openCloudConsentModal({ variant: 'enable', then: 'syncNow' }));
      return;
    }
    void dispatch(syncNowWhenSignedIn());
  }

  function handleClickSettings() {
    dispatch(openSettingsPage(SettingsCategory.DISPLAY));
    dispatch(closeAllToasts());
  }

  // Seen only once it has been on screen; ⤢ during the wait is just ⤢.
  const seeFullViewCallout = () => {
    if (isFullViewCalloutOpen) dispatch(markFullViewCalloutSeen());
    dispatch(closeFullViewCallout());
  };

  // KAN-279. This popup cannot open or focus the tab view itself: the click
  // that would do it is the same click that backgrounds this popup, and a
  // Chrome popup is torn down the instant it loses focus -- before a
  // chrome.tabs.create()/update() this component started could resolve. So
  // the click only hands off a request; openOrFocusTabView (popOut.ts), run
  // from the worker, is what actually finds or creates the tab and outlives
  // the popup doing it.
  // requestTabView (popOut.ts) sends that request.
  function handleClickOpenInTab() {
    dispatch(endRunAtFullViewButton());
    seeFullViewCallout();
    void requestTabView();
  }

  // The control shows the `sync` glyph only when syncing is possible AND
  // something may be out of sync. Every other case shows what is true instead.
  //
  // `isSignedIn` is checked FIRST and beats any status, because it is the only
  // one of the two that decides whether the action can work at all. It is not
  // a startup flash: App.tsx dispatches setLoggedOut on a failed
  // chrome.storage.sync write, on a read-back that does not match what was
  // written, and on a token that is present but unusable. In each of those the
  // control used to invite a click that called loadFromFirestore(userId!) with
  // no userId (KAN-79).
  //
  // Note what is NOT used here: `isDirty`. globalState is rebuilt on every
  // popup open, so `isDirty === false` means "no edits yet this session", not
  // "the two sides agree" -- with auto-sync off nothing has been compared at
  // all. Only a completed sync knows that, which is what syncStatus records.
  //
  // KAN-342. The words follow the same rule. A dimmed button has nothing to
  // press, so its name is why it is dimmed. A running sync is "Syncing…" in
  // every mode: describeSyncState puts Auto Sync first because the card
  // describes the setting, and under Manual sync it would name a dimmed
  // button "Manual sync", which says nothing about why it is dimmed.
  let syncIconType: IconName;
  let dimmedBecause: string | null = null;
  if (!isSignedIn) {
    syncIconType = 'cloud_off';
    dimmedBecause = t('Sync unavailable');
  } else if (syncStatus === 'loading') {
    syncIconType = 'cloud_sync';
    dimmedBecause = t('Syncing…');
  } else if (syncStatus === 'error') {
    syncIconType = 'sync_problem';
  } else if (syncStatus === 'success') {
    syncIconType = 'cloud_done';
  } else {
    syncIconType = 'sync';
  }

  // A clickable button keeps its action as its name. The state, in the Sync &
  // Backup card's words, is its description and the tooltip's first line.
  const syncState = syncStateWords(
    describeSyncState({
      isSignedIn,
      isAutoSync,
      isCloudConfigured,
      cloudConsent,
      syncStatus,
    }).kind
  );

  // Once synced there is nothing known to send, so the second line says when
  // instead of "Sync now", as the card does (KAN-255). A click still reads
  // the cloud for other devices' changes -- firestore/lite has no listener --
  // so the name stays the action. Keyed on the glyph that says synced.
  const syncedWhen =
    syncIconType === 'cloud_done' && lastSyncedTime !== ''
      ? t('Last synced {{time}}', {
          time: getPrettyDate(lastSyncedTime, i18n.language),
        })
      : null;
  const syncDetail =
    syncedWhen === null ? syncState : `${syncState}\n${syncedWhen}`;

  // One literal key per state, so keyCoverage sees every one. The card's own
  // t(state.title) takes a variable, which it can't check.
  function syncStateWords(kind: SyncKind): string {
    switch (kind) {
      case 'unavailable':
        return t('Sync unavailable');
      case 'off':
        return t('Sync is off');
      case 'manual':
        return t('Manual sync');
      case 'failed':
        return t('Last sync failed');
      case 'syncing':
        return t('Syncing…');
      case 'on':
        return t('Cloud sync on');
    }
  }

  // The list is in its natural order iff nothing carries a manual rank. Derived,
  // never stored -- the same reasoning as KAN-130's: a stored sort mode would
  // be a container-level field, and this merge has no last-writer-wins rule for
  // one.
  //
  // It is what makes "Date modified" legible as the way BACK rather than a
  // fourth equal choice. Justine had to ask how to undo a sort, which is the
  // whole reason this tick exists. (KAN-136 put the tick on "Date saved";
  // KAN-141 moved the default order, and the tick followed it.)
  const isDefaultOrder = useSelector((state: RootState) =>
    state.tabContainerDataState.tabGroups.every((g) => g.rank === undefined)
  );

  // Every item is a ONE-SHOT rearrangement of the stored order, not a mode.
  //
  // The labels name the ORDER, not the act of sorting. "Sort by" on each item
  // repeats what the trigger already says, and at the menu's 180px it wrapped
  // three of these four onto two lines. Widening the menu is not available:
  // it is anchored `right: 0` and grows leftward from a trigger that sits
  // about 200px into a ~355px pane, so a wider box runs off the left edge.
  // OverflowMenu names the menu itself from ariaLabel, so a screen reader
  // still hears "Sort sessions" before it hears "Name".
  // KAN-141 swapped the first two. "Date modified" is now the DEFAULT order --
  // the one the list is in when nothing carries a rank -- so it is the item
  // that REMOVES ranks, and the only one that can be ticked, since it is the
  // only reachable state the data can report. "Date saved" became an ordinary
  // assigning sort like name and tab count.
  //
  // Listed first because it is the default, so the way back sits where the eye
  // starts rather than being hunted for.
  //
  // Every item sets which date the ROWS show, so the number on a row always
  // describes the order the list is in (KAN-141). The rule is one line: the
  // created date is shown if and only if the sort IS by created date.
  //
  // KAN-144 replaced the earlier version, where name and tab count left the
  // basis alone on the grounds that neither is a date order, so there was no
  // date for them to be right about. That argues for the DEFAULT, not for
  // keeping whatever was chosen before: sorting by Date saved and then by Name
  // left every row reading "Created", including sessions edited since, in a
  // list no longer in any date order at all. Justine: "the created date in
  // general for all should be shown only for the sort by created date setting."
  //
  // It also removes a special case. The basis is now a function of the active
  // sort rather than a fourth piece of state that drifts out of step with it.
  //
  // A session that has never been edited still reads "Created" whatever this
  // says -- sessionDateLabel forces both the word and the value for those,
  // because "Edited" would be a false statement about them.
  const sortItems: OverflowMenuItem[] = [
    {
      key: 'modified',
      label: t('Date modified'),
      icon: 'history',
      checked: isDefaultOrder,
      onSelect: () => {
        dispatch(resetSessionOrder());
        dispatch(setSessionDateBasis('edited'));
      },
    },
    {
      key: 'date',
      label: t('Date saved'),
      icon: 'schedule',
      checked: false,
      onSelect: () => {
        dispatch(sortSessions({ by: 'createdAt', locale: i18n.language }));
        dispatch(setSessionDateBasis('created'));
      },
    },
    {
      key: 'name',
      label: t('Name'),
      icon: 'sort_by_alpha',
      checked: false,
      onSelect: () => {
        dispatch(sortSessions({ by: 'name', locale: i18n.language }));
        dispatch(setSessionDateBasis('edited'));
      },
    },
    {
      key: 'tabs',
      label: t('Tab count'),
      icon: 'tab',
      checked: false,
      onSelect: () => {
        dispatch(sortSessions({ by: 'tabCount', locale: i18n.language }));
        dispatch(setSessionDateBasis('edited'));
      },
    },
  ];

  // KAN-340 A + R1. Three pairs by what they do: views (Open full view,
  // Sort), history (Undo, Redo), account and app (Sync, Settings). 8px
  // between pairs, none inside one, so hover fills within a pair still meet
  // as they always have. Open full view is the cluster's leftmost icon and
  // the cluster is right-aligned, so the five shared icons sit at the same x
  // in the popup and the tab view, where Sort stands alone in the first pair.
  // `gap` only spaces siblings that exist, so that lone pair leaves no
  // leading gap.
  const clusterStyle = css`
    display: flex;
    gap: 8px;
  `;
  const pairStyle = css`
    display: flex;
  `;

  return (
    <div css={clusterStyle}>
      <div css={pairStyle}>
        {/* KAN-136. Sits LEFT of the undo/redo cluster, and only when there is
          a list to sort. Rendered unconditionally: every item no-ops on an
          empty list (the reducer guards it), and a control that comes and goes
          is the same mistake as the strip it replaces.

          It replaces the strip KAN-130 put inside the list box, which rendered
          as a list item (same width, same borders, directly above the first
          row), shifted the list when it appeared, and only existed once the
          user had already found the drag gesture. A header control is present
          before that, and costs no vertical space in a pane that scrolls. */}
        {/* `sort`, not `swap_vert`. swap_vert is two opposing arrows and reads
          as "reverse the direction" -- an asc/desc toggle this menu does not
          have and will not gain, because each item is a one-shot rearrangement
          rather than a mode. `sort` is the conventional affordance for
          choosing an order, which is what this does. Both are real ligatures
          in Material Symbols Outlined, measured in the built popup at 26px
          against a name the font does not carry, which renders as literal
          text 572px wide rather than as tofu (KAN-5). */}
        {/* KAN-279. Absent in the tab view: that page IS the destination this
          button opens or focuses, so a copy of itself there has nothing to
          do. Sits LEFT of Sort -- Justine's mockup measured the row with it
          first -- and sends a fire-and-forget message rather than acting
          directly; see handleClickOpenInTab above for why. */}
        {!isTabView() && (
          <span
            data-tour-anchor="expand"
            css={css`
              position: relative;
              display: inline-flex;
              ${
                isFullViewCalloutOpen &&
                `outline: 1.5px dashed ${COLORS.LABEL_L2_COLOR}; outline-offset: 2px;`
              }
            `}
          >
            <Icon
              ariaLabel={t('Open full view')}
              tooltipText={t('Open full view')}
              type="open_in_full"
              // KAN-340. Thin, but its arrows reach the corners: at DEFAULT its
              // ink spans 18.5px square, the largest in the row, and it read big.
              // MEDIUM_SMALL (21px) since KAN-437: still read big at MEDIUM.
              size={ICON.MEDIUM_SMALL}
              boxSizedFor={ICON.DEFAULT}
              // KAN-344. It stretches: "the same thing, bigger".
              hoverMotion={{ scale: 1.14, duration: DURATION.MOVE }}
              onClick={handleClickOpenInTab}
            />
            {isFullViewCalloutOpen && (
              <FullViewCallout
                onTry={handleClickOpenInTab}
                onDismiss={seeFullViewCallout}
              />
            )}
          </span>
        )}
        <OverflowMenu
          ariaLabel={t('Sort sessions')}
          triggerIcon="sort"
          items={sortItems}
        />
      </div>
      <div css={pairStyle}>
        <Icon
          ariaLabel={t('Undo')}
          tooltipText={t('Undo')}
          type="undo"
          onClick={handleClickUndo}
          style={isUndoable ? 'opacity: 1;' : 'opacity: 0.3;'}
          disable={!isUndoable}
        />
        <Icon
          ariaLabel={t('Redo')}
          tooltipText={t('Redo')}
          type="redo"
          onClick={handleClickRedo}
          style={isRedoable ? 'opacity: 1;' : 'opacity: 0.3;'}
          disable={!isRedoable}
        />
      </div>
      <div css={pairStyle}>
        <Icon
          ariaLabel={dimmedBecause ?? t('Sync now')}
          ariaDescription={dimmedBecause === null ? syncDetail : undefined}
          tooltipText={
            dimmedBecause ??
            (syncedWhen === null
              ? `${syncState}\n${t('Sync now')}`
              : syncDetail)
          }
          type={syncIconType}
          onClick={handleClickSync}
          disable={dimmedBecause !== null}
        />
        <Icon
          ariaLabel={t('Settings')}
          tooltipText={t('Settings')}
          type="settings"
          // KAN-340. The heaviest glyph in the row: at DEFAULT its ink is
          // 20.5px square, 2.6x Sort's; at SMALL it read too small beside the
          // 22.5px-wide cloud. MEDIUM (18.5px of ink) sits between Undo and
          // Search, in the same box, so nothing moves and the target stays whole.
          size={ICON.MEDIUM}
          boxSizedFor={ICON.DEFAULT}
          onClick={handleClickSettings}
          // KAN-344. Half a turn, the one flourish in the row: the gear has
          // six teeth, but only 180deg is the same pose (120deg differs by 8%
          // of its ink, so it jumped).
          hoverMotion={{ rotate: '180deg', duration: DURATION.FLOURISH }}
        />
      </div>
    </div>
  );
}
