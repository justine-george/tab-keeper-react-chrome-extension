import React, { useCallback, useEffect, useRef, useState } from 'react';

import { css } from '@emotion/react';

import Icon from './Icon';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';

export interface OverflowMenuItem {
  /** Stable identity for the React key. Not shown. */
  key: string;
  /** The visible text, and the item's accessible name. Must be translated. */
  label: string;
  /** A Material Symbols ligature, rendered decoratively. */
  icon: string;
  onSelect: () => void;
  /** Paints the glyph with the delete hover colour, as row delete icons do. */
  danger?: boolean;
}

interface OverflowMenuProps {
  /** Names the trigger. Must be translated. */
  ariaLabel: string;
  items: OverflowMenuItem[];
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
  onOpenChange,
}) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();

  const [isOpen, setIsOpen] = useState(false);

  // Every open/close goes through here, so onOpenChange cannot fall out of
  // step with the state it reports.
  const setOpen = useCallback(
    (next: boolean) => {
      setIsOpen((current) => {
        if (current !== next) onOpenChange?.(next);
        return next;
      });
    },
    [onOpenChange]
  );
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Focus goes back where it came from, or a keyboard user is dropped at
  // <body> and loses their place -- the same failure the Icon comment about
  // aria-disabled describes.
  const close = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      if (returnFocus) {
        const trigger =
          triggerRef.current?.querySelector<HTMLElement>('[role="button"]');
        (trigger ?? triggerRef.current)?.focus();
      }
    },
    [setOpen]
  );

  // Opening moves focus to the first item, which is what makes the menu
  // operable without a pointer at all.
  useEffect(() => {
    if (isOpen) itemRefs.current[0]?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isOpen, close]);

  const focusItem = (index: number) => {
    const count = items.length;
    if (count === 0) return;
    // Wraps in both directions, so the list has no dead ends.
    const next = ((index % count) + count) % count;
    itemRefs.current[next]?.focus();
  };

  const indexOfFocused = () =>
    itemRefs.current.findIndex((el) => el === document.activeElement);

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(indexOfFocused() + 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(indexOfFocused() - 1);
    }
  };

  const menuStyle = css`
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 1000;
    min-width: 180px;
    background-color: ${COLORS.PRIMARY_COLOR};
    border: 1px solid ${COLORS.BORDER_COLOR};
    border-radius: 0px;
    font-family: ${FONT_FAMILY};
  `;

  const itemStyle = (danger?: boolean) => css`
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    border: 0;
    border-radius: 0px;
    background: none;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    font-size: 0.85rem;
    color: ${COLORS.TEXT_COLOR};
    /* Named properties, never the all keyword. */
    transition-property: background-color;
    transition-duration: 150ms;
    transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
    /* Destructive hover is a red FILL behind a dark glyph, not a red glyph.
       DELETE_ICON_HOVER_COLOR is a background token everywhere else in the
       app -- Icon.tsx:115 feeds it to background-color and leaves the glyph
       at TEXT_COLOR -- so tinting the glyph instead made this item read as a
       different kind of control from the row delete icons beside it. */
    &:hover {
      background-color: ${danger
        ? COLORS.DELETE_ICON_HOVER_COLOR
        : COLORS.HOVER_COLOR};
    }
    &:hover .overflow-menu-glyph {
      color: ${COLORS.TEXT_COLOR};
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
          type="more_vert"
          tooltipText={ariaLabel}
          ariaLabel={ariaLabel}
          ariaHasPopup="menu"
          ariaExpanded={isOpen}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!isOpen);
          }}
        />
      </div>
      {isOpen && (
        <div role="menu" css={menuStyle} onKeyDown={handleMenuKeyDown}>
          {items.map((item, index) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
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
                  font-size: 1.1rem;
                  line-height: 1;
                  color: ${COLORS.LABEL_L2_COLOR};
                  transition-property: color;
                  transition-duration: 150ms;
                  transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
                `}
              >
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default OverflowMenu;
