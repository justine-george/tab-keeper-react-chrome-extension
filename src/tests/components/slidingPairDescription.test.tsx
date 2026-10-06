import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import SlidingPair, {
  type SlidingOption,
  type SlidingPairMetrics,
} from '../../components/common/SlidingPair';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-280 fix round 1. SlidingPair takes an optional `describedBy` id and
// puts it on the element that carries the pair's role and name -- the
// role="group" track -- so a caller's help line is announced with the pair.
// Callers that pass nothing must get no attribute at all.

const METRICS: SlidingPairMetrics = {
  minHeight: '32px',
  radius: '0px',
  knobRadius: '0px',
  slide: '200ms ease-out',
  press: '120ms ease-out',
};

const OPTIONS: readonly [
  SlidingOption<'on' | 'off'>,
  SlidingOption<'on' | 'off'>,
] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

describe('SlidingPair describedBy', () => {
  test('with the prop, the group is described by the element it names', async () => {
    await renderWithProviders(
      <>
        <SlidingPair
          label="Pair"
          options={OPTIONS}
          value="on"
          onChange={() => {}}
          metrics={METRICS}
          describedBy="pair-help"
        />
        <p id="pair-help">What the pair does.</p>
      </>
    );

    const group = screen.getByRole('group', { name: 'Pair' });
    expect(group.getAttribute('aria-describedby')).toBe('pair-help');
    expect(group).toHaveAccessibleDescription('What the pair does.');
  });

  test('without the prop, nothing in the pair has aria-describedby', async () => {
    const { container } = await renderWithProviders(
      <SlidingPair
        label="Pair"
        options={OPTIONS}
        value="on"
        onChange={() => {}}
        metrics={METRICS}
      />
    );

    expect(
      screen
        .getByRole('group', { name: 'Pair' })
        .hasAttribute('aria-describedby')
    ).toBe(false);
    expect(container.querySelector('[aria-describedby]')).toBeNull();
  });
});
