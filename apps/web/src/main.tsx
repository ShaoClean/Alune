import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/geist/wght.css';
import '@fontsource-variable/geist-mono/wght.css';
import App from './App';
import '@alune/ui/styles.css';
import './index.css';
import './workspace-layout.css';
import './files.css';
import './components/repository-extensions.css';
import './tags.css';
import './conflicts.css';
import './pull-requests.css';
import './pull-request-center.css';
import './collection-views.css';
import './repository-overview.css';
import './theme.css';
import './dialogs.css';
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
