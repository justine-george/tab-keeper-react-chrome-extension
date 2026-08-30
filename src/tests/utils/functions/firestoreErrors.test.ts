import { describe, expect, test } from 'vitest';

import {
  isMissingDocumentError,
  isPermissionDenied,
} from '../../../utils/functions/firestoreErrors';

const USER_ID = '69dd1795-aeaf-4a7c-a4a0-dd20b605e3d5';

// Both predicates gate the same recovery in loadFromFirestore: seed a cloud
// document from local state. A false negative here is silent - the read fails,
// nothing is seeded, and the user's first sync never happens.
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

describe('isPermissionDenied', () => {
  // The full SDK and the lite build word this differently, which is exactly
  // why the check is on code rather than message. Before this fix the lite
  // wording fell through to the "unexpected error" branch and skipped the
  // retry, so both wordings are pinned here.
  test('matches the full SDK wording', () => {
    const error: any = new Error('Missing or insufficient permissions.');
    error.code = 'permission-denied';
    expect(isPermissionDenied(error)).toBe(true);
  });

  test('matches the lite build wording, which prefixes the message', () => {
    const error: any = new Error(
      'Request failed with error: Missing or insufficient permissions.'
    );
    error.code = 'permission-denied';
    expect(isPermissionDenied(error)).toBe(true);
  });

  test('does not match a different Firestore error code', () => {
    const error: any = new Error('The service is currently unavailable.');
    error.code = 'unavailable';
    expect(isPermissionDenied(error)).toBe(false);
  });

  test('does not match an error whose message merely mentions permissions', () => {
    // No code, so it is not a Firestore permission failure however it reads.
    const error = new Error('Missing or insufficient permissions.');
    expect(isPermissionDenied(error)).toBe(false);
  });

  test('tolerates a thrown value with no code', () => {
    expect(isPermissionDenied(undefined)).toBe(false);
    expect(isPermissionDenied({})).toBe(false);
  });
});
