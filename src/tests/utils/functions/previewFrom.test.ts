import { describe, expect, test } from 'vitest';

import {
  previewFrom,
  withPreviewFrom,
} from '../../../utils/functions/previewFrom';

describe('previewFrom (KAN-880)', () => {
  test.each([
    ['?session=a&from=popup', 'popup'],
    ['?session=a&from=full', 'full'],
    ['?session=a', 'full'],
    ['', 'full'],
    ['?from=junk', 'full'],
    ['?from=', 'full'],
  ])('%s reads as %s', (search, expected) => {
    expect(previewFrom(search)).toBe(expected);
  });
});

describe('withPreviewFrom (KAN-880)', () => {
  test('appends to an existing query with &', () => {
    expect(withPreviewFrom('export.html?session=a%20b', 'popup')).toBe(
      'export.html?session=a%20b&from=popup'
    );
  });

  test('starts a query with ? when there is none', () => {
    expect(withPreviewFrom('export.html', 'full')).toBe(
      'export.html?from=full'
    );
  });

  test('what it writes, previewFrom reads back', () => {
    const url = withPreviewFrom('export.html?source=open-windows', 'popup');
    expect(previewFrom(url.slice(url.indexOf('?')))).toBe('popup');
  });
});
