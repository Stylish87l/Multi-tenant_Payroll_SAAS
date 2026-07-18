// vite.config.js
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Load env file for the current mode ('' prefix keeps raw keys)
  const env = loadEnv(mode, process.cwd(), '');

  // FIXED (2026-07-10): This previously read `env.VITE_API_URL`, but
  // frontend/src/main.jsx (REQUIRED_ENV) and frontend/src/lib/apolloClient.js
  // both read `import.meta.env.VITE_GRAPHQL_API_URL` - a DIFFERENT key.
  // Depending on which single variable an operator happened to set, this
  // caused one of two failure modes: (a) set VITE_GRAPHQL_API_URL only ->
  // `vite build`/`vite dev` throws here before anything runs, or (b) set
  // VITE_API_URL only -> the build succeeds but the deployed app boots
  // straight into main.jsx's "System Configuration Error" screen, because
  // VITE_GRAPHQL_API_URL is undefined at runtime. Both env/build-time and
  // app/runtime code must agree on one name - standardized on
  // VITE_GRAPHQL_API_URL since that's what the actual app code (and its
  // own "FIXED: Aligned with the exact production environment key naming
  // conventions" comment) already commits to.
  const API_URL = env.VITE_GRAPHQL_API_URL;
  const HTTP_URL = env.VITE_GRAPHQL_HTTP_URL || API_URL;
  const WS_URL = env.VITE_GRAPHQL_WS_URL || (API_URL ? API_URL.replace(/^http/, 'ws') : undefined);
  const REFRESH_URL = env.VITE_AUTH_REFRESH_URL || '/api/auth/refresh';

  if (!API_URL) {
    // Fail fast with a clear message so CI/devs notice missing config
    throw new Error('VITE_GRAPHQL_API_URL is required. Set it in your .env or CI environment.');
  }

  return {
    define: {
      // Expose a small set of safe runtime flags to the client
      __APP_ENV__: JSON.stringify(mode),
      __API_URL__: JSON.stringify(API_URL),
      __GRAPHQL_WS_URL__: JSON.stringify(WS_URL || ''),
    },

    plugins: [
      react(),

      VitePWA({
        registerType: 'prompt',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'android-chrome-512x512.png','masked-icon.svg'],
        manifest: {
          name: 'Ghana Payroll Pro (2026)',
          short_name: 'GHPayroll',
          description: 'Secure, multi-tenant payroll for Ghanaian enterprises.',
          theme_color: '#020617',
          background_color: '#020617',
          display: 'standalone',
          orientation: 'any',
          scope: '/',
          start_url: '/?utm_source=pwa',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/graphql') || url.pathname.startsWith('/api/graphql'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-cache',
                expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 }, // 1 hour
                networkTimeoutSeconds: 10,
              },
            },
            {
              urlPattern: ({ request }) => request.destination === 'image' || request.destination === 'script' || request.destination === 'style',
              handler: 'CacheFirst',
              options: {
                cacheName: 'static-assets',
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }, // 30 days
              },
            },
          ],
        },
      }),
    ],

    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },

    server: {
      port: Number(env.VITE_DEV_PORT || 3000),
      strictPort: true,
      https: env.VITE_DEV_HTTPS === 'true' ? {
        key: env.VITE_DEV_HTTPS_KEY || undefined,
        cert: env.VITE_DEV_HTTPS_CERT || undefined,
      } : false,
      proxy: {
        '/graphql': {
          target: HTTP_URL || 'http://localhost:5000',
          changeOrigin: true,
          secure: false,
          ws: true,
        },
        '/api': {
          target: 'http://localhost:5000',
          changeOrigin: true,
          secure: false,
          credentials: true,
        }
      },
      fs: { allow: [path.resolve(__dirname, '..')] },
    },

    preview: {
      port: Number(env.VITE_PREVIEW_PORT || 4173),
      strictPort: true,
    },

    optimizeDeps: {
      include: ['react', 'react-dom', 'react-router-dom', '@apollo/client', 'graphql'],
      esbuildOptions: {
        target: 'es2020',
      },
    },

    build: {
      sourcemap: mode !== 'production',
      target: 'es2020',
      minify: 'terser',
      terserOptions: {
        compress: { passes: 2 },
        format: { comments: false },
      },
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-apollo': ['@apollo/client', 'graphql'],
            'vendor-ui': ['framer-motion', 'lucide-react'],
          },
          chunkFileNames: 'assets/js/[name]-[hash].js',
          entryFileNames: 'assets/js/[name]-[hash].js',
          assetFileNames: ({ name }) => {
            if (/\.(css)$/.test(name ?? '')) return 'assets/css/[name]-[hash][extname]';
            return 'assets/[ext]/[name]-[hash][extname]';
          },
        },
      },
      chunkSizeWarningLimit: 1200,
    },

    envPrefix: ['VITE_', 'PUBLIC_'],
  };
});