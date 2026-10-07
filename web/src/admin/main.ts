import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import '../styles/app.css';
import '../styles/admin.css';
import { ClipboardCheck, Ellipsis, Flag, ScrollText, Images, LayoutDashboard, List, LogOut, Server, Users } from 'lucide';
import type { SessionUser } from '@sherm/shared';
import { h, icon, toast } from '../lib/dom.ts';
import { adminApi, ApiError, setUnauthorizedHandler } from './api.ts';
import type { AdminContext, View } from './context.ts';
import { auditView } from './views/audit.ts';
import { dashboardView } from './views/dashboard.ts';
import { galleryView } from './views/gallery.ts';
import { queueView } from './views/queue.ts';
import { reportsView } from './views/reports.ts';
import { shermDetailView } from './views/sherm-detail.ts';
import { shermsView } from './views/sherms.ts';
import { systemView } from './views/system.ts';
import { usersView } from './views/users.ts';

const root = document.getElementById('admin')!;

interface NavItem {
  path: string;
  label: string;
  icon: Parameters<typeof icon>[0];
  adminOnly?: boolean;
  badge?: 'pending' | 'reports';
  mobile?: boolean; // in der unteren Leiste auf dem Handy
}

const NAV: NavItem[] = [
  { path: '/admin', label: 'Übersicht', icon: LayoutDashboard, mobile: true },
  { path: '/admin/pruefen', label: 'Prüfen', icon: ClipboardCheck, badge: 'pending', mobile: true },
  { path: '/admin/sherms', label: 'Sherms', icon: List, mobile: true },
  { path: '/admin/galerie', label: 'Galerie', icon: Images, mobile: true },
  { path: '/admin/meldungen', label: 'Meldungen', icon: Flag, badge: 'reports' },
  { path: '/admin/verlauf', label: 'Verlauf', icon: ScrollText },
  { path: '/admin/benutzer', label: 'Benutzer', icon: Users, adminOnly: true },
  { path: '/admin/system', label: 'System', icon: Server, adminOnly: true },
];

function route(path: string): { view: View; params: Record<string, string> } {
  const detail = path.match(/^\/admin\/sherms\/(\d+)$/);
  if (detail) return { view: shermDetailView, params: { id: detail[1]! } };
  const views: Record<string, View> = {
    '/admin': dashboardView,
    '/admin/pruefen': queueView,
    '/admin/sherms': shermsView,
    '/admin/galerie': galleryView,
    '/admin/meldungen': reportsView,
    '/admin/verlauf': auditView,
    '/admin/benutzer': usersView,
    '/admin/system': systemView,
  };
  return { view: views[path.replace(/\/$/, '') || '/admin'] ?? dashboardView, params: {} };
}

// Login

function showLogin(message?: string) {
  const username = h('input', { name: 'username', autocomplete: 'username', required: true });
  const password = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const error = h('p', { class: 'form-error', role: 'alert' }, message ?? '');
  const submit = h('button', { class: 'button primary wide', type: 'submit' }, 'Anmelden');
  const form = h('form', { class: 'login-card' },
    h('img', { src: '/icons/icon.svg', alt: '', class: 'login-logo' }),
    h('h1', {}, 'Sherm Admin'),
    h('label', { class: 'field' }, h('span', {}, 'Benutzername'), username),
    h('label', { class: 'field' }, h('span', {}, 'Passwort'), password),
    error, submit);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    submit.disabled = true;
    error.textContent = '';
    try {
      start(await adminApi.login(username.value.trim(), password.value));
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : 'Anmelden fehlgeschlagen';
      submit.disabled = false;
    }
  });
  root.replaceChildren(h('main', { class: 'login' }, form));
  username.focus();
}

function showChangePassword(user: SessionUser) {
  const current = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const next = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 12 });
  const repeat = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const error = h('p', { class: 'form-error', role: 'alert' });
  const form = h('form', { class: 'login-card' },
    h('h1', {}, 'Neues Passwort'),
    h('p', { class: 'muted' }, `Hallo ${user.username}! Bitte wähle ein eigenes Passwort (mindestens 12 Zeichen).`),
    h('label', { class: 'field' }, h('span', {}, 'Aktuelles (Einmal-)Passwort'), current),
    h('label', { class: 'field' }, h('span', {}, 'Neues Passwort'), next),
    h('label', { class: 'field' }, h('span', {}, 'Neues Passwort wiederholen'), repeat),
    error,
    h('button', { class: 'button primary wide', type: 'submit' }, 'Speichern'));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (next.value !== repeat.value) {
      error.textContent = 'Die neuen Passwörter stimmen nicht überein';
      return;
    }
    try {
      start(await adminApi.changePassword(current.value, next.value));
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : 'Hat nicht geklappt';
    }
  });
  root.replaceChildren(h('main', { class: 'login' }, form));
  current.focus();
}

// App-Rahmen mit Navigation

let cleanup: (() => void) | void;

function start(user: SessionUser) {
  if (user.must_change_password) return showChangePassword(user);

  const items = NAV.filter(n => !n.adminOnly || user.role === 'admin');
  const badges = { pending: [] as HTMLElement[], reports: [] as HTMLElement[] };
  const navLink = (item: NavItem, cls: string) => {
    const badge = item.badge ? h('span', { class: 'nav-badge', hidden: true }) : null;
    if (badge && item.badge) badges[item.badge].push(badge);
    return h('a', { class: cls, href: item.path, 'data-path': item.path }, icon(item.icon, 20), h('span', {}, item.label), badge);
  };

  const logout = async () => {
    await adminApi.logout().catch(() => {});
    showLogin();
  };

  const sidebar = h('nav', { class: 'sidebar', 'aria-label': 'Hauptnavigation' },
    h('a', { class: 'sidebar-brand', href: '/' }, h('img', { src: '/icons/icon.svg', alt: '' }), 'Sherm Admin'),
    ...items.map(i => navLink(i, 'nav-link')),
    h('div', { class: 'sidebar-user' },
      h('span', {}, h('strong', {}, user.username), h('small', {}, user.role === 'admin' ? 'Admin' : 'Moderator')),
      h('button', { class: 'icon-button', type: 'button', 'aria-label': 'Abmelden', title: 'Abmelden', onclick: logout }, icon(LogOut, 20))));

  // Unten auf dem Handy: die vier wichtigsten + "Mehr"
  const more = h('dialog', { class: 'dialog more-menu' },
    h('nav', {}, ...items.filter(i => !i.mobile).map(i => navLink(i, 'nav-link')),
      h('button', { class: 'nav-link', type: 'button', onclick: logout }, icon(LogOut, 20), h('span', {}, 'Abmelden'))));
  more.addEventListener('click', e => { if (e.target === more || (e.target as HTMLElement).closest('a')) more.close(); });
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Navigation' },
    ...items.filter(i => i.mobile).map(i => navLink(i, 'tab')),
    h('button', { class: 'tab', type: 'button', onclick: () => more.showModal() }, icon(Ellipsis, 20), h('span', {}, 'Mehr')));

  const main = h('main', { class: 'content' });
  root.replaceChildren(h('div', { class: 'shell' }, sidebar, main, tabbar, more));

  async function refreshBadges() {
    try {
      const m = await adminApi.metrics();
      for (const [key, n] of [['pending', m.by_status.pending], ['reports', m.open_reports]] as const) {
        for (const b of badges[key]) {
          b.hidden = n === 0;
          b.textContent = n > 99 ? '99+' : String(n);
        }
      }
    } catch {
      // Badges sind nur Zusatz
    }
  }

  const ctx: AdminContext = {
    user,
    navigate(path, replace = false) {
      history[replace ? 'replaceState' : 'pushState'](null, '', path);
      render();
    },
    refreshBadges,
  };

  function render() {
    cleanup?.();
    const { view, params } = route(location.pathname);
    for (const link of root.querySelectorAll<HTMLElement>('[data-path]')) {
      const p = link.dataset.path!;
      const active = p === '/admin' ? location.pathname.replace(/\/$/, '') === '/admin' : location.pathname.startsWith(p);
      link.classList.toggle('active', active);
    }
    main.replaceChildren();
    main.scrollTop = 0;
    cleanup = view(main, ctx, params);
  }

  // Interne Links ohne Neuladen
  root.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a || a.target || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/admin')) return;
    e.preventDefault();
    ctx.navigate(url.pathname + url.search);
  });
  window.onpopstate = render;

  render();
  void refreshBadges();
  const timer = window.setInterval(refreshBadges, 60_000);
  setUnauthorizedHandler(() => {
    window.clearInterval(timer);
    cleanup?.();
    showLogin('Sitzung abgelaufen, bitte neu anmelden');
  });
}

adminApi.me().then(start).catch(err => {
  if (err instanceof ApiError && err.status !== 401) toast('Server nicht erreichbar');
  showLogin();
});
