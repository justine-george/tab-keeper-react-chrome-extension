import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Icon from '../../common/Icon';
import OverflowMenu from '../../common/OverflowMenu';
import type { OverflowMenuItem } from '../../common/OverflowMenu';
import {
  clearSessionOrder,
  sortSessionsInternal,
} from '../../../redux/slices/tabContainerDataStateSlice';
import { AppDispatch, RootState } from '../../../redux/store';
import {
  closeToast,
  openSettingsPage,
  syncStateWithFirestore,
} from '../../../redux/slices/globalStateSlice';
import {
  isRedoableSelector,
  isUndoableSelector,
  redo,
  undo,
} from '../../../redux/slices/undoRedoSlice';
import { SettingsCategory } from '../../../redux/slices/settingsCategoryStateSlice';
import { setSessionDateBasis } from '../../../redux/slices/settingsDataStateSlice';
import { useTranslation } from 'react-i18next';

export default function MenuContainer() {
  const syncStatus = useSelector(
    (state: RootState) => state.globalState.syncStatus
  );

  const isSignedIn = useSelector(
    (state: RootState) => state.globalState.isSignedIn
  );

  // i18n.language feeds the reducer's title collation; see sortItems below.
  const { t, i18n } = useTranslation();
  const dispatch: AppDispatch = useDispatch();

  const isUndoable = useSelector(isUndoableSelector);
  const isRedoable = useSelector(isRedoableSelector);

  function handleClickUndo() {
    dispatch(undo());
    dispatch(closeToast());
  }

  function handleClickRedo() {
    dispatch(redo());
    dispatch(closeToast());
  }

  function handleClickSync() {
    dispatch(syncStateWithFirestore());
  }

  function handleClickSettings() {
    dispatch(openSettingsPage(SettingsCategory.DISPLAY));
    dispatch(closeToast());
  }

  // The control offers "sync now" only when syncing is possible AND something
  // is out of sync. Every other case shows what is true instead.
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
  let syncIconType: string;
  let isDisabled = false;
  if (!isSignedIn) {
    syncIconType = 'cloud_off';
    isDisabled = true;
  } else if (syncStatus === 'loading') {
    syncIconType = 'cloud_sync';
    isDisabled = true;
  } else if (syncStatus === 'error') {
    syncIconType = 'sync_problem';
  } else if (syncStatus === 'success') {
    syncIconType = 'cloud_done';
  } else {
    syncIconType = 'sync';
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
  // The two date items also set which date the ROWS show, so the number on a
  // row always describes the order the list is in (KAN-141). Name and tab
  // count deliberately leave it alone: neither is a date order, so there is no
  // date for them to be right about, and silently flipping the rows back to
  // "Edited" would undo a choice the user made two clicks ago.
  const sortItems: OverflowMenuItem[] = [
    {
      key: 'modified',
      label: t('Date modified'),
      icon: 'history',
      checked: isDefaultOrder,
      onSelect: () => {
        dispatch(clearSessionOrder());
        dispatch(setSessionDateBasis('edited'));
      },
    },
    {
      key: 'date',
      label: t('Date saved'),
      icon: 'schedule',
      checked: false,
      onSelect: () => {
        dispatch(
          sortSessionsInternal({ by: 'createdAt', locale: i18n.language })
        );
        dispatch(setSessionDateBasis('created'));
      },
    },
    {
      key: 'name',
      label: t('Name'),
      icon: 'sort_by_alpha',
      checked: false,
      onSelect: () =>
        dispatch(sortSessionsInternal({ by: 'name', locale: i18n.language })),
    },
    {
      key: 'tabs',
      label: t('Tab count'),
      icon: 'tab',
      checked: false,
      onSelect: () =>
        dispatch(
          sortSessionsInternal({ by: 'tabCount', locale: i18n.language })
        ),
    },
  ];

  const containerStyle = css`
    display: flex;
    justify-content: space-around;
  `;

  return (
    <div css={containerStyle}>
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
      <OverflowMenu
        ariaLabel={t('Sort sessions')}
        triggerIcon="sort"
        items={sortItems}
      />
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
      <Icon
        ariaLabel={t('Sync now')}
        tooltipText={t('Sync now')}
        type={syncIconType}
        onClick={handleClickSync}
        disable={isDisabled}
      />
      <Icon
        ariaLabel={t('Settings')}
        tooltipText={t('Settings')}
        type="settings"
        onClick={handleClickSettings}
        animationFrom={`transform: rotate(0deg);`}
        animationTo={`transform: rotate(120deg);`}
      />
    </div>
  );
}
