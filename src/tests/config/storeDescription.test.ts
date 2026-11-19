import { expect, test } from 'vitest';

import en from '../../../public/_locales/en/messages.json';
import pkg from '../../../package.json';

// Since KAN-274 the manifest's description is `__MSG_appDesc__`, and the
// English text lives in _locales/en/messages.json; manifestLocales.test.ts
// holds every locale's to the Web Store's 132 characters, non-empty.
//
// The same sentence is duplicated in package.json, and nothing keeps the two
// in step. They agree today only because they have always been edited
// together; the failure mode is editing one and shipping the other.
test('the store short description is identical in package.json', () => {
  expect(pkg.description).toBe(en.appDesc.message);
});
