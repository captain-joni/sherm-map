// Übersicht: was zu tun ist (Prüfen, Meldungen) und Kennzahlen
import { h } from '../../lib/dom.ts';
import { relativeTime } from '../../lib/format.ts';
import { adminApi, type Metrics } from '../api.ts';
import type { View } from '../context.ts';
import { formatNumber } from '../ui.ts';

const monthFmt = new Intl.DateTimeFormat('de-DE', { month: 'short' });
const dayFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });

export const dashboardView: View = container => {
  container.append(h('h1', {}, 'Übersicht'), h('p', { class: 'muted' }, 'Lädt …'));
  adminApi.metrics().then(m => container.replaceChildren(h('h1', {}, 'Übersicht'), render(m))).catch(() => {
    container.replaceChildren(h('h1', {}, 'Übersicht'), h('p', { class: 'form-error' }, 'Kennzahlen konnten nicht geladen werden'));
  });
};

function render(m: Metrics): HTMLElement {
  const pending = m.by_status.pending;
  const hero = h('section', { class: 'card hero' },
    h('div', {},
      h('p', { class: 'hero-label' }, 'Zu prüfen'),
      h('p', { class: 'hero-value' }, formatNumber(pending)),
      m.oldest_pending ? h('p', { class: 'muted' }, `Ältester wartet seit ${relativeTime(m.oldest_pending).replace(/^vor /, '')}`) : null),
    pending ? h('a', { class: 'button primary', href: '/admin/pruefen' }, 'Jetzt prüfen') : h('p', { class: 'muted' }, 'Alles geprüft.'));

  const tile = (label: string, value: string, href?: string, note?: string) =>
    h(href ? 'a' : 'div', { class: 'card tile', href },
      h('p', { class: 'tile-label' }, label), h('p', { class: 'tile-value' }, value), note ? h('p', { class: 'tile-note' }, note) : null);

  const rate = m.review.approval_rate;
  const tiles = h('section', { class: 'tiles' },
    tile('Freigegeben', formatNumber(m.by_status.approved), '/admin/sherms?status=approved'),
    tile('Länder', formatNumber(m.countries.count)),
    tile('Offene Meldungen', formatNumber(m.open_reports), '/admin/meldungen'),
    tile('Wahrscheinlich weg', formatNumber(m.probably_gone), '/admin/sherms?probably_gone=true'),
    tile('Fotos', formatNumber(m.photos), '/admin/galerie', `${formatNumber(m.starred_photos)} markiert`),
    tile('Freigabequote', rate === null ? '–' : `${Math.round(rate * 100)} %`, undefined,
      m.review.median_review_hours === null ? 'letzte 90 Tage' : `Prüfung im Schnitt nach ${formatHours(m.review.median_review_hours)}`));

  const countries = h('section', { class: 'card' },
    h('h2', {}, 'Länder mit den meisten Sherms'),
    m.countries.top.length ? barList(m.countries.top.map(c => ({ label: c.name ?? c.code, value: c.n }))) : h('p', { class: 'muted' }, 'Noch keine'));

  const liked = h('section', { class: 'card' },
    h('h2', {}, 'Beliebteste Sherms'),
    m.top_liked.length
      ? h('ol', { class: 'ranked' }, ...m.top_liked.map(s =>
        h('li', {}, h('a', { href: `/admin/sherms/${s.id}` }, s.title), h('span', { class: 'muted' }, `${formatNumber(s.like_count)} ♥`))))
      : h('p', { class: 'muted' }, 'Noch keine Likes'));

  return h('div', { class: 'dashboard' }, hero, tiles, weeklyChart(m.weekly_submissions), h('div', { class: 'two-col' }, countries, liked));
}

function formatHours(hours: number): string {
  return hours < 48 ? `${hours.toLocaleString('de-DE')} Std.` : `${Math.round(hours / 24)} Tagen`;
}

// Säulendiagramm: eine Reihe, daher keine Legende. Hover/Fokus zeigt den Wert, die Tabelle darunter hat alle.
function weeklyChart(weeks: Metrics['weekly_submissions']): HTMLElement {
  const max = Math.max(1, ...weeks.map(w => w.n));
  const maxIndex = weeks.findIndex(w => w.n === max);
  const tooltip = h('div', { class: 'chart-tooltip', hidden: true, role: 'status' });
  const columns = weeks.map((w, i) => {
    const date = new Date(w.week);
    const firstOfMonth = i === 0 || new Date(weeks[i - 1]!.week).getMonth() !== date.getMonth();
    const label = `Woche ab ${dayFmt.format(date)}: ${formatNumber(w.n)} Einsendung${w.n === 1 ? '' : 'en'}`;
    const col = h('div', { class: 'chart-col', tabindex: 0, 'aria-label': label },
      h('div', { class: 'chart-plot' },
        // Nur der Höchstwert bekommt eine Zahl auf die Säule, der Rest steht im Tooltip und in der Tabelle
        h('div', { class: 'chart-bar', style: `height: ${(w.n / max) * 100}%` },
          i === maxIndex && w.n > 0 ? h('span', { class: 'chart-cap' }, formatNumber(w.n)) : null)),
      h('span', { class: 'chart-x' }, firstOfMonth ? monthFmt.format(date) : ''));
    const showTip = () => {
      tooltip.textContent = label;
      tooltip.hidden = false;
      const r = col.getBoundingClientRect();
      const parent = col.parentElement!.getBoundingClientRect();
      // Am Rand nicht aus dem Diagramm ragen: anhand der echten Breite begrenzen
      const half = tooltip.offsetWidth / 2;
      tooltip.style.left = `${Math.min(Math.max(r.left - parent.left + r.width / 2, half), parent.width - half)}px`;
    };
    col.addEventListener('pointerenter', showTip);
    col.addEventListener('focus', showTip);
    col.addEventListener('pointerleave', () => { tooltip.hidden = true; });
    col.addEventListener('blur', () => { tooltip.hidden = true; });
    return col;
  });

  const table = h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Woche ab'), h('th', { class: 'num' }, 'Einsendungen'))),
    h('tbody', {}, ...weeks.map(w => h('tr', {}, h('td', {}, dayFmt.format(new Date(w.week))), h('td', { class: 'num' }, formatNumber(w.n))))));

  return h('section', { class: 'card' },
    h('h2', {}, 'Einsendungen pro Woche'),
    h('p', { class: 'muted small' }, 'Letzte 26 Wochen'),
    h('div', { class: 'chart', role: 'img', 'aria-label': `Einsendungen pro Woche, höchstens ${formatNumber(max)}` },
      h('div', { class: 'chart-cols' }, ...columns), tooltip),
    h('details', { class: 'chart-table' }, h('summary', {}, 'Als Tabelle anzeigen'), table));
}

function barList(rows: { label: string; value: number }[]): HTMLElement {
  const max = Math.max(1, ...rows.map(r => r.value));
  return h('ul', { class: 'bar-list' }, ...rows.map(r =>
    h('li', {},
      h('span', { class: 'bar-label' }, r.label),
      h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: `width: ${(r.value / max) * 100}%` })),
      h('span', { class: 'bar-value' }, formatNumber(r.value)))));
}
