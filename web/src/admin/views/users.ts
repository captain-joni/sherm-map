// Benutzerverwaltung (nur Admins)
import { Copy } from 'lucide';
import { USER_ROLES, type UserRole } from '@sherm/shared/constants';
import { h, icon, toast } from '../../lib/dom.ts';
import { adminApi, ApiError, type AdminUser } from '../api.ts';
import type { View } from '../context.ts';
import { askDialog, formatDate } from '../ui.ts';

const ROLE_LABELS: Record<UserRole, string> = { moderator: 'Moderator', admin: 'Admin' };

export const usersView: View = (container, ctx) => {
  const list = h('div', { class: 'user-list' });
  const username = h('input', { placeholder: 'Benutzername', required: true, pattern: '[a-zA-Z0-9._\\-]{3,50}', 'aria-label': 'Benutzername' });
  const role = h('select', { 'aria-label': 'Rolle' }, ...USER_ROLES.map(r => h('option', { value: r }, ROLE_LABELS[r])));
  const form = h('form', { class: 'card inline-form' },
    h('h2', {}, 'Neuer Benutzer'), username, role, h('button', { class: 'button primary', type: 'submit' }, 'Anlegen'));
  container.append(h('h1', {}, 'Benutzer'),
    h('p', { class: 'muted' }, 'Moderatoren können prüfen, bearbeiten und Meldungen bearbeiten. Admins zusätzlich löschen, Benutzer verwalten und exportieren.'),
    list, form);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const res = await adminApi.createUser(username.value.trim(), role.value as UserRole);
      username.value = '';
      showPassword(res.user.username, res.one_time_password);
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Anlegen fehlgeschlagen');
    }
  });

  async function load() {
    const users = await adminApi.users();
    list.replaceChildren(...users.map(card));
  }

  function card(u: AdminUser): HTMLElement {
    const self = u.id === ctx.user.id;
    const roleSelect = h('select', { 'aria-label': 'Rolle', disabled: self }, ...USER_ROLES.map(r => h('option', { value: r }, ROLE_LABELS[r])));
    roleSelect.value = u.role;
    roleSelect.addEventListener('change', () => run(() => adminApi.updateUser(u.id, { role: roleSelect.value as UserRole }), 'Rolle geändert'));

    return h('article', { class: `card user ${u.disabled_at ? 'disabled' : ''}` },
      h('div', {},
        h('strong', {}, u.username, self ? ' (du)' : ''),
        h('p', { class: 'muted small' }, [
          u.disabled_at ? 'Gesperrt' : null,
          u.must_change_password ? 'Muss Passwort ändern' : null,
          u.last_login_at ? `zuletzt da ${formatDate(u.last_login_at)}` : 'noch nie angemeldet',
        ].filter(Boolean).join(' · '))),
      h('div', { class: 'button-row' },
        roleSelect,
        self ? null : h('button', { class: 'button', type: 'button', onclick: () => run(() => adminApi.updateUser(u.id, { disabled: !u.disabled_at }), u.disabled_at ? 'Entsperrt' : 'Gesperrt') }, u.disabled_at ? 'Entsperren' : 'Sperren'),
        h('button', { class: 'button', type: 'button', onclick: async () => {
          if ((await askDialog({ title: `Passwort von ${u.username} zurücksetzen?`, text: 'Es gibt ein neues Einmal-Passwort, alle Sitzungen werden beendet.', confirm: 'Zurücksetzen' })) === null) return;
          try {
            const res = await adminApi.resetPassword(u.id);
            showPassword(u.username, res.one_time_password);
            await load();
          } catch (err) {
            toast(err instanceof ApiError ? err.message : 'Hat nicht geklappt');
          }
        } }, 'Passwort zurücksetzen'),
        h('button', { class: 'button ghost', type: 'button', onclick: () => run(() => adminApi.logoutAll(u.id), 'Überall abgemeldet') }, 'Überall abmelden')));
  }

  async function run(fn: () => Promise<unknown>, message: string) {
    try {
      await fn();
      toast(message);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Hat nicht geklappt');
    }
    await load();
  }

  // Einmal-Passwort wird nur jetzt angezeigt
  function showPassword(name: string, password: string) {
    const dialog = h('dialog', { class: 'dialog' },
      h('div', { class: 'dialog-form' },
        h('h2', {}, `Einmal-Passwort für ${name}`),
        h('p', { class: 'muted' }, 'Gib es sicher weiter (nicht per öffentlichem Chat). Es wird nur jetzt angezeigt und muss beim ersten Login geändert werden.'),
        h('p', { class: 'password' }, password),
        h('div', { class: 'dialog-buttons' },
          h('button', { class: 'button', type: 'button', onclick: async () => {
            await navigator.clipboard.writeText(password).then(() => toast('Kopiert'), () => toast('Kopieren ging nicht'));
          } }, icon(Copy, 18), 'Kopieren'),
          h('button', { class: 'button primary', type: 'button', onclick: () => dialog.close() }, 'Fertig'))));
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  void load();
};
