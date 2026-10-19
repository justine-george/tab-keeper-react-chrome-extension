import { Fragment, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { ErrorBoundary } from '../../components/ErrorBoundary';

// This file stays a node test on purpose. getDerivedStateFromError is a static
// pure function -- the piece that decides whether the user sees a fallback or a
// blank rectangle -- and it needs no DOM.
//
// Note the .ts extension is load-bearing: the vitest projects split by
// extension, so this runs under `unit` despite living in the components
// directory. Component tests are .tsx and run under jsdom.
//
// KAN-2 added jsdom and RTL, so the rendered fallback IS now testable. That
// test belongs to KAN-17's follow-up, not here.
describe('ErrorBoundary.getDerivedStateFromError', () => {
  test('switches into the fallback for a thrown Error', () => {
    const state = ErrorBoundary.getDerivedStateFromError(
      new Error('MainContainer exploded')
    );

    expect(state.hasError).toBe(true);
    expect(state.message).toBe('MainContainer exploded');
  });

  // A throw can carry any value. Reading .message off a string would itself
  // throw, inside the boundary, which React does not catch.
  test.each([
    ['a thrown string', 'boom'],
    ['a thrown object', { code: 500 }],
    ['null', null],
    ['undefined', undefined],
    ['an Error with an empty message', new Error('')],
  ])('still shows the fallback for %s', (_label, thrown) => {
    const state = ErrorBoundary.getDerivedStateFromError(thrown);

    expect(state.hasError).toBe(true);
    expect(state.message).toBe('An unexpected error occurred.');
  });

  test('never reports a non-string message', () => {
    const state = ErrorBoundary.getDerivedStateFromError({
      message: { nested: true },
    });

    expect(typeof state.message).toBe('string');
  });
});

// KAN-693. Its Reload button is one of the few rounded corners, so it is a
// squircle like the rest. No test can make a page fail to reach it in Chrome;
// this reads the markup React writes for it.
describe('the fallback', () => {
  test('draws Reload with a squircle corner', () => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = { hasError: true, message: 'boom' };
    const html = renderToStaticMarkup(
      createElement(Fragment, null, boundary.render())
    );
    const reload = html.match(/<button[^>]*style="([^"]*)"[^>]*>Reload</);
    const style = reload?.[1] ?? '';
    // PREMISE: this is the Reload button's style, rounded today.
    expect(style).toContain('border-radius:4px');
    expect(style).toContain('corner-shape:squircle');
  });
});
