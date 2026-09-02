import { describe, expect, test } from 'vitest';

import Button from '../../components/common/Button';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-26. Button.tsx built the icon's style with a JS `&&` chain:
//
//   style={(imageSrc || text) && 'padding-right: 8px;' && iconStyle}
//
// `&&` yields its last truthy operand, so the padding literal was discarded in
// every case -- when iconStyle was set it lost to iconStyle, and when it was
// not the chain resolved to undefined. The gap the padding exists to create
// was therefore never applied on any button.
//
// Measured in the real extension on 2026-09-01, on Settings > Data Management:
// glyph-to-label gap was 4px (the Icon container's own `padding: 4px`), and
// injecting the intended `padding-right: 8px` moved it to 8px. So the visible
// defect is a uniform 4px deficit.
//
// These assert on computed padding rather than on the style string, because
// the string is an implementation detail -- what matters is what reaches the
// icon after Emotion has composed `containerStyle` with the injected style.
const iconContainerOf = (container: HTMLElement): HTMLElement => {
  const glyph = container.querySelector('.material-symbols-outlined');
  if (!glyph) throw new Error('no icon glyph rendered');
  // Icon.tsx renders containerStyle > wrapper > span.glyph
  return glyph.parentElement!.parentElement as HTMLElement;
};

describe('Button icon spacing', () => {
  test('separates the icon from its label', async () => {
    const { container } = await renderWithProviders(
      <Button text="Backup App Data to File" iconType="publish" />
    );

    expect(getComputedStyle(iconContainerOf(container)).paddingRight).toBe(
      '8px'
    );
  });

  test('separates the icon from an adjacent image', async () => {
    const { container } = await renderWithProviders(
      <Button imageSrc="https://example.com/i.png" iconType="publish" />
    );

    expect(getComputedStyle(iconContainerOf(container)).paddingRight).toBe(
      '8px'
    );
  });

  // The only caller in the codebase that passes iconStyle is
  // HeroContainerRight.tsx:307, the "Add window" button, and it passes the
  // shorthand `padding: 4px 4px 2px 4px`. That shorthand has to keep winning,
  // or fixing this ticket silently restyles a button nobody asked to change.
  // This is what pins the ordering: iconStyle must come last.
  test("lets a caller's own padding override the separation", async () => {
    const { container } = await renderWithProviders(
      <Button
        text="Add window"
        iconType="add"
        iconStyle="padding: 4px 4px 2px 4px;"
      />
    );

    expect(getComputedStyle(iconContainerOf(container)).paddingRight).toBe(
      '4px'
    );
  });

  // Nothing to separate the icon from, so the padding would be a bare
  // asymmetry. This is the one branch the old `&&` chain got right.
  test('adds no separation to an icon with no label or image', async () => {
    const { container } = await renderWithProviders(
      <Button iconType="publish" />
    );

    // Icon's own containerStyle padding, untouched.
    expect(getComputedStyle(iconContainerOf(container)).paddingRight).toBe(
      '4px'
    );
  });
});
