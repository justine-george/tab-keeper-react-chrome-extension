import {
  canAnimate,
  prefersReducedMotion,
  type Motion,
} from '../modals/getStartedMotion';

// The header mark's click animates only transform: the get-started beat in miniature.

// Web Animations durations, so not DURATION's (CSS transitions).
export const MARK_CLICK = {
  PRESS_MS: 150,
  SHUTTER_MS: 300,
  SHUTTER_DELAY_MS: 60,
  // KAN-627. The whole shutter slides; further than 16 and it leaves the disk.
  SHUTTER_PX: -16,
} as const;

// KAN-388. Reduce motion's save: the shutter dims and comes back, COLOR (120ms) each way.
export const MARK_SAVE_DIM = { OPACITY: 0.45, MS: 240 } as const;

// Out, a short hold, and home: the click's slide, which a save plays too.
function slideShutter(shutter: Element): Animation {
  return shutter.animate(
    [
      { transform: 'translateX(0)' },
      { transform: `translateX(${MARK_CLICK.SHUTTER_PX}px)`, offset: 0.45 },
      { transform: `translateX(${MARK_CLICK.SHUTTER_PX}px)`, offset: 0.55 },
      { transform: 'translateX(0)' },
    ],
    {
      duration: MARK_CLICK.SHUTTER_MS,
      delay: MARK_CLICK.SHUTTER_DELAY_MS,
      easing: 'ease-in-out',
    }
  );
}

// The shutter's two moments, as Get started has them (KAN-513): ready the click as it starts, play it as it shuts.
export interface ShutterBeat {
  onShutterStart: () => void;
  // Once, as the shutter shuts; a click cut short before then never calls it.
  onShutterShut: () => void;
}

// Plays nothing, and returns null, when motion is off or unavailable.
export function playMarkClick(
  mark: Element,
  shutter: Element | null,
  beat?: ShutterBeat
): Motion | null {
  if (prefersReducedMotion() || !canAnimate(mark)) return null;
  const press = mark.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(0.92)' },
      { transform: 'scale(1)' },
    ],
    { duration: MARK_CLICK.PRESS_MS, easing: 'ease-out' }
  );
  const slide = shutter === null ? null : slideShutter(shutter);
  let isCancelled = false;
  if (beat !== undefined) {
    beat.onShutterStart();
    // With no shutter drawn, the press ending is the shut.
    void (slide ?? press).finished.then(
      () => {
        if (!isCancelled) beat.onShutterShut();
      },
      () => undefined
    );
  }
  const finished = Promise.all([press.finished, slide?.finished]).then(
    () => !isCancelled,
    () => false
  );
  return {
    finished,
    cancel: () => {
      isCancelled = true;
      press.cancel();
      slide?.cancel();
    },
  };
}

// KAN-388, his pick B. A save slides the shutter as a click does, with no press and no sound.
// Under Reduce motion the shutter dims instead. Null where nothing can animate.
export function playMarkSave(shutter: Element): Motion | null {
  if (!canAnimate(shutter)) return null;
  const animation = prefersReducedMotion()
    ? shutter.animate(
        [{ opacity: 1 }, { opacity: MARK_SAVE_DIM.OPACITY }, { opacity: 1 }],
        { duration: MARK_SAVE_DIM.MS, easing: 'ease-out' }
      )
    : slideShutter(shutter);
  let isCancelled = false;
  return {
    finished: animation.finished.then(
      () => !isCancelled,
      () => false
    ),
    cancel: () => {
      isCancelled = true;
      animation.cancel();
    },
  };
}
