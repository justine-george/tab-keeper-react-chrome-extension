import { describe, expect, it } from 'vitest';

import {
  announceArrival,
  subscribeArrival,
} from '../../../utils/functions/arrival';

// KAN-892. A saved window dropped on an open window: the worker's tab ids are
// told to whoever listens (Open now's scroll and fill, Task 5).
describe('arrival', () => {
  it('tells every listener the window and its new tab ids', () => {
    const heard: unknown[] = [];
    const heardToo: unknown[] = [];
    const stop = subscribeArrival((a) => heard.push(a));
    const stopToo = subscribeArrival((a) => heardToo.push(a));

    announceArrival(7, [71, 72]);

    expect(heard).toEqual([{ windowId: 7, tabIds: [71, 72] }]);
    expect(heardToo).toEqual([{ windowId: 7, tabIds: [71, 72] }]);
    stop();
    stopToo();
  });

  it('a listener that stopped hears nothing more; the others still do', () => {
    const heard: unknown[] = [];
    const heardToo: unknown[] = [];
    const stop = subscribeArrival((a) => heard.push(a));
    const stopToo = subscribeArrival((a) => heardToo.push(a));

    stop();
    announceArrival(7, [71]);

    expect(heard).toEqual([]);
    expect(heardToo).toEqual([{ windowId: 7, tabIds: [71] }]);
    stopToo();
  });

  it('with no listener, an announcement goes nowhere and throws nothing', () => {
    expect(() => announceArrival(7, [71])).not.toThrow();
  });
});
