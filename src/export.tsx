import React from 'react';

// Before anything renders: every icon depends on it (KAN-215).
import './styles/fonts.css';

import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';

import ReactDOM from 'react-dom/client';

import i18n from './config/i18n.tsx';
import ExportPage, {
  type ExportSource,
} from './components/export/ExportPage.tsx';
import { store } from './redux/store.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

// The export preview, as its own page (KAN-190).
//
// A page rather than a popup view: the popup is destroyed the moment a tab
// takes focus, and this has to outlive that. Being a URL also means it can be
// reloaded and bookmarked -- which is why the session is named in the query
// and looked up on every render, instead of handed over once.
//
// `source=open-windows` is a capture of what is open right now (KAN-208);
// anything else is a saved session named by id, and an absent id is the
// not-found state the page renders.
const params = new URLSearchParams(window.location.search);
const source: ExportSource =
  params.get('source') === 'open-windows'
    ? { kind: 'open-windows' }
    : { kind: 'saved', tabGroupId: params.get('session') ?? '' };

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <ExportPage source={source} />
        </I18nextProvider>
      </Provider>
    </ErrorBoundary>
  </React.StrictMode>
);
