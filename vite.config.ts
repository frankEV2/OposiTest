import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Rutas relativas: la app funciona servida desde cualquier carpeta o subruta.
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'favicon-32.png'],
      manifest: {
        name: 'OposiTest',
        short_name: 'OposiTest',
        description: 'Preparación de oposiciones con tus propios PDF, sin conexión.',
        lang: 'ca',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f6f7f9',
        theme_color: '#1f3a5f',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Todo el código (incluidos PDF.js y Mermaid) queda disponible sin conexión.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Los PDF y textos de la Biblioteca y del temario se abren tal cual en otra pestaña.
        navigateFallbackDenylist: [/\/biblioteca\//, /\/temario\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: { environment: 'node', setupFiles: ['fake-indexeddb/auto'] },
} as never);
