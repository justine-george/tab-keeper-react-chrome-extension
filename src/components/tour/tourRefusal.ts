// Round 2 (KAN-902). A press the tour turned away outside its dim, such as a
// row's right-click: the card hears it and says why. Module state, as
// dragHold.ts: the rows render in tests without the card.
const listeners = new Set<() => void>();

export function refuseDuringTour(): void {
  for (const listener of [...listeners]) listener();
}

export function onRefusedDuringTour(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
