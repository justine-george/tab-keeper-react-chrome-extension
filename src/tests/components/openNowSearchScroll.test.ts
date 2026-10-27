import { describe, expect, test } from 'vitest';

import { searchScrollAfter } from '../../components/home/opennow/searchScroll';

describe('searchScrollAfter (KAN-339 B)', () => {
  test('a search starting goes to the top and keeps the place it left', () => {
    expect(searchScrollAfter(null, 'trip', 770, null)).toEqual({
      scrollTo: 0,
      before: 770,
    });
  });

  test('a changed term goes to the top and keeps the place from before the search', () => {
    expect(searchScrollAfter('trip', 'tri', 412, 770)).toEqual({
      scrollTo: 0,
      before: 770,
    });
  });

  test('clearing the search goes back to the place before it, and forgets it', () => {
    expect(searchScrollAfter('trip', null, 0, 770)).toEqual({
      scrollTo: 770,
      before: null,
    });
  });

  test('the same term (a space typed after it) leaves the list where it is', () => {
    expect(searchScrollAfter('trip', 'trip', 200, 770)).toEqual({
      scrollTo: null,
      before: 770,
    });
  });

  test('no search before or after leaves the list alone', () => {
    expect(searchScrollAfter(null, null, 300, null)).toEqual({
      scrollTo: null,
      before: null,
    });
  });

  // A pane that mounted mid-search (the drawer reopened) has no place to go back to.
  test('clearing with no place kept leaves the list where it is', () => {
    expect(searchScrollAfter('trip', null, 120, null)).toEqual({
      scrollTo: null,
      before: null,
    });
  });
});
