import { describe, expect, test, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import Tickbox from '../../components/common/Tickbox';
import type { TickState } from '../../components/common/Tickbox';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-862. One box per folder row in the import dialog.
const box = () => screen.getByRole('checkbox', { name: 'Work' });

const show = async (state: TickState, extra: { disabled?: boolean } = {}) => {
  const onToggle = vi.fn();
  await renderWithProviders(
    <Tickbox state={state} label="Work" onToggle={onToggle} {...extra} />
  );
  return onToggle;
};

// Emotion writes its rules into document.head; jsdom has no :focus-visible.
const emittedCss = () =>
  [...document.querySelectorAll('style')]
    .map((s) => s.textContent ?? '')
    .join('\n');

describe('Tickbox', () => {
  test.each([
    ['off', 'false'],
    ['on', 'true'],
  ] as const)('%s is aria-checked=%s', async (state, checked) => {
    await show(state);
    expect(box()).toHaveAttribute('aria-checked', checked);
  });

  test('off and on are not aria-disabled', async () => {
    await show('on');
    expect(box()).not.toHaveAttribute('aria-disabled');
  });

  test('clicking an off box toggles once', async () => {
    const onToggle = await show('off');
    fireEvent.click(box());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  test('Space on an on box toggles once', async () => {
    const onToggle = await show('on');
    fireEvent.keyDown(box(), { key: ' ' });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  test('Enter does not toggle (the checkbox pattern is Space)', async () => {
    const onToggle = await show('off');
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onToggle).not.toHaveBeenCalled();
  });

  test.each([
    ['off', { disabled: true }],
    ['on', { disabled: true }],
  ] as const)('%s %j is aria-disabled and inert', async (state, extra) => {
    const onToggle = await show(state, extra);
    expect(box()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(box());
    fireEvent.keyDown(box(), { key: ' ' });
    expect(onToggle).not.toHaveBeenCalled();
  });

  // An empty folder adds nothing, even ticked: it draws an empty box, so it says unchecked too.
  test('on and disabled reads and draws unchecked', async () => {
    await show('on', { disabled: true });
    expect(box()).toHaveAttribute('aria-checked', 'false');
    expect(box()).not.toHaveTextContent('check');
  });

  test('stays in the tab order when inert', async () => {
    await show('off', { disabled: true });
    expect(box()).toHaveAttribute('tabindex', '0');
  });

  test('on draws the check glyph; off does not', async () => {
    const { unmount } = await (async () => {
      await show('on');
      return { unmount: () => document.body.replaceChildren() };
    })();
    expect(box()).toHaveTextContent('check');
    unmount();
    await show('off');
    expect(box()).not.toHaveTextContent('check');
  });

  test('has a keyboard focus ring', async () => {
    await show('off');
    expect(emittedCss()).toMatch(
      /html\[[^\]]+\] [^{]*:focus-visible\s*\{[^}]*outline:\s*2px solid/
    );
  });
});
