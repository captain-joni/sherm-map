// Foto bearbeiten vor der Freigabe: drehen, zuschneiden, Bereiche verpixeln (Gesichter, Kennzeichen).
// Alles passiert im Browser auf einer Canvas, gespeichert wird das Ergebnis als neues JPEG.
// Verpixeln statt Weichzeichnen: funktioniert in allen Browsern und ist nicht umkehrbar.
import { Crop, Grid3x3, RotateCw, Undo2, X } from 'lucide';
import type { AdminPhoto } from '@sherm/shared';
import { h, icon, toast } from '../../lib/dom.ts';
import { adminApi, ApiError } from '../api.ts';

type Mode = 'crop' | 'pixelate';

export function openPhotoEditor(photo: AdminPhoto, onSaved: (photo: AdminPhoto) => void): void {
  let canvas = document.createElement('canvas');
  const undo: HTMLCanvasElement[] = [];
  let mode: Mode = 'pixelate';

  const stage = h('div', { class: 'editor-stage' }, h('p', { class: 'muted' }, 'Lädt …'));
  const selection = h('div', { class: 'editor-selection', hidden: true });
  const hint = h('p', { class: 'editor-hint' });
  const modeButtons = {
    pixelate: h('button', { class: 'chip', type: 'button', onclick: () => setMode('pixelate') }, icon(Grid3x3, 18), 'Verpixeln'),
    crop: h('button', { class: 'chip', type: 'button', onclick: () => setMode('crop') }, icon(Crop, 18), 'Zuschneiden'),
  };
  const undoButton = h('button', { class: 'chip', type: 'button', disabled: true, onclick: () => { const prev = undo.pop(); if (prev) show(prev); } }, icon(Undo2, 18), 'Rückgängig');
  const save = h('button', { class: 'button primary', type: 'button', disabled: true }, 'Speichern');

  const dialog = h('dialog', { class: 'editor' },
    h('header', { class: 'editor-header' },
      h('h2', {}, 'Foto bearbeiten'),
      h('button', { class: 'icon-button', type: 'button', 'aria-label': 'Schließen', onclick: () => close() }, icon(X))),
    h('div', { class: 'editor-tools' },
      modeButtons.pixelate, modeButtons.crop,
      h('button', { class: 'chip', type: 'button', onclick: () => rotate() }, icon(RotateCw, 18), 'Drehen'),
      undoButton),
    hint, stage,
    h('footer', { class: 'editor-footer' },
      h('button', { class: 'button', type: 'button', onclick: () => close() }, 'Abbrechen'), save));

  function setMode(m: Mode) {
    mode = m;
    modeButtons.pixelate.classList.toggle('active', m === 'pixelate');
    modeButtons.crop.classList.toggle('active', m === 'crop');
    hint.textContent = m === 'pixelate'
      ? 'Rechteck über Gesicht oder Kennzeichen ziehen, um es zu verpixeln.'
      : 'Rechteck ziehen: alles außerhalb wird abgeschnitten.';
  }

  function show(next: HTMLCanvasElement, pushUndo = false) {
    if (pushUndo) undo.push(canvas);
    canvas = next;
    canvas.className = 'editor-canvas';
    stage.replaceChildren(canvas, selection);
    undoButton.disabled = undo.length === 0;
    save.disabled = undo.length === 0;
  }

  function copy(source: HTMLCanvasElement | ImageBitmap, sx = 0, sy = 0, sw = source.width, sh = source.height) {
    const c = document.createElement('canvas');
    c.width = sw;
    c.height = sh;
    c.getContext('2d')!.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
    return c;
  }

  function rotate() {
    const c = document.createElement('canvas');
    c.width = canvas.height;
    c.height = canvas.width;
    const ctx = c.getContext('2d')!;
    ctx.translate(c.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(canvas, 0, 0);
    show(c, true);
  }

  function pixelate(x: number, y: number, w: number, h2: number) {
    const c = copy(canvas);
    const ctx = c.getContext('2d')!;
    const block = Math.max(8, Math.round(Math.max(w, h2) / 10));
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.ceil(w / block));
    small.height = Math.max(1, Math.ceil(h2 / block));
    small.getContext('2d')!.drawImage(canvas, x, y, w, h2, 0, 0, small.width, small.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h2);
    show(c, true);
  }

  // Rechteck ziehen: Bildschirm- in Bildkoordinaten umrechnen
  let start: { x: number; y: number } | null = null;
  const toImage = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.min(Math.max(0, (e.clientX - r.left) / r.width), 1) * canvas.width,
      y: Math.min(Math.max(0, (e.clientY - r.top) / r.height), 1) * canvas.height,
      sx: e.clientX - stage.getBoundingClientRect().left,
      sy: e.clientY - stage.getBoundingClientRect().top,
    };
  };
  let startScreen = { x: 0, y: 0 };
  stage.addEventListener('pointerdown', e => {
    if (e.target !== canvas) return;
    const p = toImage(e);
    start = { x: p.x, y: p.y };
    startScreen = { x: p.sx, y: p.sy };
    stage.setPointerCapture(e.pointerId);
    Object.assign(selection.style, { left: `${p.sx}px`, top: `${p.sy}px`, width: '0', height: '0' });
    selection.hidden = false;
  });
  stage.addEventListener('pointermove', e => {
    if (!start) return;
    const p = toImage(e);
    Object.assign(selection.style, {
      left: `${Math.min(p.sx, startScreen.x)}px`, top: `${Math.min(p.sy, startScreen.y)}px`,
      width: `${Math.abs(p.sx - startScreen.x)}px`, height: `${Math.abs(p.sy - startScreen.y)}px`,
    });
  });
  stage.addEventListener('pointerup', e => {
    if (!start) return;
    const p = toImage(e);
    const x = Math.round(Math.min(p.x, start.x));
    const y = Math.round(Math.min(p.y, start.y));
    const w = Math.round(Math.abs(p.x - start.x));
    const hgt = Math.round(Math.abs(p.y - start.y));
    start = null;
    selection.hidden = true;
    if (w < 8 || hgt < 8) return;
    if (mode === 'pixelate') pixelate(x, y, w, hgt);
    else show(copy(canvas, x, y, w, hgt), true);
  });

  save.addEventListener('click', async () => {
    save.disabled = true;
    save.textContent = 'Speichert …';
    try {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Bild konnte nicht erzeugt werden'))), 'image/jpeg', 0.92));
      onSaved(await adminApi.replaceImage(photo.id, blob));
      toast('Foto gespeichert. Das Original bleibt bis zur Freigabe aufgehoben.');
      undo.length = 0;
      close();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen');
      save.disabled = false;
      save.textContent = 'Speichern';
    }
  });

  function close() {
    if (undo.length && !confirm('Änderungen verwerfen?')) return;
    dialog.close();
  }
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dialog.addEventListener('close', () => dialog.remove());

  document.body.append(dialog);
  dialog.showModal();
  setMode('pixelate');

  // Original laden (gleiche Herkunft, die Canvas bleibt also exportierbar)
  fetch(photo.urls.original, { credentials: 'same-origin' })
    .then(r => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(b => createImageBitmap(b))
    .then(bitmap => show(copy(bitmap)))
    .catch(() => stage.replaceChildren(h('p', { class: 'form-error' }, 'Original konnte nicht geladen werden')));
}
