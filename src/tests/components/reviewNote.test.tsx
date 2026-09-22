import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import { RateAndReviewModal } from '../../components/modals/RateAndReviewModal';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { renderWithProviders } from '../setup/renderWithProviders';
import { openRateAndReviewModal } from '../../redux/slices/globalStateSlice';

// KAN-242. The rate-and-review prompt is a signed note, not a prompt for a
// "good review".
//
// The copy spoke in the first person ("helping ME out") without saying who
// "me" was, and asked for a GOOD review, which reads as steering -- and seven
// of the ten locales had translated that steer faithfully ("positive
// Bewertung", "buena reseña", "好评"). Now the ask is for A review, one
// sentence, and it is signed with a first name: this is a note from the
// developer, where a first name is the right register. (The About page
// carries the full name, because that line is attribution -- KAN-241.)

const localeFiles = import.meta.glob('/public/locales/*/translation.json', {
  import: 'default',
  eager: true,
}) as Record<string, Record<string, string>>;

const locales = Object.entries(localeFiles).map(
  ([path, dict]) => [path.split('/')[3], dict] as const
);

/** A colour as emotion wrote it, or as jsdom normalises it. */
const asWritten = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return new RegExp(`(${hex}|rgb\\(${r}, ?${g}, ?${b}\\))`, 'i');
};

const renderOpen = () =>
  renderWithProviders(<RateAndReviewModal />, {
    seedStore: (store) => {
      store.dispatch(openRateAndReviewModal());
    },
  });

describe('the review note', () => {
  test('asks for a review in one sentence, and keeps the header', async () => {
    await renderOpen();

    expect(screen.getByText('Enjoying Tab Keeper?')).toBeTruthy();
    expect(
      screen.getByText("If it's been useful, a review would mean a lot.")
    ).toBeTruthy();
    expect(screen.queryByText(/good review/)).toBeNull();
  });

  test('is signed with a first name, on its own line, in LABEL_L2', async () => {
    await renderOpen();

    const sig = screen.getByText('— Justine');
    expect(getComputedStyle(sig).display).toBe('block');
    expect(getComputedStyle(sig).color).toMatch(
      asWritten(LIGHT_THEME.LABEL_L2_COLOR)
    );
  });

  // The signature is part of what the dialog says, so a screen reader hears
  // who is asking too: it lives inside the element aria-describedby points at.
  test('the signature is inside the dialog description', async () => {
    await renderOpen();

    const dialog = screen.getByRole('dialog');
    const bodyId = dialog.getAttribute('aria-describedby')!;
    const body = document.getElementById(bodyId)!;
    expect(body.textContent).toContain("If it's been useful");
    expect(body.textContent).toContain('— Justine');
  });
});

// The words each locale used to steer with. Listed, as productName.test lists
// the transliterations: a scan can only find what it already knows to look for.
const STEERING = [
  'good review',
  'positive Bewertung',
  'buena reseña',
  'bon avis',
  'recensione positiva',
  'avaliação positiva',
  'положительный отзыв',
  'सकारात्मक समीक्षा',
  'ポジティブなレビュー',
  '好评',
  '좋은 리뷰', // ko, and the star-count ask a translator reaches for next
  '별 5개',
  'positivt omdöme', // sv
  'bra recension',
  '好評', // zh-TW
  '五星',
];

describe('no locale asks for a good review', () => {
  test('CONTROL: all thirteen locales were loaded', () => {
    expect(locales).toHaveLength(13);
  });

  for (const [name, dict] of locales) {
    test(`${name}: RequestUserReviewText asks for a review, not a good one`, () => {
      const text = dict['RequestUserReviewText'];
      expect(text).toBeTruthy();
      for (const steer of STEERING) {
        expect(text).not.toContain(steer);
      }
    });

    test(`${name}: carries the sign-off`, () => {
      expect(dict['RequestUserReviewSignOff']).toContain('Justine');
    });
  }
});

// KAN-243. Initial focus is the dialog itself, not the CTA: showModal() lands
// on the first control, and on a page with no pointer interaction yet Chrome
// paints its focus ring on it -- so the note opened lit, and Enter fired the
// CTA unread. jsdom runs no focusing steps of its own, so this pins only the
// explicit focus() and the attributes it depends on; offer-modal-focus.spec.ts
// measures the ring and the Tab in a real browser.
describe('the review note opens with focus on the dialog', () => {
  test('the dialog is the active element, and is focusable only by script', async () => {
    await renderOpen();

    const dialog = screen.getByRole('dialog');
    expect(document.activeElement).toBe(dialog);
    expect(dialog.getAttribute('tabindex')).toBe('-1');
    expect(getComputedStyle(dialog).outlineStyle).toBe('none');
  });
});
