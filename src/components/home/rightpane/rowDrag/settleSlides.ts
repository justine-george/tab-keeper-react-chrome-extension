import { LANDING_SLIDE } from './landingSlides';

// KAN-280 Part F (Justine, 2026-10-15 02:25). A drag measures its list at rest. Rows step aside with an eased
// transform (DURATION.MOVE); after a hand-back they ease home. A drag that starts, or adopts a carry, within that
// time would read every row mid-slide and land its slot rows away from the pointer. So any transform slide still
// running in the list is finished first: the rows jump to where they are going, then are measured.

// What a running animation exposes here: a CSS transition names its property; a keyframe animation does not.
interface Slide {
  transitionProperty?: string;
  id?: string;
  playState: string;
  finish(): void;
}

interface HasAnimations {
  getAnimations?(options: { subtree: boolean }): readonly Slide[];
}

export function settleSlides(root: HasAnimations | null): void {
  // jsdom has no animations, and neither does a list not drawn yet.
  const animations = root?.getAnimations?.({ subtree: true }) ?? [];
  for (const a of animations) {
    // A landing's window blocks gliding up are slides too (KAN-836).
    const slides =
      a.transitionProperty === 'transform' || a.id === LANDING_SLIDE;
    if (slides && a.playState === 'running') {
      a.finish();
    }
  }
}
