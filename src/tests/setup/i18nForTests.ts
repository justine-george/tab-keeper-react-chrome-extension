import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '../../../public/locales/en/translation.json';

// The app's src/config/i18n.tsx uses i18next-http-backend, which cannot
// resolve under jsdom and loads asynchronously. Tests get their own instance
// with the real en resources inlined, so translation is synchronous and
// assertions run against the strings a user actually sees.
//
// Importing the app's i18n config from a test would run the HTTP backend at
// module load. Never do it.
export const testI18n = i18n.createInstance();

let initialised: Promise<unknown> | undefined;

// Inits once per test file. Each call still leaves the language on en, as a
// re-init did: bundles a test added stay, but its language does not.
export const initTestI18n = async (): Promise<void> => {
  initialised ??= testI18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
  await initialised;
  if (testI18n.language !== 'en') await testI18n.changeLanguage('en');
};
