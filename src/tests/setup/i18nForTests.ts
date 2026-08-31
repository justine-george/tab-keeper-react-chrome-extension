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

export const initTestI18n = () =>
  testI18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
