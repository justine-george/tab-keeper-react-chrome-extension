import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { css } from '@emotion/react';

import AskCard from './AskCard';
import { markClosesThisTabCardAnswered } from '../../redux/slices/settingsDataStateSlice';
import type { AppDispatch, RootState } from '../../redux/store';

interface ClosesThisTabProps {
  // Whether the press would close this full view. A read that fails counts as yes.
  wouldClose: () => boolean | Promise<boolean>;
  // What the press does.
  onGo: () => void;
  text: string;
  goLabel: string;
  pinLabel: string;
  // Which edge of the control the card lines up with, and the notch's distance from it.
  align: 'left' | 'right';
  notchInset: string;
  // For a control that shrinks in its row (Open now's chip).
  shrinks?: boolean;
  // KAN-810. A pane-motion layer name (paneMotion.ts) for the control's box.
  layer?: string;
  children: (press: () => void) => ReactNode;
}

/**
 * KAN-578 (pick A, H1). A control whose press may close this full view. Until
 * Go back, or a Pin that worked, on this device, such a press shows a card
 * first; ✕, Esc and a press outside cancel it and are not an answer.
 */
export default function ClosesThisTab({
  wouldClose,
  onGo,
  text,
  goLabel,
  pinLabel,
  align,
  notchInset,
  shrinks = false,
  layer,
  children,
}: ClosesThisTabProps) {
  const dispatch: AppDispatch = useDispatch();
  const isAnswered = useSelector(
    (state: RootState) => state.settingsDataState.isClosesThisTabCardAnswered
  );
  const [isOpen, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);

  const press = async () => {
    if (isAnswered) {
      onGo();
      return;
    }
    let closes = true;
    try {
      closes = await wouldClose();
    } catch (error) {
      console.warn('Could not tell whether this tab would close:', error);
    }
    if (closes) setOpen(true);
    else onGo();
  };

  const go = () => {
    dispatch(markClosesThisTabCardAnswered());
    setOpen(false);
    onGo();
  };

  // Awaited before the press goes on: the worker reads the tab's pinned state to decide.
  const pinAndGo = async () => {
    try {
      const self = await chrome.tabs.getCurrent();
      if (self?.id === undefined) throw new Error('Not in a tab.');
      await chrome.tabs.update(self.id, { pinned: true });
    } catch (error) {
      console.warn('Could not pin this tab:', error);
      return;
    }
    go();
  };

  // The control is the wrapper's first focusable child; the card follows it.
  const cancel = (refocus: boolean) => {
    setOpen(false);
    if (refocus)
      anchorRef.current
        ?.querySelector<HTMLElement>('button, [role="button"]')
        ?.focus();
  };

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        anchorRef.current?.contains(event.target)
      )
        return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  return (
    <span
      ref={anchorRef}
      data-pane-layer={layer}
      css={css`
        position: relative;
        display: inline-flex;
        ${shrinks ? 'min-width: 0;' : ''}
      `}
    >
      {children(() => void press())}
      {isOpen && (
        <AskCard
          text={text}
          quiet={{ label: pinLabel, onPress: () => void pinAndGo() }}
          filled={{ label: goLabel, onPress: go }}
          align={align}
          notchInset={notchInset}
          onCancel={() => cancel(true)}
        />
      )}
    </span>
  );
}
