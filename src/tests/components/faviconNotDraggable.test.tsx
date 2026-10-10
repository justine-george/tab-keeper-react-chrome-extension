import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import Icon from '../../components/common/Icon';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-232. An <img> is natively draggable: a press-and-move on the favicon started an HTML5 drag and the row's engine
// never saw it. e2e/favicon-drag.spec.ts proves the drag; this pins the attribute a refactor of Icon would most quietly lose.
describe('the favicon image is not natively draggable (KAN-232)', () => {
  test('renders with draggable="false"', async () => {
    await renderWithProviders(
      <Icon faviconUrl="https://example.test/favicon.ico" type="globe" />
    );

    // `hidden`: the presentational Icon is aria-hidden.
    const img = screen.getByRole('img', { name: 'favicon', hidden: true });
    expect(img).toHaveAttribute('draggable', 'false');
  });
});
