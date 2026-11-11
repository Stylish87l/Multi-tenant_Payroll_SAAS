import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // Must match the key main.jsx and lib/apolloClient.js read at runtime.
  const API_URL = env.VITE_GRAPHQL_API_URL;
  if (!API_URL) throw new Error('VITE_GRAPHQL_API_URL is required. Set it in your .env or CI environment.');

  return {
    plugins: [
      react(),
      // The ONE service worker. Manifest is generated here; the hand-written public/manifest.json,
      // public/sw.js and the <link rel="manifest"> in index.html were removed (they conflicted).
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
        manifest: {
          name: 'Paylio',
          short_name: 'Paylio',
          description: 'Secure, multi-tenant payroll for Ghanaian enterprises.',
          theme_color: '#020617',
          background_color: '#020617',
          display: 'standalone',
          orientation: 'any',
          scope: '/',
          start_url: '/',
          icons: [
            { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
          // Never serve the SPA shell for API/GraphQL, and never cache authenticated responses
          // (the old NetworkFirst rule on /graphql could persist payroll data on shared devices).
          navigateFallbackDenylist: [/^\/api\//, /^\/graphql/],
          cleanupOutdatedCaches: true,
        },
      }),
    ],

    resolve: { alias: { '@': path.resolve(__dirname, './src') } },

    server: {
      port: Number(env.VITE_DEV_PORT || 3000),
      strictPort: true,
      fs: { allow: [path.resolve(__dirname, '..')] },
    },

    preview: { port: Number(env.VITE_PREVIEW_PORT || 4173), strictPort: true },

    optimizeDeps: {
      include: ['react', 'react-dom', 'react-router-dom', '@apollo/client', 'graphql'],
      esbuildOptions: { target: 'es2020' },
    },

    build: {
      sourcemap: mode !== 'production',
      target: 'es2020',
      minify: 'terser',
      terserOptions: { compress: { passes: 2 }, format: { comments: false } },
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-apollo': ['@apollo/client', 'graphql'],
            'vendor-ui': ['framer-motion', 'lucide-react'],
          },
          chunkFileNames: 'assets/js/[name]-[hash].js',
          entryFileNames: 'assets/js/[name]-[hash].js',
          assetFileNames: ({ name }) => (/\.(css)$/.test(name ?? '') ? 'assets/css/[name]-[hash][extname]' : 'assets/[ext]/[name]-[hash][extname]'),
        },
      },
      chunkSizeWarningLimit: 1200,
    },

    envPrefix: ['VITE_'],
  };
});
