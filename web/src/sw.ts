/// <reference lib="webworker" />
// Service Worker: App-Shell offline, Kacheln/Fotos/Sherms gecacht, Warteschlange per Background Sync
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { processQueue, SYNC_TAG } from './lib/queue.ts';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Seitenaufrufe: Admin-App bzw. Karten-App aus dem Cache (funktioniert offline)
registerRoute(new NavigationRoute(createHandlerBoundToURL('/admin/index.html'), { allowlist: [/^\/admin/] }));
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/media\//, /^\/admin/] }));

const DAY = 24 * 60 * 60;
const ok = new CacheableResponsePlugin({ statuses: [200] });

// Kartenkacheln: lange cachen, schont auch die OSM-Server
registerRoute(
  ({ url }) => url.hostname === 'tile.openstreetmap.org',
  new CacheFirst({ cacheName: 'tiles', plugins: [ok, new ExpirationPlugin({ maxEntries: 2000, maxAgeSeconds: 30 * DAY, purgeOnQuotaError: true })] }),
);

// Liste aller Sherms: sofort aus dem Cache, im Hintergrund aktualisieren
registerRoute(
  ({ url }) => url.pathname === '/api/sherms',
  new StaleWhileRevalidate({ cacheName: 'sherms', plugins: [ok] }),
);

// Details und Fotos: online immer frisch (versteckte Sherms verschwinden sofort), offline aus dem Cache
registerRoute(
  ({ url }) => /^\/api\/sherms\/\d+$/.test(url.pathname),
  new NetworkFirst({ cacheName: 'sherm-details', networkTimeoutSeconds: 4, plugins: [ok, new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * DAY })] }),
);
registerRoute(
  ({ url }) => url.pathname.startsWith('/media/'),
  new NetworkFirst({ cacheName: 'photos', networkTimeoutSeconds: 4, plugins: [ok, new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 7 * DAY, purgeOnQuotaError: true })] }),
);

// Background Sync: wartende Sherms senden, auch wenn die App gerade nicht offen ist (Chrome/Android)
self.addEventListener('sync', (event: Event) => {
  const e = event as ExtendableEvent & { tag: string };
  if (e.tag !== SYNC_TAG) return;
  e.waitUntil(processQueue().then(async () => {
    for (const client of await self.clients.matchAll()) client.postMessage({ type: 'queue-updated' });
  }));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
