// KAN-723. A tag ending within this far of the strip's first control counts as under it.
export const TAG_STRIP_ALLOWANCE_PX = 4;

// KAN-723. A row places this inside its own strip-shown selector: the mark says where a tag sits, the row says when.
export const HIDE_TAGS_UNDER_STRIP =
  '[data-row-tag][data-under-strip] { visibility: hidden; }';

// KAN-723. Marks each of the row's tags the strip would cover; with no strip or no control with a width, marks none.
export function markTagsUnderStrip(
  row: HTMLElement,
  strip: HTMLElement | null
): void {
  let line: number | null = null;
  for (const control of strip ? Array.from(strip.children) : []) {
    const box = control.getBoundingClientRect();
    if (box.width > 0) {
      line = box.left - TAG_STRIP_ALLOWANCE_PX;
      break;
    }
  }
  for (const tag of Array.from(row.querySelectorAll('[data-row-tag]'))) {
    if (line !== null && tag.getBoundingClientRect().right > line) {
      tag.setAttribute('data-under-strip', '');
    } else {
      tag.removeAttribute('data-under-strip');
    }
  }
}
