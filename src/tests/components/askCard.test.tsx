import { describe, expect, test, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import AskCard from '../../components/common/AskCard';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-880. The KAN-578 card, with any two answers.

const TEXT = 'Going back loses your edits. Save as PDF first to keep them.';

const renderCard = async () => {
  const quiet = vi.fn();
  const filled = vi.fn();
  const onCancel = vi.fn();
  await renderWithProviders(
    <AskCard
      text={TEXT}
      quiet={{ label: 'Go back', onPress: quiet }}
      filled={{ label: 'Stay', onPress: filled }}
      align="left"
      notchInset="12px"
      onCancel={onCancel}
    />
  );
  return { quiet, filled, onCancel };
};

describe('AskCard', () => {
  test('is a dialog labelled by its text', async () => {
    await renderCard();
    expect(screen.getByRole('dialog', { name: TEXT })).toBeTruthy();
  });

  test('focuses the filled button on mount', async () => {
    await renderCard();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Stay' })
    );
  });

  test('the quiet button calls only its own answer', async () => {
    const { quiet, filled, onCancel } = await renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(quiet).toHaveBeenCalledTimes(1);
    expect(filled).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  test('the filled button calls only its own answer', async () => {
    const { quiet, filled, onCancel } = await renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(filled).toHaveBeenCalledTimes(1);
    expect(quiet).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  test('Esc cancels and is consumed', async () => {
    const { quiet, filled, onCancel } = await renderCard();
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(quiet).not.toHaveBeenCalled();
    expect(filled).not.toHaveBeenCalled();
  });

  test('the close mark cancels', async () => {
    const { quiet, filled, onCancel } = await renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(quiet).not.toHaveBeenCalled();
    expect(filled).not.toHaveBeenCalled();
  });
});
