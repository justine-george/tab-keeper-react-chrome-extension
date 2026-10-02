// How long a carry rests on a session's row before that session opens
// (KAN-350 S1 A). The row's dwell sweep (TabGroupEntry) runs for exactly this
// long, and the session list's timer (TabGroupEntryContainer) waits exactly
// this long, so the row is full when the session opens.
export const SPRING_OPEN_MS = 600;
