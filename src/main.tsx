import React from 'react';

import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';

import ReactDOM from 'react-dom/client';

import i18n from './i18n';
import App from './App.tsx';
import { store } from './redux/store.tsx';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>
    </Provider>
  </React.StrictMode>
);
