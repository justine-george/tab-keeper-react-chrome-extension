// KAN-990. The sync size measures still running (KAN-6 measures off the main
// path), so a test can wait for them to land rather than guess how long a
// gzip of up to 1 MB takes on a busy machine.
const running = new Set<Promise<unknown>>();

/** Runs `measure` as it is, remembered until it settles. */
export function trackSyncMeasure<T>(measure: Promise<T>): Promise<T> {
  running.add(measure);
  const done = () => {
    running.delete(measure);
  };
  measure.then(done, done);
  return measure;
}

/** Resolves once every measure started so far, and any started meanwhile, has settled. */
export async function syncMeasuresLanded(): Promise<void> {
  while (running.size > 0) await Promise.allSettled([...running]);
}
