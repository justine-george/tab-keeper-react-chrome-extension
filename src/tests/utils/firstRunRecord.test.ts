import { describe, expect, test } from 'vitest';

import { asFirstRun, newRun } from '../../utils/functions/firstRun';

describe('the run record’s replay and typed-name facts (KAN-879)', () => {
  test('a new run is not a replay and has no typed name', () => {
    expect(newRun('full', 1).isReplay).toBe(false);
    expect(newRun('full', 1).isSessionNameTyped).toBe(false);
  });

  test('a record stored without either field reads both as false', () => {
    const stored = Object.fromEntries(
      Object.entries(newRun('full', 1)).filter(
        ([key]) => key !== 'isReplay' && key !== 'isSessionNameTyped'
      )
    );
    expect(asFirstRun(stored)).toMatchObject({
      isReplay: false,
      isSessionNameTyped: false,
    });
  });

  test('a stored isReplay of true and a typed name read back', () => {
    const stored = {
      ...newRun('full', 1),
      isReplay: true,
      isSessionNameTyped: true,
    };
    expect(asFirstRun(stored)).toMatchObject({
      isReplay: true,
      isSessionNameTyped: true,
    });
  });

  test.each([
    ['isReplay', 'yes'],
    ['isSessionNameTyped', 1],
  ])('%s of %j reads as no record', (field, value) => {
    expect(asFirstRun({ ...newRun('full', 1), [field]: value })).toBeNull();
  });
});
