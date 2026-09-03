import { describe, expect, test, vi } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module graph
// is evaluated, and common.ts -- the module under test here -- reads
// window.screen at load to size a new window. Keep in step with
// src/tests/setup/domStub.ts.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

import en from '../../../public/locales/en/translation.json';
import { TOAST_MESSAGES } from '../../utils/constants/common';

// Toast text is invisible to keyCoverage.test.ts. Toast.tsx renders
// `t(toastText)` -- a computed key -- and that file's scan only matches literal
// t('...') calls, as its own comment says. Its other test compares the ten
// locale files against each other, so it only ever sees DRIFT: when a string is
// missing from `en` too there is no drift and nothing fails.
//
// That blind spot is exactly KAN-61 (the sync-failure toast shipped English in
// nine locales) and then KAN-73 (SYNC_MERGED and IMPORT_SUCCESS shipped English
// in all ten). Both were found by hand. This is the test that sees them.
//
// Same import.meta.glob route as keyCoverage, and for the same reason: this
// project's tsconfig has no "node" types, so node:fs would fail tsc even though
// vitest resolves it at runtime.
const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Reachability is DERIVED, not listed. A constant counts as reachable if live
// source mentions `TOAST_MESSAGES.NAME` anywhere, so a newly added toast is
// covered the moment it is used -- nobody has to remember to register it here.
const USAGE_PATTERN = /\bTOAST_MESSAGES\.([A-Z0-9_]+)/g;

// The only exclusions, and they are files rather than message names on purpose:
// naming messages would need updating whenever one is added, while naming the
// dead files needs updating exactly once, when KAN-69 deletes them.
//
// These three components have no importers and do not reach the bundle
// (`handleCreateAccount` occurs 0 times in dist). Their eight strings DO still
// ship, because TOAST_MESSAGES is one object literal that live code imports and
// tree-shaking does not drop object properties -- but nothing can display them,
// so translating them would be dead weight in ten files.
const DEAD_COMPONENTS = [
  '/src/components/settings/rightpane/Account/SignIn.tsx',
  '/src/components/settings/rightpane/Account/CreateAccount.tsx',
  '/src/components/settings/rightpane/Account/ForgotPassword.tsx',
];

function reachableConstantNames(): Set<string> {
  const names = new Set<string>();

  for (const [file, source] of Object.entries(sources)) {
    if (file.includes('/src/tests/')) continue;
    if (file.endsWith('/utils/constants/common.ts')) continue; // the definition
    if (DEAD_COMPONENTS.some((dead) => file.endsWith(dead))) continue;

    for (const [, name] of source.matchAll(USAGE_PATTERN)) names.add(name);
  }

  return names;
}

describe('toast translation coverage', () => {
  test('every reachable toast message has an en translation', () => {
    const missing: string[] = [];

    for (const name of reachableConstantNames()) {
      const text = (TOAST_MESSAGES as Record<string, string>)[name];
      // A name that resolves to nothing is a typo at the usage site, which is
      // its own bug: `t(undefined)` renders nothing at all.
      if (text === undefined) {
        missing.push(`${name}  (no such TOAST_MESSAGES entry)`);
        continue;
      }
      if (!(text in en)) missing.push(`${name}  ->  "${text}"`);
    }

    expect(missing).toEqual([]);
  });

  // CONTROL. Without it the test above passes just as well against a broken
  // scan that finds no usages at all -- which is precisely how keyCoverage
  // misses these, so it is not a hypothetical failure mode here.
  test('control: the scan actually finds toast usages, including known ones', () => {
    const reached = reachableConstantNames();

    expect(reached.size).toBeGreaterThan(5);
    expect(reached).toContain('SYNC_MERGED');
    expect(reached).toContain('UNREADABLE_CLOUD_DOCUMENT');
  });

  // CONTROL for the exclusion. If the dead-file filter ever stops matching --
  // a moved file, a renamed directory -- the test above starts demanding
  // translations for eight strings no user can reach, and the honest fix then
  // is to update DEAD_COMPONENTS rather than to translate them.
  test('control: the dead Account components are excluded from the scan', () => {
    const reached = reachableConstantNames();

    expect(reached).not.toContain('LOGIN_FAIL');
    expect(reached).not.toContain('ACCOUNT_CREATION_SUCCESS');
  });
});
