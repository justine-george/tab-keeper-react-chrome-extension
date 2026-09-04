import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act } from '@testing-library/react';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import TabGroupEntry from '../../components/home/leftpane/TabGroupEntry';
import { renderWithProviders } from '../setup/renderWithProviders';
import { initTestI18n, testI18n } from '../setup/i18nForTests';
import {
  saveToTabContainerInternal,
  selectTabContainer,
  tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-65. Every ariaLabel used to be a hardcoded English string sitting beside
// a translated tooltipText, so nine of the ten locales heard English.
//
// Reads the source tree and the locale files through import.meta.glob rather
// than node:fs, for the reason keyCoverage.test.ts documents at length:
// tsconfig's `types` array is deliberately without "node".
const allSources = import.meta.glob('/src/components/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// This scan excluded SignIn, CreateAccount and ForgotPassword, whose hardcoded
// English strings were unreachable. KAN-69 deleted those components, so every
// remaining component is live and none is skipped.

// Commented-out JSX still matches the literal patterns below --
// UserInputContainer keeps a `{/* <Button text="Search" ... /> */}` line -- and
// a commented string is not shipped to anyone.
const stripComments = (src: string) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

const sources = Object.fromEntries(
  Object.entries(allSources).map(([file, src]) => [file, stripComments(src)])
);

const localeFiles = import.meta.glob('/public/locales/*/translation.json', {
  import: 'default',
  eager: true,
}) as Record<string, Record<string, string>>;

// A string literal handed straight to ariaLabel. `ariaLabel={t('...')}` and
// `ariaLabel={title}` do not match, which is the point.
const HARDCODED_LABEL = /ariaLabel="([^"]*)"/g;

// Likewise for the two sibling props that turned out to carry untranslated
// English of their own -- WindowEntryContainer's tooltipText="Save changes"
// and SignIn's VISIBLE text="Sign In". The ticket only described ariaLabel.
const HARDCODED_TOOLTIP = /tooltipText="([^"]*)"/g;
const HARDCODED_TEXT = /\btext="([^"]*)"/g;

// The raw DOM attribute, kebab-case, as written directly on a native element
// (e.g. `<div role="group" aria-label="...">`) rather than handed to one of
// this repo's custom components (ClickableRow, Icon, Button), which forward
// their camelCase `ariaLabel` prop to `aria-label={ariaLabel}` and so already
// read as `ariaLabel="..."` only when literal. HARDCODED_LABEL's regex is
// `ariaLabel="`, which does not match `aria-label="` -- confirmed by
// mutating WindowEntryContainer's group band to a literal
// `aria-label="Unnamed group"` and watching this file's other assertions
// stay green (KAN-11 task 8). Without this pattern, a raw aria-label on a
// role-bearing element is invisible to the sweep.
const HARDCODED_ARIA_ATTR = /aria-label="([^"]*)"/g;

const findAll = (src: string, re: RegExp) =>
  [...src.matchAll(new RegExp(re.source, 'g'))].map((m) => m[1]);

describe('no user-facing string is hardcoded English', () => {
  // The control. If this ever fails, the glob has stopped seeing the source
  // tree and every "zero hardcoded strings" assertion below is vacuous.
  test('CONTROL: the component sources are actually being read', () => {
    const files = Object.keys(sources);
    expect(files.length).toBeGreaterThan(10);
    expect(files.join('|')).toMatch(/MenuContainer\.tsx/);
    // Something translated really is in there, so the scan sees real content.
    expect(Object.values(sources).join('\n')).toMatch(/t\('Undo'\)/);

    // Nothing is skipped any more. This asserted that the KAN-69 exclusion
    // removed exactly three files; KAN-69 deleted them, so the scan now covers
    // every component. Keep the equality rather than dropping the check: it is
    // what would catch a filter being reintroduced, which is how a real
    // offender would get hidden again.
    expect(Object.keys(sources).length).toBe(Object.keys(allSources).length);
  });

  for (const [prop, re] of [
    ['ariaLabel', HARDCODED_LABEL],
    ['tooltipText', HARDCODED_TOOLTIP],
    ['text', HARDCODED_TEXT],
    ['aria-label', HARDCODED_ARIA_ATTR],
  ] as const) {
    test(`no component passes a literal ${prop}`, () => {
      const offenders: string[] = [];
      for (const [file, src] of Object.entries(sources)) {
        for (const value of findAll(src, re)) {
          offenders.push(`${file}  ${prop}="${value}"`);
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});

// A factory rather than a shared constant: saveToTabContainerInternal's
// reducer mutates what it is handed and Immer freezes it, so a session reused
// across the ten locale cases arrives at the second dispatch already frozen
// and throws "Cannot assign to read only property 'lastModified'".
const buildSession = (): tabContainerData => ({
  tabGroupId: 'group-1',
  title: 'Research',
  createdTime: '2026-08-31 09:00:00',
  createdAt: Date.UTC(2026, 7, 31, 9, 0, 0),
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected: true,
  windows: [
    {
      windowId: 'win-1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Morning reading',
      tabs: [
        {
          tabId: 't1',
          favicon: '',
          title: 'Kagi Search',
          url: 'https://kagi.com/',
        },
      ],
    },
  ],
});

const noop = () => {};

// The text a sighted user reads off the control. Two things have to come out:
// the Material Symbols glyph, which renders as its ligature NAME ("delete",
// "reopen_window") and is not text anyone sees, and anything already hidden
// from assistive tech.
function visibleTextOf(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone
    .querySelectorAll('.material-symbols-outlined, [aria-hidden="true"]')
    .forEach((n) => n.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// testI18n is created but NOT initialised at import time -- renderWithProviders
// is what calls init. addResourceBundle and changeLanguage do not exist on an
// uninitialised instance, so this has to run before either is touched.
beforeEach(async () => {
  await initTestI18n();
});

afterEach(async () => {
  // changeLanguage mutates the shared test instance, so a leaked locale would
  // silently run every later test in the wrong language.
  await testI18n.changeLanguage('en');
});

// WCAG 2.5.3 Label in Name, Level A: when a control has visible text, its
// accessible name must contain that text.
//
// This is the test that rules out KAN-65's own suggested fix. The ticket
// proposes reusing each control's tooltipText key as its label, and measured
// across all ten locales that fails 22 of 40 cases -- "Switch" against a
// tooltip reading "Close current windows and open this session" fails in
// every locale, and "Add window" fails in seven.
//
// jsdom is a sound oracle here, unlike the accessible-NAME assertions in
// e2e/a11y-controls.spec.ts: this compares an aria-label attribute against
// rendered text content, both of which jsdom reflects faithfully. No
// computed-name algorithm is involved.
describe('Label in Name holds in every locale (WCAG 2.5.3)', () => {
  for (const [file, dict] of Object.entries(localeFiles)) {
    const locale = file.split('/')[3];

    test(`${locale}: labelled controls contain their visible text`, async () => {
      const { container } = await renderWithProviders(
        <>
          <TabGroupEntry
            tabGroupData={buildSession()}
            onTabGroupClick={noop}
            onOpenAllClick={noop}
            onFocusClick={noop}
            onDeleteClick={noop}
          />
          <HeroContainerRight />
        </>,
        {
          seedStore: (store) => {
            store.dispatch(saveToTabContainerInternal(buildSession()));
            store.dispatch(selectTabContainer('group-1'));
          },
        }
      );

      // The language switch has to happen AFTER the render, not before.
      // renderWithProviders calls initTestI18n() itself, and init({ lng: 'en' })
      // resets the language -- so switching first left every case running
      // English labels against English text and passing vacuously. The count
      // control below did not catch it, because the COUNT was right and only
      // the language was wrong.
      testI18n.addResourceBundle(locale, 'translation', dict, true, true);
      await act(async () => {
        await testI18n.changeLanguage(locale);
      });

      // CONTROL: prove the locale is actually live in the DOM before trusting
      // anything below. `en` is exempt only because it is the fallback.
      expect(testI18n.language).toBe(locale);
      if (locale !== 'en') {
        expect(dict['Open']).toBeTruthy();
        expect(container.textContent).toContain(dict['Open']);
      }

      const checked: string[] = [];
      const failures: string[] = [];

      // Only glyph controls -- an Icon or Button whose visible text sits
      // beside a Material Symbols glyph. Their text IS the control's label,
      // which is what 2.5.3 governs.
      //
      // Composite rows are deliberately excluded. The session row is a
      // ClickableRow named after its session title while its text content also
      // carries the window/tab counts and the created date; those are
      // supplementary CONTENT, not part of the label, so requiring the name to
      // contain all of them would be wrong rather than strict.
      for (const el of container.querySelectorAll('[aria-label]')) {
        if (!el.querySelector('.material-symbols-outlined')) continue;
        const visible = visibleTextOf(el);
        if (!visible) continue;
        const name = el.getAttribute('aria-label') ?? '';
        checked.push(visible);
        if (!norm(name).includes(norm(visible))) {
          failures.push(
            `name "${name}" does not contain visible text "${visible}"`
          );
        }
      }

      // Without this the loop above passes trivially on a render that produced
      // no labelled control with visible text at all.
      expect(checked.length).toBeGreaterThanOrEqual(4);
      expect(failures).toEqual([]);
    });
  }
});
