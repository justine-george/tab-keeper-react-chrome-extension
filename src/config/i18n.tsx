import i18n from 'i18next';
import HttpBackend from 'i18next-http-backend';
import { initReactI18next } from 'react-i18next';

import { DEFAULT_LANG } from '../utils/constants/common';
import {
  asPartialSettings,
  loadFromLocalStorage,
} from '../utils/functions/local';
import { Language, SettingsData } from '../redux/slices/settingsDataStateSlice';

// retrieve language from localStorage
const { language: storedLanguage } = asPartialSettings<SettingsData>(
  loadFromLocalStorage('settingsData')
);
// This runs at module load, so a non-string here would throw on .replace and
// take the whole app down before it renders. Fall back instead.
const userLang: Language =
  typeof storedLanguage === 'string' && storedLanguage
    ? (storedLanguage.replace(/"/g, '') as Language)
    : DEFAULT_LANG;

i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .init({
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
    lng: userLang,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
