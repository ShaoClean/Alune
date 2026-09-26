import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './workspace-layout.css';
import './files.css';
import './pull-requests.css';
import './theme.css';
import { initializeAppearance } from './appearance';
import { hydrateWorkspace } from './stores/workspaceStore';

// Mount only after asynchronous desktop preferences have been restored.
void hydrateWorkspace().then(() => {
  const disposeAppearance = initializeAppearance();
  if (import.meta.hot) import.meta.hot.dispose(disposeAppearance);
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
