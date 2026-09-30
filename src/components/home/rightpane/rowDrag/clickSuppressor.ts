// The click a drag's release must not deliver, and no other (KAN-128, KAN-177,
// KAN-335, KAN-337). One rule, used by both the drag engine (RowDragArea) and
// the carry (CarryLayer, KAN-350): it took three tickets to get right, and two
// copies would be two chances for a fix to reach only one of them.
//
// Chrome synthesizes a `click` after `mouseup`, aimed at whatever the pointer
// released over -- the held row, which tracks the pointer, or whatever a carry
// was released over. Left alone it runs that element's onClick: for a tab that
// opens the tab, and for a window it opens the whole window's worth of tabs.
//
// A timestamp rather than an add/remove-listener dance: the click arrives in
// the same input sequence as the pointerup that arms this, and a listener
// removed on a timer can race that sequence in either direction. Spending the
// window on the first swallowed click is what stops the NEXT ordinary click
// being eaten too.

// How long after a release its click may still arrive.
const RELEASE_CLICK_MS = 400;

export interface ClickSuppressor {
  /** The press was just released: eat the one click that follows it. */
  armForRelease(): void;
  /**
   * The gesture was cancelled with the press still down (Esc, a list turning
   * drag off, a carried item removed): eat the click that follows that
   * press's release, whenever it comes (KAN-335). Measured on the real
   * artifact: 800ms after an Esc, a release back on the held row opened its
   * tab. While it waits it eats no click (KAN-337).
   */
  armUntilRelease(): void;
  /** Window `pointerup`: a press waiting for its release gets its 400ms. */
  onPointerUp(): void;
  /** Window `click`, CAPTURE: before React's root delegation dispatches it. */
  onClickCapture(e: MouseEvent): void;
  /** Window `pointerdown`, CAPTURE: nothing a press reaches first can stop it. */
  onPointerDownCapture(): void;
}

export function createClickSuppressor(): ClickSuppressor {
  let until = 0;
  return {
    armForRelease() {
      until = performance.now() + RELEASE_CLICK_MS;
    },
    armUntilRelease() {
      until = Number.POSITIVE_INFINITY;
    },
    onPointerUp() {
      if (until === Number.POSITIVE_INFINITY)
        until = performance.now() + RELEASE_CLICK_MS;
    },
    onClickCapture(e) {
      // Still waiting for a cancelled press's release: the press's own click
      // only ever follows its pointerup, and onPointerUp has turned this into
      // the 400ms by then. A click now has no press behind it -- Enter or
      // Space on a focused control -- and is the user's (KAN-337).
      if (until === Number.POSITIVE_INFINITY) return;
      if (performance.now() >= until) return;
      until = 0;
      e.preventDefault();
      e.stopPropagation();
    },
    // A new press disarms it (KAN-177). The suppression is for ONE click: the
    // one Chrome synthesizes for the release, which follows that pointerup
    // with no press in between (measured in click-after-drag.spec.ts).
    //
    // A drag that COMMITS gets no such click -- React moves the row inside the
    // pointerup handler -- so, judged by the clock alone, the suppression
    // stayed armed and ate the user's next click wherever it landed: very
    // often Undo. Every click the user makes afterwards starts with a
    // pointerdown of its own, and that is what tells the two apart; not the
    // time, and not where the click lands.
    onPointerDownCapture() {
      until = 0;
    },
  };
}
