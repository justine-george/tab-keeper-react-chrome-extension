import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import en from '../../../public/locales/en/translation.json';
import ru from '../../../public/locales/ru/translation.json';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  selectCategory,
  SettingsCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import { APP_VERSION, PRIVACY_POLICY_LINK } from '../../utils/constants/common';
import { ICON, TYPE } from '../../styles/scale';
import { testI18n } from '../setup/i18nForTests';

// KAN-241. Settings -> About is a nameplate over the same section anatomy the
// other four panes use.
//
// It was the one pane laid out differently: centred, a SECTION heading that
// thanked the user, and the version at the floor in LABEL_L3 -- the marker
// token, 2.56:1 on Paper -- so the one line a bug report needs was the hardest
// on the page to read.
//
// jsdom lays out nothing, so the inset and the stack are measured by the e2e
// spec (about-nameplate.spec.ts). What is pinned here is the contract: which
// glyph, which tokens, which strings.

/** A colour as emotion wrote it, or as jsdom normalises it. */
const asWritten = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return new RegExp(`(${hex}|rgb\\(${r}, ?${g}, ?${b}\\))`, 'i');
};

/** A TYPE step as jsdom reports it: rem resolved against the 16px root. */
const px = (rem: string) => `${parseFloat(rem) * 16}px`;

// The Privacy policy link's chrome.tabs.create() rejects a windowId no
// window carries, as Chrome does.
const renderAbout = () =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seed: { windows: [{ id: 1 }] },
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.ABOUT));
    },
  });

afterEach(async () => {
  Reflect.deleteProperty(Element.prototype, 'animate');
  vi.restoreAllMocks();
  // The instance is shared, so a leaked locale would run later tests in Russian.
  await testI18n.changeLanguage('en');
});

const collapse = (text: string | null | undefined) =>
  (text ?? '').replace(/\s+/g, ' ').trim();

describe('the About nameplate', () => {
  // KAN-521. The header's mark, not the old one-colour floppy glyph.
  test('draws the header’s mark, shutter and all, at NAMEPLATE size, hidden from AT', async () => {
    const { container } = await renderAbout();

    const marks = container.querySelectorAll(
      'svg:has([data-mark-part="shutter"])'
    );
    expect(marks).toHaveLength(1);
    const mark = marks[0];
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(getComputedStyle(mark).width).toBe(px(ICON.NAMEPLATE));
    // KAN-728. Outside the buttons, the mark is the only svg left: no heart.
    const others = Array.from(container.querySelectorAll('svg')).filter(
      (s) => s !== mark && s.closest('button') === null
    );
    expect(others).toEqual([]);
  });

  test('a click on the mark presses it and slides its shutter, as in the header', async () => {
    const targets: Element[] = [];
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value(this: Element) {
        targets.push(this);
        return {
          finished: new Promise(() => undefined),
          cancel: () => undefined,
        };
      },
    });
    const { container } = await renderAbout();
    const mark = container.querySelector(
      'svg:has([data-mark-part="shutter"])'
    )!;
    fireEvent.click(mark);
    expect(targets).toEqual([
      mark,
      mark.querySelector('[data-mark-part="shutter"]'),
    ]);
  });

  test('names the product at SECTION size in the text colour', async () => {
    await renderAbout();

    const name = screen.getByText('Tab Keeper');
    expect(getComputedStyle(name).fontSize).toBe(px(TYPE.SECTION));
    expect(getComputedStyle(name).color).toMatch(
      asWritten(LIGHT_THEME.TEXT_COLOR)
    );
  });

  // The whole point. LABEL_L3 is the marker token, and the version is the one
  // line a bug report has to be able to read.
  test('sets the version in LABEL_L1, not the L3 marker token', async () => {
    await renderAbout();

    const version = screen.getByText(`Version ${APP_VERSION}`);
    expect(getComputedStyle(version).color).toMatch(
      asWritten(LIGHT_THEME.LABEL_L1_COLOR)
    );
    expect(getComputedStyle(version).fontSize).toBe(px(TYPE.SECONDARY));
  });

  // KAN-728. A short signed note replaced the credit and the Feedback heading.
  describe('the note', () => {
    const NOTE_LINES = [
      en.AboutStory,
      en.AboutPromise,
      'Justine George',
      en['Tab Keeper Creator'],
    ];

    test('reads the story, the promise, then the signature', async () => {
      const { container } = await renderAbout();

      const text = collapse(container.textContent);
      const at = NOTE_LINES.map((line) => text.indexOf(line));
      expect(
        at.every((i) => i >= 0),
        `${at}`
      ).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
    });

    test('every line is TEXT_COLOR at SECONDARY size, weight 400', async () => {
      await renderAbout();

      for (const line of NOTE_LINES) {
        const el = screen.getByText(line);
        const style = getComputedStyle(el);
        expect(style.fontSize, line).toBe(px(TYPE.SECONDARY));
        expect(['400', 'normal', ''], line).toContain(style.fontWeight);
        expect(style.color, line).toMatch(asWritten(LIGHT_THEME.TEXT_COLOR));
      }
    });

    test('has no image or heart left in it', async () => {
      const { container } = await renderAbout();

      expect(screen.queryByRole('img', { name: 'love' })).toBeNull();
      expect(container.textContent).not.toMatch(/Made with|©|❤/);
      expect(screen.queryByText('Feedback', { exact: true })).toBeNull();
    });

    test('the name stays Justine George in another language', async () => {
      await renderAbout();
      testI18n.addResourceBundle('ru', 'translation', ru, true, true);
      await act(async () => {
        await testI18n.changeLanguage('ru');
      });
      // CONTROL: the note itself did switch, so the name is not passing in English.
      expect(screen.getByText(ru.AboutStory)).toBeTruthy();
      expect(screen.getByText(ru['Tab Keeper Creator'])).toBeTruthy();
      expect(screen.getByText('Justine George')).toBeTruthy();
    });
  });

  test('Rate Tab Keeper carries the star and is the filled button; Share feedback stays quiet', async () => {
    await renderAbout();

    const rate = screen.getByRole('button', { name: 'Rate Tab Keeper' });
    const mail = screen.getByRole('button', { name: 'Share feedback' });
    expect(rate.querySelector('.material-symbols-outlined')?.textContent).toBe(
      'star'
    );
    expect(getComputedStyle(rate).backgroundColor).not.toBe(
      getComputedStyle(mail).backgroundColor
    );
    expect(getComputedStyle(rate).color).toBe(
      getComputedStyle(mail).backgroundColor
    );
  });

  test('the two buttons follow the signature, and the policy follows them', async () => {
    await renderAbout();

    const order = [
      screen.getByText(en['Tab Keeper Creator']),
      screen.getByRole('button', { name: 'Rate Tab Keeper' }),
      screen.getByRole('button', { name: 'Share feedback' }),
      screen.getByRole('link', { name: 'Privacy policy' }),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
  });

  // KAN-260. The policy is a file in the repository; the consent dialog links
  // to it, and so does the one place a user goes looking: About. A link, not a
  // button -- it leaves the extension, and the dialog already set the pattern.
  describe('the privacy policy link', () => {
    // KAN-728. A quiet line under the buttons, as the r4 mock drew it.
    test('is a link to the policy, set in LABEL_L2 at SECONDARY size', async () => {
      await renderAbout();

      const link = screen.getByRole('link', { name: 'Privacy policy' });
      expect(link.getAttribute('href')).toBe(PRIVACY_POLICY_LINK);
      expect(getComputedStyle(link).color).toMatch(
        asWritten(LIGHT_THEME.LABEL_L2_COLOR)
      );
      expect(getComputedStyle(link).fontSize).toBe(px(TYPE.SECONDARY));
    });

    // A popup that follows a link navigates itself away; chrome.tabs.create
    // opens the policy in a real tab instead, and the default is stopped so
    // the popup does not also navigate.
    test('a click opens the policy in a new tab and does not navigate the popup', async () => {
      const { chrome } = await renderAbout();
      const link = screen.getByRole('link', { name: 'Privacy policy' });

      const click = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });
      const proceeded = link.dispatchEvent(click);

      expect(chrome.createdTabs.map((t) => t.url)).toEqual([
        PRIVACY_POLICY_LINK,
      ]);
      expect(proceeded).toBe(false);
    });
  });
});
