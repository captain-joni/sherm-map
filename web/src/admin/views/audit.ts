// Verlauf: wer hat wann was gemacht
import { h } from '../../lib/dom.ts';
import { adminApi, type AuditEntry } from '../api.ts';
import type { View } from '../context.ts';
import { ACTION_LABELS, emptyState, formatDate, formatNumber } from '../ui.ts';

export const auditView: View = container => {
  const action = h('select', { 'aria-label': 'Aktion' }, h('option', { value: '' }, 'Alle Aktionen'),
    ...Object.entries(ACTION_LABELS).map(([k, v]) => h('option', { value: k }, v)));
  const user = h('input', { type: 'search', placeholder: 'Benutzer', 'aria-label': 'Benutzer' });
  const table = h('tbody');
  const summary = h('p', { class: 'muted small' });
  const more = h('button', { class: 'button wide', type: 'button', hidden: true }, 'Mehr laden');
  container.append(
    h('h1', {}, 'Verlauf'),
    h('div', { class: 'filters' }, action, user),
    summary,
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Wann'), h('th', {}, 'Wer'), h('th', {}, 'Was'), h('th', {}, 'Sherm'), h('th', {}, 'Details'))),
      table)),
    more);

  let page = 1;
  let shown = 0;

  async function load(reset: boolean) {
    if (reset) {
      page = 1;
      shown = 0;
      table.replaceChildren();
    }
    const res = await adminApi.audit({ action: action.value || undefined, user: user.value.trim() || undefined, page, page_size: 100 });
    table.append(...res.items.map(row));
    shown += res.items.length;
    page++;
    summary.textContent = `${formatNumber(res.total)} Einträge`;
    more.hidden = shown >= res.total;
    if (!res.total) table.replaceChildren(h('tr', {}, h('td', { colspan: 5 }, emptyState('Keine Einträge'))));
  }

  function row(a: AuditEntry): HTMLElement {
    return h('tr', {},
      h('td', { class: 'nowrap' }, formatDate(a.created_at)),
      h('td', {}, a.username ?? 'System'),
      h('td', {}, ACTION_LABELS[a.action] ?? a.action),
      h('td', {}, a.sherm_id ? h('a', { href: `/admin/sherms/${a.sherm_id}` }, a.sherm_title ?? `#${a.sherm_id}`) : '–'),
      h('td', { class: 'details' }, describe(a)));
  }

  action.addEventListener('change', () => load(true));
  let timer: number | undefined;
  user.addEventListener('input', () => { window.clearTimeout(timer); timer = window.setTimeout(() => load(true), 300); });
  more.addEventListener('click', () => load(false));
  void load(true);
};

// Details lesbar machen statt rohes JSON
function describe(a: AuditEntry): string {
  const d = a.details;
  if (a.action === 'edit' && d.changes && typeof d.changes === 'object') {
    return Object.entries(d.changes as Record<string, [unknown, unknown]>)
      .map(([field, [from, to]]) => `${field}: „${from ?? ''}“ → „${to ?? ''}“`).join('; ');
  }
  const parts: string[] = [];
  if (typeof d.reason === 'string') parts.push(`Grund: ${d.reason}`);
  if (typeof d.username === 'string') parts.push(`Benutzer: ${d.username}`);
  if (typeof d.role === 'string') parts.push(`Rolle: ${d.role}`);
  if (typeof d.title === 'string') parts.push(d.title);
  if (typeof d.count === 'number') parts.push(`${d.count} Stück`);
  if (d.bulk) parts.push('Sammelaktion');
  return parts.join(' · ');
}
