import React, { useLayoutEffect, useRef, useState } from 'react';

import { css } from '@emotion/react';

import Icon from './Icon';
import type { IconName } from './iconNames';
import { usePopoverList } from '../../hooks/usePopoverList';
import { MenuPanel } from './MenuPanel';
import { VIEWPORT_GUTTER_PX } from './rowMenu/placeMenu';
import type { OverflowMenuItem } from './MenuPanel';

// Moved to MenuPanel (KAN-708); kept importable from here.
export type { OverflowMenuItem };

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
  /**
   * The trigger takes the full height the menu is given, rather than its
   * content's (KAN-492): the save row's segment, whose height follows the row.
   */
  fillsHeight?: boolean;
  // KAN-582. The trigger is held: it opens nothing (the tour's Delete step explains only).
  disabled?: boolean;
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
 * codebase and is `0px` every time. The shadow (KAN-267) is the one
 * exception, and it is the theme's FLOATING_SHADOW rather than a value of
 * this component's own: a menu is the one surface here that floats.
 *
 * CONSUMER CONSTRAINT, learned the hard way. The menu's z-index only reaches
 * as far as its nearest STACKING CONTEXT, and every action strip in this app
 * is centred with `transform: translateY(-50%)`, which creates one. Inside
 * such a strip the menu paints behind any later sibling that is positioned --
 * the tab rows, in the first consumer. The strip itself must therefore carry a
 * z-index. A component cannot fix an ancestor's stacking context from the
 * inside, so this is the caller's job; see the note on group-actions in
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
  fillsHeight = false,
  disabled = false,
}) => {
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

  const positionCss = `
    position: absolute;
    top: 100%;
    ${align === 'start' ? 'left: 0;' : 'right: 0;'}
    /* KAN-230. Pushed back inside the window when a long translation would
       otherwise carry it off the edge. Zero in the common case, and never
       animated -- the menu must open where it is going to stay. */
    transform: translateX(${shiftX}px);
  `;

  const fillStyle = css`
    display: flex;
  `;

  return (
    <div
      ref={wrapperRef}
      css={css`
        position: relative;
        display: flex;
        align-items: ${fillsHeight ? 'stretch' : 'center'};
      `}
    >
      <div ref={triggerRef} css={fillsHeight ? fillStyle : undefined}>
        <Icon
          type={triggerIcon}
          tooltipText={ariaLabel}
          ariaLabel={ariaLabel}
          ariaHasPopup="menu"
          ariaExpanded={isOpen}
          style={triggerStyle}
          disable={disabled}
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
        <MenuPanel
          menuRef={menuRef}
          ariaLabel={ariaLabel}
          items={items}
          registerItem={registerItem}
          handleKeyDown={handleKeyDown}
          close={() => close(false)}
          positionCss={positionCss}
        />
      )}
    </div>
  );
};

export default OverflowMenu;
