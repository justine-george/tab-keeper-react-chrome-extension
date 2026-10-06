// The get-started moment animates only transform and opacity.

// Web Animations durations, so not DURATION's (CSS transitions).
export const GET_STARTED = {
  PRESS_MS: 150,
  SHUTTER_MS: 250,
  LEAVE_MS: 150,
  ENTER_MS: 220,
} as const;
export const SHUTTER_EASE = 'ease-in-out';
export const ENTER_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
// The modals centre themselves with this transform, so every dialog frame keeps it.
const CENTRED = 'translate(-50%, -50%)';

export interface RunningAnimation {
  readonly finished: Promise<unknown>;
  cancel(): void;
}

export interface Animatable {
  animate(
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions
  ): RunningAnimation;
}

export interface GetStartedParts {
  button: Animatable;
  shutter: Animatable | null;
  dialog: Animatable;
}

export interface Motion {
  // True once all of it ran; false when it was cancelled first.
  finished: Promise<boolean>;
  cancel(): void;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// No Web Animations (jsdom, or an old engine): no moment, straight on.
export function canAnimate(element: Element): boolean {
  return typeof element.animate === 'function';
}

export function playGetStarted(parts: GetStartedParts): Motion {
  const running: RunningAnimation[] = [];
  let isCancelled = false;
  const run = async (
    target: Animatable,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions
  ) => {
    if (isCancelled) throw new Error('cancelled');
    const animation = target.animate(keyframes, options);
    running.push(animation);
    await animation.finished;
  };
  const finished = (async () => {
    try {
      await run(
        parts.button,
        [
          { transform: 'scale(1)' },
          { transform: 'scale(0.96)' },
          { transform: 'scale(1)' },
        ],
        { duration: GET_STARTED.PRESS_MS, easing: 'ease-out' }
      );
      if (parts.shutter !== null) {
        await run(
          parts.shutter,
          [
            { transform: 'translateX(0px)' },
            { transform: 'translateX(-14px)', offset: 0.5 },
            { transform: 'translateX(0px)' },
          ],
          { duration: GET_STARTED.SHUTTER_MS, easing: SHUTTER_EASE }
        );
      }
      await run(
        parts.dialog,
        [
          { opacity: 1, transform: CENTRED },
          { opacity: 0, transform: 'translate(-50%, calc(-50% - 8px))' },
        ],
        { duration: GET_STARTED.LEAVE_MS, easing: 'ease-in', fill: 'forwards' }
      );
      return !isCancelled;
    } catch {
      return false;
    }
  })();
  return {
    finished,
    cancel: () => {
      isCancelled = true;
      running.forEach((animation) => animation.cancel());
    },
  };
}

// A dialog that follows Get started enters from 0.97 and transparent.
export function playDialogEntrance(dialog: Animatable): void {
  dialog.animate(
    [
      { opacity: 0, transform: `${CENTRED} scale(0.97)` },
      { opacity: 1, transform: `${CENTRED} scale(1)` },
    ],
    { duration: GET_STARTED.ENTER_MS, easing: ENTER_EASE }
  );
}
