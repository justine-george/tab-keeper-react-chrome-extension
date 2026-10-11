import { afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  selectCategory,
  SettingsCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import { APP_VERSION, PRIVACY_POLICY_LINK } from '../../utils/constants/common';
import { ICON, TYPE } from '../../styles/scale';

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

afterEach(() => {
  Reflect.deleteProperty(Element.prototype, 'animate');
  vi.restoreAllMocks();
});

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
    // The one-colour glyph is gone: outside the buttons, the only other svg is the credit's heart.
    const others = Array.from(container.querySelectorAll('svg')).filter(
      (s) => s !== mark && s.closest('button') === null
    );
    expect(others.map((s) => s.getAttribute('role'))).toEqual(['img']);
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

  // KAN-521. A drawn heart in the credit's own grey, named for AT; the red emoji is gone.
  test('sets the credit, "Made with ♥ by Justine George", in LABEL_L2 at SECONDARY size', async () => {
    const { container } = await renderAbout();

    const heart = screen.getByRole('img', { name: 'love' });
    const credit = heart.parentElement!;
    expect(credit.textContent?.replace(/\s+/g, ' ')).toBe(
      'Made with by Justine George'
    );
    expect(getComputedStyle(credit).color).toMatch(
      asWritten(LIGHT_THEME.LABEL_L2_COLOR)
    );
    expect(getComputedStyle(credit).fontSize).toBe(px(TYPE.SECONDARY));
    expect(heart.getAttribute('fill')).toBe('currentColor');
    expect(container.textContent).not.toMatch(/❤|Crafted/);
  });

  test('drops the thank-you heading', async () => {
    await renderAbout();

    expect(screen.queryByText(/Thank you for using/)).toBeNull();
  });

  // KAN-511. Share on X is gone; the section is named for what is left.
  test('keeps two actions under "Feedback": Rate first, then Share your feedback, and no Share on X', async () => {
    await renderAbout();

    expect(screen.getByText('Feedback', { exact: true })).toBeTruthy();
    expect(screen.queryByText('Feedback & Share')).toBeNull();
    const rate = screen.getByRole('button', { name: 'Rate this extension' });
    const mail = screen.getByRole('button', { name: 'Share your feedback' });
    expect(
      rate.compareDocumentPosition(mail) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Share on X' })).toBeNull();
  });

  test('Rate carries the star and is the filled button; Share your feedback stays quiet', async () => {
    await renderAbout();

    const rate = screen.getByRole('button', { name: 'Rate this extension' });
    const mail = screen.getByRole('button', { name: 'Share your feedback' });
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

  // KAN-260. The policy is a file in the repository; the consent dialog links
  // to it, and so does the one place a user goes looking: About. A link, not a
  // button -- it leaves the extension, and the dialog already set the pattern.
  describe('the privacy policy link', () => {
    test('is a link to the policy, under the version line', async () => {
      await renderAbout();

      const link = screen.getByRole('link', { name: 'Privacy policy' });
      expect(link.getAttribute('href')).toBe(PRIVACY_POLICY_LINK);
      // In the nameplate section, not among the Feedback & Share actions.
      expect(link.closest('[data-settings-section]')).toBe(
        screen
          .getByText(`Version ${APP_VERSION}`)
          .closest('[data-settings-section]')
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
