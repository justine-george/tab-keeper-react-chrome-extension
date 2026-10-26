import {
  RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { css, keyframes } from '@emotion/react';
import { useTranslation } from 'react-i18next';

import {
  useSearchShortcut,
  useSearchTarget,
} from '../../../hooks/useSearchShortcut';
import { Tag } from '../../common/Tag';
import { SEARCH_SHORTCUT_KEY } from '../../common/searchShortcut';
import Icon from '../../common/Icon';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { formatTabCount } from '../../../utils/functions/local';
import type { OpenWindow } from '../../../utils/functions/openNow';
import OpenNowPane from './OpenNowPane';
import type { OpenNowHeaderAction } from './OpenNowPane';
import { currentCarry, subscribeCarry } from '../../../redux/carry';
import { DURATION, EASE, TYPE } from '../../../styles/scale';
import { isUnclaimedEscape } from '../../common/unclaimedEscape';
import { COACH_CARD_SHOWN } from '../paneMotion';
import { springSweepStyle } from '../../common/springOpen';
import { useRailSpring } from './useRailSpring';

interface OpenNowRailProps {
  windows: OpenWindow[] | null;
  // The fold button, shown in the drawer's header before its close button.
  foldAction: OpenNowHeaderAction;
  // The rail's button. The caller holds it so an unfold that brings the rail
  // back can focus it (OpenNowColumn).
  buttonRef: RefObject<HTMLButtonElement>;
  // The search field's text (KAN-330 O14). Held by OpenNowColumn, above the
  // pane ↔ drawer swap, so a resize or a drawer close keeps it.
  searchText: string;
  onSearchTextChange: (text: string) => void;
  // The field. The caller holds it so the drawer can focus it on open (R1).
  searchInputRef: RefObject<HTMLInputElement>;
}

// KAN-280 O2. A 44px column with one button, which opens Open now as a 380px
// drawer over the right side. The drawer's open state lives here, so it goes
// when the rail does: a window grown past 1100px, or a fold, drops both.
const slideIn = keyframes`
  from {
    transform: translateX(100%);
  }
`;
const slideOut = keyframes`
  to {
    transform: translateX(100%);
  }
`;

export default function OpenNowRail({
  windows,
  foldAction,
  buttonRef,
  searchText,
  onSearchTextChange,
  searchInputRef,
}: OpenNowRailProps) {
  const COLORS = useThemeColors();
  const { t, i18n } = useTranslation();
  const drawerId = useId();
  const headingId = useId();

  const [isOpen, setIsOpen] = useState(false);
  // KAN-810. The drawer slides in and out on itself (drawerStyle), so it
  // takes presses from its first frame, and a press that closes it still
  // lands where it pressed. Closed, it stays drawn while it slides out,
  // inert, and goes at the slide's end, or at once if nothing slides
  // (reduced motion).
  const [isLeaving, setIsLeaving] = useState(false);
  const openDrawer = () => {
    setIsLeaving(false);
    setIsOpen(true);
  };
  const closeDrawer = () => {
    setIsOpen(false);
    setIsLeaving(true);
  };
  const headingRef = useRef<HTMLHeadingElement>(null);

  // KAN-330 R1. Opened by `/`, the drawer puts the cursor in its search
  // field; opened by the button, focus goes to the drawer's heading, so a
  // screen reader announces where it landed and Tab continues into the
  // drawer (O2).
  const openedByShortcut = useRef(false);
  // KAN-820 E. Sprung by a resting carry, the drawer opens and focus stays where it was.
  const openedBySpring = useRef(false);
  // KAN-800. While / would open the drawer into its search, the rail wears the chip.
  const showsShortcut = useSearchTarget() === 'openNow' && !isOpen;
  useSearchShortcut(
    'openNow',
    isOpen
      ? null
      : () => {
          openedByShortcut.current = true;
          openDrawer();
        }
  );
  useEffect(() => {
    if (!isOpen) return;
    if (openedBySpring.current) {
      openedBySpring.current = false;
    } else if (openedByShortcut.current) {
      openedByShortcut.current = false;
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    } else {
      headingRef.current?.focus();
    }
  }, [isOpen, searchInputRef]);

  // KAN-280 Part F (N2 A). Once a carry's pointer leaves the drawer, the drawer slides away so every drop works as
  // wide; it comes back when the carry ends, mounted all along, so its scroll, folds and search are as they were.
  const [away, setAway] = useState(false);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  // Leaving with no slide running (reduced motion), it goes at once; a slide
  // cut short goes too (React has no animationcancel prop).
  useLayoutEffect(() => {
    if (!isLeaving || isOpen) return;
    const drawer = drawerRef.current;
    const sliding = drawer
      ?.getAnimations()
      .some((a) => a.playState === 'running');
    if (!drawer || !sliding) {
      setIsLeaving(false);
      return;
    }
    const gone = () => setIsLeaving(false);
    drawer.addEventListener('animationcancel', gone);
    return () => drawer.removeEventListener('animationcancel', gone);
  }, [isLeaving, isOpen]);
  useEffect(() => {
    // Read once per carry, at its first move, before the drawer has moved.
    let box: DOMRect | null = null;
    return subscribeCarry(() => {
      const carry = currentCarry();
      if (carry === null) {
        box = null;
        setAway(false);
        return;
      }
      box ??= drawerRef.current?.getBoundingClientRect() ?? null;
      if (box === null) return;
      const outside =
        carry.x < box.left ||
        carry.x >= box.right ||
        carry.y < box.top ||
        carry.y >= box.bottom;
      if (outside) setAway(true);
    });
  }, []);

  // KAN-820 E. A saved carry resting on the rail springs the drawer out.
  const railRef = useRef<HTMLDivElement>(null);
  const { isTarget } = useRailSpring({
    railRef,
    drawerOver: !isOpen || away ? 'none' : 'settled',
    // Only a closed drawer opens: set on an open one, the flag would outlive this open (R1).
    onSpring: () => {
      if (isOpen) return;
      openedBySpring.current = true;
      openDrawer();
    },
  });
  // Reduced motion draws no sweep; the drawer still opens after the wait.
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  // Back to the button that opened it, so the user's place is kept.
  const close = useCallback(() => {
    closeDrawer();
    buttonRef.current?.focus();
  }, [buttonRef]);

  // KAN-681. Not modal: Esc closes it wherever focus is, a click on blank space
  // having moved focus to the body, unless something else used the key.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // P8. During a carry, Esc is the carry's (CarryLayer), and the drawer stays.
      if (!isUnclaimedEscape(e) || currentCarry() !== null) return;
      e.preventDefault();
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, close]);

  // KAN-682. A press outside closes it and still does what it presses. The toast
  // and a modal dialog sit over the drawer and are not outside it; the rail is
  // under it.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target === null || currentCarry() !== null) return;
      if (drawerRef.current?.contains(target)) return;
      // KAN-708. A row menu opened from the drawer is part of it.
      if (target.closest('[data-toast], dialog, [data-row-menu]') !== null)
        return;
      closeDrawer();
      // After the press's own focus change: the rail, unless it focused something.
      setTimeout(() => {
        if (document.activeElement === document.body)
          buttonRef.current?.focus();
      });
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen, buttonRef]);

  // No count while the first read is in flight: "0 Tabs" would be false.
  const railLabel =
    windows === null
      ? t('Open now')
      : `${t('Open now')}, ${formatTabCount(
          windows.reduce((sum, w) => sum + w.tabs.length, 0),
          t
        )}`;

  const railStyle = css`
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    padding-top: 8px;
    /* KAN-820 E. The session row's carry-target look; its button shows no hover or press fill under it. */
    &[data-carry-target] {
      background-color: ${COLORS.ACTIVE_COLOR};
      outline-width: 2px;
      outline-style: solid;
      outline-color: ${COLORS.LABEL_L2_COLOR};
      outline-offset: -2px;
    }
    &[data-carry-target] > button,
    &[data-carry-target] > button:hover,
    &[data-carry-target] > button:active {
      background-color: transparent;
    }
    /* The sweep is the dwell's fill, in from the window's edge. */
    &[data-carry-dwell] {
      background-color: transparent;
      ${springSweepStyle(COLORS.ACTIVE_COLOR, 'right')}
    }
  `;

  // Sized and filled as an actionable Icon is (padding 4px round a 24px
  // glyph, hover and press fills), but a native button: it needs a ref for
  // focus to come back to, and aria-controls. KAN-776: the label stacks under
  // the glyph.
  const buttonStyle = css`
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 32px;
    justify-content: center;
    padding: 4px;
    border: none;
    background-color: transparent;
    color: inherit;
    cursor: pointer;
    &:hover {
      background-color: ${COLORS.ICON_HOVER_COLOR};
    }
    /* KAN-810. No fill while expanded: the drawer covers the button then, so the fill only ever flashed as the drawer moved. */
    &:active {
      background-color: ${COLORS.ICON_ACTIVE_COLOR};
    }
  `;

  // KAN-776 C. Read top to bottom; CJK stands upright. Set, not inherited:
  // inherited, it drew black on Charcoal.
  const labelStyle = css`
    color: ${COLORS.TEXT_COLOR};
    font-size: ${TYPE.SECONDARY};
    padding: 6px 0 4px;
  `;
  const verticalStyle = css`
    writing-mode: vertical-rl;
    line-height: 1.25;
    white-space: nowrap;
  `;
  // Upright CJK in vertical-rl advances by the font's vertical metrics, and
  // WenQuanYi Zen Hei's are zero: the label drew on one spot. Stacked one
  // character per line, each takes its horizontal advance; a word per block
  // keeps Korean's spaces.
  const stacksUpright = /^(ja|zh|ko)\b/i.test(i18n.language);
  const stackedStyle = css`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35em;
    line-height: 1;
    & > span {
      width: 1em;
      text-align: center;
    }
  `;

  // z-index 900: over the panes, and under the toast (1050), which must stay
  // readable while the drawer is open. The modals are <dialog>s in the top
  // layer, above any z-index, so they need no room here.
  const drawerStyle = css`
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 380px;
    z-index: 900;
    overflow: hidden;
    background-color: ${COLORS.PRIMARY_COLOR};
    border-left: 1px solid ${COLORS.PANEL_BORDER_COLOR};
    box-shadow: ${COLORS.FLOATING_SHADOW};
    /* N2 A. Away during a carry: slid off, then hidden; back without the delay. */
    transition:
      transform ${DURATION.MOVE} ease,
      visibility 0s linear ${DURATION.MOVE};
    &[data-carry-away] {
      transform: translateX(100%);
      visibility: hidden;
    }
    &:not([data-carry-away]) {
      transition: transform ${DURATION.MOVE} ease;
    }
    /* KAN-810. In from the window's edge and back out, on the drawer itself. */
    animation: ${slideIn} ${DURATION.DRAWER_IN} ${EASE.OUT} backwards;
    &[data-leaving] {
      animation: ${slideOut} ${DURATION.DRAWER_OUT} ${EASE.IN} forwards;
      pointer-events: none;
    }
    @media (prefers-reduced-motion: reduce) {
      transition: none;
      animation: none;
    }
    /* KAN-812. Nor while the tour's card is on screen. */
    html:has(${COACH_CARD_SHOWN}) & {
      animation: none;
    }
  `;

  return (
    <div
      ref={railRef}
      css={railStyle}
      data-open-now-rail=""
      data-carry-target={isTarget ? '' : undefined}
      data-carry-dwell={isTarget && !reducedMotion ? '' : undefined}
    >
      <button
        ref={buttonRef}
        type="button"
        css={buttonStyle}
        aria-label={railLabel}
        data-tooltip={railLabel}
        aria-expanded={isOpen}
        aria-keyshortcuts={showsShortcut ? SEARCH_SHORTCUT_KEY : undefined}
        // Only while the drawer exists: an IDREF to nothing names no element.
        aria-controls={isOpen ? drawerId : undefined}
        onClick={() => (isOpen ? close() : openDrawer())}
      >
        <Icon type="tab" />
        {/* Named by aria-label, which holds this text and the count. */}
        {stacksUpright ? (
          <span css={[labelStyle, stackedStyle]}>
            {t('Open now')
              .split(' ')
              .flatMap((word, i) => [
                i > 0 ? ' ' : null,
                <span key={i}>{word}</span>,
              ])}
          </span>
        ) : (
          <span css={[labelStyle, verticalStyle]}>{t('Open now')}</span>
        )}
        {showsShortcut && (
          <span aria-hidden="true">
            <Tag value={SEARCH_SHORTCUT_KEY} />
          </span>
        )}
      </button>
      {(isOpen || isLeaving) && (
        <div
          id={drawerId}
          role="dialog"
          data-pane-layer="drawer"
          // Named by the pane's own heading, not a second copy of its text.
          aria-labelledby={headingId}
          css={drawerStyle}
          ref={(el) => {
            drawerRef.current = el;
            // Away, or sliding out, nothing in it takes focus or a click (as DraggableRow sets it).
            const inert = away || !isOpen;
            if (el && el.inert !== inert) el.inert = inert;
          }}
          data-carry-away={away ? '' : undefined}
          data-leaving={isOpen ? undefined : ''}
          onAnimationEnd={(e) => {
            if (
              e.target === e.currentTarget &&
              e.animationName === slideOut.name
            )
              setIsLeaving(false);
          }}
        >
          <OpenNowPane
            windows={windows}
            titleActions={[foldAction]}
            close={{
              icon: 'close',
              label: t('Close Open now'),
              onClick: close,
            }}
            headingId={headingId}
            headingRef={headingRef}
            searchText={searchText}
            onSearchTextChange={onSearchTextChange}
            searchInputRef={searchInputRef}
          />
        </div>
      )}
    </div>
  );
}
