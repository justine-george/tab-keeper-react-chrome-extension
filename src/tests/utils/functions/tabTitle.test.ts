import { describe, expect, test } from 'vitest';
import { shownTitle, withShownTitle } from '../../../utils/functions/tabTitle';

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
