import { EASE } from '../../styles/scale';

// Web Animations timings for §5's four beats, so not DURATION's (CSS transitions).
export const WELCOME_LOOP = {
  INTO_AT_MS: 300,
  CHIP_STAGGER_MS: 120,
  ARC_MS: 560,
  DIP_MS: 220,
  LINE_FADE_AT_MS: 400,
  LINE_FADE_MS: 300,
  SHUT_AT_MS: 1100,
  SHUT_MS: 300,
  CHECK_AT_MS: 1150,
  CHECK_MS: 220,
  BACK_AT_MS: 1600,
  OPEN_MS: 220,
  LINES_AT_MS: 1850,
  LINE_STAGGER_MS: 90,
  LINE_MS: 280,
  SMALLEST: 0.35,
  LIFT_PX: 70,
  SHUTTER_PX: 14,
  CHIP_STEP_PX: 50,
} as const;

export interface HeroLoop {
  // Get started: every running beat jumps to its end.
  finish(): void;
  // A remount: drops the fill, so a replay starts from the start frame.
  cancel(): void;
}

const NO_LOOP: HeroLoop = { finish: () => undefined, cancel: () => undefined };

// §5's beats once, about 2.4s; measured on start, so any dialog width draws the same arcs.
export function playWelcomeLoop(hero: HTMLElement): HeroLoop {
  const L = WELCOME_LOOP;
  const parts = (name: string) => [
    ...hero.querySelectorAll<HTMLElement>(`[data-hero-part="${name}"]`),
  ];
  const [floppy] = parts('floppy');
  const [shutter] = parts('shutter');
  const [check] = parts('check');
  const [right] = parts('window-right');
  if (!floppy || !shutter || !check || !right) return NO_LOOP;
  const running: Animation[] = [];
  const play = (
    el: Element,
    keyframes: Keyframe[],
    timing: KeyframeAnimationOptions
  ) => {
    running.push(el.animate(keyframes, { fill: 'forwards', ...timing }));
  };
  // Rects are on screen: undo an ancestor's scale (Hello's entrance) or every arc lands short.
  const scale =
    hero.offsetWidth > 0
      ? hero.getBoundingClientRect().width / hero.offsetWidth
      : 1;
  const slot = floppy.getBoundingClientRect();
  const intoX = slot.left + slot.width / 2;
  const intoY = slot.top + 10;
  const home = right.getBoundingClientRect();

  parts('chip').forEach((chip, i) => {
    const from = chip.getBoundingClientRect();
    const dx = (intoX - (from.left + from.width / 2)) / scale;
    const dy = (intoY - from.top) / scale;
    const outX = (home.left - from.left) / scale + 6 + i * L.CHIP_STEP_PX;
    const outY = (home.top - from.top) / scale + 5;
    const leaves = L.INTO_AT_MS + i * L.CHIP_STAGGER_MS;
    play(
      chip,
      [
        { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
        {
          transform: `translate(${dx / 2}px, ${dy - L.LIFT_PX}px) scale(1.08)`,
          opacity: 1,
          offset: 0.5,
        },
        {
          transform: `translate(${dx}px, ${dy}px) scale(${L.SMALLEST})`,
          opacity: 0,
        },
      ],
      { duration: L.ARC_MS, delay: leaves, easing: 'ease-in-out' }
    );
    // The floppy dips as each chip lands; it ends where it began, so no fill.
    running.push(
      floppy.animate(
        [
          { transform: 'translateY(0px) scale(1)' },
          { transform: 'translateY(3px) scale(0.96)' },
          { transform: 'translateY(0px) scale(1)' },
        ],
        {
          duration: L.DIP_MS,
          delay: leaves + L.ARC_MS - L.DIP_MS,
          easing: EASE.OUT,
        }
      )
    );
    play(
      chip,
      [
        {
          transform: `translate(${dx}px, ${dy}px) scale(${L.SMALLEST})`,
          opacity: 0,
        },
        {
          transform: `translate(${(dx + outX) / 2}px, ${
            dy - L.LIFT_PX
          }px) scale(1.08)`,
          opacity: 1,
          offset: 0.5,
        },
        { transform: `translate(${outX}px, ${outY}px) scale(1)`, opacity: 1 },
      ],
      {
        duration: L.ARC_MS,
        delay: L.BACK_AT_MS + i * L.CHIP_STAGGER_MS,
        easing: 'ease-in-out',
      }
    );
  });
  parts('line-left').forEach((line, i) =>
    play(line, [{ opacity: 1 }, { opacity: 0.15 }], {
      duration: L.LINE_FADE_MS,
      delay: L.LINE_FADE_AT_MS + i * L.CHIP_STAGGER_MS,
    })
  );
  play(
    shutter,
    [
      { transform: 'translateX(0px)' },
      { transform: `translateX(-${L.SHUTTER_PX}px)` },
    ],
    { duration: L.SHUT_MS, delay: L.SHUT_AT_MS, easing: 'ease-in-out' }
  );
  play(
    check,
    [
      { opacity: 0, transform: 'translate(-50%, 4px)' },
      { opacity: 1, transform: 'translate(-50%, 0px)' },
    ],
    { duration: L.CHECK_MS, delay: L.CHECK_AT_MS, easing: EASE.OUT }
  );
  play(
    check,
    [
      { opacity: 1, transform: 'translate(-50%, 0px)' },
      { opacity: 0, transform: 'translate(-50%, 0px)' },
    ],
    { duration: L.CHECK_MS, delay: L.BACK_AT_MS }
  );
  play(
    shutter,
    [
      { transform: `translateX(-${L.SHUTTER_PX}px)` },
      { transform: 'translateX(0px)' },
    ],
    { duration: L.OPEN_MS, delay: L.BACK_AT_MS, easing: 'ease-in-out' }
  );
  parts('line-right').forEach((line, i) =>
    play(
      line,
      [
        { opacity: 0, transform: 'scaleX(0.3)' },
        { opacity: 1, transform: 'scaleX(1)' },
      ],
      {
        duration: L.LINE_MS,
        delay: L.LINES_AT_MS + i * L.LINE_STAGGER_MS,
        easing: EASE.OUT,
      }
    )
  );
  return {
    finish: () => running.forEach((animation) => animation.finish()),
    cancel: () => running.forEach((animation) => animation.cancel()),
  };
}
