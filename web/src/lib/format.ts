import { locale, t } from './i18n.ts';

const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600], ['month', 30 * 24 * 3600], ['week', 7 * 24 * 3600],
  ['day', 24 * 3600], ['hour', 3600], ['minute', 60],
];

// "vor 3 Wochen"
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return t('time.justNow');
}

export function formatDistance(meters: number): string {
  // \u00a0: Zahl und Einheit nicht umbrechen
  if (meters < 1000) return `${Math.round(meters / 10) * 10}\u00a0m`;
  return `${(meters / 1000).toLocaleString(locale, { maximumFractionDigits: meters < 10_000 ? 1 : 0 })}\u00a0km`;
}

// Entfernung zweier Punkte auf der Erde in Metern (Haversine)
export function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(x));
}

// Für die Suche: Groß/klein und Akzente egal ("Brücke" findet "brucke")
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}
