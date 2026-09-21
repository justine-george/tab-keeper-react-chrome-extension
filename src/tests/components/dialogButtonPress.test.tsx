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
import { activeRulesFor, hoverRulesFor } from '../setup/hoverRules';

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
        seedStore: (s) => s.dispatch(openCloudConsentModal('welcome')),
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
