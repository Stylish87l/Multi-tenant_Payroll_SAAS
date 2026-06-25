// src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ApolloProvider } from '@apollo/client';
import App from './app';
import './index.css';

import { AuthProvider } from './context/AuthContext';
import client from './lib/apolloClient'; 

/**
 * Environment configuration
 * - FIXED: Aligned with the exact production environment key naming conventions
 */
const REQUIRED_ENV = ['VITE_GRAPHQL_API_URL']; // 👈 CHANGED THIS
const OPTIONAL_ENV = ['VITE_GRAPHQL_WS_URL'];

/* Small React UI to show configuration errors outside the app tree */
function ConfigError({ missing }) {
  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#020617',
      color: '#94a3b8',
      fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
      textAlign: 'center',
      padding: 20,
    }}>
      <div>
        <h1 style={{ color: '#fff', fontSize: '1.5rem', marginBottom: 10 }}>System Configuration Error</h1>
        <p style={{ marginBottom: 8 }}>The application is missing required environment configuration.</p>
        <div style={{ background: '#0f172a', padding: 12, borderRadius: 6, display: 'inline-block' }}>
          <strong style={{ color: '#fff' }}>Missing</strong>
          <div style={{ color: '#94a3b8', marginTop: 6 }}>{missing.join(', ')}</div>
        </div>
        <p style={{ marginTop: 12, color: '#94a3b8' }}>
          Please contact your administrator or check your deployment configuration.
        </p>
      </div>
    </div>
  );
}

/* Validate environment and return { ok, missingRequired, missingOptional } */
function validateEnvironment() {
  const missingRequired = REQUIRED_ENV.filter((k) => !import.meta.env[k]);
  const missingOptional = OPTIONAL_ENV.filter((k) => !import.meta.env[k]);

  const ok = missingRequired.length === 0;
  if (!ok) {
    console.error(`🚨 Fatal: Missing Environment Variables: ${missingRequired.join(', ')}`);
  } else if (missingOptional.length > 0) {
    console.warn(`⚠️ Optional env missing: ${missingOptional.join(', ')}`);
  }

  return { ok, missingRequired, missingOptional };
}

/* Service worker registration with update callback */
async function registerServiceWorker({ onUpdate } = {}) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !import.meta.env.PROD) return;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    console.log('🚀 PWA: ServiceWorker registered at', registration.scope);

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed') {
          if (navigator.serviceWorker.controller) {
            if (typeof onUpdate === 'function') onUpdate(registration);
          }
        }
      });
    });
  } catch (err) {
    console.warn('PWA: ServiceWorker registration failed', err);
  }
}

/* Boot sequence */
(function bootstrap() {
  const rootEl = document.getElementById('root');
  if (!rootEl) {
    throw new Error('Fatal: Root element #root not found in index.html');
  }

  const env = validateEnvironment();
  const root = ReactDOM.createRoot(rootEl);

  if (!env.ok) {
    root.render(
      <React.StrictMode>
        <ConfigError missing={env.missingRequired} />
      </React.StrictMode>
    );
    return;
  }

  // ✅ Normal app mount with Router, Apollo, and AuthProvider
  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <ApolloProvider client={client}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ApolloProvider>
      </BrowserRouter>
    </React.StrictMode>
  );

  // Register service worker and provide an onUpdate handler
  registerServiceWorker({
    onUpdate: (registration) => {
      window.dispatchEvent(new CustomEvent('sw:update', { detail: { registration } }));
    },
  });
})();
