import { describe, expect, test } from 'vitest';

import { ErrorBoundary } from '../../components/ErrorBoundary';

// There is no jsdom or React Testing Library in this project (KAN-2), so the
// rendered fallback is verified by driving the real popup in Chrome. What is
// unit-testable without a DOM is the decision itself: getDerivedStateFromError
// is a static pure function, and it is the piece that decides whether the user
// sees a fallback or a blank rectangle.
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
