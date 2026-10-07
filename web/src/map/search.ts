// Suche oben rechts: zugeklappt nur ein Knopf, damit die Karte frei bleibt.
// Findet Sherms (lokal, aus der geladenen Liste) und Orte (Photon über /api/geocode).
import { MapPin, Search, X } from 'lucide';
import type { GeocodeResult, MapSherm } from '@sherm/shared';
import { api } from '../lib/api.ts';
import { h, icon } from '../lib/dom.ts';
import { normalize } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';

interface Options {
  sherms: () => MapSherm[];
  onSherm: (sherm: MapSherm) => void;
  onPlace: (place: GeocodeResult) => void;
}

export function createSearch({ sherms, onSherm, onPlace }: Options): HTMLElement {
  const input = h('input', {
    type: 'search', class: 'search-input', placeholder: t('search.placeholder'),
    'aria-label': t('search.label'), autocomplete: 'off', enterkeyhint: 'search',
  });
  const results = h('div', { class: 'search-results', role: 'listbox' });
  const panel = h('div', { class: 'search-panel', hidden: true },
    h('div', { class: 'search-bar' },
      icon(Search, 20), input,
      h('button', { class: 'icon-button', type: 'button', 'aria-label': t('search.close'), onclick: () => close() }, icon(X))),
    results);
  const toggle = h('button', { class: 'fab fab-small search-toggle', type: 'button', 'aria-label': t('search.open'), onclick: () => open() }, icon(Search));

  let timer: number | undefined;
  let controller: AbortController | null = null;
  let places: GeocodeResult[] = [];

  function open() {
    panel.hidden = false;
    toggle.hidden = true;
    input.focus();
  }

  function close() {
    panel.hidden = true;
    toggle.hidden = false;
    input.value = '';
    results.replaceChildren();
    controller?.abort();
  }

  function render() {
    const q = normalize(input.value.trim());
    const found = q.length < 2 ? [] : sherms().filter(s => normalize(s.title).includes(q)).slice(0, 6);
    const items: HTMLElement[] = [];

    if (found.length) {
      items.push(h('p', { class: 'search-heading' }, t('search.sherms')));
      for (const s of found) {
        items.push(h('button', { class: 'search-item', type: 'button', role: 'option', onclick: () => { close(); onSherm(s); } },
          s.thumb ? h('img', { src: s.thumb, alt: '', loading: 'lazy' }) : h('span', { class: 'search-icon' }, icon(MapPin, 18)),
          h('span', {}, s.title)));
      }
    }
    if (places.length) {
      items.push(h('p', { class: 'search-heading' }, t('search.places')));
      for (const p of places) {
        items.push(h('button', { class: 'search-item', type: 'button', role: 'option', onclick: () => { close(); onPlace(p); } },
          h('span', { class: 'search-icon' }, icon(MapPin, 18)),
          h('span', {}, h('strong', {}, p.name), p.detail ? h('small', {}, p.detail) : null)));
      }
    }
    if (!items.length && q.length >= 3) items.push(h('p', { class: 'search-empty' }, t('search.empty')));
    results.replaceChildren(...items);
  }

  input.addEventListener('input', () => {
    places = [];
    render();
    window.clearTimeout(timer);
    controller?.abort();
    const q = input.value.trim();
    if (q.length < 3) return;
    timer = window.setTimeout(async () => {
      controller = new AbortController();
      try {
        places = await api.geocode(q, controller.signal);
        render();
      } catch {
        // Ortssuche ist Zusatz, Sherm-Treffer bleiben sichtbar
      }
    }, 350);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') (results.querySelector('.search-item') as HTMLButtonElement | null)?.click();
  });

  return h('div', { class: 'search' }, toggle, panel);
}
