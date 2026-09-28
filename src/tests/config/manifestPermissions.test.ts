import { describe, expect, test } from 'vitest';

import manifest from '../../../public/manifest.json';

// KAN-280 Part D, Task 7. Reopen with history asks for `sessions` only after
// the user turns the Settings switch on, so the manifest must list it as
// OPTIONAL, never required (spec O9): a required `sessions` changes the
// install warning and disables the extension on update until the user
// accepts, while an optional one leaves the warning unchanged.

describe('the manifest keeps sessions optional (KAN-280)', () => {
  test('sessions is in optional_permissions', () => {
    expect(manifest.optional_permissions).toContain('sessions');
  });

  test('sessions is not in the required permissions', () => {
    expect(manifest.permissions).not.toContain('sessions');
  });

  test('tabGroups is still optional', () => {
    expect(manifest.optional_permissions).toContain('tabGroups');
  });
});
