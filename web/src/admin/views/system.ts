// Export und Backup-Status (nur Admins)
import { Download } from 'lucide';
import { h, icon, toast } from '../../lib/dom.ts';
import { relativeTime } from '../../lib/format.ts';
import { adminApi, ApiError } from '../api.ts';
import type { View } from '../context.ts';
import { download, formatDate } from '../ui.ts';

const BACKUP_MAX_AGE_HOURS = 36;

export const systemView: View = container => {
  const exportButton = h('button', { class: 'button primary', type: 'button' }, icon(Download, 18), 'Export herunterladen');
  const backups = h('div', {}, h('p', { class: 'muted' }, 'Lädt …'));
  container.append(
    h('h1', {}, 'System'),
    h('section', { class: 'card' },
      h('h2', {}, 'Daten exportieren'),
      h('p', {}, 'Alle Sherms, Fotos (Originale), Meldungen, Reaktionen und der Verlauf als eine Datei. Lässt sich mit dem Import-Skript in jede Sherm-Map-Installation laden. Enthält keine Benutzer und Passwörter.'),
      exportButton),
    h('section', { class: 'card' }, h('h2', {}, 'Backups'), backups));

  exportButton.addEventListener('click', async () => {
    exportButton.disabled = true;
    exportButton.lastChild!.textContent = 'Export läuft …';
    try {
      const { blob, name } = await adminApi.exportData();
      download(blob, name);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Export fehlgeschlagen');
    } finally {
      exportButton.disabled = false;
      exportButton.lastChild!.textContent = 'Export herunterladen';
    }
  });

  adminApi.backups().then(res => {
    if (!res.available) {
      backups.replaceChildren(h('p', { class: 'muted' }, 'Der Backup-Ordner ist nicht in den Container eingebunden. Die Backups laufen trotzdem auf dem Server (scripts/backup.sh), sie sind hier nur nicht sichtbar.'));
      return;
    }
    const latest = res.backups[0];
    const ageHours = latest ? (Date.now() - new Date(latest.created_at).getTime()) / 3_600_000 : Infinity;
    backups.replaceChildren(
      ageHours > BACKUP_MAX_AGE_HOURS
        ? h('p', { class: 'note note-warn' }, latest ? `Letztes Backup ist ${relativeTime(latest.created_at).replace(/^vor /, '')} alt – läuft der nächtliche Cronjob?` : 'Noch kein Backup gefunden.')
        : h('p', { class: 'note' }, `Letztes Backup ${relativeTime(latest!.created_at)}.`),
      h('ul', { class: 'compact-list' }, ...res.backups.map(b =>
        h('li', {}, b.name, h('span', { class: 'muted' }, ` · ${(b.bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB · ${formatDate(b.created_at)}`)))));
  }).catch(() => backups.replaceChildren(h('p', { class: 'form-error' }, 'Backups konnten nicht geladen werden')));
};
