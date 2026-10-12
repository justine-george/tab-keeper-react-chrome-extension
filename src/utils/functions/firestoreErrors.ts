// A predicate for the one Firestore read failure that loadFromFirestore
// recovers from. Kept separate from external.ts so it can be tested without
// pulling in the Redux slices, which touch window at module load.

// The user has no cloud document yet. This is our own error from
// fetchDataFromFirestore, not the SDK's, so the message is stable.
export const isMissingDocumentError = (error: any, userId: string): boolean =>
  error?.message === 'Document does not exist for userId: ' + userId;
