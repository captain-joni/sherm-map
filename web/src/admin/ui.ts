// Kleine Bausteine für das Admin-Panel
import type { ShermStatus } from '@sherm/shared';
import { h } from '../lib/dom.ts';

export const STATUS_LABELS: Record<ShermStatus, string> = {
  pending: 'Zu prüfen',
  approved: 'Freigegeben',
  rejected: 'Abgelehnt',
  hidden: 'Versteckt',
};

export function statusBadge(status: ShermStatus, deleted = false): HTMLElement {
  return deleted
    ? h('span', { class: 'status status-deleted' }, 'Papierkorb')
    : h('span', { class: `status status-${status}` }, STATUS_LABELS[status]);
}

export const ACTION_LABELS: Record<string, string> = {
  login: 'Login',
  approve: 'Freigegeben',
  reject: 'Abgelehnt',
  hide: 'Versteckt',
  reopen: 'Prüfung zurückgenommen',
  delete: 'In den Papierkorb',
  restore: 'Wiederhergestellt',
  purge: 'Endgültig gelöscht',
  edit: 'Bearbeitet',
  photo_edit: 'Foto bearbeitet',
  photo_revert: 'Fotobearbeitung zurückgenommen',
  star: 'Foto markiert',
  unstar: 'Markierung entfernt',
  download_starred: 'Markierte Fotos geladen',
  report_resolved: 'Meldung erledigt',
  report_dismissed: 'Meldung ignoriert',
  password_change: 'Passwort geändert',
  user_create: 'Benutzer angelegt',
  user_update: 'Benutzer geändert',
  user_reset_password: 'Passwort zurückgesetzt',
  user_logout_all: 'Überall abgemeldet',
  export: 'Daten exportiert',
};

export const REASON_LABELS: Record<string, string> = {
  privacy: 'Person/Kennzeichen erkennbar',
  illegal: 'Illegal',
  offensive: 'Anstößig',
  spam: 'Spam',
  wrong_location: 'Falscher Ort',
  other: 'Anderes',
};

const dateFmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
export const formatDate = (iso: string) => dateFmt.format(new Date(iso));
export const formatNumber = (n: number) => n.toLocaleString('de-DE');

export function osmLink(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}

export function emptyState(text: string): HTMLElement {
  return h('p', { class: 'empty' }, text);
}

// Bestätigungsdialog mit optionalem Textfeld; löst mit dem Text (oder '') auf, null bei Abbruch
export function askDialog(opts: {
  title: string; text?: string; confirm: string; danger?: boolean;
  input?: { label: string; required?: boolean; presets?: string[] };
}): Promise<string | null> {
  return new Promise(resolve => {
    const input = opts.input ? h('textarea', { id: 'ask-dialog-input', rows: 2, maxlength: 300 }) : null;
    const presets = opts.input?.presets?.map(p =>
      h('button', { class: 'chip', type: 'button', onclick: () => { input!.value = p; input!.focus(); } }, p));
    const confirm = h('button', { class: `button ${opts.danger ? 'danger' : 'primary'}`, type: 'submit' }, opts.confirm);
    const form = h('form', { method: 'dialog', class: 'dialog-form' },
      h('h2', {}, opts.title),
      opts.text ? h('p', { class: 'muted' }, opts.text) : null,
      // Kein <label> um alles: das würde seinen Text dem ersten Preset-Knopf als Namen geben
      opts.input ? h('div', { class: 'field' },
        h('label', { for: 'ask-dialog-input' }, opts.input.label),
        presets?.length ? h('div', { class: 'chips' }, ...presets) : null, input) : null,
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'button', type: 'button', onclick: () => dialog.close() }, 'Abbrechen'),
        confirm));
    const dialog = h('dialog', { class: 'dialog' }, form);
    let result: string | null = null;
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (opts.input?.required && !input!.value.trim()) {
        input!.focus();
        return;
      }
      result = input ? input.value.trim() : '';
      dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    document.body.append(dialog);
    dialog.showModal();
    input?.focus();
  });
}

export const REJECT_PRESETS = ['Kein Sherm zu sehen', 'Person erkennbar', 'Doppelt eingetragen', 'Unpassender Inhalt'];

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
