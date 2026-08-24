import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';

const useDevHttps = process.env.VITE_DEV_HTTPS === 'true';

export default defineConfig({
  plugins: [
    react(),
    ...(useDevHttps ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'PrivoxPTT',
        short_name: 'PrivoxPTT',
        description: 'Профессиональная система PTT связи',
        theme_color: '#0A0C0A',
        background_color: '#0A0C0A',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // jsPDF нужен ОДНОМУ администратору при выдаче приглашений, а
        // предзагрузка скачивает всё перечисленное КАЖДОМУ устройству — включая
        // рации на слабой связи. Отложенный импорт сам по себе от этого не
        // спасает: он выделяет отдельный файл, но service worker всё равно
        // тянет его заранее. Исключаем явно, иначе +390 КБ всем и навсегда.
        // Презентация — страница для заказчиков, а не часть приложения. В
        // предзагрузке она заставила бы КАЖДОЕ устройство, включая рации на
        // слабой связи, скачать полсотни килобайт маркетинга.
        globIgnores: ['**/jspdf*.js', 'presentation/**'],
        // Отдачу страницы из precache отключаем совсем: она регистрируется
        // раньше наших правил и перехватывает все переходы, из-за чего
        // NetworkFirst ниже никогда бы не сработал.
        navigateFallback: undefined,
        // Старый воркер отдавал страницу из кеша, и после каждого деплоя
        // устройства продолжали жить на прошлой сборке: на компьютере, на
        // iPhone и на рации это лечилось только ручной чисткой. Со сборками
        // такой проблемы нет — у них хеш в имени, — а вот сама страница
        // ссылается на эти имена, поэтому устаревала именно она.
        //
        // Теперь страница берётся из сети, а кеш служит запасом: при
        // отсутствии связи или медленном ответе отдаётся последняя удачная
        // копия. Для рации это даже лучше: без сети приложение всё равно
        // бесполезно, зато обновления доезжают сами.
        runtimeCaching: [
          {
            urlPattern: ({ request, url }: { request: Request; url: URL }) =>
              request.mode === 'navigate' && !url.pathname.startsWith('/downloads/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-shell',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 10 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    ...(useDevHttps ? { https: {} } : {}),
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3000', ws: true, changeOrigin: true },
    },
  },
});
