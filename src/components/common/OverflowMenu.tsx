import React, { useLayoutEffect, useRef, useState } from 'react';

import { css } from '@emotion/react';

import Icon from './Icon';
import type { IconName } from './iconNames';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { usePopoverList } from '../../hooks/usePopoverList';
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
}

// A ligature written as JSX text would bypass IconName, and a name missing from
// the bundled subset renders as the word itself (KAN-215).
const RADIO_CHECK_ICON: IconName = 'check';

/**
 * How close to the window's edge an open menu may come (KAN-230).
 *
 * Not zero: flush against the edge the menu's own border merges with the
 * window's, and there is nowhere for the eye to separate them.
 */
const VIEWPORT_GUTTER_PX = 4;

interface OverflowMenuProps {
  /** Names the trigger. Must be translated. */
  ariaLabel: string;
  items: OverflowMenuItem[];
  /**
   * The trigger's Material Symbols ligature.
   *
   * Defaults to `more_vert`, which is what "a menu of secondary actions behind
   * one trigger" looks like and what the row consumers want. A menu whose items
   * are all one KIND of thing wants a glyph naming that kind instead -- the
   * session sort menu (KAN-136) is a sort control, not an overflow.
   */
  triggerIcon?: IconName;
  /**
   * Fires whenever the menu opens or closes.
   *
   * Exists because the menu cannot solve its own z-order: it is confined to
   * the stacking context of whichever action strip hosts it, so a SIBLING
   * strip with the same z-index paints over it purely by DOM order. The host
   * has to lift the row that owns the open menu, and this is how it learns
   * which row that is.
   */
  onOpenChange?: (isOpen: boolean) => void;
  /**
   * Which edge of the trigger the menu lines up with (KAN-193).
   *
   * `'end'`, the default, pins the menu's right edge to the trigger's, so it
   * opens leftward -- right for a trigger at the END of a row, like the tab
   * group title. `'start'` pins the left edges instead, for a trigger near the
   * start: in the session header an end-aligned menu opened across the pane
   * divider, over the session list.
   */
  align?: 'start' | 'end';
  /**
   * Extra CSS for the trigger's own box, after Icon's own rules (KAN-208).
   *
   * The save row's trigger is a SEGMENT of a bordered group, the same height
   * as the button beside it, so its hover and pressed fills cover the segment
   * the way the button's do. An Icon's box is otherwise content-sized, which
   * leaves a dead strip above and below it inside the group.
   */
  triggerStyle?: string;
}

/**
 * A menu of secondary actions behind a single trigger.
 *
 * Exists so that a crowded row can keep two or three prominent actions and
 * push the rest here, rather than growing another always-visible icon every
 * time a feature lands. The first consumer is the Chrome tab group row; the
 * window and session rows are the intended next ones.
 *
 * NOT built on the native Popover API, which would have supplied light
 * dismiss and Escape for free. jsdom 30 implements none of it -- `'popover'
 * in el` is false and showPopover is undefined -- so a popover-based menu
 * would throw in every component test and ship with no coverage. The E2E
 * suite cannot stand in either: it has no way to grant the tabGroups
 * permission, so it never renders a group row to hang a menu on. Twenty lines
 * of listeners in one shared component is the cheaper trade.
 *
 * Surface tokens come from Toast rather than being invented: this app is
 * deliberately square and flat -- `border-radius` appears five times in the
 * codebase and is `0px` every time, and there are no drop shadows at all.
 *
 * CONSUMER CONSTRAINT, learned the hard way. The menu's z-index only reaches
 * as far as its nearest STACKING CONTEXT, and every action strip in this app
 * is centred with `transform: translateY(-50%)`, which creates one. Inside
 * such a strip the menu paints behind any later sibling that is positioned --
 * the tab rows, in the first consumer. The strip itself must therefore carry a
 * z-index. A component cannot fix an ancestor's stacking context from the
 * inside, so this is the caller's job; see the note on group-rename-reveal in
 * WindowEntryContainer. jsdom computes no paint order, so only a real browser
 * shows this.
 */
const OverflowMenu: React.FC<OverflowMenuProps> = ({
  ariaLabel,
  items,
  triggerIcon = 'more_vert',
  onOpenChange,
  align = 'end',
  triggerStyle,
}) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();

  const {
    isOpen,
    setOpen,
    close,
    wrapperRef,
    triggerRef,
    registerItem,
    handleKeyDown,
  } = usePopoverList({
    count: items.length,
    axis: 'vertical',
    onOpenChange,
  });

  // A menu whose items report a current selection is a radio group, not a list
  // of commands. Derived rather than a separate prop so the two cannot disagree.
  const isRadioGroup = items.some((item) => item.checked !== undefined);

  /**
   * How far the menu has been pushed back inside the window (KAN-230).
   *
   * The menu is anchored to ONE edge of its trigger, so its other edge is
   * wherever the widest label puts it -- and in a language whose labels are
   * longer than English's, that was off the side of the popup. Measured on
   * main, the sort menu's left edge sat at -11.4 (es), -12.3 (fr) and -6.2
   * (ru), cutting off the glyph column and the border.
   *
   * A measurement rather than a media query because the overflow depends on
   * the rendered text: no threshold can be written down in advance, and the
   * same menu fits in seven locales and not in three.
   *
   * useLayoutEffect, so the correction lands in the same paint as the menu --
   * a useEffect would show the clipped position for a frame first.
   */
  const menuRef = useRef<HTMLDivElement>(null);
  const [shiftX, setShiftX] = useState(0);
  useLayoutEffect(() => {
    // Deliberately NOT cleared on close. A stale shift cannot mislead the next
    // open, because the measurement below takes the transform off first and so
    // never reads the previous correction; and the menu is unmounted while
    // closed, so nothing wears it in the meantime. Resetting here instead
    // meant calling setState unconditionally from an effect, which is the
    // cascading-render the lint rule is there to stop.
    if (!isOpen) return;
    const element = menuRef.current;
    if (!element) return;

    // Measured with the shift taken OFF, so what comes back is always the
    // menu's natural box. Reading the shifted box and subtracting looks
    // equivalent and is not: a rect includes the element's transform only
    // where there is a layout engine to apply it. Under jsdom every rect is
    // zero and the transform is ignored, so the subtraction recovered a
    // position 4px further left on every pass and the correction walked --
    // an update loop that took out 21 component tests.
    //
    // Sound in the browser too, and cheaper to reason about: there is exactly
    // one definition of the natural box, and it is the measured one. The write
    // and the read are both inside a layout effect, so nothing paints between
    // them.
    element.style.transform = 'none';
    const rect = element.getBoundingClientRect();
    element.style.transform = '';

    // No layout engine, no measurement to trust: jsdom reports a zero box for
    // everything. Correcting from that would invent a shift for a menu whose
    // position is not known at all.
    if (rect.width === 0 && rect.height === 0) return;

    let next = 0;
    if (rect.left < VIEWPORT_GUTTER_PX) {
      next = VIEWPORT_GUTTER_PX - rect.left;
    } else if (rect.right > window.innerWidth - VIEWPORT_GUTTER_PX) {
      next = window.innerWidth - VIEWPORT_GUTTER_PX - rect.right;
    }
    // Converges on the second pass, which measures the same natural box and
    // agrees -- so this settles rather than looping.
    if (next !== shiftX) setShiftX(next);
  }, [isOpen, shiftX]);

  const menuStyle = css`
    position: absolute;
    top: 100%;
    ${align === 'start' ? 'left: 0;' : 'right: 0;'}
    z-index: 1000;
    min-width: 180px;
    background-color: ${COLORS.PRIMARY_COLOR};
    border: 1px solid ${COLORS.BORDER_COLOR};
    border-radius: ${RADIUS.SQUARE};
    /* KAN-267. Same ground as the page, so the border alone read as a panel
       cut INTO it. A shadow says "above it"; a scrim would say "modal",
       which is the dialogs' signal and not true of a light-dismiss menu. The
       held drag row's lift (RowDragArea), softened because this is not
       moving: a tight contact edge plus a soft lift. Nearly invisible on the
       dark themes, where the border keeps the edge. */
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.12),
      0 4px 12px rgba(0, 0, 0, 0.18);
    font-family: ${FONT_FAMILY};
    /* KAN-230. Pushed back inside the window when a long translation would
       otherwise carry it off the edge. Zero in the common case, and never
       animated -- the menu must open where it is going to stay. */
    transform: translateX(${shiftX}px);
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
      background-color: ${danger
        ? COLORS.DELETE_ICON_HOVER_COLOR
        : COLORS.HOVER_COLOR};
    }
    /* KAN-205. A menu item is the one place a press most needs confirming --
       the menu closes on release, so without this the only feedback a click
       gets is the menu disappearing. A danger item keeps its red; see Icon. */
    &:active {
      background-color: ${danger
        ? COLORS.DELETE_ICON_HOVER_COLOR
        : COLORS.ACTIVE_COLOR};
    }
  `;

  return (
    <div
      ref={wrapperRef}
      css={css`
        position: relative;
        display: flex;
        align-items: center;
      `}
    >
      <div ref={triggerRef}>
        <Icon
          type={triggerIcon}
          tooltipText={ariaLabel}
          ariaLabel={ariaLabel}
          ariaHasPopup="menu"
          ariaExpanded={isOpen}
          style={triggerStyle}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!isOpen);
          }}
        />
      </div>
      {/* The menu is named from the trigger's label, so items may be as terse
          as the menu allows without going unmoored: the sort menu's "Name" is
          only unambiguous once the menu around it announces "Sort sessions". */}
      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={ariaLabel}
          css={menuStyle}
          onKeyDown={handleKeyDown}
        >
          {items.map((item, index) => (
            <button
              key={item.key}
              type="button"
              role={isRadioGroup ? 'menuitemradio' : 'menuitem'}
              aria-checked={isRadioGroup ? !!item.checked : undefined}
              ref={registerItem(index)}
              css={itemStyle(item.danger)}
              onClick={(e) => {
                e.stopPropagation();
                close(false);
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
                     -- LABEL_L2_COLOR is #D81B60 there, so the glyphs rendered
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
      )}
    </div>
  );
};

export default OverflowMenu;
