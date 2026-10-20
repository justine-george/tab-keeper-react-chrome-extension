import React from 'react';

import { css } from '@emotion/react';

import type { IconName } from './iconNames';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { DURATION, RADIUS, TYPE } from '../../styles/scale';

export interface OverflowMenuItem {
  /** Stable identity for the React key. Not shown. */
  key: string;
  /** The visible text, and the item's accessible name. Must be translated. */
  label: string;
  /** A Material Symbols ligature, rendered decoratively. */
  icon: IconName;
  onSelect: () => void;
  /** Paints the glyph with the delete hover colour, as row delete icons do. */
  danger?: boolean;
  /**
   * Marks this item as the state the list is currently in (KAN-136).
   *
   * Present on ANY item turns the whole menu into a radio group -- the items
   * become `menuitemradio` and each carries `aria-checked`, so a screen reader
   * reports the current choice rather than three indistinguishable commands.
   * The tick itself is decorative and aria-hidden: the state lives in
   * aria-checked, and a bare glyph in the accessible name is exactly the leak
   * KAN-56 fixed.
   */
  checked?: boolean;
  /**
   * KAN-592, KAN-638. A key that runs this item while the menu is open, as a Mac menu's does.
   * `hint` is shown at the item's end, hidden from its name; `ariaKeyShortcuts` names the keys.
   */
  shortcut?: {
    hint: string;
    ariaKeyShortcuts: string;
    matches: (e: React.KeyboardEvent) => boolean;
  };
}

// A ligature written as JSX text would bypass IconName, and a name missing from
// the bundled subset renders as the word itself (KAN-215).
const RADIO_CHECK_ICON: IconName = 'check';

// KAN-708. The ⋮ and row menus' role="menu" box and items; the caller owns placement (positionCss), list behaviour and closing.
export function MenuPanel({
  ariaLabel,
  items,
  registerItem,
  handleKeyDown,
  close,
  positionCss,
  menuRef,
  dataRowMenu = false,
}: {
  /** Names the menu. Must be translated. */
  ariaLabel: string;
  items: OverflowMenuItem[];
  registerItem: (index: number) => (el: HTMLElement | null) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  close: () => void;
  positionCss: string;
  menuRef?: React.Ref<HTMLDivElement>;
  dataRowMenu?: boolean;
}): React.ReactElement {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();

  // A menu whose items report a current selection is a radio group, not a list
  // of commands. Derived rather than a separate prop so the two cannot disagree.
  const isRadioGroup = items.some((item) => item.checked !== undefined);

  const menuStyle = css`
    ${positionCss}
    z-index: 1000;
    min-width: 180px;
    background-color: ${COLORS.PRIMARY_COLOR};
    border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
    border-radius: ${RADIUS.SQUARE};
    /* KAN-267. Same ground as the page, so the border alone read as a panel
       cut INTO it. A shadow says "above it"; a scrim would say "modal",
       which is the dialogs' signal and not true of a light-dismiss menu.
       Per theme: the dark grounds need a far heavier one to show anything. */
    box-shadow: ${COLORS.FLOATING_SHADOW};
    font-family: ${FONT_FAMILY};
  `;

  const itemStyle = (danger?: boolean) => css`
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    border: 0;
    border-radius: ${RADIUS.SQUARE};
    background: none;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    font-size: ${TYPE.BODY};
    /* One line per item. A wrapped label reads as two items squeezed together,
       and "Export as PDF / web page" wrapped at the menu's minimum width. The
       menu grows to fit instead. */
    white-space: nowrap;
    color: ${COLORS.TEXT_COLOR};
    /* Named properties, never the all keyword. */
    transition-property: background-color;
    transition-duration: ${DURATION.COLOR};
    transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
    /* Destructive hover is a red FILL behind the row's ordinary ink, not a red
       glyph. DELETE_ICON_HOVER_COLOR is a background token everywhere else in
       the app -- Icon.tsx feeds it to background-color and leaves the glyph at
       TEXT_COLOR -- so tinting the glyph instead made this item read as a
       different kind of control from the row delete icons beside it.
       The fill is readable in every theme because KAN-204 made it so; nothing
       here repaints the text to compensate. */
    &:hover {
      background-color: ${
        danger ? COLORS.DELETE_ICON_HOVER_COLOR : COLORS.HOVER_COLOR
      };
    }
    /* The key hint is LABEL_L1 on the menu (4.5:1 in every theme, syncStatus.test.tsx)
       but not on the danger fill, so on a fill it takes the label's TEXT, as Button's does. */
    &:hover [data-key-hint],
    &:active [data-key-hint] {
      color: ${COLORS.TEXT_COLOR};
    }
    /* KAN-205. A menu item is the one place a press most needs confirming --
       the menu closes on release, so without this the only feedback a click
       gets is the menu disappearing. A danger item keeps its red; see Icon. */
    &:active {
      background-color: ${
        danger ? COLORS.DELETE_ICON_HOVER_COLOR : COLORS.ACTIVE_COLOR
      };
    }
  `;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      data-row-menu={dataRowMenu ? '' : undefined}
      css={menuStyle}
      // KAN-708. Chrome's own menu must not open on ours, and a row under it must not hear it.
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onKeyDown={(e) => {
        const item = items.find((i) => i.shortcut?.matches(e));
        if (item === undefined) {
          handleKeyDown(e);
          return;
        }
        // Before the repeat check: a held key must not fall through to the browser either.
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        close();
        item.onSelect();
      }}
    >
      {items.map((item, index) => (
        <button
          key={item.key}
          type="button"
          role={isRadioGroup ? 'menuitemradio' : 'menuitem'}
          aria-checked={isRadioGroup ? !!item.checked : undefined}
          aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
          data-menu-item={item.key}
          ref={registerItem(index)}
          css={itemStyle(item.danger)}
          onClick={(e) => {
            e.stopPropagation();
            close();
            item.onSelect();
          }}
        >
          {/* Presentational: the label already names the item, and a bare
              Icon is aria-hidden, so the ligature text cannot leak into
              the accessible name (KAN-56). */}
          <span
            className="material-symbols-outlined overflow-menu-glyph"
            aria-hidden="true"
            css={css`
              font-size: ${TYPE.SECTION};
              line-height: 1;
              /* ONE colour, the same as the label beside it and the
                 toolbar icons above it (KAN-203).

                 It was LABEL_L2_COLOR at rest and TEXT_COLOR on hover,
                 eased over 150ms. Two symptoms, one rule: crossing between
                 two items faded one glyph down while the other faded up,
                 and at rest the glyph read as washed out next to every
                 other icon in the app. On BB Pink it was worse than quiet
                 -- LABEL_L2_COLOR was #D81B60 there, so the glyphs rendered
                 magenta beside a near-black label.

                 Not merely un-animated: a colour that changes on hover
                 still changes on hover. The state cue is the row's fill,
                 which is what every other hover in the app uses. */
              color: ${COLORS.TEXT_COLOR};
            `}
          >
            {item.icon}
          </span>
          {item.label}
          {item.shortcut !== undefined && (
            <span
              data-key-hint
              aria-hidden="true"
              css={css`
                margin-left: auto;
                padding-left: 16px;
                color: ${COLORS.LABEL_L1_COLOR};
              `}
            >
              {item.shortcut.hint}
            </span>
          )}
          {isRadioGroup && (
            /* Decorative. The state is on aria-checked above; this only
               makes it visible. Reserved width even when unticked, so the
               labels do not shift as the checked item changes. */
            <span
              aria-hidden="true"
              className="material-symbols-outlined"
              css={css`
                margin-left: auto;
                font-size: ${TYPE.SECTION};
                line-height: 1;
                width: 1.1rem;
                color: ${COLORS.TEXT_COLOR};
                visibility: ${item.checked ? 'visible' : 'hidden'};
              `}
            >
              {RADIO_CHECK_ICON}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
