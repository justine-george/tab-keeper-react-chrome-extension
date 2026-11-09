// KAN-925. Chrome does not always fire `storage` in another open page of the
// extension when one writes: measured 8 in 6,183 runs, the write landed every
// time. So each write of a key the pages share also posts that key on a
// BroadcastChannel, which arrived in all 7 misses it was sent in, with the
// write already readable there, and a page takes in on either signal. Both
// take-ins re-read storage and do nothing when nothing changed, so a page that
// hears both takes the write in once.

export type SharedKey = 'settingsData' | 'tabContainerData';

const isSharedKey = (value: unknown): value is SharedKey =>
  value === 'settingsData' || value === 'tabContainerData';

// One per page, for posting and hearing: a channel never hears its own posts,
// so a page is not told of its own write, as `storage` never tells it either.
let pageChannel: BroadcastChannel | null | undefined;

function channel(): BroadcastChannel | null {
  if (pageChannel === undefined) {
    pageChannel =
      typeof BroadcastChannel === 'function'
        ? new BroadcastChannel('tab-keeper-stored')
        : null;
  }
  return pageChannel;
}

// After a write of `key` landed. Any other key is not shared and posts nothing.
export function announceStoredWrite(key: string): void {
  if (!isSharedKey(key)) return;
  try {
    channel()?.postMessage(key);
  } catch (error) {
    // The storage event still goes out; only the second signal is lost.
    console.error('Failed to tell other pages of a write: ', error);
  }
}

/**
 * Runs `takeIn` each time another page writes `key`: on its storage event,
 * and on its post here. A `removeItem` or `clear()` is ignored: nothing in the
 * app does either, and there is no value to take in. Returns the unsubscribe.
 */
export function onOtherPageWrite(
  key: SharedKey,
  takeIn: () => void
): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === key && e.newValue !== null) takeIn();
  };
  const onPost = (e: MessageEvent<unknown>) => {
    if (e.data === key) takeIn();
  };
  const posts = channel();
  window.addEventListener('storage', onStorage);
  posts?.addEventListener('message', onPost);
  return () => {
    window.removeEventListener('storage', onStorage);
    posts?.removeEventListener('message', onPost);
  };
}
