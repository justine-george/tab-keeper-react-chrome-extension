import { registerCarryReceiver, type CarryReceiver } from '../../redux/carry';

// KAN-352. A saved drag is handed to the carry only where the pointer
// reaches a carry receiver -- in the app, the session list. A test that
// renders the saved detail without the list stands one in over `area`: hit
// there and nowhere else, taking nothing (a release on it cancels, as a
// release on the list's empty space does).
//
// Returns the receiver, so a test can spy on what was asked of it, and the
// call that unregisters it.
export interface ReceiverArea {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function standInSessionList(area: ReceiverArea): {
  receiver: CarryReceiver;
  unregister: () => void;
} {
  const receiver: CarryReceiver = {
    hit: (x, y) =>
      x >= area.left && x < area.right && y >= area.top && y < area.bottom,
    hover: () => {},
    leave: () => {},
    take: () => false,
  };
  return { receiver, unregister: registerCarryReceiver(receiver) };
}
