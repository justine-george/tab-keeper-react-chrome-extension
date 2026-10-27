import { describe, expect, test } from 'vitest';
import {
  addressTooltip,
  shownTitle,
  withShownTitle,
} from '../../../utils/functions/tabTitle';

const tab = {
  tabId: 't1',
  favicon: 'data:,',
  title: '(3) Inbox',
  url: 'https://mail.example/',
};

describe('shownTitle (KAN-824)', () => {
  test('a tab without a name of its own shows its page title', () => {
    expect(shownTitle(tab)).toBe('(3) Inbox');
  });

  test('a renamed tab shows its own name', () => {
    expect(shownTitle({ ...tab, customTitle: 'Work mail' })).toBe('Work mail');
  });
});

describe('withShownTitle (KAN-824)', () => {
  test('puts the shown name in title and drops customTitle', () => {
    const out = withShownTitle({ ...tab, customTitle: 'Work mail' });
    expect(out).toEqual({ ...tab, title: 'Work mail' });
    expect(out).not.toHaveProperty('customTitle');
  });

  test('leaves an unnamed tab as it was', () => {
    expect(withShownTitle(tab)).toEqual(tab);
  });
});

describe('addressTooltip caps a long address (KAN-824 final review)', () => {
  const huge = `data:image/png;base64,${'A'.repeat(50_000)}`;

  test('keeps a short address whole', () => {
    expect(addressTooltip({ title: 'T', url: 'https://a.test/x' })).toBe(
      'https://a.test/x'
    );
  });

  test('cuts the middle of a long one: its start and end stay', () => {
    const tip = addressTooltip({ title: 'T', url: huge });
    expect(tip.length).toBeLessThanOrEqual(301);
    expect(tip.startsWith('data:image/png;base64,AAA')).toBe(true);
    expect(tip.endsWith('AAA')).toBe(true);
    expect(tip).toContain('…');
  });

  test('a renamed one keeps its page title line', () => {
    const tip = addressTooltip({ title: 'Page', url: huge, customTitle: 'N' });
    expect(tip.startsWith('Page\ndata:image/png')).toBe(true);
    expect(tip.length).toBeLessThanOrEqual(306);
  });
});
