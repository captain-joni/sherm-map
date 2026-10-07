import path from 'node:path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const root = import.meta.dirname;
const backend = process.env.BACKEND_URL ?? 'http://localhost:3000';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.join(root, 'index.html'),
        admin: path.join(root, 'admin', 'index.html'),
      },
    },
  },
  server: {
    // Im Dev-Modus läuft das Backend separat (npm run dev -w backend)
    proxy: {
      '/api': backend,
      '/media': backend,
    },
  },
  plugins: [
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      manifest: {
        name: 'Sherm Map',
        short_name: 'Sherm Map',
        description: 'Alle Sherms auf einer Karte – entdecken und eintragen.',
        lang: 'de',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#1d4ed8',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
