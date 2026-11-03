import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import SlidingPair, {
  type SlidingOption,
} from '../../components/common/SlidingPair';
import { SETTINGS_PAIR_METRICS } from '../../components/common/slidingPairMetrics';
import { EXPORT_PAIR_METRICS } from '../../components/export/slidingPairStyle';
import { RADIUS } from '../../styles/scale';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-908. The knob's fill is its own element, so its corners are a real
// squircle (a clip-path can only cut an arc); the pressed words keep the clip.

type Side = 'on' | 'off';
const OPTIONS: readonly [SlidingOption<Side>, SlidingOption<Side>] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

function Pair({ start }: { start: Side }) {
  const [value, setValue] = useState<Side>(start);
  return (
    <SlidingPair
      label="Pair"
      options={OPTIONS}
      value={value}
      onChange={setValue}
      metrics={SETTINGS_PAIR_METRICS}
    />
  );
}

// jsdom lays nothing out: give the layer 100px and the buttons 40px each,
// "On" at 0–40 and "Off" at 60–100, measured from the layer's left.
const rect = (left: number, right: number): DOMRect => ({
  left,
  right,
  width: right - left,
  top: 0,
  bottom: 20,
  height: 20,
  x: left,
  y: 0,
  toJSON: () => ({}),
});

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: Element) {
      if (this.hasAttribute('data-sliding-knob')) return rect(10, 110);
      const name = this.getAttribute('aria-label');
      if (name === 'On') return rect(10, 50);
      if (name === 'Off') return rect(70, 110);
      return rect(0, 0);
    }
  );
  const original = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    const style = original(el, pseudo);
    if (!el.hasAttribute('data-sliding-knob')) return style;
    return new Proxy(style, {
      get: (target, key) =>
        key === 'width'
          ? '100px'
          : ((v) => (typeof v === 'function' ? v.bind(target) : v))(
              Reflect.get(target, key)
            ),
    });
  });
});
afterEach(() => vi.restoreAllMocks());

const fill = () => document.querySelector<HTMLElement>('[data-sliding-fill]');

describe('the switch radii (KAN-908)', () => {
  test('the track is 10px and the knob 7px, parallel 3px inside it', () => {
    expect(RADIUS.SWITCH).toBe('10px');
    expect(RADIUS.SWITCH_KNOB).toBe('7px');
    expect('KNOB' in RADIUS).toBe(false);
  });
  test('Settings and the export toolbar both use them', () => {
    for (const m of [SETTINGS_PAIR_METRICS, EXPORT_PAIR_METRICS]) {
      expect(m.radius).toBe(RADIUS.SWITCH);
      expect(m.knobRadius).toBe(RADIUS.SWITCH_KNOB);
    }
  });
});

describe('the knob fill (KAN-908)', () => {
  test('sits under the pressed option, hidden from assistive tech', async () => {
    await renderWithProviders(<Pair start="on" />);
    const f = fill();
    expect(f).not.toBeNull();
    expect(f?.style.left).toBe('0px');
    expect(f?.style.right).toBe('60px');
    expect(f?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  test('moves to the other option when it is pressed', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<Pair start="on" />);
    await user.click(screen.getByRole('button', { name: 'Off' }));
    expect(fill()?.style.left).toBe('60px');
    expect(fill()?.style.right).toBe('0px');
  });

  test('the pressed words are still clipped to it, at the knob radius', async () => {
    await renderWithProviders(<Pair start="off" />);
    const layer = document.querySelector<HTMLElement>('[data-sliding-knob]');
    expect(layer?.style.clipPath).toBe('inset(0px 0px 0px 60px round 7px)');
  });

  test('nothing is drawn before the first measure', async () => {
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(() =>
      rect(0, 0)
    );
    await renderWithProviders(<Pair start="on" />);
    expect(fill()).toBeNull();
  });
});
