import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { hydrateWorkspace } from './stores/workspaceStore';

// Mount only after asynchronous desktop preferences have been restored.
void hydrateWorkspace().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
