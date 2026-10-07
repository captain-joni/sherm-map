// Alle Sherms: Suche, Filter (stehen in der URL), Sammelaktionen, Liste oder Karte
import L from '../../map/leaflet.ts';
import 'leaflet.markercluster';
import { List, Map as MapIcon, Search } from 'lucide';
import { SHERM_STATUSES } from '@sherm/shared/constants';
import type { AdminSherm, ShermAction } from '@sherm/shared';
import { h, icon, replace, toast } from '../../lib/dom.ts';
import { relativeTime } from '../../lib/format.ts';
import { adminApi, ApiError } from '../api.ts';
import type { View } from '../context.ts';
import { askDialog, emptyState, formatNumber, REJECT_PRESETS, STATUS_LABELS, statusBadge } from '../ui.ts';

const PAGE_SIZE = 50;

export const shermsView: View = (container, ctx) => {
  const params = new URLSearchParams(location.search);
  const filters = {
    q: params.get('q') ?? '',
    status: params.get('status') ?? '',
    country: params.get('country') ?? '',
    sort: params.get('sort') ?? 'newest',
    special: params.get('reported') ? 'reported' : params.get('probably_gone') ? 'probably_gone' : params.get('deleted') ? 'deleted' : params.get('has_photo') === 'false' ? 'no_photo' : '',
    view: params.get('view') === 'map' ? 'map' : 'list',
  };

  const q = h('input', { type: 'search', value: filters.q, placeholder: 'Titel, Beschreibung, Ort oder #ID', 'aria-label': 'Suche' });
  const status = select('Status', filters.status, [['', 'Alle Status'], ...SHERM_STATUSES.map(s => [s, STATUS_LABELS[s]] as [string, string])]);
  const special = select('Filter', filters.special, [['', 'Keine Extras'], ['reported', 'Mit offenen Meldungen'], ['probably_gone', 'Wahrscheinlich weg'], ['no_photo', 'Ohne Foto'], ['deleted', 'Papierkorb']]);
  const country = select('Land', filters.country, [['', 'Alle Länder']]);
  const sort = select('Sortierung', filters.sort, [['newest', 'Neueste zuerst'], ['oldest', 'Älteste zuerst'], ['likes', 'Meiste Likes'], ['reports', 'Meiste Meldungen']]);
  const viewToggle = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Ansicht' },
    h('button', { type: 'button', 'aria-pressed': String(filters.view === 'list'), onclick: () => setView('list') }, icon(List, 18), 'Liste'),
    h('button', { type: 'button', 'aria-pressed': String(filters.view === 'map'), onclick: () => setView('map') }, icon(MapIcon, 18), 'Karte'));

  const summary = h('p', { class: 'muted small' });
  const results = h('div', { class: 'results' });
  const more = h('button', { class: 'button wide', type: 'button', hidden: true }, 'Mehr laden');
  const bulkBar = h('div', { class: 'bulk-bar', hidden: true });

  container.append(
    h('header', { class: 'view-header' }, h('h1', {}, 'Sherms'), viewToggle),
    h('form', { class: 'filters', role: 'search', onsubmit: (e: Event) => { e.preventDefault(); apply(); } },
      h('div', { class: 'search-field' }, icon(Search, 18), q), status, special, country, sort),
    summary, bulkBar, results, more);

  for (const el of [status, special, country, sort]) el.addEventListener('change', apply);
  let qTimer: number | undefined;
  q.addEventListener('input', () => { window.clearTimeout(qTimer); qTimer = window.setTimeout(apply, 300); });

  // Länderliste aus den Kennzahlen (nur Länder, in denen es Sherms gibt)
  adminApi.metrics().then(m => {
    for (const c of m.countries.top.length ? m.countries.top : []) country.append(h('option', { value: c.code }, c.name ?? c.code));
    country.value = filters.country;
  }).catch(() => {});

  let items: AdminSherm[] = [];
  let page = 1;
  let total = 0;
  const selected = new Set<number>();
  let map: L.Map | null = null;

  function query(p: number) {
    const s = special.value;
    return {
      q: q.value.trim() || undefined,
      status: status.value || undefined,
      country: country.value || undefined,
      sort: sort.value,
      reported: s === 'reported' || undefined,
      probably_gone: s === 'probably_gone' || undefined,
      deleted: s === 'deleted' || undefined,
      has_photo: s === 'no_photo' ? false : undefined,
      page: p,
      page_size: filters.view === 'map' ? 200 : PAGE_SIZE,
    };
  }

  function apply() {
    // Filter in die URL, damit "Zurück" und Links funktionieren
    const p = new URLSearchParams();
    const qq = query(1);
    for (const [k, v] of Object.entries(qq)) if (v !== undefined && k !== 'page' && k !== 'page_size' && !(k === 'sort' && v === 'newest')) p.set(k, String(v));
    if (filters.view === 'map') p.set('view', 'map');
    history.replaceState(null, '', `/admin/sherms${p.size ? `?${p}` : ''}`);
    selected.clear();
    void load(1);
  }

  function setView(v: 'list' | 'map') {
    filters.view = v;
    for (const b of viewToggle.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.textContent === (v === 'list' ? 'Liste' : 'Karte')));
    apply();
  }

  async function load(p: number) {
    try {
      const res = await adminApi.sherms(query(p));
      page = p;
      total = res.total;
      items = p === 1 ? res.items : [...items, ...res.items];
      render();
    } catch (err) {
      results.replaceChildren(h('p', { class: 'form-error' }, err instanceof ApiError ? err.message : 'Laden fehlgeschlagen'));
    }
  }

  function render() {
    summary.textContent = `${formatNumber(total)} Sherm${total === 1 ? '' : 's'}${filters.view === 'map' && total > items.length ? `, Karte zeigt die ersten ${items.length}` : ''}`;
    more.hidden = filters.view === 'map' || items.length >= total;
    renderBulkBar();
    map?.remove();
    map = null;
    if (!items.length) {
      results.replaceChildren(emptyState('Keine Sherms gefunden'));
      return;
    }
    if (filters.view === 'map') return renderMap();
    results.replaceChildren(h('ul', { class: 'sherm-list' }, ...items.map(row)));
  }

  function row(s: AdminSherm): HTMLElement {
    const thumb = s.photos[0]?.urls.thumb;
    const check = h('input', { type: 'checkbox', 'aria-label': `${s.title} auswählen`, checked: selected.has(s.id) });
    check.addEventListener('change', () => {
      if (check.checked) selected.add(s.id); else selected.delete(s.id);
      renderBulkBar();
    });
    return h('li', { class: 'sherm-row' },
      h('label', { class: 'row-check' }, check),
      thumb ? h('img', { src: thumb, alt: '', loading: 'lazy' }) : h('span', { class: 'row-nothumb' }),
      h('a', { class: 'row-main', href: `/admin/sherms/${s.id}` },
        h('strong', {}, s.title),
        h('span', { class: 'muted small' }, [`#${s.id}`, s.country_code, relativeTime(s.created_at)].filter(Boolean).join(' · '))),
      h('span', { class: 'row-meta' },
        statusBadge(s.status, !!s.deleted_at),
        s.open_reports ? h('span', { class: 'status status-rejected' }, `${s.open_reports} Meldung${s.open_reports === 1 ? '' : 'en'}`) : null,
        s.like_count ? h('span', { class: 'muted small' }, `${s.like_count} ♥`) : null));
  }

  function renderMap() {
    const el = h('div', { class: 'list-map' });
    results.replaceChildren(el);
    map = L.map(el).setView([50, 10], 5);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, crossOrigin: true, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    }).addTo(map);
    const cluster = L.markerClusterGroup({ showCoverageOnHover: false });
    for (const s of items) {
      const link = h('a', { href: `/admin/sherms/${s.id}` }, s.title);
      cluster.addLayer(L.marker([s.lat, s.lng], { title: s.title, icon: L.divIcon({ className: `admin-dot status-${s.status}`, iconSize: [16, 16] }) })
        .bindPopup(h('div', {}, link, h('br'), STATUS_LABELS[s.status])));
    }
    map.addLayer(cluster);
    map.fitBounds(cluster.getBounds(), { padding: [30, 30], maxZoom: 15 });
  }

  function renderBulkBar() {
    bulkBar.hidden = selected.size === 0;
    if (!selected.size) return;
    const isAdmin = ctx.user.role === 'admin';
    const deleted = special.value === 'deleted';
    const btn = (action: ShermAction, label: string, cls = '') =>
      h('button', { class: `button ${cls}`, type: 'button', onclick: () => bulk(action) }, label);
    replace(bulkBar,
      h('strong', {}, `${selected.size} ausgewählt`),
      ...(deleted
        ? [isAdmin && btn('restore', 'Wiederherstellen', 'primary')]
        : [btn('approve', 'Freigeben', 'success'), btn('reject', 'Ablehnen'), btn('hide', 'Verstecken'), isAdmin && btn('delete', 'Papierkorb', 'danger')]),
      h('button', { class: 'button ghost', type: 'button', onclick: () => { selected.clear(); render(); } }, 'Auswahl aufheben'));
  }

  async function bulk(action: ShermAction) {
    let reason: string | undefined;
    if (action === 'reject') {
      const r = await askDialog({ title: `${selected.size} ablehnen`, confirm: 'Ablehnen', danger: true, input: { label: 'Grund', required: true, presets: REJECT_PRESETS } });
      if (r === null) return;
      reason = r;
    } else if (action === 'delete') {
      if ((await askDialog({ title: `${selected.size} in den Papierkorb?`, confirm: 'In den Papierkorb', danger: true })) === null) return;
    }
    try {
      const res = await adminApi.bulk([...selected], action, reason);
      toast(`${res.updated} geändert`);
      selected.clear();
      void ctx.refreshBadges();
      await load(1);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Hat nicht geklappt');
    }
  }

  more.addEventListener('click', () => load(page + 1));
  void load(1);
  return () => map?.remove();
};

function select(label: string, value: string, options: [string, string][]): HTMLSelectElement {
  const el = h('select', { 'aria-label': label }, ...options.map(([v, l]) => h('option', { value: v }, l)));
  el.value = value;
  return el;
}
