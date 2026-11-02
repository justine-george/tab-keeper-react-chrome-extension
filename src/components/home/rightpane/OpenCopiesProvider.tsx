import { useState } from 'react';
import type { ReactNode } from 'react';

import { useOpenWindows } from '../../../hooks/useOpenWindows';
import { openGroupKeys } from '../../../utils/functions/openSavedGroup';
import { openCopyAddresses } from '../../../utils/functions/openSavedTab';
import {
  NO_OPEN_COPIES,
  NO_OPEN_GROUPS,
  OpenCopyAddresses,
  OpenGroupKeys,
} from './openCopies';

const sameMembers = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((address) => b.has(address));

// KAN-890. A live read of the open tabs for the saved session's rows (and,
// KAN-885, of the open groups when `showGroups`: the tabGroups grant is held).
// Each value changes only when its members do, so a page load or a tab switch
// re-renders no saved row; the children are the caller's elements, so this
// component's own re-reads re-render nothing below it.
export function OpenCopiesProvider({
  showGroups,
  children,
}: {
  showGroups: boolean;
  children: ReactNode;
}) {
  const windows = useOpenWindows(showGroups);
  const [addresses, setAddresses] = useState(NO_OPEN_COPIES);
  const [groupKeys, setGroupKeys] = useState(NO_OPEN_GROUPS);
  const readAddresses =
    windows === null ? NO_OPEN_COPIES : openCopyAddresses(windows);
  const readGroupKeys =
    windows === null ? NO_OPEN_GROUPS : openGroupKeys(windows);
  // React's derived-state pattern: a new set is kept only when its members differ.
  if (!sameMembers(readAddresses, addresses)) setAddresses(readAddresses);
  if (!sameMembers(readGroupKeys, groupKeys)) setGroupKeys(readGroupKeys);
  return (
    <OpenCopyAddresses.Provider value={addresses}>
      <OpenGroupKeys.Provider value={groupKeys}>
        {children}
      </OpenGroupKeys.Provider>
    </OpenCopyAddresses.Provider>
  );
}
