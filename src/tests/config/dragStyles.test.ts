import { describe, expect, test } from 'vitest';

// `?raw`, not node:fs: tsconfig omits node types on purpose, and this is the same file the bundler ships.
import appCss from '../../App.css?raw';

// KAN-134 / KAN-135. Asserted on the STYLESHEET TEXT: a cursor set on body was set and inert
// (cursor inherits and every row declares its own), and jsdom resolves no cascade. The rendered effect is checked in a browser.

// Whitespace collapsed, so formatting cannot fail an assertion.
const flat = appCss.replace(/\s+/g, ' ');

describe('the drag stylesheet rules', () => {
  // `*`, as each row declares its own cursor; `!important`, as emotion's classes load later.
  test('a drag forces the grabbing cursor onto every element', () => {
    expect(flat).toMatch(
      /\[data-dragging\] \* \{[^}]*cursor: grabbing !important/
    );
  });

  test('a drag hides every row action strip', () => {
    expect(flat).toMatch(/\[data-dragging\] \[data-row-actions\]/);
  });

  // CONTROL: unscoped, the rules would hide every row's actions and force the grabbing cursor for good.
  test('CONTROL: neither rule applies outside a drag', () => {
    expect(flat).not.toMatch(/(^|})\s*\* \{[^}]*cursor: grabbing/);
    expect(flat).not.toMatch(/(^|})\s*\[data-row-actions\] \{[^}]*opacity: 0/);
  });
});

// KAN-153. A WINDOW drag folds every window, by stylesheet rule: no component state changes, so nothing can be left half-applied.
describe('the window-drag collapse rule', () => {
  test('folds window tab lists away while a window is dragged', () => {
    expect(flat).toContain(
      "[data-dragging='window'] [data-window-tabs] { display: none !important; }"
    );
  });

  // `[data-dragging]` matches any value: unscoped, a TAB drag would hide the rows being reordered.
  test('and is scoped, so a tab drag does not hide its own rows', () => {
    expect(flat).not.toContain('[data-dragging] [data-window-tabs]');
  });
});

// KAN-160. While a GROUP is dragged, the held group compresses to its title
// row and moves like a tab.
describe('the group-drag fold rule', () => {
  test('compresses the held group to its title row', () => {
    expect(flat).toContain(
      "[data-dragging='group'] [data-drag-held] [data-group-tabs] { display: none !important; }"
    );
  });

  // Folding a group ABOVE the held one moves it off the cursor, and the pick-up opens refused (measured: 128px, KAN-161).
  test('and nothing wider: not other groups, not other drag kinds', () => {
    expect(flat).not.toMatch(
      /\[data-dragging(='group')?\] \[data-group-tabs\]/
    );
    expect(flat).not.toContain('[data-dragging] [data-drag-held]');
  });
});

// KAN-321 O1a. Resizing Open now shows the resize cursor and selects nothing: a flag and a descendant rule, never body.style (KAN-134).
describe('the Open now resize rule', () => {
  const rule = flat.match(/\[data-resizing\] \* \{[^}]*\}/)?.[0] ?? '';

  test('every element shows the resize cursor, important', () => {
    expect(rule).toContain('cursor: col-resize !important');
  });

  test('and nothing selects', () => {
    expect(rule).toContain('user-select: none !important');
  });
});

// KAN-394 N1 (revised). The New session target swaps in on the drag's marker, not on a live carry.
describe('the New session target rule', () => {
  test('the marker hides the save row’s controls and shows its target', () => {
    expect(flat).toContain(
      '[data-drag-new-session] [data-save-row]:has(> [data-new-session-target]) > :not([data-new-session-target]) { visibility: hidden; }'
    );
    expect(flat).toContain(
      '[data-drag-new-session] [data-new-session-target] { visibility: visible; }'
    );
  });

  test('CONTROL: no rule waits for a live carry', () => {
    expect(flat).not.toContain('[data-carrying]');
  });
});
