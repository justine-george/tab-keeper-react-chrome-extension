import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import {
  HIDE_TAGS_UNDER_STRIP,
  TAG_STRIP_ALLOWANCE_PX,
  markTagsUnderStrip,
} from '../../components/common/tagsUnderStrip';
import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';
import { classRulesFor } from '../setup/hoverRules';
import { KEY_NAV_ATTRIBUTE } from '../../utils/functions/keyNav';

// KAN-723. While a row's strip shows, a count tag the strip would cover hides instead of being cut.

const MARK = 'data-under-strip';

const built: HTMLElement[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  built.splice(0).forEach((row) => row.remove());
});

// jsdom lays nothing out, so each box is stubbed: a 20px-tall box from left to right.
const stubRect = (el: Element, left: number, right: number) =>
  vi
    .spyOn(el, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(left, 0, right - left, 20));

// A row of `tags`, each ending at its right edge, and a strip of controls at [left, right].
function buildRow(tagRights: number[], controls: [number, number][]) {
  const row = document.createElement('div');
  const tags = tagRights.map((right) => {
    const tag = document.createElement('span');
    tag.setAttribute('data-row-tag', '');
    stubRect(tag, right - 40, right);
    row.append(tag);
    return tag;
  });
  const strip = document.createElement('div');
  for (const [left, right] of controls) {
    const control = document.createElement('button');
    stubRect(control, left, right);
    strip.append(control);
  }
  row.append(strip);
  document.body.append(row);
  built.push(row);
  return { row, tags, strip };
}

describe('markTagsUnderStrip', () => {
  test("a tag ending past the strip's first control minus 4px is marked", () => {
    expect(TAG_STRIP_ALLOWANCE_PX).toBe(4);
    const { row, tags, strip } = buildRow([600], [[603, 635]]);
    markTagsUnderStrip(row, strip);
    expect(tags[0].hasAttribute(MARK)).toBe(true);
  });

  test('a tag ending on the line or before it is not marked', () => {
    const { row, tags, strip } = buildRow([599, 598], [[603, 635]]);
    markTagsUnderStrip(row, strip);
    expect(tags[0].hasAttribute(MARK)).toBe(false);
    expect(tags[1].hasAttribute(MARK)).toBe(false);
  });

  test('a stale mark is removed when the tag no longer reaches the strip', () => {
    const { row, tags, strip } = buildRow([620], [[603, 635]]);
    markTagsUnderStrip(row, strip);
    expect(tags[0].hasAttribute(MARK)).toBe(true);
    stubRect(tags[0], 500, 560);
    markTagsUnderStrip(row, strip);
    expect(tags[0].hasAttribute(MARK)).toBe(false);
  });

  test('the line is the first control with a width, not a hidden first child', () => {
    const { row, tags, strip } = buildRow(
      [590],
      [
        [500, 500],
        [603, 635],
      ]
    );
    markTagsUnderStrip(row, strip);
    expect(tags[0].hasAttribute(MARK)).toBe(false);
  });

  test('with no strip every mark is removed', () => {
    const { row, tags, strip } = buildRow([620, 700], [[603, 635]]);
    markTagsUnderStrip(row, strip);
    expect(tags.every((t) => t.hasAttribute(MARK))).toBe(true);
    markTagsUnderStrip(row, null);
    expect(tags.some((t) => t.hasAttribute(MARK))).toBe(false);
  });

  // The worst path: a strip whose controls all measure zero (searching hides Open, say) says nothing about where it covers.
  test('with a strip of no measurable control every mark is removed', () => {
    const { row, tags, strip } = buildRow([620], [[603, 635]]);
    markTagsUnderStrip(row, strip);
    expect(tags[0].hasAttribute(MARK)).toBe(true);
    const empty = document.createElement('div');
    const zero = document.createElement('button');
    stubRect(zero, 603, 603);
    empty.append(zero);
    markTagsUnderStrip(row, empty);
    expect(tags[0].hasAttribute(MARK)).toBe(false);
  });

  test('each tag is judged on its own', () => {
    const { row, tags, strip } = buildRow([560, 640], [[603, 635]]);
    markTagsUnderStrip(row, strip);
    expect(tags[0].hasAttribute(MARK)).toBe(false);
    expect(tags[1].hasAttribute(MARK)).toBe(true);
  });
});

const tab = (
  tabId: string,
  title: string,
  chromeGroupId?: string
): tabData => ({
  tabId,
  favicon: '',
  title,
  url: `https://${tabId}.test`,
  ...(chromeGroupId ? { chromeGroupId } : {}),
});

async function renderWindow() {
  return renderWithProviders(
    <WindowEntryContainer
      number={1}
      title="Window 1"
      tabGroupId="tg1"
      windowId="w1"
      tabs={[tab('t1', 'Loose'), tab('t2', 'Paper', 'g1')]}
      chromeTabGroups={[{ groupId: 'g1', title: 'Research', color: 'blue' }]}
      onOpenWindow={() => undefined}
      onUpdateWindowGroupTitle={() => undefined}
      onAddCurrTabToWindowClick={() => undefined}
      onDeleteClick={() => undefined}
    />,
    {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
      },
    }
  );
}

const windowRow = () => {
  const row = document.querySelector<HTMLElement>('[data-window-drag-handle]');
  if (!row) throw new Error('no window row');
  return row;
};
const groupBand = () => {
  const band = document.querySelector<HTMLElement>('[data-group-drag-handle]');
  if (!band) throw new Error('no group band');
  return band;
};
const tagOf = (row: HTMLElement) => {
  const tag = row.querySelector<HTMLElement>('[data-row-tag]');
  if (!tag) throw new Error('no tag');
  return tag;
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

describe('saved pane rows hide a covered tag while the strip shows', () => {
  test('the hide rule is visibility, nothing that reflows', () => {
    expect(HIDE_TAGS_UNDER_STRIP).toBe(
      '[data-row-tag][data-under-strip] { visibility: hidden; }'
    );
  });

  test('a saved window row hides a marked tag only while its strip shows', async () => {
    await renderWindow();
    const row = windowRow();
    const tag = tagOf(row);
    tag.setAttribute(MARK, '');
    expect(visibilityOf(tag)).not.toBe('hidden');

    fireEvent.mouseEnter(row);
    expect(visibilityOf(tag)).toBe('hidden');

    fireEvent.mouseLeave(row);
    expect(visibilityOf(tag)).not.toBe('hidden');
  });

  // CONTROL: the strip shows, but this tag clears it.
  test('an unmarked tag stays shown while the strip shows', async () => {
    await renderWindow();
    const row = windowRow();
    fireEvent.mouseEnter(row);
    expect(visibilityOf(tagOf(row))).not.toBe('hidden');
  });

  test("a saved window row's held right-click look hides a marked tag too", async () => {
    await renderWindow();
    const row = windowRow();
    const tag = tagOf(row);
    tag.setAttribute(MARK, '');
    fireEvent.contextMenu(row, { clientX: 40, clientY: 40 });
    expect(row.hasAttribute('data-row-menu-held')).toBe(true);
    expect(visibilityOf(tag)).toBe('hidden');
  });

  test("a saved window row's keyboard reveal hides a marked tag, as it shows the strip", async () => {
    await renderWindow();
    const row = windowRow();
    expect(
      emits(
        row,
        (cls) =>
          `${KEY_NAV} ${cls}:has([data-row-actions] :focus-visible) ${HIDE}`
      )
    ).toBe(true);
  });

  test('a saved group band hides a marked tag under its hover and key-nav rules', async () => {
    await renderWindow();
    const band = groupBand();
    // The selectors that show its strip, then the same selectors hiding the tag.
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

  test("a saved group band's held right-click look hides a marked tag", async () => {
    await renderWindow();
    const band = groupBand();
    const tag = tagOf(band);
    tag.setAttribute(MARK, '');
    expect(visibilityOf(tag)).not.toBe('hidden');
    fireEvent.contextMenu(band, { clientX: 40, clientY: 40 });
    expect(band.hasAttribute('data-row-menu-held')).toBe(true);
    expect(visibilityOf(tag)).toBe('hidden');
  });

  test('entering a saved row measures its tags', async () => {
    await renderWindow();
    const row = windowRow();
    const strip = row.querySelector('[data-row-actions]');
    const control = strip?.firstElementChild;
    if (!control) throw new Error('no strip control');
    stubRect(tagOf(row), 520, 600);
    stubRect(control, 603, 635);
    fireEvent.pointerEnter(row);
    expect(tagOf(row).hasAttribute(MARK)).toBe(true);

    const band = groupBand();
    const bandControl = band.querySelector('.group-actions')?.firstElementChild;
    if (!bandControl) throw new Error('no band control');
    stubRect(tagOf(band), 520, 600);
    stubRect(bandControl, 603, 635);
    fireEvent.pointerEnter(band);
    expect(tagOf(band).hasAttribute(MARK)).toBe(true);
  });

  test('focus entering a saved row measures its tags', async () => {
    await renderWindow();
    const band = groupBand();
    const bandControl = band.querySelector('.group-actions')?.firstElementChild;
    if (!bandControl) throw new Error('no band control');
    stubRect(tagOf(band), 520, 600);
    stubRect(bandControl, 603, 635);
    act(() => {
      screen.getByRole('button', { name: 'Rename group: Research' }).focus();
    });
    expect(tagOf(band).hasAttribute(MARK)).toBe(true);

    const row = windowRow();
    const control = row.querySelector('[data-row-actions]')?.firstElementChild;
    if (!control) throw new Error('no strip control');
    stubRect(tagOf(row), 520, 600);
    stubRect(control, 603, 635);
    act(() => {
      screen.getByRole('button', { name: 'Rename window: Window 1' }).focus();
    });
    expect(tagOf(row).hasAttribute(MARK)).toBe(true);
  });
});
