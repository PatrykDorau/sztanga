import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // Port 3000 = domyślny "Site URL" w Supabase Auth, więc magic link działa lokalnie bez konfiguracji.
  server: { port: 3000 },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Trener – plany, grafik, postępy',
        short_name: 'Trener',
        lang: 'pl',
        description: 'Aplikacja trenerki personalnej',
        theme_color: '#0b0d10',
        background_color: '#0b0d10',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Fonty Barlow – po pierwszym wczytaniu działają offline.
            urlPattern: ({ url }) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com',
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'raw.githubusercontent.com',
            handler: 'CacheFirst',
            options: { cacheName: 'exercise-images', expiration: { maxEntries: 500 } },
          },
        ],
      },
    }),
  ],
})
