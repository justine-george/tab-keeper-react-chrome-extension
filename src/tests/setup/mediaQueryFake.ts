// jsdom implements no media queries: `window.matchMedia` is undefined, so any
// component that calls it throws on mount. componentSetup installs a default
// built from this class (every query false: a wide window), and a test that
// needs a query to match installs its own and flips it with setMatches.
//
// WHAT THIS FAKE DOES AND DOES NOT DO. It holds a `matches` the test sets and
// fires `change` when that flips. It does not parse the query or know the
// viewport, so a test proves the component follows the list it was handed,
// not that the query string is the right one. That is a real-browser claim.
export class FakeMediaQueryList extends EventTarget implements MediaQueryList {
  readonly media: string;
  matches: boolean;
  onchange: MediaQueryList['onchange'] = null;

  constructor(media: string, matches: boolean) {
    super();
    this.media = media;
    this.matches = matches;
  }

  // Sets the answer and tells the listeners, as a resized window would.
  setMatches(matches: boolean): void {
    if (this.matches === matches) return;
    this.matches = matches;
    this.dispatchEvent(new Event('change'));
  }

  // The deprecated listener API. Nothing in the app uses it, and a fake that
  // quietly accepted a listener it never called would hide that it had.
  addListener(): void {
    throw new Error('FakeMediaQueryList: use addEventListener');
  }

  removeListener(): void {
    throw new Error('FakeMediaQueryList: use removeEventListener');
  }
}
