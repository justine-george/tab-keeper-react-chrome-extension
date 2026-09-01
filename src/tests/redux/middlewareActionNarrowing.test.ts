import { describe, it, expect, vi } from 'vitest';

// common.ts reads window.screen at module load, and this is a node test.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  displayToast: vi.fn(),
}));

import { customMiddleware } from '../../redux/middleware/customMiddleware';
import { SELECT_TAB_CONTAINER_ACTION } from '../../utils/constants/actionTypes';

// Redux Toolkit 2 types a middleware's `action` as `unknown` rather than
// `AnyAction`, because a middleware sits above the base dispatch and therefore
// sees whatever was handed to it -- including things that are not actions at
// all. This middleware read `action.type` unconditionally, which the compiler
// could not object to under RTK 1.
//
// Exercised directly rather than through a store: dispatching a non-action into
// a real store also trips Redux's own "actions must be plain objects" check, so
// a store-level test could not tell our middleware's failure apart from that
// one. Calling the chain by hand isolates the narrowing.
const runMiddleware = (action: unknown) => {
  const store = {
    getState: () => ({
      tabContainerDataState: {},
      globalState: { isDirty: false, isSignedIn: false },
      settingsDataState: { isAutoSync: false },
      undoRedo: { present: { tabContainerDataState: {} } },
    }),
    dispatch: vi.fn(),
  };
  const next = vi.fn((a: unknown) => a);

  // The Middleware type is deliberately not satisfied by this hand-rolled
  // store; the cast is scoped to the test harness, not to production code.
  type Chain = (s: unknown) => (n: unknown) => (a: unknown) => unknown;
  const invoke = (customMiddleware as unknown as Chain)(store)(next);

  return { result: invoke(action), next, dispatch: store.dispatch };
};

describe('customMiddleware action narrowing (RTK 2)', () => {
  // The four values RTK 2's `unknown` is warning about. Each one made the old
  // `action.type` read throw a TypeError before the action could reach `next`.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a string', 'not-an-action'],
  ])('passes %s through instead of throwing', (_label, action) => {
    const { next } = runMiddleware(action);

    expect(next).toHaveBeenCalledWith(action);
  });

  // A function is what a thunk looks like. In this store thunk middleware is
  // ahead of this one so it should never arrive here, but the middleware must
  // not depend on that ordering to avoid throwing.
  it('passes a thunk-shaped function through', () => {
    const thunk = () => undefined;
    const { next } = runMiddleware(thunk);

    expect(next).toHaveBeenCalledWith(thunk);
  });

  // The control. Narrowing must not stop real actions being handled -- without
  // this, a middleware that passed everything straight to `next` would satisfy
  // every test above.
  it('still processes a real action', () => {
    const action = { type: SELECT_TAB_CONTAINER_ACTION, payload: 'group-1' };
    const { next } = runMiddleware(action);

    expect(next).toHaveBeenCalledWith(action);
  });
});
