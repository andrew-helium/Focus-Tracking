import { createRoot } from 'react-dom/client';
import { Router } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './fonts.css';
import './index.css';

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <Router hook={useHashLocation}>
      <App />
    </Router>
  </ErrorBoundary>,
);
