import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';

import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { initTestI18n, testI18n } from '../setup/i18nForTests';

// KAN-279/KAN-301. The popup's index.html <title> ("TabKeeper - Tab Manager
// Extension") is never shown; the tab view is a real tab, so its title
// shows in the tab strip. This only proves the WIRING: isTabView() gates
// which page gets its title rewritten, and the string written is the same
// key the header renders.

const POPUP_TITLE = 'TabKeeper - Tab Manager Extension';

function Harness() {
  useDocumentTitle();
  return null;
}

async function renderHarness() {
  await initTestI18n();
  return render(
    <I18nextProvider i18n={testI18n}>
      <Harness />
    </I18nextProvider>
  );
}

beforeEach(() => {
  // jsdom keeps one document per file; the popup's own title is the known
  // starting point every real page loads with.
  document.title = POPUP_TITLE;
});

afterEach(() => {
  cleanup();
  // isTabView() reads the live URL; put it back (same reason as
  // viewMode.test.tsx and useTabCloudReads.test.tsx).
  window.history.replaceState(null, '', '/index.html');
});

describe('useDocumentTitle', () => {
  test('sets document.title to Tab Keeper in the tab view', async () => {
    window.history.replaceState(null, '', '/index.html?view=tab');

    await renderHarness();

    expect(document.title).toBe('Tab Keeper');
  });

  // CONTROL: the mutation this guards against is setting the title in the
  // popup too.
  test('CONTROL: leaves the popup title unchanged', async () => {
    window.history.replaceState(null, '', '/index.html');

    await renderHarness();

    expect(document.title).toBe(POPUP_TITLE);
  });
});
