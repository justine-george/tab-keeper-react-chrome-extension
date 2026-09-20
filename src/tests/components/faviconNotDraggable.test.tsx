import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import Icon from '../../components/common/Icon';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-232. A tab row's favicon is an <img>, and an image is natively
// draggable by default: a press-and-move on it started the browser's own
// HTML5 drag and the page stopped receiving pointer moves, so the row's drag
// engine never saw the gesture. e2e/favicon-drag.spec.ts proves the drag now
// works from the icon; this pins the one attribute that makes it so, where a
// refactor of Icon's img would most quietly lose it.
describe('the favicon image is not natively draggable (KAN-232)', () => {
  test('renders with draggable="false"', async () => {
    await renderWithProviders(
      <Icon faviconUrl="https://example.test/favicon.ico" type="globe" />
    );

    // `hidden`: a presentational Icon is aria-hidden, which is right, and
    // hides the img from the accessibility tree the default query walks.
    const img = screen.getByRole('img', { name: 'favicon', hidden: true });
    expect(img).toHaveAttribute('draggable', 'false');
  });

  // CONTROL: the attribute is not a jsdom default. A bare <img> reports no
  // draggable attribute at all, so the assertion above is reading what Icon
  // wrote, not what the DOM assumes.
  test('CONTROL: a plain img carries no draggable attribute', () => {
    const img = document.createElement('img');
    expect(img.hasAttribute('draggable')).toBe(false);
  });
});
