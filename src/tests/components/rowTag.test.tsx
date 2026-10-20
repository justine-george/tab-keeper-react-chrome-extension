// KAN-720. The count tag's look, and "This window" drawn with it.
import { createRef } from 'react';
import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import { RowTag } from '../../components/common/RowTag';
import { Tag } from '../../components/common/Tag';
import OpenNowPane from '../../components/home/opennow/OpenNowPane';
import { renderWithProviders } from '../setup/renderWithProviders';
import { classRulesFor } from '../setup/hoverRules';
import { toOpenWindows } from '../../utils/functions/openNow';

const tagIn = (container: HTMLElement): HTMLElement => {
  const tag = container.querySelector('[data-row-tag]');
  if (!(tag instanceof HTMLElement)) throw new Error('no row tag drawn');
  return tag;
};

describe('the row tag (KAN-720)', () => {
  test('a row tag has the row look: 2px 8px, 4px round corners, tabular figures', async () => {
    const { container } = await renderWithProviders(<RowTag value="3 Tabs" />);
    const tag = tagIn(container);
    expect(tag).toHaveTextContent('3 Tabs');
    const style = getComputedStyle(tag);
    expect(style.padding).toBe('2px 8px');
    expect(style.borderRadius).toBe('4px');
    // jsdom drops corner-shape from the computed style; the injected rule is the proof.
    expect(classRulesFor(tag)).toMatch(/corner-shape:\s*round/);
    expect(style.getPropertyValue('font-variant-numeric')).toBe('tabular-nums');
    expect(style.whiteSpace).toBe('nowrap');
    expect(style.getPropertyValue('flex-shrink')).toBe('0');
    expect(style.marginLeft).toBe('8px');
  });

  test('the plain tag keeps its look, so the "/" hint does not change', async () => {
    await renderWithProviders(<Tag value="/" />);
    const style = getComputedStyle(screen.getByText('/'));
    expect(style.padding).toBe('2px 5px');
    expect(['', '0px']).toContain(style.borderRadius);
  });

  test('"This window" is a row tag', async () => {
    const result = await renderWithProviders(
      <OpenNowPane
        windows={null}
        actions={[]}
        headingId="open-now-heading"
        searchText=""
        onSearchTextChange={() => undefined}
        searchInputRef={createRef<HTMLInputElement>()}
      />,
      {
        seed: {
          windows: [
            {
              id: 1,
              focused: true,
              tabs: [
                {
                  title: 'A',
                  url: 'https://a.test/',
                  active: true,
                  pinned: false,
                  audible: false,
                },
              ],
            },
          ],
        },
      }
    );
    const windows = toOpenWindows(
      await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
      [],
      1
    );
    result.rerender(
      <OpenNowPane
        windows={windows}
        actions={[]}
        headingId="open-now-heading"
        searchText=""
        onSearchTextChange={() => undefined}
        searchInputRef={createRef<HTMLInputElement>()}
      />
    );
    expect(screen.getByText('This window')).toHaveAttribute('data-row-tag');
  });
});
