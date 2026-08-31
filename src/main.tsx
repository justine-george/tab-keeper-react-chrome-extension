import React from 'react';

import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';

import ReactDOM from 'react-dom/client';

import i18n from './config/i18n.tsx';
import App from './App.tsx';
import { store } from './redux/store.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {/* Outermost, so a throw anywhere below it -- including in a provider --
        still renders something the user can act on. */}
    <ErrorBoundary>
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <App />
        </I18nextProvider>
      </Provider>
    </ErrorBoundary>
  </React.StrictMode>
);
