import { describe, expect, test, vi } from 'vitest';

// KAN-45. local.test.ts already asserts that a malformed placeholder decodes to
// null rather than throwing -- but it passes against js-base64 3.7.5 only
// because that version decodes garbage instead of rejecting it. The production
// code has no guard, so the guarantee belongs to the dependency, not to us.
// js-base64 3.9.3 throws InvalidCharacterError, which is what dependabot #138
// surfaced.
//
// Forcing the throw is the whole point of this file: it pins the behaviour to
// the code rather than to whichever version happens to be installed, so the
// test keeps its meaning across the bump and after it.
vi.mock('js-base64', () => ({
  Base64: {
    // Present only to keep the module's shape; no test here encodes anything,
    // and a stub that pretended to would invite someone to trust its output.
    encode: () => {
      throw new Error('Base64.encode is not stubbed for these tests');
    },
    decode: () => {
      // The shape js-base64 >= 3.9 throws for input that is not valid base64.
      throw new DOMException(
        'The string to be decoded is not correctly encoded.',
        'InvalidCharacterError'
      );
    },
  },
}));

vi.mock('../../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  displayToast: vi.fn(),
}));

const { decodeDataUrl, placeholderTarget, resolveTabUrl } = await import(
  '../../../utils/functions/local'
);

const PLACEHOLDER = 'data:text/html;base64,';

describe('decodeDataUrl when the base64 decoder rejects the input (KAN-45)', () => {
  // The one that matters: background.ts calls placeholderTarget from
  // chrome.tabs.onActivated, so this runs in the service worker on every tab
  // the user activates. A throw there aborts the handler and the placeholder
  // silently never resolves to its real page -- KAN-36's defect, by a
  // different route.
  test('placeholderTarget declines instead of throwing', () => {
    expect(placeholderTarget(`${PLACEHOLDER}!!!not!!base64!!!`)).toBeNull();
  });

  test('decodeDataUrl hands back the url it was given', () => {
    const url = `${PLACEHOLDER}!!!not!!base64!!!`;
    expect(decodeDataUrl(url)).toBe(url);
  });

  // decodeDataUrl is also on the save path, via resolveTabUrl -- a capture that
  // hit an undecodable placeholder would otherwise throw mid-save.
  test('resolveTabUrl hands back the url it was given', () => {
    const url = `${PLACEHOLDER}!!!not!!base64!!!`;
    expect(resolveTabUrl(url)).toBe(url);
  });

  // Nothing that is not a placeholder should reach the decoder at all, so a
  // throwing decoder must not change how ordinary URLs are handled.
  test('leaves a non-placeholder url alone', () => {
    expect(decodeDataUrl('https://example.com/')).toBe('https://example.com/');
    expect(placeholderTarget('https://example.com/')).toBeNull();
  });
});
