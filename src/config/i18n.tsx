import i18n from 'i18next';
import HttpBackend from 'i18next-http-backend';
import { initReactI18next } from 'react-i18next';

import { DEFAULT_LANG } from '../utils/constants/common';
import { loadFromLocalStorage } from '../utils/functions/local';
import { Language } from '../redux/slices/settingsDataStateSlice';

// retrieve language from localStorage
const { language: storedLanguage } = loadFromLocalStorage('settingsData') || {};
const userLang: Language = (storedLanguage || DEFAULT_LANG).replace(/"/g, '');

i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .init({
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
    lng: userLang,
    fallbackLng: 'en',
    detection: {
      order: [
        'querystring',
        'cookie',
        'localStorage',
        'navigator',
        'htmlTag',
        'path',
        'subdomain',
      ],
      caches: ['cookie'],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
