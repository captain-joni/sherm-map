// Meldungen von Besuchern, nach Sherm gruppiert
import { EyeOff } from 'lucide';
import { h, icon, toast } from '../../lib/dom.ts';
import { adminApi, ApiError, type ReportGroup } from '../api.ts';
import type { View } from '../context.ts';
import { askDialog, emptyState, formatDate, REASON_LABELS, statusBadge } from '../ui.ts';

export const reportsView: View = (container, ctx) => {
  const tabs = h('div', { class: 'segmented' });
  const list = h('div', { class: 'report-list' });
  container.append(h('header', { class: 'view-header' }, h('h1', {}, 'Meldungen'), tabs), list);
  let status: 'open' | 'resolved' | 'dismissed' = 'open';

  for (const [value, label] of [['open', 'Offen'], ['resolved', 'Erledigt'], ['dismissed', 'Ignoriert']] as const) {
    tabs.append(h('button', { type: 'button', 'aria-pressed': String(value === status), onclick: () => { status = value; for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.textContent === label)); void load(); } }, label));
  }

  async function load() {
    const res = await adminApi.reports(status);
    list.replaceChildren(...(res.items.length ? res.items.map(group) : [emptyState(status === 'open' ? 'Keine offenen Meldungen' : 'Nichts hier')]));
  }

  function group(g: ReportGroup): HTMLElement {
    const done = async (fn: () => Promise<unknown>, message: string) => {
      try {
        await fn();
        toast(message);
        void ctx.refreshBadges();
        await load();
      } catch (err) {
        toast(err instanceof ApiError ? err.message : 'Hat nicht geklappt');
      }
    };
    return h('article', { class: 'card report' },
      g.thumb ? h('img', { src: g.thumb, alt: '', loading: 'lazy' }) : h('span', { class: 'row-nothumb' }),
      h('div', { class: 'report-main' },
        h('h2', {}, h('a', { href: `/admin/sherms/${g.id}` }, g.title), ' ', statusBadge(g.status, !!g.deleted_at)),
        h('ul', { class: 'compact-list' }, ...g.reports.map(r =>
          h('li', {}, h('strong', {}, REASON_LABELS[r.reason] ?? r.reason), r.comment ? `: ${r.comment}` : '', h('span', { class: 'muted' }, ` · ${formatDate(r.created_at)}`)))),
        status === 'open'
          ? h('div', { class: 'button-row' },
            g.status === 'approved' && !g.deleted_at
              ? h('button', { class: 'button danger', type: 'button', onclick: async () => {
                const reason = await askDialog({ title: 'Sherm verstecken', confirm: 'Verstecken', danger: true, input: { label: 'Grund (optional)' } });
                if (reason === null) return;
                await done(async () => {
                  await adminApi.action(g.id, 'hide', reason || undefined);
                  await adminApi.resolveAll(g.id, 'resolved');
                }, 'Versteckt und Meldungen erledigt');
              } }, icon(EyeOff, 18), 'Verstecken')
              : null,
            h('button', { class: 'button', type: 'button', onclick: () => done(() => adminApi.resolveAll(g.id, 'resolved'), 'Erledigt') }, 'Erledigt'),
            h('button', { class: 'button ghost', type: 'button', onclick: () => done(() => adminApi.resolveAll(g.id, 'dismissed'), 'Ignoriert') }, 'Ignorieren'))
          : null));
  }

  void load();
};
