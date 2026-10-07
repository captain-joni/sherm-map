// Ortssuche über Photon (OpenStreetMap-Daten, komoot). Läuft über unser Backend, damit die CSP
// streng bleibt, wir cachen können und die Fair-Use-Regeln einhalten (eigener User-Agent, Limit).
import type { GeocodeResult } from '@sherm/shared';

const CACHE_MAX = 1000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 5000;

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; city?: string; state?: string; country?: string; street?: string; housenumber?: string };
}

export function createGeocoder(baseUrl: string, userAgent: string, fetchImpl: typeof fetch = fetch) {
  const cache = new Map<string, { at: number; results: GeocodeResult[] }>();

  return async function geocode(q: string): Promise<GeocodeResult[]> {
    const key = q.toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results;

    const url = new URL(baseUrl);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '6');
    url.searchParams.set('lang', 'de');
    const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
    const data = (await res.json()) as { features?: PhotonFeature[] };

    const results = (data.features ?? []).map(f => {
      const p = f.properties;
      const name = p.name ?? [p.street, p.housenumber].filter(Boolean).join(' ') ?? p.city ?? '';
      const detail = [p.city !== p.name ? p.city : null, p.state, p.country].filter(Boolean).join(', ') || null;
      return { name: name || detail || '?', detail, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
    });

    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), results });
    return results;
  };
}

export type Geocoder = ReturnType<typeof createGeocoder>;
