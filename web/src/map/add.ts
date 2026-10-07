// Sherm eintragen in drei Schritten: Ort (GPS oder Karte), Foto (Kamera oder Galerie), Text.
// Gesendet wird über die Warteschlange: ohne Netz bleibt der Eintrag gespeichert und geht später raus.
import L from 'leaflet';
import { Camera, ChevronLeft, CircleCheck, CloudUpload, Images, LocateFixed, X } from 'lucide';
import { LIMITS } from '@sherm/shared/constants';
import { h, icon, toast } from '../lib/dom.ts';
import { compressImage } from '../lib/image.ts';
import { enqueue, processQueue, SYNC_TAG } from '../lib/queue.ts';
import { getPosition, userMarker } from './locate.ts';
import { t } from '../lib/i18n.ts';

interface Options {
  center: L.LatLng;
  zoom: number;
  onClose: () => void;
  onQueueChanged: () => void;
}

type Step = 1 | 2 | 3 | 'done';

export function openAddFlow({ center, zoom, onClose, onQueueChanged }: Options): { close: () => void } {
  const state = {
    step: 1 as Step,
    accuracy: null as number | null,
    image: null as Blob | null,
    previewUrl: null as string | null,
    title: '',
    description: '',
    dirty: false,
  };

  const title = h('h2', {});
  const progress = h('span', { class: 'add-progress' });
  const backButton = h('button', { class: 'icon-button', type: 'button', 'aria-label': t('common.back'), onclick: () => back() }, icon(ChevronLeft));
  const content = h('div', { class: 'add-content' });
  const primary = h('button', { class: 'button primary wide', type: 'button' });
  const footer = h('footer', { class: 'add-footer' }, primary);
  const overlay = h('div', { class: 'add', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('add.dialog') },
    h('header', { class: 'add-header' },
      backButton,
      h('div', { class: 'add-title' }, title, progress),
      h('button', { class: 'icon-button', type: 'button', 'aria-label': t('common.close'), onclick: () => tryClose() }, icon(X))),
    content, footer);
  document.body.append(overlay);
  document.body.classList.add('no-scroll');

  // Schritt 1: Karte mit festem Fadenkreuz in der Mitte, der Nutzer schiebt die Karte darunter
  const mapEl = h('div', { class: 'add-map' });
  const coordsText = h('p', { class: 'add-coords' });
  const gpsButton = h('button', { class: 'button primary wide', type: 'button' }, icon(LocateFixed, 20), t('add.useLocation'));
  const manualInput = h('input', { type: 'text', inputmode: 'decimal', placeholder: t('add.coordinatesPlaceholder'), 'aria-label': t('add.coordinatesLabel') });
  const manual = h('details', { class: 'add-manual' },
    h('summary', {}, t('add.coordinates')),
    h('form', { class: 'inline-form', onsubmit: (e: Event) => { e.preventDefault(); applyManual(); } },
      manualInput, h('button', { class: 'button', type: 'submit' }, t('add.coordinatesApply'))));
  const step1 = h('div', { class: 'add-step add-step-location' },
    h('div', { class: 'add-map-wrap' }, mapEl, h('div', { class: 'add-crosshair', 'aria-hidden': 'true' })),
    h('div', { class: 'add-panel' },
      h('p', { class: 'muted' }, t('add.dragHint')),
      gpsButton, coordsText, manual));

  // Erst einhängen, dann die Karte erzeugen: an einem losen Element setzt Leaflet position: relative
  // inline und die Karte hätte die Höhe 0
  content.append(step1);
  const miniMap = L.map(mapEl, { zoomControl: false, attributionControl: true }).setView(center, Math.max(zoom, 14));
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, crossOrigin: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
  }).addTo(miniMap);
  const dot = userMarker();
  const accuracyCircle = L.circle([0, 0], { radius: 0, className: 'user-accuracy', interactive: false });

  const updateCoords = () => {
    const c = miniMap.getCenter();
    coordsText.textContent = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}${state.accuracy ? ` · GPS ±${Math.round(state.accuracy)} m` : ''}`;
  };
  miniMap.on('move', updateCoords);
  miniMap.on('dragstart', () => { state.dirty = true; });

  async function useGps() {
    gpsButton.disabled = true;
    gpsButton.lastChild!.textContent = t('add.locating');
    try {
      const { coords } = await getPosition();
      const pos = L.latLng(coords.latitude, coords.longitude);
      state.accuracy = coords.accuracy;
      state.dirty = true;
      dot.setLatLng(pos).addTo(miniMap);
      accuracyCircle.setLatLng(pos).setRadius(coords.accuracy).addTo(miniMap);
      miniMap.setView(pos, 18);
      updateCoords();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      gpsButton.disabled = false;
      gpsButton.lastChild!.textContent = t('add.useLocation');
    }
  }
  gpsButton.addEventListener('click', useGps);

  function applyManual() {
    const match = manualInput.value.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
    const lat = match ? Number(match[1]) : NaN;
    const lng = match ? Number(match[2]) : NaN;
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) {
      toast(t('add.coordinatesFormat'));
      return;
    }
    state.accuracy = null;
    state.dirty = true;
    miniMap.setView([lat, lng], 18);
    updateCoords();
  }

  // Fragt nur dann nicht nach, wenn der Standort-Zugriff schon erlaubt ist: dann direkt holen
  navigator.permissions?.query({ name: 'geolocation' }).then(p => { if (p.state === 'granted') useGps(); }).catch(() => {});

  // Schritt 2: Foto
  const cameraInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const galleryInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const preview = h('div', { class: 'add-preview' });
  const step2 = h('div', { class: 'add-step add-step-photo' },
    preview,
    h('div', { class: 'add-photo-buttons' },
      h('button', { class: 'button primary', type: 'button', onclick: () => cameraInput.click() }, icon(Camera, 20), t('add.takePhoto')),
      h('button', { class: 'button', type: 'button', onclick: () => galleryInput.click() }, icon(Images, 20), t('add.gallery'))),
    h('p', { class: 'muted small' }, t('add.metadataNote')),
    cameraInput, galleryInput);

  async function takeImage(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    preview.replaceChildren(h('p', { class: 'muted' }, t('add.preparing')));
    try {
      state.image = await compressImage(file);
      state.dirty = true;
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = URL.createObjectURL(state.image);
    } catch {
      toast(t('add.photoUnreadable'));
    }
    renderPreview();
    renderFooter();
  }
  cameraInput.addEventListener('change', () => takeImage(cameraInput));
  galleryInput.addEventListener('change', () => takeImage(galleryInput));

  function renderPreview() {
    preview.replaceChildren(state.previewUrl
      ? h('img', { src: state.previewUrl, alt: t('add.yourPhoto') })
      : h('div', { class: 'add-preview-empty' }, icon(Camera, 48), h('p', {}, t('add.photoHint'))));
  }

  // Schritt 3: Text
  const titleInput = h('input', { type: 'text', name: 'title', required: true, maxlength: LIMITS.titleMax, autocomplete: 'off', placeholder: t('add.titlePlaceholder') });
  const descInput = h('textarea', { name: 'description', rows: 4, maxlength: LIMITS.descriptionMax, placeholder: t('add.descriptionPlaceholder') });
  // Honeypot: für Menschen unsichtbar, Bots füllen es aus
  const honeypot = h('input', { type: 'text', name: 'website', tabindex: -1, autocomplete: 'off' });
  const form = h('form', { class: 'add-step add-step-text', novalidate: true, onsubmit: (e: Event) => { e.preventDefault(); next(); } },
    h('label', { class: 'field' }, h('span', {}, t('add.titleLabel')), titleInput),
    h('label', { class: 'field' }, h('span', {}, t('add.descriptionLabel')), descInput),
    h('div', { class: 'hp', 'aria-hidden': 'true' }, h('label', {}, 'Website', honeypot)));
  titleInput.addEventListener('input', () => { state.dirty = true; renderFooter(); });

  function render() {
    content.replaceChildren();
    backButton.style.visibility = state.step === 1 || state.step === 'done' ? 'hidden' : 'visible';
    if (state.step === 1) {
      title.textContent = t('add.where');
      content.append(step1);
      setTimeout(() => miniMap.invalidateSize(), 0);
      updateCoords();
    } else if (state.step === 2) {
      title.textContent = t('add.photo');
      content.append(step2);
      renderPreview();
    } else if (state.step === 3) {
      title.textContent = t('add.details');
      content.append(form);
      setTimeout(() => titleInput.focus(), 50);
    }
    progress.textContent = state.step === 'done' ? '' : t('add.step', { n: state.step });
    renderFooter();
  }

  function renderFooter() {
    footer.hidden = state.step === 'done';
    primary.disabled = false;
    if (state.step === 1) primary.textContent = t('add.here');
    if (state.step === 2) primary.textContent = state.image ? t('add.next') : t('add.withoutPhoto');
    if (state.step === 3) {
      primary.textContent = t('add.submit');
      primary.disabled = !titleInput.value.trim();
    }
  }

  primary.addEventListener('click', () => next());

  function next() {
    if (state.step === 1) state.step = 2;
    else if (state.step === 2) state.step = 3;
    else if (state.step === 3) return submit();
    render();
  }

  function back() {
    if (state.step === 2) state.step = 1;
    else if (state.step === 3) state.step = 2;
    render();
  }

  async function submit() {
    if (!titleInput.value.trim()) return;
    primary.disabled = true;
    primary.textContent = t('add.saving');
    const c = miniMap.getCenter().wrap();
    await enqueue({
      uuid: crypto.randomUUID(),
      title: titleInput.value.trim(),
      description: descInput.value.trim() || null,
      lat: Number(c.lat.toFixed(6)),
      lng: Number(c.lng.toFixed(6)),
      image: state.image,
      website: honeypot.value,
    });
    let sent = false;
    try {
      const result = await processQueue();
      sent = result.sent > 0;
    } catch {
      // bleibt in der Warteschlange
    }
    if (!sent) {
      // Hintergrund-Sync (Chrome/Android): sendet auch, wenn die App geschlossen ist
      navigator.serviceWorker?.ready.then(reg => (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync?.register(SYNC_TAG)).catch(() => {});
    }
    onQueueChanged();
    showDone(sent);
  }

  function showDone(sent: boolean) {
    state.step = 'done';
    state.dirty = false;
    title.textContent = sent ? t('add.thanks') : t('add.saved');
    render();
    content.append(h('div', { class: 'add-done' },
      icon(sent ? CircleCheck : CloudUpload, 64),
      h('h3', {}, sent ? t('add.doneTitle') : t('add.queuedTitle')),
      h('p', { class: 'muted' }, sent ? t('add.doneText') : t('add.queuedText')),
      h('button', { class: 'button primary', type: 'button', onclick: () => close() }, t('add.toMap'))));
  }

  function tryClose() {
    if (state.dirty && state.step !== 'done' && !confirm(t('add.discard'))) return;
    close();
  }

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    miniMap.remove();
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    overlay.remove();
    document.body.classList.remove('no-scroll');
    onClose();
  }

  render();
  return { close };
}
