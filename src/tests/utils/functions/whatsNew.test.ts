import { describe, expect, it, test } from 'vitest';

import { SettingsCategory } from '../../../redux/slices/settingsCategoryStateSlice';
import {
  WHATS_NEW,
  WhatsNewRelease,
} from '../../../utils/constants/whatsNew';
import {
  parseVersion,
  releasesToShow,
  settingsPageOf,
  showsDefaultChange,
} from '../../../utils/functions/whatsNew';

const entry = (key: string) => ({
  titleKey: `${key}Title`,
  bodyKey: `${key}Body`,
  changesDefault: false,
});

const A: WhatsNewRelease = { version: '2.3.0', entries: [entry('A')] };
const B: WhatsNewRelease = { version: '2.2.0', fixesOnly: true, entries: [entry('B')] };
const C: WhatsNewRelease = { version: '2.1.0', entries: [entry('C')] };
const D: WhatsNewRelease = { version: '2.0.2', fixesOnly: true, entries: [entry('D')] };

const versions = (since: unknown, installed: string, list: readonly WhatsNewRelease[]) =>
  releasesToShow(since, installed, list).map((r) => r.version);

describe('releasesToShow', () => {
  test('since 2.0.1, installed 2.1.0: shows 2.1.0', () => {
    expect(versions('2.0.1', '2.1.0', [C])).toEqual(['2.1.0']);
  });

  test("'next' reads as the installed version", () => {
    const next: WhatsNewRelease = { version: 'next', entries: [entry('N')] };
    expect(versions('2.0.1', '2.1.0', [next])).toEqual(['2.1.0']);
  });

  test('a fixes-only release alone shows nothing', () => {
    expect(versions('2.1.0', '2.2.0', [B, C])).toEqual([]);
  });

  test('a fixes-only release between two main ones is grouped', () => {
    const shown = releasesToShow('2.0.1', '2.3.0', [A, B, C]);
    expect(shown.map((r) => r.version)).toEqual(['2.3.0', '2.2.0', '2.1.0']);
    expect(shown.map((r) => r.fixesOnly)).toEqual([false, true, false]);
  });

  test('fixes-only releases at either end show once one opens it', () => {
    expect(versions('2.0.1', '2.3.0', [A, B, C, D])).toEqual([
      '2.3.0',
      '2.2.0',
      '2.1.0',
      '2.0.2',
    ]);
    expect(versions('2.0.1', '2.2.0', [B, C])).toEqual(['2.2.0', '2.1.0']);
  });

  test('nothing newer than the installed version', () => {
    expect(versions('2.0.1', '2.2.0', [A, B, C])).toEqual(['2.2.0', '2.1.0']);
  });

  test('the same version shows nothing', () => {
    expect(versions('2.1.0', '2.1.0', [C])).toEqual([]);
  });

  test('a downgrade shows nothing', () => {
    expect(versions('2.3.0', '2.1.0', [A, B, C])).toEqual([]);
  });

  it.each([undefined, null, 2, '', 'abc', '2.x.0', '2.0.1-beta', '1.2.3.4.5', '70000.0.0'])(
    'a since of %j shows nothing',
    (since) => {
      expect(versions(since, '2.3.0', [A, B, C])).toEqual([]);
    }
  );

  test("an installed version of 'abc' shows nothing", () => {
    expect(versions('2.0.1', 'abc', [A, B, C])).toEqual([]);
  });

  test("Chrome's short form '1.9' reads as 1.9.0", () => {
    expect(versions('1.9', '2.1.0', [C])).toEqual(['2.1.0']);
    expect(parseVersion('2.0.1')).toEqual([2, 0, 1]);
    expect(parseVersion('1.9')).toEqual([1, 9]);
  });
});

describe('showsDefaultChange', () => {
  test('true when any entry in any release changes a default', () => {
    const changing: WhatsNewRelease = {
      version: '2.1.0',
      entries: [entry('C'), { ...entry('X'), changesDefault: true }],
    };
    expect(showsDefaultChange(releasesToShow('2.0.1', '2.3.0', [A, changing]))).toBe(true);
  });

  test('false otherwise', () => {
    expect(showsDefaultChange(releasesToShow('2.0.1', '2.3.0', [A, B, C]))).toBe(false);
  });
});

describe('settingsPageOf', () => {
  test('the first settingsPage in list order', () => {
    const a: WhatsNewRelease = {
      version: '2.3.0',
      entries: [{ ...entry('A'), settingsPage: SettingsCategory.DISPLAY }],
    };
    const c: WhatsNewRelease = {
      version: '2.1.0',
      entries: [{ ...entry('C'), settingsPage: SettingsCategory.SESSIONS }],
    };
    expect(settingsPageOf(releasesToShow('2.0.1', '2.3.0', [a, c]))).toBe(
      SettingsCategory.DISPLAY
    );
  });

  test('null with no settingsPage', () => {
    expect(settingsPageOf(releasesToShow('2.0.1', '2.3.0', [A, C]))).toBeNull();
  });
});

describe('the shipped list', () => {
  test("at most one 'next', and only at index 0", () => {
    const nexts = WHATS_NEW.flatMap((r, i) => (r.version === 'next' ? [i] : []));
    expect(nexts.length).toBeLessThanOrEqual(1);
    if (nexts.length === 1) expect(nexts[0]).toBe(0);
  });

  test('every other version is x.y.z and strictly below the one before it', () => {
    const numbered = WHATS_NEW.filter((r) => r.version !== 'next');
    for (const r of numbered) expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
    for (let i = 1; i < numbered.length; i++) {
      const [prev, cur] = [numbered[i - 1], numbered[i]].map(
        (r) => parseVersion(r.version) as number[]
      );
      const below = cur.findIndex((n, j) => n !== prev[j]);
      expect(below).not.toBe(-1);
      expect(cur[below]).toBeLessThan(prev[below]);
    }
  });

  test('the first release is Copy links', () => {
    expect(WHATS_NEW[0]).toEqual({
      version: 'next',
      entries: [
        {
          titleKey: 'WhatsNewCopyLinksTitle',
          bodyKey: 'WhatsNewCopyLinksBody',
          settingsPage: SettingsCategory.SESSIONS,
          changesDefault: true,
        },
      ],
    });
  });
});
