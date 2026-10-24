import { afterEach, describe, expect, test, vi } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

// KAN-750. The app's store says whether this build has a cloud from the moment
// it is made, so the sync button's first frame never reads "Sync unavailable"
// in a build that has one. Test stores (makeTestStore) still start without it.
describe.each([true, false])(
  'a build whose cloud config is %s',
  (configured) => {
    afterEach(() => {
      vi.doUnmock('../../config/firebase');
      vi.resetModules();
    });

    test('the app store says so before anything renders', async () => {
      vi.resetModules();
      vi.doMock('../../config/firebase', async (importOriginal) => ({
        ...(await importOriginal<typeof import('../../config/firebase')>()),
        isCloudConfigured: configured,
      }));
      const { store } = await import('../../redux/store');
      expect(store.getState().globalState.isCloudConfigured).toBe(configured);
    });
  }
);
