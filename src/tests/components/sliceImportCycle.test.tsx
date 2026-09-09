// KAN-137. Importing the session slice must not break unrelated code.
//
// THE IMPORT ORDER BELOW IS THE TEST. `tabContainerDataStateSlice` is imported
// FIRST, before MainContainer, which is what a component importing it does to
// the module graph. While tabContainerDataStateSlice and globalStateSlice
// imported each other at runtime, that ordering left one of them partially
// initialised, and the damage surfaced somewhere else entirely.
//
// What it looked like: a cmd+Z chord dispatched `undoRedo/undo` but
// `event.defaultPrevented` stayed false, so it read as a broken keyboard
// shortcut. The real cause was `Cannot read properties of undefined (reading
// 'tabGroups')` thrown inside dispatch(), which unwound before MainContainer's
// handler reached its next line -- `event.preventDefault()`. Nine tests in
// undoRedoChords.test.tsx failed for a change that touched neither keyboard
// handling nor sessions.
//
// It never reached users: rollup hoists cyclic bindings differently from
// vitest's module runner, and the built extension worked. It failed CI, which
// is enough -- the next person to import this slice would lose the same hour.
import { clearSessionOrder } from '../../redux/slices/tabContainerDataStateSlice';

import { describe, expect, test } from 'vitest';
import { act } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import { renderWithProviders } from '../setup/renderWithProviders';

describe('importing the session slice early', () => {
  test('the action creator is defined, not a partially initialised module', () => {
    expect(typeof clearSessionOrder).toBe('function');
    expect(clearSessionOrder().type).toBe(
      'tabContainerDataState/clearSessionOrder'
    );
  });

  // The canary. This is the assertion that actually failed, two steps
  // downstream of the cycle, and it is why the test lives here rather than
  // being a static import-graph check: what matters is that nothing throws
  // during dispatch, not that any particular edge is absent.
  test('a cmd+Z chord still reaches preventDefault', async () => {
    const errors: string[] = [];
    const onError = (e: ErrorEvent) => errors.push(String(e.message));
    window.addEventListener('error', onError);

    await renderWithProviders(<MainContainer />);

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.body.dispatchEvent(event);
    });
    window.removeEventListener('error', onError);

    // Asserted before defaultPrevented, because it names the CAUSE. Left to
    // the flag alone, a failure here reads as a keyboard bug.
    expect(errors).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
  });
});
