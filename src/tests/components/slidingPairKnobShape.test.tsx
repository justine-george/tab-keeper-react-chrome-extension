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
import { squircleRect } from '../../styles/squirclePath';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-908. The knob is clipped by a traced squircle at the measured edges:
// inset(… round) can only cut an arc inside the track's squircle.

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
          : key === 'height'
            ? '28px'
            : ((v) => (typeof v === 'function' ? v.bind(target) : v))(
                Reflect.get(target, key)
              ),
    });
  });
});
afterEach(() => vi.restoreAllMocks());

const clip = () =>
  document.querySelector<HTMLElement>('[data-sliding-knob]')?.style.clipPath ??
  '';

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

describe('the knob clip (KAN-908)', () => {
  test('is the pressed option traced with 7px squircle corners', async () => {
    await renderWithProviders(<Pair start="on" />);
    expect(clip()).toBe(
      `path("${squircleRect({ left: 0, top: 0, right: 40, bottom: 28 }, 7)}")`
    );
  });

  test('moves to the other option when it is pressed', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<Pair start="on" />);
    await user.click(screen.getByRole('button', { name: 'Off' }));
    expect(clip()).toBe(
      `path("${squircleRect({ left: 60, top: 0, right: 100, bottom: 28 }, 7)}")`
    );
  });

  test('cuts no arc', async () => {
    await renderWithProviders(<Pair start="off" />);
    expect(clip()).toMatch(/^path\(/);
    expect(clip()).not.toMatch(/round|[Aa] /);
  });
});
