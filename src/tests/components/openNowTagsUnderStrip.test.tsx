import { createRef } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import OpenNowPane from '../../components/home/opennow/OpenNowPane';
import { HIDE_TAGS_UNDER_STRIP } from '../../components/common/tagsUnderStrip';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { toOpenWindows } from '../../utils/functions/openNow';
import { classRulesFor } from '../setup/hoverRules';
import { KEY_NAV_ATTRIBUTE } from '../../utils/functions/keyNav';

// KAN-723. While an Open now row's strip shows, a count tag the strip would cover hides instead of being cut.

const MARK = 'data-under-strip';

afterEach(() => vi.restoreAllMocks());

const tab = (title: string, groupId?: number) => ({
  title,
  url: `https://${title.toLowerCase()}.test/`,
  pinned: false,
  audible: false,
  ...(groupId === undefined ? {} : { groupId }),
});

// Window 1 is this one: a loose tab, then two tabs in "Research". Window 2 is another.
const seed = (): ChromeSeed => ({
  windows: [
    { id: 1, tabs: [tab('Loose'), tab('G1', 50), tab('G2', 50)] },
    { id: 2, tabs: [tab('Other')] },
  ],
  tabGroups: [{ id: 50, title: 'Research', color: 'blue', windowId: 1 }],
});

async function renderPane() {
  const props = {
    actions: [],
    headingId: 'open-now-heading',
    onSearchTextChange: () => undefined,
    searchInputRef: createRef<HTMLInputElement>(),
  };
  const result = await renderWithProviders(
    <OpenNowPane windows={null} searchText="" {...props} />,
    { seed: seed() }
  );
  const windows = toOpenWindows(
    await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
    await chrome.tabGroups.query({}),
    1
  );
  const search = (searchText: string) =>
    result.rerender(
      <OpenNowPane windows={windows} searchText={searchText} {...props} />
    );
  search('');
  return { ...result, search };
}

const stubRect = (el: Element, left: number, right: number) =>
  vi
    .spyOn(el, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(left, 0, right - left, 20));

const windowRow = (windowId = 1) => {
  const row = document.querySelector<HTMLElement>(
    `[data-open-window-id="${windowId}"] [data-window-row]`
  );
  if (!row) throw new Error('no window row');
  return row;
};
const groupBand = () => {
  const band = screen
    .getByRole('button', { name: 'Rename group: Research' })
    .closest<HTMLElement>('[data-group-drag-handle]');
  if (!band) throw new Error('no group band');
  return band;
};
const tagsOf = (row: HTMLElement) => [
  ...row.querySelectorAll<HTMLElement>('[data-row-tag]'),
];
const firstControl = (row: HTMLElement, strip: string) => {
  const control = row.querySelector(strip)?.firstElementChild;
  if (!control) throw new Error('no strip control');
  return control;
};
const visibilityOf = (el: Element) => getComputedStyle(el).visibility;

// Whitespace collapsed, so jsdom's formatting cannot fail a match.
const flat = (s: string) => s.replace(/\s+/g, ' ');
const HIDE = HIDE_TAGS_UNDER_STRIP;
const KEY_NAV = `html[${KEY_NAV_ATTRIBUTE}]`;
// True when one of el's classes emits the rule `rule(".class")` builds.
const emits = (el: Element, rule: (cls: string) => string) => {
  const rules = flat(classRulesFor(el));
  return [...el.classList].some((c) => rules.includes(rule(`.${c}`)));
};

describe('Open now rows hide a covered tag while the strip shows', () => {
  test('entering an Open now window row measures each of its tags', async () => {
    await renderPane();
    const row = windowRow();
    const [count, thisWindow] = tagsOf(row);
    expect(count.textContent).toBe('3 Tabs');
    expect(thisWindow.textContent).toBe('This window');
    stubRect(count, 520, 560);
    stubRect(thisWindow, 570, 640);
    stubRect(firstControl(row, '[data-row-actions]'), 603, 635);
    fireEvent.pointerEnter(row);
    expect(count.hasAttribute(MARK)).toBe(false);
    expect(thisWindow.hasAttribute(MARK)).toBe(true);
  });

  test('focus entering an Open now window row measures its tags', async () => {
    await renderPane();
    const row = windowRow();
    const [count, thisWindow] = tagsOf(row);
    stubRect(count, 520, 560);
    stubRect(thisWindow, 570, 640);
    stubRect(firstControl(row, '[data-row-actions]'), 603, 635);
    act(() => {
      screen.getByRole('button', { name: 'Collapse: Window 1' }).focus();
    });
    expect(thisWindow.hasAttribute(MARK)).toBe(true);
    expect(count.hasAttribute(MARK)).toBe(false);
  });

  test('an Open now window row hides a marked tag only while its strip shows', async () => {
    await renderPane();
    const row = windowRow();
    const [count, thisWindow] = tagsOf(row);
    thisWindow.setAttribute(MARK, '');
    expect(visibilityOf(thisWindow)).not.toBe('hidden');

    fireEvent.mouseEnter(row);
    expect(visibilityOf(thisWindow)).toBe('hidden');
    // CONTROL: the strip shows, but this tag clears it.
    expect(visibilityOf(count)).not.toBe('hidden');

    fireEvent.mouseLeave(row);
    expect(visibilityOf(thisWindow)).not.toBe('hidden');
  });

  test("an Open now window row's keyboard reveal hides a marked tag", async () => {
    await renderPane();
    const row = windowRow();
    expect(
      emits(
        row,
        (cls) =>
          `${KEY_NAV} ${cls}:has([data-row-actions] :focus-visible) ${HIDE}`
      )
    ).toBe(true);
  });

  test("an Open now window row's held right-click look hides a marked tag", async () => {
    await renderPane();
    const row = windowRow(2);
    const [count] = tagsOf(row);
    count.setAttribute(MARK, '');
    fireEvent.contextMenu(row, { clientX: 40, clientY: 40 });
    expect(row.hasAttribute('data-row-menu-held')).toBe(true);
    expect(visibilityOf(count)).toBe('hidden');
  });

  // A search removes both strips, so a tag marked before it started has nothing over it.
  test('while searching a hovered Open now row hides no marked tag', async () => {
    const { search } = await renderPane();
    const row = windowRow();
    const [, thisWindow] = tagsOf(row);
    thisWindow.setAttribute(MARK, '');
    fireEvent.mouseEnter(row);
    expect(visibilityOf(thisWindow)).toBe('hidden');

    await act(async () => search('G1'));
    // The premise: the same node, still marked, on a row the pointer never left.
    expect(tagsOf(windowRow())[1]).toBe(thisWindow);
    expect(thisWindow.hasAttribute(MARK)).toBe(true);
    expect(visibilityOf(thisWindow)).not.toBe('hidden');

    const band = groupBand();
    expect(emits(band, (cls) => `${cls}:hover ${HIDE}`)).toBe(false);
    expect(
      emits(band, (cls) => `${KEY_NAV} ${cls}:has(:focus-visible) ${HIDE}`)
    ).toBe(false);
  });

  test('entering an Open now group band measures its tag', async () => {
    await renderPane();
    const band = groupBand();
    const [count] = tagsOf(band);
    stubRect(count, 520, 600);
    stubRect(firstControl(band, '.group-actions'), 603, 635);
    fireEvent.pointerEnter(band);
    expect(count.hasAttribute(MARK)).toBe(true);
  });

  test('focus entering an Open now group band measures its tag', async () => {
    await renderPane();
    const band = groupBand();
    const [count] = tagsOf(band);
    stubRect(count, 520, 600);
    stubRect(firstControl(band, '.group-actions'), 603, 635);
    act(() => {
      screen.getByRole('button', { name: 'Rename group: Research' }).focus();
    });
    expect(count.hasAttribute(MARK)).toBe(true);
  });

  test('an Open now group band hides a marked tag under its hover and key-nav rules', async () => {
    await renderPane();
    const band = groupBand();
    expect(emits(band, (cls) => `${cls}:hover .group-actions`)).toBe(true);
    expect(emits(band, (cls) => `${cls}:hover ${HIDE}`)).toBe(true);
    expect(
      emits(
        band,
        (cls) => `${KEY_NAV} ${cls}:has(:focus-visible) .group-actions`
      )
    ).toBe(true);
    expect(
      emits(band, (cls) => `${KEY_NAV} ${cls}:has(:focus-visible) ${HIDE}`)
    ).toBe(true);
  });

  test("an Open now group band's held right-click look hides a marked tag", async () => {
    await renderPane();
    const band = groupBand();
    const [count] = tagsOf(band);
    count.setAttribute(MARK, '');
    expect(visibilityOf(count)).not.toBe('hidden');
    fireEvent.contextMenu(band, { clientX: 40, clientY: 40 });
    expect(band.hasAttribute('data-row-menu-held')).toBe(true);
    expect(visibilityOf(count)).toBe('hidden');
  });
});
