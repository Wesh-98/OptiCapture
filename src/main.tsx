import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { installApiFetchInterceptor } from './lib/apiFetch.ts';
import './index.css';

// Installed before the tree mounts so the very first fetch from any component
// already carries the active-store header. See installApiFetchInterceptor.
installApiFetchInterceptor();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
