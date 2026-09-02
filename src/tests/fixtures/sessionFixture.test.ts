import { describe, expect, test } from 'vitest';

import { buildContainer, buildSession } from './sessionFixture';
import { isValidTabMasterContainer } from '../../utils/functions/local';

// The E2E harness seeds straight into localStorage, bypassing every reducer.
// Nothing else would catch a fixture that has drifted from the real shape --
// the app would just render an empty list, and the E2E failure would surface
// far away from the cause.
describe('session fixture', () => {
  test('the default container is one the app would accept', () => {
    expect(isValidTabMasterContainer(buildContainer())).toBe(true);
  });

  test('a container built from explicit sessions is valid', () => {
    const container = buildContainer([
      buildSession({ tabGroupId: 'a', title: 'Research' }),
      buildSession({ tabGroupId: 'b', title: 'Holiday' }),
    ]);
    expect(isValidTabMasterContainer(container)).toBe(true);
    expect(container.tabGroups).toHaveLength(2);
  });

  test('overrides are applied', () => {
    expect(buildSession({ title: 'Thesis' }).title).toBe('Thesis');
  });

  // The guard has to be capable of saying no, or the assertions above prove
  // nothing about the fixture.
  test('the validator rejects a malformed container', () => {
    const broken = { ...buildContainer(), lastModified: 'not a number' };
    expect(isValidTabMasterContainer(broken)).toBe(false);
  });
});
