import type { Locator } from '@playwright/test';

export interface PairFit {
  /** The track's outer height. */
  height: number;
  /** How far the word's text box sits inside the track's padding box, top and bottom; negative overruns. */
  clearTop: number;
  clearBottom: number;
}

// A SlidingPair's track against the text box of one of its words.
export function pairFit(group: Locator, word: string): Promise<PairFit> {
  return group.evaluate((track, label) => {
    const box = track.getBoundingClientRect();
    const style = getComputedStyle(track);
    const innerTop = box.top + parseFloat(style.borderTopWidth);
    const innerBottom = box.bottom - parseFloat(style.borderBottomWidth);
    const button = [...track.querySelectorAll('button')].find(
      (b) => b.textContent === label
    );
    if (button === undefined) throw new Error(`no ${label} in the pair`);
    const range = document.createRange();
    range.selectNodeContents(button);
    const text = range.getBoundingClientRect();
    return {
      height: box.height,
      clearTop: text.top - innerTop,
      clearBottom: innerBottom - text.bottom,
    };
  }, word);
}
