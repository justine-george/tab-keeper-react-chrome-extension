// KAN-695. The app's own tooltip, in place of Chrome's: one ink chip for the
// element with data-tooltip that the pointer rests on or the keyboard moves to.
//
// Mounted once per page (MainContainer, ExportPage), outside every pane: action
// strips trap z-index and panes clip, so a chip drawn inside its control's
// subtree would be cut off or painted under later rows. It reads anchors and
// never writes to them: names and descriptions stay theirs (Task 3).
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactPortal,
} from 'react';
import { createPortal } from 'react-dom';

import { css, keyframes } from '@emotion/react';

import { useThemeColors } from '../../hooks/useThemeColors';
import { useFontFamily } from '../../hooks/useFontFamily';
import { DURATION, RADIUS, TYPE } from '../../styles/scale';
import {
  MAX_WIDTH_PX,
  placeTooltip,
  showDelay,
  type Box,
} from './tooltipRules';

// Above the carry card (1100) and the tour (1020): the spec draws it over everything.
const CHIP_Z_INDEX = 2000;

const NAV_KEYS = new Set([
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);
// Esc, and a keyboard press of the control: they hide the chip and are never claimed.
const HIDING_KEYS = new Set(['Escape', 'Enter', ' ']);

interface Shown {
  anchor: Element;
  text: string;
  // A new number per show, so each show mounts its own chip and fades in.
  serial: number;
}

const anchorOf = (target: EventTarget | null): Element | null =>
  target instanceof Element ? target.closest('[data-tooltip]') : null;

const isDragging = (): boolean => {
  const root = document.documentElement;
  return (
    root.hasAttribute('data-dragging') || root.hasAttribute('data-carrying')
  );
};

// True when the anchor already shows the text in full: some element in it holds
// exactly that text, and none of those is cut off.
function repeatsVisibleText(anchor: Element, text: string): boolean {
  const holders = [anchor, ...anchor.querySelectorAll('*')].filter(
    (el) => el.textContent?.trim() === text
  );
  return (
    holders.length > 0 &&
    holders.every((el) => el.scrollWidth <= el.clientWidth)
  );
}

// What the chip shows, as a store the layer subscribes to, and the document
// listeners that decide it. One per mounted layer; attach returns its undo.
function createTooltips() {
  let shown: Shown | null = null;
  let serial = 0;
  const listeners = new Set<() => void>();
  const set = (next: Shown | null) => {
    shown = next;
    for (const listener of [...listeners]) listener();
  };

  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  };
  const current = () => shown;

  const attach = (): (() => void) => {
    // The anchor under the pointer, whether or not its chip shows.
    let hovered: Element | null = null;
    let pending: {
      anchor: Element;
      delay: number;
      timer: ReturnType<typeof setTimeout>;
    } | null = null;
    let lastHiddenAt: number | null = null;
    // A Tab or arrow key is down: the focus it moves shows a chip (memory a-timer-cannot-end-a-keys-turn).
    let navKeyDown = false;

    const cancel = () => {
      if (pending === null) return;
      clearTimeout(pending.timer);
      pending = null;
    };
    const hide = () => {
      cancel();
      if (shown === null) return;
      anchorWatch.disconnect();
      lastHiddenAt = Date.now();
      set(null);
    };
    const show = (anchor: Element) => {
      cancel();
      const text = anchor.getAttribute('data-tooltip');
      if (!text || isDragging() || shown?.anchor === anchor) return;
      if (repeatsVisibleText(anchor, text)) return;
      anchorWatch.disconnect();
      anchorWatch.observe(anchor.getRootNode(), {
        childList: true,
        subtree: true,
      });
      anchorWatch.observe(anchor, {
        attributes: true,
        attributeFilter: ['data-tooltip'],
      });
      set({ anchor, text, serial: ++serial });
    };
    // The delay is fixed when the pointer arrives; a move only restarts it.
    const schedule = (
      anchor: Element,
      delay = showDelay(Date.now(), lastHiddenAt)
    ) => {
      cancel();
      pending = { anchor, delay, timer: setTimeout(() => show(anchor), delay) };
    };
    const leaveHover = () => {
      cancel();
      if (hovered !== null && shown?.anchor === hovered) hide();
    };

    // The shown anchor gone, or its text changed or removed.
    const anchorWatch = new MutationObserver(() => {
      if (shown === null) return;
      const text = shown.anchor.getAttribute('data-tooltip');
      if (!shown.anchor.isConnected || !text) hide();
      else if (text !== shown.text) set({ ...shown, text });
    });
    const dragWatch = new MutationObserver(() => {
      if (isDragging()) hide();
    });
    dragWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-dragging', 'data-carrying'],
    });

    const onPointerOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const anchor = anchorOf(e.target);
      // Still the same anchor (a move onto its child): nothing restarts, so a pressed one stays hidden.
      if (anchor === hovered) return;
      leaveHover();
      hovered = anchor;
      if (anchor !== null) schedule(anchor);
    };
    const onPointerOut = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (anchorOf(e.relatedTarget) === hovered) return;
      leaveHover();
      hovered = null;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || pending === null) return;
      if (anchorOf(e.target) === pending.anchor) {
        schedule(pending.anchor, pending.delay);
      }
    };
    const onPointerDown = () => {
      navKeyDown = false;
      hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!navKeyDown) return;
      const anchor = anchorOf(e.target);
      if (anchor !== null) show(anchor);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (shown === null || !(e.target instanceof Node)) return;
      if (!shown.anchor.contains(e.target)) return;
      if (anchorOf(e.relatedTarget) !== shown.anchor) hide();
    };
    // Never preventDefault or stopPropagation: every key keeps its usual job.
    const onKeyDown = (e: KeyboardEvent) => {
      navKeyDown = NAV_KEYS.has(e.key);
      if (HIDING_KEYS.has(e.key)) hide();
    };
    const onKeyUp = () => {
      navKeyDown = false;
    };
    const onBlur = () => {
      navKeyDown = false;
      hide();
    };

    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', onBlur);
      cancel();
      anchorWatch.disconnect();
      dragWatch.disconnect();
      shown = null;
    };
  };

  return { subscribe, current, attach };
}

const fadeIn = keyframes`
  from {
    opacity: 0;
  }
`;

// The box the chip stays inside, in viewport px: an open dialog's inside, since
// it clips what it holds (Setup: overflow auto), else the window.
function frameOf(dialog: Element | null): Box {
  if (dialog === null) {
    const root = document.documentElement;
    return {
      left: 0,
      top: 0,
      width: root.clientWidth,
      height: root.clientHeight,
    };
  }
  const box = dialog.getBoundingClientRect();
  return {
    left: box.left + dialog.clientLeft,
    top: box.top + dialog.clientTop,
    width: dialog.clientWidth,
    height: dialog.clientHeight,
  };
}

function Chip({
  anchor,
  text,
  dialog,
}: {
  anchor: Element;
  text: string;
  dialog: Element | null;
}) {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const ref = useRef<HTMLDivElement>(null);

  // Placed before the first paint. Drawn at 0,0 first: where that lands is the
  // origin of its containing block, which a transformed dialog moves.
  useLayoutEffect(() => {
    const chip = ref.current;
    if (chip === null) return;
    chip.style.left = '0px';
    chip.style.top = '0px';
    const origin = chip.getBoundingClientRect();
    const frame = frameOf(dialog);
    const box = anchor.getBoundingClientRect();
    const at = placeTooltip(
      {
        left: box.left - frame.left,
        top: box.top - frame.top,
        width: box.width,
        height: box.height,
      },
      { width: origin.width, height: origin.height },
      { width: frame.width, height: frame.height }
    );
    chip.style.left = `${frame.left + at.left - origin.left}px`;
    chip.style.top = `${frame.top + at.top - origin.top}px`;
  }, [anchor, text, dialog]);

  return (
    <div
      ref={ref}
      data-tooltip-chip=""
      aria-hidden="true"
      css={css`
        position: fixed;
        left: 0;
        top: 0;
        z-index: ${CHIP_Z_INDEX};
        box-sizing: border-box;
        width: max-content;
        max-width: ${MAX_WIDTH_PX}px;
        padding: 4px 8px;
        border-radius: ${RADIUS.SQUARE};
        background-color: ${COLORS.TEXT_COLOR};
        color: ${COLORS.PRIMARY_COLOR};
        font-family: ${FONT_FAMILY};
        font-size: ${TYPE.SECONDARY};
        white-space: normal;
        overflow-wrap: break-word;
        pointer-events: none;
        @media (prefers-reduced-motion: no-preference) {
          animation: ${fadeIn} ${DURATION.COLOR} ease-out;
        }
      `}
    >
      {text}
    </div>
  );
}

export function TooltipLayer(): ReactPortal | null {
  const [tooltips] = useState(createTooltips);
  const shown = useSyncExternalStore(tooltips.subscribe, tooltips.current);
  useEffect(() => tooltips.attach(), [tooltips]);

  if (shown === null) return null;
  // A modal dialog is in the top layer, above every z-index: its chip is drawn inside it.
  const dialog = shown.anchor.closest('dialog[open]');
  return createPortal(
    <Chip
      key={shown.serial}
      anchor={shown.anchor}
      text={shown.text}
      dialog={dialog}
    />,
    dialog ?? document.body
  );
}
