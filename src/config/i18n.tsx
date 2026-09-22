import i18n from 'i18next';
import HttpBackend from 'i18next-http-backend';
import { initReactI18next } from 'react-i18next';

import { mirrorLanguageOnDocument } from '../utils/functions/documentLanguage';
import { initialState as settingsAtLoad } from '../redux/slices/settingsDataStateSlice';

// The settings slice decides the startup language (KAN-282: saved, else the
// browser's, else English), and this reads that decision rather than making
// its own. Two copies could disagree -- the page rendering one language while
// the store saves another -- which is how detecting here alone lost the
// detected language on the first setting write.
const userLang = settingsAtLoad.language;

// Before init(), so the first language is caught when the backend delivers it.
mirrorLanguageOnDocument(i18n, document.documentElement);

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
