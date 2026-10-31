import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';

import PrintCopy from '../../components/export/PrintCopy';
import { buildSession } from '../fixtures/sessionFixture';
import {
  EXPORT_PALETTE,
  sessionToHtml,
  type SessionExportOptions,
} from '../../utils/functions/sessionExportHtml';

// KAN-602. Chrome's menu Print… prints the page, so the page holds a print-only
// copy of the file. What prints is measured in e2e/export-print.spec.ts.

const OPTIONS: SessionExportOptions = {
  layout: 'comfortable',
  scheme: 'light',
  countsLabel: '1 Window · 3 Tabs',
  tabCountLabel: (count) => `${count} Tabs`,
  strings: {
    window: 'Window',
    notAWebLink: 'not a web link',
    savedWith: 'Saved with {{brand}} on {{date}}',
    getExtension: 'Get the extension',
  },
  mark: 'data:image/png;base64,TUFSSw==',
  storeUrl: 'https://store.example/',
  savedOn: 'Oct 30, 2026',
  icons: new Map(),
  iconsReady: true,
};

const fileOf = (titles: string[]) =>
  sessionToHtml(
    buildSession({
      tabGroupId: 'session-print',
      title: 'Thesis research',
      windows: [
        {
          windowId: 'w-1',
          windowHeight: 800,
          windowWidth: 1200,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: titles.length,
          title: '',
          tabs: titles.map((title, index) => ({
            tabId: `t-${index}`,
            favicon: '',
            title,
            url: `https://paper${index}.example/`,
          })),
        },
      ],
    }),
    OPTIONS
  );

const BACKGROUND = EXPORT_PALETTE.light.bg;

const copy = (): ShadowRoot => {
  const host = document.querySelector('[data-print-copy]');
  if (!host?.shadowRoot) throw new Error('no print copy with a shadow root');
  return host.shadowRoot;
};

describe('the print-only copy of the file (KAN-602)', () => {
  test("holds the file's body and styles in a shadow root", () => {
    render(
      <PrintCopy
        html={fileOf(['Paper 1', 'Paper 2', 'Paper 3'])}
        background={BACKGROUND}
      />
    );
    const root = copy();
    for (const title of ['Paper 1', 'Paper 2', 'Paper 3']) {
      expect(root.textContent).toContain(title);
    }
    expect(root.querySelector('style')).not.toBeNull();
    // The body's class (the layout) carries over, so the layout's rules apply.
    expect(root.querySelector('.comfortable main')).not.toBeNull();
  });

  test("the file's page rules are rewritten for the shadow root", () => {
    render(<PrintCopy html={fileOf(['Paper 1'])} background={BACKGROUND} />);
    const css = [...copy().querySelectorAll('style')]
      .map((style) => style.textContent ?? '')
      .join('');
    // :root and body match nothing inside a shadow root.
    expect(css).not.toMatch(/(^|[{},]):root[{,]/);
    expect(css).not.toMatch(/(^|[{},])(html|body)[{,]/);
    expect(css).toContain(':host{--bg:');
    // A class named "body" is not the body element.
    expect(css).toContain('.comfortable li.tab .body{');
  });

  test('follows a changed file', () => {
    const { rerender } = render(
      <PrintCopy html={fileOf(['Paper 1'])} background={BACKGROUND} />
    );
    rerender(
      <PrintCopy html={fileOf(['Renamed paper'])} background={BACKGROUND} />
    );
    expect(copy().textContent).toContain('Renamed paper');
    expect(copy().textContent).not.toContain('Paper 1');
  });

  test('drops scripts', () => {
    const html = fileOf(['Paper 1']).replace(
      '<main>',
      '<main><script>window.ran = true</script>'
    );
    expect(html).toContain('<script>');
    render(<PrintCopy html={html} background={BACKGROUND} />);
    expect(copy().querySelector('script')).toBeNull();
    expect(copy().textContent).toContain('Paper 1');
  });

  test('no file, no copy', () => {
    render(<PrintCopy html="" background={BACKGROUND} />);
    expect(document.querySelector('[data-print-copy]')).toBeNull();
  });
});
