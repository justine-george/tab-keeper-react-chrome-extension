import { ReactElement } from 'react';
import { Provider } from 'react-redux';
import { render, RenderResult } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';

import { makeTestStore } from './makeStore';
import { initTestI18n, testI18n } from './i18nForTests';
import { setupChromeFake, ChromeSeed, ChromeFakeHandle } from './chrome.fake';

type Options = {
  seed?: ChromeSeed;
  seedStore?: (store: ReturnType<typeof makeTestStore>['store']) => void;
};

export type RenderWithProvidersResult = RenderResult & {
  store: ReturnType<typeof makeTestStore>['store'];
  seen: string[];
  chrome: ChromeFakeHandle;
};

// One call installs everything a component needs: a fresh store (with the
// action recorder), real i18n, and the chrome fake. useThemeColors and
// useFontFamily read from the store, so the Provider covers theming too --
// there is deliberately no separate theme provider.
//
// Async because initReactI18next returns a promise even with inlined
// resources; awaiting once here stops every test racing the first render.
export async function renderWithProviders(
  ui: ReactElement,
  { seed, seedStore }: Options = {}
): Promise<RenderWithProvidersResult> {
  await initTestI18n();
  const chrome = setupChromeFake(seed);
  const { store, seen } = makeTestStore();

  // Some components read selected/derived state on their very first render
  // and throw against an empty store (e.g. KAN-39: TabGroupDetailsContainer
  // dereferences the selected tab group unconditionally). Dispatching after
  // render is too late for those -- the crash happens inside render() itself,
  // before a caller could ever reach a post-render dispatch. seedStore runs
  // synchronously here, before the first render, so callers can put the
  // store in the state a component expects to see on mount.
  seedStore?.(store);

  const result = render(
    <Provider store={store}>
      <I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>
    </Provider>
  );

  return { ...result, store, seen, chrome };
}
