import { describe, expect, test } from 'vitest';

import { CloudConsentModal } from '../../components/modals/CloudConsentModal';
import { DeleteCloudDataModal } from '../../components/modals/DeleteCloudDataModal';
import { FocusConfirmModal } from '../../components/modals/FocusConfirmModal';
import { renderWithProviders } from '../setup/renderWithProviders';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import {
  openCloudConsentModal,
  openDeleteCloudDataModal,
  openFocusModal,
} from '../../redux/slices/globalStateSlice';
import { saveToTabContainerInternal } from '../../redux/slices/tabContainerDataStateSlice';
import { buildSession } from '../fixtures/sessionFixture';
import {
  activeRulesFor,
  classRulesFor,
  hoverRulesFor,
} from '../setup/hoverRules';
import { dialogButtonStyles } from '../../components/modals/dialogButtons';
import { mixHex } from '../../styles/mixHex';

// KAN-259. The three bordered-button dialogs each carried a copy of one style
// with a hover rung and no press rung, so pressing looked like hovering --
// the defect KAN-236 fixed on the settings rows. They share dialogButtons now,
// on Button's rungs. jsdom paints nothing, so this pins that the :active rule
// is EMITTED, one rung past :hover; cloud-consent.spec.ts pins that Chrome
// paints it under a held pointer.

const DIALOGS = [
  {
    name: 'CloudConsentModal',
    render: () =>
      renderWithProviders(<CloudConsentModal />, {
        seedStore: (s) =>
          // The welcome has one button (KAN-410); the question has both kinds.
          s.dispatch(openCloudConsentModal({ variant: 'enable' })),
      }),
  },
  {
    name: 'DeleteCloudDataModal',
    render: () =>
      renderWithProviders(<DeleteCloudDataModal />, {
        seedStore: (s) => s.dispatch(openDeleteCloudDataModal()),
      }),
  },
  {
    name: 'FocusConfirmModal',
    render: () =>
      renderWithProviders(<FocusConfirmModal />, {
        seedStore: (s) => {
          s.dispatch(saveToTabContainerInternal(buildSession()));
          s.dispatch(
            openFocusModal({
              tabGroupId: buildSession().tabGroupId,
              windowCount: 1,
              willSave: true,
            })
          );
        },
      }),
  },
] as const;

describe.each(DIALOGS)('$name buttons answer a press (KAN-259)', (dialog) => {
  test('every button has an :active rung, one past :hover', async () => {
    const { container } = await dialog.render();
    const buttons = [...container.querySelectorAll('dialog button')];
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    const bg = (rules: string) =>
      /background-color:\s*([^;}]+)/.exec(rules)?.[1].trim();
    for (const button of buttons) {
      const hover = hoverRulesFor(button);
      const active = activeRulesFor(button);
      expect(bg(hover), 'no :hover background').toBeTruthy();
      expect(bg(active), 'no :active background').toBeTruthy();
      // The rung is a background colour, and the two differ -- except on the
      // danger button, which holds its red on both by design (KAN-204).
      const isDanger = button.textContent?.trim() === 'Delete';
      if (!isDanger) expect(bg(active)).not.toBe(bg(hover));
    }
  });
});

test('CONTROL: the rungs are Button own tokens on Paper', () => {
  expect(LIGHT_THEME.ICON_ACTIVE_COLOR).not.toBe(LIGHT_THEME.ICON_HOVER_COLOR);
});

// KAN-7. The run's way forward: rungs mix TEXT_COLOR over PRIMARY_COLOR, never opacity.
describe('the filled button', () => {
  const COLORS = LIGHT_THEME;
  const renderFilled = async () => {
    const { container } = await renderWithProviders(
      <button css={dialogButtonStyles(COLORS).filled}>Next</button>
    );
    const button = container.querySelector('button');
    if (button === null) throw new Error('no button');
    return button;
  };
  // jsdom may hand a colour back as rgb(); compare in one spelling.
  const rgb = (hex: string) =>
    `rgb(${[1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16))
      .join(', ')})`;
  const fills = (rules: string) =>
    [...rules.matchAll(/(border-color|background-color):\s*([^;}]+)/g)].map(
      (m) => [m[1], m[2].trim().toLowerCase()]
    );
  const asHex = (value: string) =>
    value.startsWith('#') ? rgb(value.toUpperCase()) : value;

  test('at rest: TEXT_COLOR border and ground, PRIMARY_COLOR letters', async () => {
    const style = getComputedStyle(await renderFilled());
    expect(style.borderTopColor).toBe(rgb(COLORS.TEXT_COLOR));
    expect(style.backgroundColor).toBe(rgb(COLORS.TEXT_COLOR));
    expect(style.color).toBe(rgb(COLORS.PRIMARY_COLOR));
  });

  test('hover mixes 88% of TEXT_COLOR over PRIMARY_COLOR, press 76%, both on border and ground', async () => {
    const button = await renderFilled();
    const hover = mixHex(COLORS.TEXT_COLOR, COLORS.PRIMARY_COLOR, 0.88);
    const press = mixHex(COLORS.TEXT_COLOR, COLORS.PRIMARY_COLOR, 0.76);
    expect(hover).not.toBe(press);
    const seen = (rules: string) =>
      fills(rules).map(([prop, value]) => [prop, asHex(value)]);
    expect(seen(hoverRulesFor(button))).toEqual([
      ['border-color', rgb(hover)],
      ['background-color', rgb(hover)],
    ]);
    expect(seen(activeRulesFor(button))).toEqual([
      ['border-color', rgb(press)],
      ['background-color', rgb(press)],
    ]);
  });

  test('border and ground ease together, so no ring of another colour shows', async () => {
    const rules = classRulesFor(await renderFilled());
    const transition = /transition:\s*([^;}]+)/.exec(rules)?.[1] ?? '';
    expect(transition).toMatch(/background-color/);
    expect(transition).toMatch(/border-color/);
  });

  test('hover and press never fade the element or recolour the letters', async () => {
    const button = await renderFilled();
    const rules = `${hoverRulesFor(button)}\n${activeRulesFor(button)}`;
    expect(rules).not.toMatch(/opacity|color-mix|[^-]color:/);
  });

  test('the focus ring is 2px TEXT_COLOR, outside by 2px', async () => {
    const button = await renderFilled();
    // The last such rule wins the cascade.
    const ring = classRulesFor(button)
      .split('\n')
      .filter((rule) => rule.includes(':focus-visible'))
      .pop();
    expect(ring).toMatch(/outline:\s*2px solid/);
    expect(ring).toMatch(/outline-offset:\s*2px/);
    expect(ring).not.toMatch(/outline-offset:\s*-/);
  });

  test('CONTROL: the other styles keep the inside ring', async () => {
    const { container } = await renderWithProviders(
      <button css={dialogButtonStyles(COLORS).primary}>Next</button>
    );
    const button = container.querySelector('button');
    if (button === null) throw new Error('no button');
    expect(classRulesFor(button)).toMatch(/outline-offset:\s*-4px/);
  });
});
