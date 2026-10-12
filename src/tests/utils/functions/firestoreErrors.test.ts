import { describe, expect, test } from 'vitest';

import { isMissingDocumentError } from '../../../utils/functions/firestoreErrors';

const USER_ID = '69dd1795-aeaf-4a7c-a4a0-dd20b605e3d5';

// The one read failure that means the cloud is empty: the caller then seeds a
// cloud document from local state. A false negative here is silent - the read
// fails, nothing is seeded, and the user's first sync never happens.
describe('isMissingDocumentError', () => {
  test('matches the error fetchDataFromFirestore throws for an absent document', () => {
    const error = new Error('Document does not exist for userId: ' + USER_ID);
    expect(isMissingDocumentError(error, USER_ID)).toBe(true);
  });

  test('does not match the same message for a different user', () => {
    const error = new Error('Document does not exist for userId: someone-else');
    expect(isMissingDocumentError(error, USER_ID)).toBe(false);
  });

  test('does not match an unrelated failure', () => {
    expect(
      isMissingDocumentError(new Error('network request failed'), USER_ID)
    ).toBe(false);
  });

  test('tolerates a thrown value with no message', () => {
    expect(isMissingDocumentError(undefined, USER_ID)).toBe(false);
    expect(isMissingDocumentError({}, USER_ID)).toBe(false);
  });
});
