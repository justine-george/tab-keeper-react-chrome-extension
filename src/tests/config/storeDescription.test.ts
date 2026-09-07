import { describe, expect, test } from 'vitest';

import manifest from '../../../public/manifest.json';
import pkg from '../../../package.json';

// The manifest's `description` is the extension's SHORT description: what the
// Chrome Web Store prints under the name in search results, and what every link
// preview card renders when the listing URL is shared. It is not a dashboard
// field -- it ships inside the package, so a wrong one cannot be corrected on
// the listing and has to wait for the next release and its review cycle.
//
// KAN-126: it went three releases describing the pre-1.6.0 product, never
// mentioning tab groups, because nothing here looks at it.
//
// The copy itself is deliberately NOT pinned -- asserting an exact sentence
// only restates it, and would fail on any future reword for no reason. What is
// pinned are the two properties that make a wrong value expensive.
describe('store short description', () => {
  // Chrome rejects an over-long description at UPLOAD time, so the feedback
  // arrives at submission -- after a version bump, a tagged release and a green
  // build, at the one moment the cost of a round trip is highest.
  test('is within the 132-character limit the Web Store enforces', () => {
    expect(manifest.description.length).toBeLessThanOrEqual(132);
  });

  test('is not empty', () => {
    expect(manifest.description.trim()).not.toBe('');
  });

  // The same sentence is duplicated in package.json, and nothing keeps the two
  // in step. They agree today only because they have always been edited
  // together; the failure mode is editing one and shipping the other.
  test('is identical in package.json', () => {
    expect(pkg.description).toBe(manifest.description);
  });
});
