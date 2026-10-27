// KAN-825. Whether a text can't be read to its end: wider than its box (it ends
// in "…"), or something is drawn over its end (a row's strip, the rename pencil,
// neither of which reserves room). Measured once, where the last glyph shows.

// A background at least this opaque hides the text under it; the tour's dim (0.2) does not.
const COVERING_ALPHA = 0.5;

// The alpha of a computed colour: rgb(), rgba(), or color(srgb … / a) from color-mix.
function alphaOf(color: string): number {
  if (color === 'transparent') return 0;
  const slash = color.match(/\/\s*([\d.]+)(%?)\s*\)$/);
  if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1);
  const rgba = color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/);
  return rgba ? Number(rgba[1]) : 1;
}

const hasOwnText = (el: Element): boolean =>
  [...el.childNodes].some(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
  );

// The point hit is the end of the text: something painted there that the eye can see covers it.
function covers(hit: Element, holder: Element): boolean {
  const chain: Element[] = [];
  for (let el: Element | null = hit; el && !el.contains(holder);) {
    chain.unshift(el);
    el = el.parentElement;
  }
  // An empty chain: the hit holds the title (a parent it passes through), nothing over it.
  if (chain.length === 0) return false;
  for (const el of chain) {
    const style = getComputedStyle(el);
    // Hides itself and all it holds: nothing below is seen.
    if (
      Number(style.opacity) === 0 ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    ) {
      return false;
    }
    if (
      alphaOf(style.backgroundColor) >= COVERING_ALPHA ||
      (style.backgroundImage !== '' && style.backgroundImage !== 'none')
    ) {
      return true;
    }
  }
  return (
    hasOwnText(hit) ||
    hit instanceof SVGElement ||
    hit instanceof HTMLImageElement
  );
}

// Where the holder's glyphs end. Its text nodes, one by one: a range over the
// holder itself also spans the boxes of the elements it holds, which in a row
// button run to the row's end, under the strip.
function textRightOf(holder: Element): number | null {
  const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let right: number | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (rect.width > 0) right = Math.max(right ?? rect.right, rect.right);
  }
  return right;
}

export function isCutOff(holder: Element): boolean {
  if (holder.scrollWidth > holder.clientWidth) return true;
  const textRight = textRightOf(holder);
  // No layout (jsdom), or nothing drawn: nothing to cover.
  if (textRight === null) return false;
  const box = holder.getBoundingClientRect();
  const hit = document.elementFromPoint(
    Math.min(textRight, box.right) - 2,
    box.top + box.height / 2
  );
  // Off screen: the end can't be read.
  if (hit === null) return true;
  if (holder.contains(hit)) return false;
  return covers(hit, holder);
}
