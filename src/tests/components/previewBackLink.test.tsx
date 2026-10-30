import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

const request = vi.hoisted(() => ({
  calls: [] as string[],
  isSent: true,
}));
vi.mock('../../utils/functions/backFromPreview', () => ({
  requestReturnFromPreview: async (from: string) => {
    request.calls.push(`request:${from}`);
    return request.isSent;
  },
}));

import PreviewBackLink, {
  PREVIEW_BACK_HANG_MIN_PX,
  RETRY_AFTER_MS,
} from '../../components/export/PreviewBackLink';
import { renderWithProviders } from '../setup/renderWithProviders';
import { classRulesFor } from '../setup/hoverRules';
import type { PreviewFrom } from '../../utils/functions/previewFrom';

// KAN-880. The preview's "Back to Tab Keeper": one press when nothing is lost, a card first when edits are pending.

const CARD_TEXT =
  'Going back loses your edits. Save as PDF first to keep them.';

const renderLink = (from: PreviewFrom, pending: boolean) =>
  renderWithProviders(
    <PreviewBackLink
      from={from}
      pending={pending}
      onLeave={() => request.calls.push('leave')}
      onLeaveFailed={() => request.calls.push('failed')}
    />
  );
const link = () => screen.getByRole('button', { name: 'Back to Tab Keeper' });

beforeEach(() => {
  request.calls = [];
  request.isSent = true;
});
afterEach(() => vi.useRealTimers());

describe('the link', () => {
  test('is named Back to Tab Keeper and shows Tab Keeper', async () => {
    await renderLink('full', false);

    expect(link()).toHaveTextContent('Tab Keeper');
    expect(link()).not.toHaveTextContent('Back to');
    expect(link()).toHaveAttribute('data-tooltip', 'Back to Tab Keeper');
  });

  test('draws no fill or border at any state', async () => {
    await renderLink('full', false);

    const rules = classRulesFor(link());
    const fills = [...rules.matchAll(/background(?:-color)?:\s*([^;}]+)/g)];
    expect(fills.map((m) => m[1])).toEqual(['none']);
    const borders = [...rules.matchAll(/border(?:-\w+)?:\s*([^;}]+)/g)];
    expect(borders.map((m) => m[1])).toEqual(['medium']);
  });

  test('hangs the arrow only from 880px, derived from the sheet', async () => {
    expect(PREVIEW_BACK_HANG_MIN_PX).toBe(816 + 2 * (18 + 6 + 8));
    await renderLink('full', false);

    const media = `@media (min-width: ${PREVIEW_BACK_HANG_MIN_PX}px)`;
    const wrapper = link().parentElement;
    const arrow = link().querySelector('[data-icon="arrow_back"]');
    if (!wrapper || !arrow) throw new Error('link not drawn');
    expect(classRulesFor(wrapper)).toContain(media);
    expect(classRulesFor(wrapper)).toContain('margin-left: -24px');
    expect(classRulesFor(arrow)).toContain(media);
    expect(classRulesFor(arrow)).toContain('margin-left: -3px');
  });

  test('slides the arrow alone, and only for a hovering pointer with motion allowed', async () => {
    await renderLink('full', false);

    const rules = classRulesFor(link());
    expect(rules).toContain('prefers-reduced-motion: no-preference');
    expect(rules).toContain('translate: -5px');
  });
});

describe('with nothing to lose', () => {
  test.each<PreviewFrom>(['full', 'popup'])(
    'a press leaves, then asks to go back (%s)',
    async (from) => {
      await renderLink(from, false);

      await userEvent.click(link());

      expect(request.calls).toEqual(['leave', `request:${from}`]);
      expect(screen.queryByText(CARD_TEXT)).toBeNull();
    }
  );

  test('two presses send one request', async () => {
    await renderLink('full', false);

    await userEvent.click(link());
    await userEvent.click(link());

    expect(request.calls).toEqual(['leave', 'request:full']);
  });
});

describe('with edits pending', () => {
  test('a press shows the card, focuses Stay and does nothing else', async () => {
    await renderLink('full', true);

    await userEvent.click(link());

    expect(screen.getByText(CARD_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stay' })).toHaveFocus();
    expect(request.calls).toEqual([]);
  });

  test('Stay closes the card and sends nothing', async () => {
    await renderLink('full', true);
    await userEvent.click(link());

    await userEvent.click(screen.getByRole('button', { name: 'Stay' }));

    expect(screen.queryByText(CARD_TEXT)).toBeNull();
    expect(request.calls).toEqual([]);
    expect(link()).toHaveFocus();
  });

  test('Esc closes the card and sends nothing', async () => {
    await renderLink('full', true);
    await userEvent.click(link());

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByText(CARD_TEXT)).toBeNull();
    expect(request.calls).toEqual([]);
  });

  test('the ✕ closes the card and sends nothing', async () => {
    await renderLink('full', true);
    await userEvent.click(link());

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByText(CARD_TEXT)).toBeNull();
    expect(request.calls).toEqual([]);
  });

  test('a press outside closes the card and sends nothing', async () => {
    await renderLink('full', true);
    await userEvent.click(link());

    fireEvent.pointerDown(document.body);

    expect(screen.queryByText(CARD_TEXT)).toBeNull();
    expect(request.calls).toEqual([]);
  });

  test('a press on the link while the card is open keeps it open', async () => {
    await renderLink('full', true);
    await userEvent.click(link());

    fireEvent.pointerDown(link());

    expect(screen.getByText(CARD_TEXT)).toBeInTheDocument();
    expect(request.calls).toEqual([]);
  });

  test.each<PreviewFrom>(['full', 'popup'])(
    'Go back leaves, then asks to go back (%s)',
    async (from) => {
      await renderLink(from, true);
      await userEvent.click(link());

      await userEvent.click(screen.getByRole('button', { name: 'Go back' }));

      expect(request.calls).toEqual(['leave', `request:${from}`]);
    }
  );

  test('Go back pressed twice sends one request', async () => {
    await renderLink('full', true);
    await userEvent.click(link());
    const goBack = screen.getByRole('button', { name: 'Go back' });

    // One batch, so the card has not yet re-rendered away between the two clicks.
    act(() => {
      fireEvent.click(goBack);
      fireEvent.click(goBack);
    });

    expect(request.calls).toEqual(['leave', 'request:full']);
  });

  test('the card closes when the edits are reset', async () => {
    function Harness() {
      const [pending, setPending] = useState(true);
      return (
        <>
          <button onClick={() => setPending(false)}>reset</button>
          <PreviewBackLink
            from="full"
            pending={pending}
            onLeave={() => {}}
            onLeaveFailed={() => {}}
          />
        </>
      );
    }
    await renderWithProviders(<Harness />);
    await userEvent.click(link());
    expect(screen.getByText(CARD_TEXT)).toBeInTheDocument();

    await act(async () => {
      screen.getByText('reset').click();
    });

    expect(screen.queryByText(CARD_TEXT)).toBeNull();
    expect(request.calls).toEqual([]);
  });
});

describe('when going back does not happen', () => {
  const settle = () => act(async () => {});

  test('a failed send tells the page, and a later press sends again', async () => {
    request.isSent = false;
    await renderLink('full', false);

    fireEvent.click(link());
    await settle();
    expect(request.calls).toEqual(['leave', 'request:full', 'failed']);

    fireEvent.click(link());
    await settle();
    expect(request.calls).toEqual([
      'leave',
      'request:full',
      'failed',
      'leave',
      'request:full',
      'failed',
    ]);
  });

  test('a send that worked blocks a second press inside the window', async () => {
    vi.useFakeTimers();
    await renderLink('full', false);

    fireEvent.click(link());
    await settle();
    vi.advanceTimersByTime(RETRY_AFTER_MS - 1);
    fireEvent.click(link());
    await settle();

    expect(request.calls).toEqual(['leave', 'request:full']);
  });

  test('a tab still open after the window tells the page, and a press sends again', async () => {
    vi.useFakeTimers();
    await renderLink('popup', false);

    fireEvent.click(link());
    await settle();
    act(() => {
      vi.advanceTimersByTime(RETRY_AFTER_MS);
    });
    expect(request.calls).toEqual(['leave', 'request:popup', 'failed']);

    fireEvent.click(link());
    await settle();
    expect(request.calls.slice(3)).toEqual(['leave', 'request:popup']);
  });

  test('unmounting stops the timer', async () => {
    vi.useFakeTimers();
    const view = await renderLink('full', false);

    fireEvent.click(link());
    await settle();
    view.unmount();
    vi.advanceTimersByTime(RETRY_AFTER_MS * 2);

    expect(request.calls).toEqual(['leave', 'request:full']);
  });
});
