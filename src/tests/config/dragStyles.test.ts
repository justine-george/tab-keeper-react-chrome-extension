import { describe, expect, test } from 'vitest';

// `?raw` rather than node:fs. tsconfig's `types` array omits "node"
// deliberately -- its comment says so -- to stop src/ reaching for APIs that do
// not exist in a browser, and a readFileSync here fails `tsc` for exactly that
// reason. This resolves through the same bundler the app uses, so the file
// asserted on is provably the file that ships.
import appCss from '../../App.css?raw';

// KAN-134 / KAN-135. The drag's two visual rules live in App.css rather than in
// an emotion style, and that is deliberate — see the comments in the file.
//
// Asserted against the STYLESHEET TEXT, which is unusual and is the whole point.
// The bug being guarded against is a declaration that is set and inert:
// `setBodyGrabbing` really did set `document.body.style.cursor = 'grabbing'`,
// the old test asserted exactly that and passed, and the user still saw
// `pointer` — because `cursor` inherits and every row declares its own. jsdom
// resolves no cascade, so no assertion about a rendered cursor is available at
// this layer at all. Pinning the rule's existence is what is left; the rendered
// effect is verified in a browser.
//
// Same shape as KAN-111, which asserted generated CSS because jsdom applies no
// `:hover`.

// Collapse whitespace so the assertions do not depend on formatting.
const flat = appCss.replace(/\s+/g, ' ');

describe('the drag stylesheet rules', () => {
  test('a drag forces the grabbing cursor onto every element', () => {
    expect(flat).toMatch(
      /\[data-dragging\] \* \{[^}]*cursor: grabbing !important/
    );
  });

  // `!important` is load-bearing, not lazy: these rules have to beat emotion
  // classes, which are injected into the document after this stylesheet and
  // would otherwise win on order alone. The same reasoning is already recorded
  // on the [data-theme-switching] rule beside them.
  test('the cursor rule is important, or emotion wins on order', () => {
    const rule = flat.match(/\[data-dragging\] \* \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('!important');
  });

  // The reason it must target `*` rather than a single ancestor: `cursor`
  // inherits, and an explicit declaration on a descendant beats an inherited
  // value whatever its importance. A rule scoped to one element could not win.
  test('the cursor rule targets descendants, not just one element', () => {
    expect(flat).toMatch(/\[data-dragging\] \*/);
  });

  test('a drag hides every row action strip', () => {
    expect(flat).toMatch(/\[data-dragging\] \[data-row-actions\]/);
  });

  // CONTROL. The rules must be scoped to a drag; unscoped, they would hide
  // every row's actions and force a grabbing cursor permanently.
  test('CONTROL: neither rule applies outside a drag', () => {
    expect(flat).not.toMatch(/(^|})\s*\* \{[^}]*cursor: grabbing/);
    expect(flat).not.toMatch(/(^|})\s*\[data-row-actions\] \{[^}]*opacity: 0/);
  });
});

// KAN-153. Dragging a WINDOW folds every window shut so the whole session fits
// on screen while it is being rearranged.
//
// A stylesheet rule rather than lifted React state, and that is the design: no
// component's open/closed state is touched, so "it comes back exactly how it
// was" needs no bookkeeping and cannot be left half-applied by a drag that ends
// in an unanticipated way.
describe('the window-drag collapse rule', () => {
  test('folds window tab lists away while a window is dragged', () => {
    expect(flat).toContain(
      "[data-dragging='window'] [data-window-tabs] { display: none !important; }"
    );
  });

  // THE SCOPE IS THE POINT. `[data-dragging]` matches whatever the value is, so
  // an unscoped rule would fire during a TAB drag too and take the very rows
  // being reordered out from under the pointer.
  test('and is scoped, so a tab drag does not hide its own rows', () => {
    expect(flat).not.toContain('[data-dragging] [data-window-tabs]');
  });

  // The control for that scoping: the rules that SHOULD apply to every kind are
  // still written without a value, and an attribute selector matches any value.
  test('CONTROL: the kind-agnostic rules stay kind-agnostic', () => {
    expect(flat).toContain('[data-dragging] * {');
    expect(flat).toContain('[data-dragging] [data-row-actions] {');
  });
});
