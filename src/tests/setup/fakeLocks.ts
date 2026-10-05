import type { LockApi } from '../../utils/functions/tourLock';

// One Set stands for the origin's lock manager, shared by every "page" a test builds.
export interface FakeLocks {
  held: Set<string>;
  // A page going away: the browser drops its locks.
  dropAll(): void;
  uninstall(): void;
}

export function installFakeLocks(
  options: { requestRejects?: boolean; queryRejects?: boolean } = {}
): FakeLocks {
  const held = new Set<string>();
  const api: LockApi = {
    request: (name, callback) => {
      if (options.requestRejects) {
        return Promise.reject(new Error('lock refused'));
      }
      held.add(name);
      return callback().finally(() => held.delete(name));
    },
    query: () =>
      options.queryRejects
        ? Promise.reject(new Error('query refused'))
        : Promise.resolve({ held: [...held].map((name) => ({ name })) }),
  };
  Object.defineProperty(navigator, 'locks', { value: api, configurable: true });
  return {
    held,
    dropAll: () => held.clear(),
    uninstall: () => {
      Reflect.deleteProperty(navigator, 'locks');
    },
  };
}
