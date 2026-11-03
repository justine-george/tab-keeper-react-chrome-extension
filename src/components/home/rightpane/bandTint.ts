// KAN-164. A group a tab released here would join answers in its own colour:
// a wash over the band, both panes' bands alike.
//
// KAN-915. Painted over the band's DRAWN extent, not its box. The follower
// grows the box by padding to reach a title row moved up, but never shrinks
// it (GroupFrameFollower), so when a group above goes (KAN-169) and the
// whole band is drawn higher, its box still ends at its resting bottom: the
// wash ran past the last tab and over the next group's header. The follower
// publishes the drawn bottom as --frame-bottom (the strip already reads it);
// the wash stops there. The top needs nothing: a lit band's title only moves
// up, which the padding reaches. Square, so the cut needs no corner.
import { RADIUS } from '../../../styles/scale';

export const DROP_TARGET_TINT = `
  border-radius: ${RADIUS.SQUARE};
  background-image: linear-gradient(
    color-mix(in srgb, var(--band-color, transparent) 18%, transparent),
    color-mix(in srgb, var(--band-color, transparent) 18%, transparent)
  );
  background-repeat: no-repeat;
  background-size: 100% calc(100% - max(0px, -1 * var(--frame-bottom, 0px)));
`;
