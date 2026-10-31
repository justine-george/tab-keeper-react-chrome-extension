import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { css, Global } from '@emotion/react';

// The wrapper that stands in for the file's <body> inside the shadow root.
const BODY_CLASS = 'tk-print-body';

/**
 * The file's stylesheet, for a shadow root: `:root` and `html` become `:host`,
 * and `body` the wrapper, since none of them match anything inside one. Only
 * bare element selectors move; `.body` (a class the file uses) stays.
 */
function scopeFileCss(fileCss: string): string {
  return fileCss
    .replace(/(^|[{},]):root(?=[{,])/g, '$1:host')
    .replace(/(^|[{},])html(?=[{,])/g, '$1:host')
    .replace(/(^|[{},])body(?=[{,])/g, `$1.${BODY_CLASS}`);
}

interface PrintCopyProps {
  /** The file, as Save as PDF… prints it. Empty when there is no file. */
  html: string;
  /** The file's page colour, painted to the paper's edges. */
  background: string;
}

/**
 * KAN-602. Chrome's menu Print… prints this page, not the preview frame, and
 * a frame printed in place leaves page 1 blank (measured). So the page holds
 * a print-only copy of the file, directly in <body>, and under print it is
 * the only thing shown. A shadow root keeps the file's CSS and the page's
 * apart. Parsed, never run: DOMParser executes nothing and scripts are
 * dropped besides.
 */
export default function PrintCopy({ html, background }: PrintCopyProps) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  // Before paint, so a print right after an edit has the edit.
  useLayoutEffect(() => {
    if (!host || !html) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    const file = new DOMParser().parseFromString(html, 'text/html');
    const styles = [...file.querySelectorAll('style')].map((fileStyle) => {
      const style = document.createElement('style');
      style.textContent = scopeFileCss(fileStyle.textContent ?? '');
      return style;
    });
    const body = document.createElement('div');
    body.className = `${BODY_CLASS} ${file.body.className}`;
    body.append(
      ...[...file.body.childNodes].map((n) => document.importNode(n, true))
    );
    body.querySelectorAll('script').forEach((script) => script.remove());
    root.replaceChildren(...styles, body);
  }, [host, html]);

  if (!html) return null;
  return createPortal(
    <>
      <Global
        styles={css`
          @media screen {
            [data-print-copy] {
              display: none;
            }
          }
          /* The file's own: Chrome's header and footer would print the
             page's address into a document meant for other people. */
          @page {
            margin: 0;
          }
          @media print {
            html,
            body {
              background: ${background} !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            body > :not([data-print-copy]) {
              display: none !important;
            }
          }
        `}
      />
      <div data-print-copy ref={setHost} />
    </>,
    document.body
  );
}
