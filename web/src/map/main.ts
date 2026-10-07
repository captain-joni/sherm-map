import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import '../styles/app.css';
import L from './leaflet.ts';
import 'leaflet.markercluster';
import { CloudUpload, Info, Plus } from 'lucide';
import { registerSW } from 'virtual:pwa-register';
import type { MapSherm } from '@sherm/shared';
import { api, ApiError } from '../lib/api.ts';
import { h, icon, storage, toast } from '../lib/dom.ts';
import { processQueue, queued } from '../lib/queue.ts';
import { openAddFlow } from './add.ts';
import { renderDetail } from './detail.ts';
import { openInfo } from './info.ts';
import { createLocateButton } from './locate.ts';
import { createSearch } from './search.ts';
import { createSheet } from './sheet.ts';
import { errorMessage, t, tn } from '../lib/i18n.ts';

const DEFAULT_VIEW = { lat: 49.41, lng: 8.69, zoom: 6 };
const saved = storage.get('view', DEFAULT_VIEW);

// Karte
document.getElementById('map')!.setAttribute('aria-label', t('map.label'));
const map = L.map('map', { zoomControl: false, worldCopyJump: true, minZoom: 2 })
  .setView([saved.lat, saved.lng], saved.zoom);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  crossOrigin: true, // CORS statt opaker Antworten, damit der Service Worker Kacheln sinnvoll cachen kann
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
map.on('moveend', () => {
  const c = map.getCenter();
  storage.set('view', { lat: c.lat, lng: c.lng, zoom: map.getZoom() });
});

const pinIcon = L.divIcon({
  className: 'pin',
  html: '<svg viewBox="0 0 24 32" width="30" height="40" aria-hidden="true"><path d="M12 31s10-9.3 10-18A10 10 0 0 0 2 13c0 8.7 10 18 10 18z"/><circle cx="12" cy="12.5" r="4"/></svg>',
  iconSize: [30, 40],
  iconAnchor: [15, 39],
});

const clusters = L.markerClusterGroup({
  showCoverageOnHover: false,
  maxClusterRadius: 55,
  spiderfyOnMaxZoom: true,
  chunkedLoading: true,
  iconCreateFunction: cluster => {
    const n = cluster.getChildCount();
    const size = n < 10 ? 40 : n < 100 ? 48 : 56;
    return L.divIcon({ className: 'cluster', html: `<span>${n}</span>`, iconSize: [size, size] });
  },
});
map.addLayer(clusters);

let sherms: MapSherm[] = [];
const markers = new Map<number, L.Marker>();

async function loadSherms() {
  try {
    sherms = await api.sherms();
  } catch (err) {
    toast(err instanceof ApiError && err.status === 0 ? t('map.loadFailedOffline') : t('map.loadFailed'));
    return;
  }
  clusters.clearLayers();
  markers.clear();
  const list = sherms.map(s => {
    const marker = L.marker([s.lat, s.lng], { icon: pinIcon, title: s.title, alt: s.title });
    marker.on('click', () => navigate(`/s/${s.id}`));
    markers.set(s.id, marker);
    return marker;
  });
  clusters.addLayers(list);
}

// Detail-Sheet
const sheet = createSheet(() => {
  if (location.pathname.startsWith('/s/')) navigate('/', true);
});

async function showSherm(id: number) {
  sheet.open(h('div', { class: 'detail-loading' }, t('common.loading')));
  try {
    const sherm = await api.sherm(id);
    sheet.open(renderDetail(sherm), sheet.state() === 'full' ? 'full' : 'half');
    document.title = `${sherm.title} – Sherm Map`;
    // Sherm so zeigen, dass er nicht unter dem Sheet verschwindet
    const marker = markers.get(id);
    const target = L.latLng(sherm.lat, sherm.lng);
    const zoom = Math.max(map.getZoom(), 15);
    const point = map.project(target, zoom).add([0, window.innerWidth < 900 ? window.innerHeight * 0.22 : 0]);
    map.setView(map.unproject(point, zoom), zoom);
    if (marker) clusters.zoomToShowLayer(marker, () => {});
  } catch (err) {
    sheet.close();
    toast(err instanceof ApiError && err.status === 404 ? t('sherm.notFound') : t('sherm.loadFailed'));
  }
}

// Kleine Router-Logik über die URL: /s/123 = Sherm, /neu = eintragen, /info = Infos
let addFlow: { close: () => void } | null = null;

function navigate(path: string, replace = false) {
  if (location.pathname === path) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', path);
  route();
}

function route() {
  const path = location.pathname;
  const shermMatch = path.match(/^\/s\/(\d+)$/);

  if (path !== '/neu' && addFlow) {
    const flow = addFlow;
    addFlow = null;
    flow.close();
  }
  if (shermMatch) {
    void showSherm(Number(shermMatch[1]));
    return;
  }
  document.title = 'Sherm Map';
  if (sheet.state() !== 'closed') sheet.close();
  if (path === '/neu' && !addFlow) {
    addFlow = openAddFlow({
      center: map.getCenter(),
      zoom: map.getZoom(),
      onClose: () => {
        addFlow = null;
        if (location.pathname === '/neu') history.back();
      },
      onQueueChanged: () => void updateQueueChip(),
    });
  }
  if (path === '/info' || path === '/datenschutz') openInfo(() => navigate('/', true));
}
window.addEventListener('popstate', route);

// Bedienelemente
const queueChip = h('button', { class: 'queue-chip', type: 'button', hidden: true }, icon(CloudUpload, 18), h('span'));
queueChip.addEventListener('click', async () => {
  const items = await queued();
  const failed = items.filter(i => i.status === 'failed');
  if (failed.length) {
    toast(t('queue.rejected', { error: errorMessage(failed[0]!.error_code ?? undefined, failed[0]!.error ?? '?') }));
    return;
  }
  const { sent } = await processQueue().catch(() => ({ sent: 0 }));
  toast(sent ? t('queue.uploaded') : t('queue.stillOffline'));
  void updateQueueChip();
});

async function updateQueueChip() {
  const items = await queued().catch(() => []);
  queueChip.hidden = items.length === 0;
  const failed = items.filter(i => i.status === 'failed').length;
  queueChip.classList.toggle('failed', failed > 0);
  queueChip.lastElementChild!.textContent = failed ? tn('queue.failed', failed) : tn('queue.waiting', items.length);
}

const ui = document.getElementById('app')!;
ui.append(
  h('div', { class: 'top-bar' },
    h('button', { class: 'brand', type: 'button', onclick: () => navigate('/info') }, h('img', { src: '/icons/icon.svg', alt: '' }), 'Sherm Map'),
    createSearch({
      sherms: () => sherms,
      onSherm: s => navigate(`/s/${s.id}`),
      onPlace: p => map.setView([p.lat, p.lng], 14),
    })),
  queueChip,
  h('div', { class: 'fabs' },
    createLocateButton(map, () => sherms),
    h('button', { class: 'fab fab-primary', type: 'button', onclick: () => navigate('/neu') }, icon(Plus, 26), h('span', {}, t('map.add')))),
  h('button', { class: 'info-button', type: 'button', 'aria-label': t('map.info'), onclick: () => navigate('/info') }, icon(Info, 18)),
  sheet.element,
);
map.on('click', () => {
  if (sheet.state() !== 'closed') sheet.close();
});

// Warteschlange abarbeiten, sobald wieder Netz da ist (und Nachrichten vom Service Worker)
window.addEventListener('online', () => void processQueue().then(updateQueueChip).catch(() => {}));
navigator.serviceWorker?.addEventListener('message', e => {
  if (e.data?.type === 'queue-updated') void updateQueueChip();
});

// Neue App-Version: nachfragen statt mitten im Eintragen neu zu laden
const updateSW = registerSW({
  onNeedRefresh() {
    toast(t('map.update'), { label: t('map.reload'), onClick: () => void updateSW(true) });
  },
});

void loadSherms().then(route);
void processQueue().catch(() => {}).finally(() => void updateQueueChip());
