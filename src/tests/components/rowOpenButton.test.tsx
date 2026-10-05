import { describe, expect, test, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import RowOpenButton from '../../components/home/rightpane/RowOpenButton';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { renderWithProviders } from '../setup/renderWithProviders';
import { classRulesFor } from '../setup/hoverRules';

// KAN-394 D11. The text button that opens a window or group from its row.
// Emotion writes colours as rgb(); the tokens are hex.
const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

const NAME = 'Open window 2';
const TIP = 'Open this window';

const render = (onClick: () => void = () => undefined) =>
  renderWithProviders(
    <RowOpenButton ariaLabel={NAME} tooltipText={TIP} onClick={onClick} />
  );

describe('RowOpenButton', () => {
  test('is a button named by ariaLabel, showing the word "Open"', async () => {
    await render();
    const button = screen.getByRole('button', { name: NAME });
    expect(button).toHaveTextContent('Open');
  });

  test('carries the tooltip as its title', async () => {
    await render();
    expect(screen.getByRole('button', { name: NAME })).toHaveAttribute(
      'title',
      TIP
    );
  });

  test('shows the reopen_window icon beside the word', async () => {
    await render();
    const button = screen.getByRole('button', { name: NAME });
    expect(
      button.querySelector('.material-symbols-outlined')
    ).toHaveTextContent('reopen_window');
  });

  test('a click calls onClick once', async () => {
    const onClick = vi.fn();
    await render(onClick);
    fireEvent.click(screen.getByRole('button', { name: NAME }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('is transparent at rest, with a 1px divider border, 32px high', async () => {
    await render();
    const rules = classRulesFor(screen.getByRole('button', { name: NAME }));
    expect(rules).toMatch(/background-color:\s*transparent/);
    expect(rules).toContain(`1px solid ${rgb(LIGHT_THEME.DIVIDER_COLOR)}`);
    expect(rules).toMatch(/height:\s*32px/);
  });

  test('label is LABEL_L1 at rest and TEXT on hover and press', async () => {
    await render();
    const rules = classRulesFor(screen.getByRole('button', { name: NAME }));
    expect(rules).toContain(`color: ${rgb(LIGHT_THEME.LABEL_L1_COLOR)}; }`);
    // The button's own key-hint rules also name TEXT, so match the label's rule.
    expect(rules).toMatch(
      new RegExp(
        `:hover,\\S+:active \\{ color: ${rgb(LIGHT_THEME.TEXT_COLOR).replace(
          /[()]/g,
          '\\$&'
        )}; \\}`
      )
    );
  });
});

// KAN-413. Dimmed as Undo is, and a click does nothing.
test('disabled: announced, at 30% opacity, and a click calls nothing', async () => {
  const onClick = vi.fn();
  await renderWithProviders(
    <RowOpenButton
      ariaLabel={NAME}
      tooltipText={TIP}
      onClick={onClick}
      disable
    />
  );
  const button = screen.getByRole('button', { name: NAME });
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(classRulesFor(button)).toMatch(/opacity:\s*0\.3/);
  fireEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
});
