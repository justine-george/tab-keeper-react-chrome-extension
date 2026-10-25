import { describe, expect, test } from 'vitest';

import Icon from '../../components/common/Icon';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-148, kept for the Tab Keeper mark since KAN-511 removed Share on X.
//
// WHY THIS NEEDS A TEST AT ALL. Material Symbols carries no brand marks, and an
// unavailable ligature does not render as tofu -- it renders as LITERAL TEXT.
// So a brand name against the font produces its letters, which in a button is
// not obviously wrong to the eye; KAN-5 had to measure inked
// width on a canvas to tell a real glyph from a spelled-out name. A test that
// only asserted "something rendered" would pass against that.
describe('a brand icon (the Tab Keeper mark)', () => {
  test('draws the brand mark rather than the word tab_keeper', async () => {
    const { container } = await renderWithProviders(
      <Icon type="tab_keeper" onClick={() => {}} ariaLabel="Tab Keeper" />
    );

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // A real path, not an empty element that happens to be an <svg>.
    expect(svg!.querySelector('path')?.getAttribute('d')).toMatch(/^M[\d.]/);
    // And no ligature span, which is what would have rendered the letter.
    expect(container.querySelector('.material-symbols-outlined')).toBeNull();
    expect(container.textContent).not.toContain('tab_keeper');
  });

  // THE CONTROL. Without it, an Icon that drew an <svg> for every type -- or a
  // SVG_GLYPHS lookup that matched anything -- would satisfy the test above
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
      <Icon type="tab_keeper" onClick={() => {}} ariaLabel="Tab Keeper" />
    );

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
  });
});
