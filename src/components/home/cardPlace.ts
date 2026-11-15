// KAN-820 2B. The drag and carry card's width and its gap from the pointer.
export const CARD_WIDTH_PX = 230;
export const CARD_OFFSET_X = 8;
// Just below the arrow's tip, as the mock draws it; KAN-822: a dropped row glides from here.
export const CARD_OFFSET_Y = 4;

// The card's left edge: right of the pointer, or left of it once the right
// edge would pass the viewport.
export function cardLeft(pointerX: number, viewportWidth: number): number {
  const right = pointerX + CARD_OFFSET_X;
  if (right + CARD_WIDTH_PX > viewportWidth) {
    return pointerX - CARD_OFFSET_X - CARD_WIDTH_PX;
  }
  return right;
}
