// Galerie: alle Fotos als Raster, zum Durchstöbern und Markieren (z.B. für Instagram)
import { Download, ExternalLink, Star, X } from 'lucide';
import { SHERM_STATUSES } from '@sherm/shared/constants';
import { h, icon, toast } from '../../lib/dom.ts';
import { adminApi, type GalleryPhoto } from '../api.ts';
import type { View } from '../context.ts';
import { emptyState, formatNumber, STATUS_LABELS } from '../ui.ts';

export const galleryView: View = container => {
  const status = h('select', { 'aria-label': 'Status' },
    h('option', { value: '' }, 'Alle Status'), ...SHERM_STATUSES.map(s => h('option', { value: s }, STATUS_LABELS[s])));
  status.value = 'approved';
  const starredOnly = h('input', { type: 'checkbox' });
  const summary = h('p', { class: 'muted small' });
  const grid = h('div', { class: 'gallery' });
  const sentinel = h('div', { class: 'sentinel' });

  container.append(
    h('header', { class: 'view-header' }, h('h1', {}, 'Galerie'),
      h('a', { class: 'button', href: '/api/admin/photos/starred.zip', download: '' }, icon(Download, 18), 'Markierte als ZIP')),
    h('div', { class: 'filters' }, status, h('label', { class: 'check-label' }, starredOnly, 'Nur markierte')),
    summary, grid, sentinel);

  let items: GalleryPhoto[] = [];
  let page = 1;
  let total = 0;
  let loading = false;
  let done = false;

  async function load(reset = false) {
    if (loading || (done && !reset)) return;
    loading = true;
    if (reset) {
      page = 1;
      items = [];
      done = false;
      grid.replaceChildren();
    }
    try {
      const res = await adminApi.photos({ status: status.value || undefined, starred: starredOnly.checked || undefined, page, page_size: 60 });
      total = res.total;
      items.push(...res.items);
      grid.append(...res.items.map(tile));
      page++;
      done = items.length >= total;
      summary.textContent = `${formatNumber(total)} Foto${total === 1 ? '' : 's'}`;
      if (!total) grid.replaceChildren(emptyState('Keine Fotos'));
    } finally {
      loading = false;
    }
  }

  function tile(p: GalleryPhoto): HTMLElement {
    const button = h('button', { class: `gallery-tile ${p.starred ? 'starred' : ''}`, type: 'button', 'aria-label': p.sherm.title, onclick: () => openLightbox(p) },
      h('img', { src: p.urls.thumb, alt: '', loading: 'lazy' }),
      p.starred ? h('span', { class: 'gallery-star' }, icon(Star, 16)) : null);
    return button;
  }

  function openLightbox(p: GalleryPhoto) {
    const starBtn = h('button', { class: 'chip', type: 'button' });
    const renderStar = () => {
      starBtn.replaceChildren(icon(Star, 18), p.starred ? 'Markiert' : 'Markieren');
      starBtn.classList.toggle('active', p.starred);
    };
    renderStar();
    starBtn.addEventListener('click', async () => {
      try {
        await adminApi.star(p.id, !p.starred);
        p.starred = !p.starred;
        renderStar();
        const old = grid.children[items.indexOf(p)];
        old?.replaceWith(tile(p));
      } catch {
        toast('Hat nicht geklappt');
      }
    });
    const dialog = h('dialog', { class: 'lightbox' },
      h('img', { src: p.urls.display, alt: p.sherm.title }),
      h('div', { class: 'lightbox-bar' },
        h('strong', {}, p.sherm.title),
        h('span', { class: 'muted' }, `${STATUS_LABELS[p.sherm.status]}${p.sherm.country_code ? ` · ${p.sherm.country_code}` : ''} · ${p.sherm.like_count} ♥`),
        h('div', { class: 'button-row' },
          starBtn,
          h('a', { class: 'chip', href: `${p.urls.original.split('?')[0]}?download` }, icon(Download, 18), 'Original'),
          h('a', { class: 'chip', href: `/admin/sherms/${p.sherm.id}`, onclick: () => dialog.close() }, icon(ExternalLink, 18), 'Sherm'),
          h('button', { class: 'icon-button', type: 'button', 'aria-label': 'Schließen', onclick: () => dialog.close() }, icon(X)))));
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  status.addEventListener('change', () => load(true));
  starredOnly.addEventListener('change', () => load(true));
  const observer = new IntersectionObserver(entries => { if (entries[0]?.isIntersecting) void load(); }, { rootMargin: '600px' });
  observer.observe(sentinel);
  return () => observer.disconnect();
};
