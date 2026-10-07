// Ein Sherm im Detail: bearbeiten (Text, Ort, Foto), Status ändern, Meldungen, Verlauf
import { ArchiveRestore, Check, ChevronLeft, Download, ExternalLink, EyeOff, Pencil, RotateCcw, Star, Trash, Undo2, X } from 'lucide';
import { LIMITS } from '@sherm/shared/constants';
import type { AdminPhoto, AdminSherm, ShermAction } from '@sherm/shared';
import { h, icon, replace, toast } from '../../lib/dom.ts';
import { adminApi, ApiError, type ShermDetail } from '../api.ts';
import { createMiniMap } from '../components/mini-map.ts';
import { openPhotoEditor } from '../components/photo-editor.ts';
import type { View } from '../context.ts';
import { ACTION_LABELS, askDialog, formatDate, osmLink, REASON_LABELS, REJECT_PRESETS, statusBadge } from '../ui.ts';

export const shermDetailView: View = (container, ctx, params) => {
  const id = Number(params.id);
  const fromQueue = new URLSearchParams(location.search).get('from') === 'queue';
  let destroyMap: (() => void) | null = null;

  async function load() {
    destroyMap?.();
    try {
      render(await adminApi.sherm(id));
    } catch (err) {
      container.replaceChildren(h('p', { class: 'form-error' }, err instanceof ApiError && err.status === 404 ? 'Sherm nicht gefunden' : 'Laden fehlgeschlagen'));
    }
  }

  function render(d: ShermDetail) {
    const s = d.sherm;
    const back = fromQueue
      ? h('a', { class: 'back-link', href: '/admin/pruefen' }, icon(ChevronLeft, 18), 'Zurück zur Prüfung')
      : h('a', { class: 'back-link', href: '/admin/sherms' }, icon(ChevronLeft, 18), 'Alle Sherms');

    container.replaceChildren(
      back,
      h('header', { class: 'view-header' }, h('h1', {}, s.title), statusBadge(s.status, !!s.deleted_at)),
      statusBar(s),
      h('div', { class: 'detail-grid' },
        h('div', {}, photoSection(s), editForm(s)),
        h('div', {}, locationSection(s, d), reportsSection(s, d), sourceSection(d), historySection(d))));
  }

  function statusBar(s: AdminSherm): HTMLElement {
    const isAdmin = ctx.user.role === 'admin';
    const btn = (action: ShermAction, label: string, ic: Parameters<typeof icon>[0], cls = '') =>
      h('button', { class: `button ${cls}`, type: 'button', onclick: () => runAction(s, action) }, icon(ic, 18), label);
    const buttons: HTMLElement[] = [];
    if (s.deleted_at) {
      if (isAdmin) buttons.push(btn('restore', 'Wiederherstellen', ArchiveRestore, 'primary'));
    } else {
      if (s.status !== 'approved') buttons.push(btn('approve', 'Freigeben', Check, 'success'));
      if (s.status === 'pending') buttons.push(btn('reject', 'Ablehnen', X, 'danger'));
      if (s.status === 'approved') buttons.push(btn('hide', 'Verstecken', EyeOff));
      if (s.status !== 'pending') buttons.push(btn('reopen', 'Zurück in die Prüfung', Undo2));
      if (isAdmin) buttons.push(btn('delete', 'Papierkorb', Trash, 'ghost-danger'));
    }
    const facts = [
      s.reviewed_by ? `geprüft von ${s.reviewed_by} am ${formatDate(s.reviewed_at!)}` : null,
      s.reject_reason ? `Grund: ${s.reject_reason}` : null,
      s.deleted_at ? `im Papierkorb seit ${formatDate(s.deleted_at)} (wird nach 30 Tagen endgültig gelöscht)` : null,
      `${s.like_count} ♥ · ${s.still_there_count} noch da · ${s.gone_count} weg`,
    ].filter(Boolean).join(' · ');
    return h('section', { class: 'status-bar' }, h('div', { class: 'button-row' }, ...buttons), h('p', { class: 'muted small' }, facts));
  }

  async function runAction(s: AdminSherm, action: ShermAction) {
    let reason: string | undefined;
    if (action === 'reject' || action === 'hide') {
      const r = await askDialog({
        title: action === 'reject' ? 'Ablehnen' : 'Verstecken', confirm: action === 'reject' ? 'Ablehnen' : 'Verstecken', danger: true,
        input: { label: 'Grund (sieht nur das Team)', required: action === 'reject', presets: REJECT_PRESETS },
      });
      if (r === null) return;
      reason = r || undefined;
    }
    if (action === 'delete') {
      const ok = await askDialog({
        title: 'In den Papierkorb?', confirm: 'In den Papierkorb', danger: true,
        text: 'Der Sherm verschwindet sofort und wird nach 30 Tagen endgültig gelöscht. Bis dahin lässt er sich wiederherstellen.',
      });
      if (ok === null) return;
    }
    try {
      await adminApi.action(s.id, action, reason);
      toast(`${ACTION_LABELS[action] ?? action}`);
      void ctx.refreshBadges();
      if (fromQueue && (action === 'approve' || action === 'reject')) ctx.navigate('/admin/pruefen');
      else await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Hat nicht geklappt');
    }
  }

  function photoSection(s: AdminSherm): HTMLElement {
    const photo = s.photos[0];
    if (!photo) return h('section', { class: 'card' }, h('h2', {}, 'Foto'), h('p', { class: 'muted' }, 'Kein Foto'));
    const section = h('section', { class: 'card' });
    const renderPhoto = (p: AdminPhoto) => {
      const star = h('button', { class: `chip ${p.starred ? 'active' : ''}`, type: 'button', 'aria-pressed': String(p.starred) }, icon(Star, 18), p.starred ? 'Markiert' : 'Markieren');
      star.addEventListener('click', async () => {
        await adminApi.star(p.id, !p.starred);
        renderPhoto({ ...p, starred: !p.starred });
      });
      replace(section,
        h('h2', {}, 'Foto'),
        h('a', { href: p.urls.display, target: '_blank', rel: 'noopener' }, h('img', { class: 'detail-img', src: p.urls.display, alt: s.title })),
        p.edited ? h('p', { class: 'note' }, 'Bearbeitet. Das unbearbeitete Original wird bei der Freigabe gelöscht.') : null,
        h('div', { class: 'button-row' },
          h('button', { class: 'chip', type: 'button', onclick: () => openPhotoEditor(p, updated => renderPhoto(updated)) }, icon(Pencil, 18), 'Bearbeiten'),
          p.edited ? h('button', { class: 'chip', type: 'button', onclick: async () => renderPhoto(await adminApi.revertImage(p.id)) }, icon(RotateCcw, 18), 'Bearbeitung zurücknehmen') : null,
          star,
          h('a', { class: 'chip', href: `${p.urls.original.split('?')[0]}?download` }, icon(Download, 18), 'Original')));
    };
    renderPhoto(photo);
    return section;
  }

  function editForm(s: AdminSherm): HTMLElement {
    const title = h('input', { value: s.title, maxlength: LIMITS.titleMax, required: true });
    const description = h('textarea', { rows: 4, maxlength: LIMITS.descriptionMax });
    description.value = s.description ?? '';
    const place = h('input', { value: s.place_name ?? '', maxlength: LIMITS.placeNameMax, placeholder: 'z.B. Heidelberg Altstadt' });
    const save = h('button', { class: 'button primary', type: 'submit' }, 'Speichern');
    const form = h('form', { class: 'card form' },
      h('h2', {}, 'Text'),
      h('label', { class: 'field' }, h('span', {}, 'Titel'), title),
      h('label', { class: 'field' }, h('span', {}, 'Beschreibung'), description),
      h('label', { class: 'field' }, h('span', {}, 'Ortsname (optional)'), place),
      h('div', { class: 'button-row' }, save));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      try {
        await adminApi.edit(s.id, { title: title.value, description: description.value, place_name: place.value });
        toast('Gespeichert');
        await load();
      } catch (err) {
        toast(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen');
      }
    });
    return form;
  }

  function locationSection(s: AdminSherm, d: ShermDetail): HTMLElement {
    let moved: { lat: number; lng: number } | null = null;
    const saveButton = h('button', { class: 'button primary', type: 'button', hidden: true }, 'Neuen Ort speichern');
    const coords = h('p', { class: 'muted small' });
    const showCoords = (lat: number, lng: number) => { coords.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}${s.country_name ? ` · ${s.country_name}` : ''}`; };
    showCoords(s.lat, s.lng);
    const map = createMiniMap({
      lat: s.lat, lng: s.lng, nearby: d.nearby, draggable: !s.deleted_at,
      onMove: (lat, lng) => {
        moved = { lat, lng };
        showCoords(lat, lng);
        saveButton.hidden = false;
      },
    });
    destroyMap = map.destroy;
    saveButton.addEventListener('click', async () => {
      if (!moved) return;
      try {
        await adminApi.edit(s.id, moved);
        toast('Ort gespeichert');
        await load();
      } catch (err) {
        toast(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen');
      }
    });
    return h('section', { class: 'card' },
      h('h2', {}, 'Ort'),
      h('p', { class: 'muted small' }, 'Roten Pin ziehen, um den Ort zu korrigieren. Blau: andere Sherms in der Nähe.'),
      map.element, coords,
      h('div', { class: 'button-row' }, saveButton,
        h('a', { class: 'chip', href: osmLink(s.lat, s.lng), target: '_blank', rel: 'noopener' }, icon(ExternalLink, 16), 'OpenStreetMap')),
      d.nearby.length
        ? h('ul', { class: 'compact-list' }, ...d.nearby.slice(0, 5).map(n =>
          h('li', {}, h('a', { href: `/admin/sherms/${n.id}` }, n.title), h('span', { class: 'muted' }, ` ${n.distance_m} m · ${n.status}`))))
        : null);
  }

  function reportsSection(s: AdminSherm, d: ShermDetail): HTMLElement | null {
    if (!d.reports.length) return null;
    const open = d.reports.filter(r => r.status === 'open');
    const resolve = async (status: 'resolved' | 'dismissed') => {
      await adminApi.resolveAll(s.id, status);
      void ctx.refreshBadges();
      await load();
    };
    return h('section', { class: 'card' },
      h('h2', {}, `Meldungen (${open.length} offen)`),
      h('ul', { class: 'compact-list' }, ...d.reports.map(r =>
        h('li', {}, h('strong', {}, REASON_LABELS[r.reason] ?? r.reason), r.comment ? `: ${r.comment}` : '',
          h('span', { class: 'muted' }, ` · ${formatDate(r.created_at)} · ${r.status === 'open' ? 'offen' : r.status === 'resolved' ? 'erledigt' : 'ignoriert'}`)))),
      open.length
        ? h('div', { class: 'button-row' },
          h('button', { class: 'button', type: 'button', onclick: () => resolve('resolved') }, 'Als erledigt markieren'),
          h('button', { class: 'button', type: 'button', onclick: () => resolve('dismissed') }, 'Ignorieren'))
        : null);
  }

  function sourceSection(d: ShermDetail): HTMLElement | null {
    if (!d.same_source.length) return null;
    return h('section', { class: 'card' },
      h('h2', {}, 'Weitere Einsendungen derselben Quelle'),
      h('ul', { class: 'compact-list' }, ...d.same_source.map(o =>
        h('li', {}, h('a', { href: `/admin/sherms/${o.id}` }, o.title), h('span', { class: 'muted' }, ` · ${o.status} · ${formatDate(o.created_at)}`)))));
  }

  function historySection(d: ShermDetail): HTMLElement {
    return h('section', { class: 'card' },
      h('h2', {}, 'Verlauf'),
      d.history.length
        ? h('ul', { class: 'compact-list' }, ...d.history.map(a =>
          h('li', {}, h('strong', {}, ACTION_LABELS[a.action] ?? a.action),
            h('span', { class: 'muted' }, ` · ${a.username ?? 'System'} · ${formatDate(a.created_at)}`))))
        : h('p', { class: 'muted' }, 'Noch nichts passiert'));
  }

  void load();
  return () => destroyMap?.();
};
