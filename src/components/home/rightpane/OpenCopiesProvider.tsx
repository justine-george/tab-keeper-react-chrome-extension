import { useState } from 'react';
import type { ReactNode } from 'react';

import { useOpenWindows } from '../../../hooks/useOpenWindows';
import { openCopyAddresses } from '../../../utils/functions/openSavedTab';
import { NO_OPEN_COPIES, OpenCopyAddresses } from './openCopies';

const sameMembers = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((address) => b.has(address));

// KAN-890. A live read of the open tabs for the saved session's rows. The
// value changes only when the set of addresses does, so a page load or a tab
// switch re-renders no saved row; the children are the caller's elements, so
// this component's own re-reads re-render nothing below it.
export function OpenCopiesProvider({ children }: { children: ReactNode }) {
  // Groups are not needed for an address, so no group events are listened to.
  const windows = useOpenWindows(false);
  const [addresses, setAddresses] = useState(NO_OPEN_COPIES);
  const read = windows === null ? NO_OPEN_COPIES : openCopyAddresses(windows);
  // React's derived-state pattern: a new set is kept only when its members differ.
  if (!sameMembers(read, addresses)) setAddresses(read);
  return (
    <OpenCopyAddresses.Provider value={addresses}>
      {children}
    </OpenCopyAddresses.Provider>
  );
}
