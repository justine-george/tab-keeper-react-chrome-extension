import { describe, expect, test } from 'vitest';

import Icon from '../../components/common/Icon';
import { renderWithProviders } from '../setup/renderWithProviders';
import { SHARE_X_TEXT } from '../../utils/constants/common';

// KAN-148. The X share control.
//
// WHY THIS NEEDS A TEST AT ALL. Material Symbols carries no brand marks, and an
// unavailable ligature does not render as tofu -- it renders as LITERAL TEXT.
// So `type="x"` against the font produces a lowercase letter x, which at 1.5rem
// in a button is not obviously wrong to the eye; KAN-5 had to measure inked
// width on a canvas to tell a real glyph from a spelled-out name. A test that
// only asserted "something rendered" would pass against that.
describe('the X share icon', () => {
  test('draws the brand mark rather than the letter x', async () => {
    const { container } = await renderWithProviders(
      <Icon type="x" onClick={() => {}} ariaLabel="Share on X" />
    );

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // A real path, not an empty element that happens to be an <svg>.
    expect(svg!.querySelector('path')?.getAttribute('d')).toMatch(/^M[\d.]/);
    // And no ligature span, which is what would have rendered the letter.
    expect(container.querySelector('.material-symbols-outlined')).toBeNull();
    expect(container.textContent).not.toContain('x');
  });

  // THE CONTROL. Without it, an Icon that drew an <svg> for every type -- or a
  // BRAND_GLYPHS lookup that matched anything -- would satisfy the test above
  // while breaking every other icon in the app.
  test('CONTROL: an ordinary icon still renders as a ligature', async () => {
    const { container } = await renderWithProviders(
      <Icon type="mail" onClick={() => {}} ariaLabel="Share your feedback" />
    );

    const span = container.querySelector('.material-symbols-outlined');
    expect(span?.textContent).toBe('mail');
    expect(container.querySelector('svg')).toBeNull();
  });

  // The mark is decorative: the control is named by its own aria-label, so a
  // second name from the graphic would be read out twice.
  test('the mark is hidden from the accessibility tree', async () => {
    const { container } = await renderWithProviders(
      <Icon type="x" onClick={() => {}} ariaLabel="Share on X" />
    );

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
  });
});

describe('the X share link', () => {
  // twitter.com/intent/tweet answered 301 to exactly this, so every share cost
  // a redirect, and `tweet` is the endpoint name X has retired.
  test('posts to x.com, not to twitter.com', () => {
    expect(SHARE_X_TEXT).toContain('https://x.com/intent/post?');
    expect(SHARE_X_TEXT).not.toContain('twitter.com');
    expect(SHARE_X_TEXT).not.toContain('/intent/tweet');
  });

  // Interpolated raw rather than percent-encoded, which is what the constant
  // has always done and is legal in a query value -- a store URL carries no
  // character that needs escaping there. Asserted in the form it actually
  // takes, so this does not quietly become a test of encodeURIComponent.
  test('still carries the store link it is sharing', () => {
    expect(SHARE_X_TEXT).toContain(
      'url=https://chromewebstore.google.com/detail/'
    );
  });
});
