import { describe, expect, test } from 'vitest';

import Button from '../../components/common/Button';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-603. Print's "Preparing…" face shows a spinner, which is a glyph rather than a ligature.
describe('a second face with a glyph (KAN-603)', () => {
  const render = () =>
    renderWithProviders(
      <Button
        text="PDF / Print"
        iconType="print"
        secondFace={{
          iconType: 'print',
          glyph: <svg data-testid="g" />,
          text: 'Preparing…',
          shown: true,
        }}
      />
    );

  test('draws the glyph in place of the icon, beside its word', async () => {
    const { container } = await render();
    const face = container.querySelector('[data-second-face]');
    if (!face) throw new Error('no second face');

    expect(face.querySelector('[data-testid="g"]')).not.toBeNull();
    expect(face.textContent).toContain('Preparing…');
    expect(face.querySelector('.material-symbols-outlined')).toBeNull();
    expect(face.textContent).not.toContain('print');
  });

  test('spaces the glyph away from its word as the icon is', async () => {
    const { container } = await render();
    const glyph = container.querySelector('[data-testid="g"]');
    const holder = glyph?.parentElement;
    if (!holder) throw new Error('no glyph holder');

    expect(getComputedStyle(holder).paddingRight).toBe('8px');
  });
});
