import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(process.env.RIVET_DESKTOP==='1'?[]:[VitePWA({
    registerType: 'prompt',
    includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'fonts/*'],
    manifest: {
      name: 'Rivet · Adventure companion', short_name: 'Rivet',
      description: 'Your characters, campaign notebook, and guide at the table.',
      theme_color: '#7d2030', background_color: '#faf8f4', display: 'standalone',
      start_url: '/', scope: '/',
      icons: [
        {src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any'},
        {src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any'},
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,ttf,json}', 'rules/OGL-1.0a.txt', 'rules/*.pdf'],
      maximumFileSizeToCacheInBytes:8*1024*1024,
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/api\//, /^\/__\//],
      cleanupOutdatedCaches: true,
    },
  })])],
  resolve: {alias: {'@': fileURLToPath(new URL('./src', import.meta.url))}},
  server: {port: 5173, proxy: {'/api': {target: process.env.RIVET_API_URL || 'http://127.0.0.1:8080'}}},
  test: {environment: 'node', include: ['tests/**/*.test.{ts,tsx}'], setupFiles: ['./tests/setup.ts']},
});
