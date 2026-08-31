// Predicates for the Firestore read failures that loadFromFirestore recovers
// from. Kept separate from external.ts so they can be tested without pulling
// in the Redux slices, which touch window at module load.

// The user has no cloud document yet. This is our own error from
// fetchDataFromFirestore, not the SDK's, so the message is stable.
export const isMissingDocumentError = (error: any, userId: string): boolean =>
  error?.message === 'Document does not exist for userId: ' + userId;

// Firestore rejected the read. Keyed on the stable error code rather than the
// message: the full SDK reports "Missing or insufficient permissions." while
// the lite build prefixes it with "Request failed with error: ", so a message
// comparison silently stops matching depending on which build is imported.
export const isPermissionDenied = (error: any): boolean =>
  error?.code === 'permission-denied';
