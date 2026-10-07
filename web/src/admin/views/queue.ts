// Prüf-Warteschlange: ein Sherm nach dem anderen, älteste zuerst.
// Tastatur: A = freigeben, R = ablehnen, E = bearbeiten, S = überspringen. Am Handy: Foto nach rechts/links wischen.
import { Check, ExternalLink, Pencil, SkipForward, X } from 'lucide';
import type { AdminSherm } from '@sherm/shared';
import { h, icon, toast } from '../../lib/dom.ts';
import { formatDistance, relativeTime } from '../../lib/format.ts';
import { adminApi, ApiError, type ShermDetail } from '../api.ts';
import { createMiniMap } from '../components/mini-map.ts';
import type { View } from '../context.ts';
import { askDialog, emptyState, formatDate, osmLink, REASON_LABELS, REJECT_PRESETS } from '../ui.ts';

const SWIPE_THRESHOLD = 120;

export const queueView: View = (container, ctx) => {
  const counter = h('span', { class: 'muted' });
  const body = h('div', { class: 'queue' });
  container.append(h('header', { class: 'view-header' }, h('h1', {}, 'Prüfen'), counter), body);

  let ids: number[] = [];
  let current: ShermDetail | null = null;
  let destroyMap: (() => void) | null = null;
  let busy = false;
  const skipped = new Set<number>();

  async function loadIds() {
    const page = await adminApi.sherms({ status: 'pending', sort: 'oldest', page_size: 200 });
    // Übersprungene ans Ende
    ids = [...page.items.map(s => s.id).filter(id => !skipped.has(id)), ...page.items.map(s => s.id).filter(id => skipped.has(id))];
    counter.textContent = page.total ? `noch ${page.total}` : '';
  }

  async function next() {
    destroyMap?.();
    destroyMap = null;
    if (!ids.length) await loadIds();
    const id = ids.shift();
    if (id === undefined) {
      current = null;
      body.replaceChildren(emptyState('Alles geprüft. Danke!'));
      counter.textContent = '';
      return;
    }
    body.replaceChildren(h('p', { class: 'muted' }, 'Lädt …'));
    try {
      current = await adminApi.sherm(id);
      if (current.sherm.status !== 'pending' || current.sherm.deleted_at) return next(); // inzwischen von jemand anderem geprüft
      renderCard(current);
    } catch {
      return next();
    }
  }

  function renderCard(d: ShermDetail) {
    const s = d.sherm;
    const photo = s.photos[0];
    const photoEl = photo
      ? h('div', { class: 'queue-photo' },
        h('img', { src: photo.urls.display, alt: s.title, draggable: 'false' }),
        h('div', { class: 'swipe-hint swipe-approve' }, icon(Check, 48)),
        h('div', { class: 'swipe-hint swipe-reject' }, icon(X, 48)))
      : h('div', { class: 'queue-photo queue-nophoto' }, 'Kein Foto');

    const map = createMiniMap({ lat: s.lat, lng: s.lng, nearby: d.nearby, zoom: 17 });
    destroyMap = map.destroy;

    const near = d.nearby.filter(n => n.status === 'approved');
    const info = h('div', { class: 'queue-info' },
      h('h2', {}, s.title),
      h('p', { class: 'muted' }, `eingesendet ${relativeTime(s.created_at)} · ${formatDate(s.created_at)}`),
      s.description ? h('p', { class: 'pre' }, s.description) : h('p', { class: 'muted' }, 'Keine Beschreibung'),
      map.element,
      h('p', { class: 'queue-coords' },
        `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`, s.country_name ? ` · ${s.country_name}` : '',
        ' · ', h('a', { href: osmLink(s.lat, s.lng), target: '_blank', rel: 'noopener' }, 'In OSM öffnen ', icon(ExternalLink, 14))),
      near.length
        ? h('p', { class: 'note' }, `${near.length} freigegebene${near.length === 1 ? 'r' : ''} Sherm${near.length === 1 ? '' : 's'} in der Nähe, nächster ${formatDistance(near[0]!.distance_m)} entfernt (blaue Pins)`)
        : null,
      d.same_source.length
        ? h('details', { class: 'note' },
          h('summary', {}, `${d.same_source.length} weitere Einsendung${d.same_source.length === 1 ? '' : 'en'} von derselben Quelle`),
          h('ul', {}, ...d.same_source.map(o => h('li', {}, h('a', { href: `/admin/sherms/${o.id}` }, o.title), ` (${o.status})`))))
        : null,
      d.reports.length
        ? h('p', { class: 'note note-warn' }, `Gemeldet: ${d.reports.map(r => REASON_LABELS[r.reason] ?? r.reason).join(', ')}`)
        : null);

    const actions = h('div', { class: 'queue-actions' },
      h('button', { class: 'button danger', type: 'button', onclick: () => reject() }, icon(X, 20), h('span', {}, 'Ablehnen'), h('kbd', {}, 'R')),
      h('button', { class: 'button', type: 'button', onclick: () => ctx.navigate(`/admin/sherms/${s.id}?from=queue`) }, icon(Pencil, 20), h('span', {}, 'Bearbeiten'), h('kbd', {}, 'E')),
      h('button', { class: 'button', type: 'button', onclick: () => skip() }, icon(SkipForward, 20), h('span', {}, 'Später'), h('kbd', {}, 'S')),
      h('button', { class: 'button success', type: 'button', onclick: () => approve() }, icon(Check, 20), h('span', {}, 'Freigeben'), h('kbd', {}, 'A')));

    body.replaceChildren(h('article', { class: 'queue-card' }, photoEl, info), actions);
    if (photo) enableSwipe(photoEl);
  }

  // Wischen auf dem Foto: rechts = freigeben, links = ablehnen
  function enableSwipe(el: HTMLElement) {
    let startX = 0;
    let dx = 0;
    let active = false;
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') return;
      active = true;
      startX = e.clientX;
      dx = 0;
      el.setPointerCapture(e.pointerId);
      el.style.transition = 'none';
    });
    el.addEventListener('pointermove', e => {
      if (!active) return;
      dx = e.clientX - startX;
      el.style.transform = `translateX(${dx}px) rotate(${dx / 30}deg)`;
      el.dataset.swipe = dx > SWIPE_THRESHOLD ? 'approve' : dx < -SWIPE_THRESHOLD ? 'reject' : '';
    });
    const end = () => {
      if (!active) return;
      active = false;
      el.style.transition = '';
      el.style.transform = '';
      el.dataset.swipe = '';
      if (dx > SWIPE_THRESHOLD) void approve();
      else if (dx < -SWIPE_THRESHOLD) void reject();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  async function act(action: 'approve' | 'reject', reason?: string) {
    if (!current || busy) return;
    busy = true;
    const s: AdminSherm = current.sherm;
    try {
      await adminApi.action(s.id, action, reason);
      toast(action === 'approve' ? `„${s.title}“ freigegeben` : `„${s.title}“ abgelehnt`, {
        label: 'Rückgängig',
        onClick: async () => {
          await adminApi.action(s.id, 'reopen').catch(() => toast('Rückgängig ging nicht'));
          ids.unshift(s.id);
          void ctx.refreshBadges();
          void next();
        },
      });
      void ctx.refreshBadges();
      counter.textContent = ids.length ? `noch ${ids.length}` : '';
      await next();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Hat nicht geklappt');
    } finally {
      busy = false;
    }
  }

  const approve = () => act('approve');
  async function reject() {
    if (!current) return;
    const reason = await askDialog({
      title: 'Ablehnen', confirm: 'Ablehnen', danger: true,
      input: { label: 'Grund (sieht nur das Team)', required: true, presets: REJECT_PRESETS },
    });
    if (reason) await act('reject', reason);
  }
  function skip() {
    if (!current) return;
    skipped.add(current.sherm.id);
    ids.push(current.sherm.id);
    void next();
  }

  const onKey = (e: KeyboardEvent) => {
    if (!current || document.querySelector('dialog[open]') || (e.target as HTMLElement).closest('input, textarea')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'a') void approve();
    else if (key === 'r') void reject();
    else if (key === 's') skip();
    else if (key === 'e') ctx.navigate(`/admin/sherms/${current.sherm.id}?from=queue`);
  };
  document.addEventListener('keydown', onKey);

  loadIds().then(next).catch(err => {
    body.replaceChildren(h('p', { class: 'form-error' }, err instanceof ApiError ? err.message : 'Laden fehlgeschlagen'));
  });

  return () => {
    document.removeEventListener('keydown', onKey);
    destroyMap?.();
  };
};
