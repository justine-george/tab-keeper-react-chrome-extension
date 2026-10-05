import type { LockApi } from '../../utils/functions/tourLock';

// One manager for every "page" a test builds; a steal rejects the holder's request, as Chrome does.
export interface FakeLocks {
  held: Set<string>;
  // A page going away: the browser drops its locks and tells no one.
  dropAll(): void;
  uninstall(): void;
}

export function installFakeLocks(
  options: { requestRejects?: boolean; queryRejects?: boolean } = {}
): FakeLocks {
  const held = new Set<string>();
  const holders = new Map<string, (error: Error) => void>();
  const api: LockApi = {
    request: (name, { steal }, callback) => {
      if (options.requestRejects) {
        return Promise.reject(new Error('lock refused'));
      }
      const holder = holders.get(name);
      if (holder !== undefined) {
        if (!steal) {
          return Promise.reject(new Error('fake locks model steal only'));
        }
        holder(new DOMException('stolen', 'AbortError'));
      }
      return new Promise((resolve, reject) => {
        holders.set(name, reject);
        held.add(name);
        void callback().then(() => {
          if (holders.get(name) !== reject) return;
          holders.delete(name);
          held.delete(name);
          resolve(undefined);
        });
      });
    },
    query: () =>
      options.queryRejects
        ? Promise.reject(new Error('query refused'))
        : Promise.resolve({ held: [...held].map((name) => ({ name })) }),
  };
  Object.defineProperty(navigator, 'locks', { value: api, configurable: true });
  return {
    held,
    dropAll: () => {
      held.clear();
      holders.clear();
    },
    uninstall: () => {
      Reflect.deleteProperty(navigator, 'locks');
    },
  };
}
