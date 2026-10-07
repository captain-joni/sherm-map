// Kleine Karte für Prüfung und Bearbeitung: roter Pin = dieser Sherm, blaue Pins = andere in der Nähe.
// Mit draggable lässt sich der Pin verschieben (Ort korrigieren).
import L from 'leaflet';
import { h } from '../../lib/dom.ts';

const pin = (color: string, size = 30) => L.divIcon({
  className: 'pin',
  html: `<svg viewBox="0 0 24 32" width="${size}" height="${size * 4 / 3}" aria-hidden="true"><path d="M12 31s10-9.3 10-18A10 10 0 0 0 2 13c0 8.7 10 18 10 18z" style="fill:${color}"/><circle cx="12" cy="12.5" r="4"/></svg>`,
  iconSize: [size, size * 4 / 3],
  iconAnchor: [size / 2, size * 4 / 3 - 1],
});

export interface MiniMapOptions {
  lat: number;
  lng: number;
  zoom?: number;
  nearby?: { lat: number; lng: number; title: string }[];
  draggable?: boolean;
  onMove?: (lat: number, lng: number) => void;
}

export function createMiniMap(opts: MiniMapOptions) {
  const element = h('div', { class: 'mini-map' });
  const map = L.map(element, { zoomControl: true, attributionControl: true, scrollWheelZoom: false })
    .setView([opts.lat, opts.lng], opts.zoom ?? 17);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, crossOrigin: true, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
  }).addTo(map);

  for (const n of opts.nearby ?? []) {
    L.marker([n.lat, n.lng], { icon: pin('#1d4ed8', 24), title: n.title }).bindTooltip(n.title).addTo(map);
  }
  const marker = L.marker([opts.lat, opts.lng], { icon: pin('#dc2626'), draggable: opts.draggable, zIndexOffset: 1000 }).addTo(map);
  marker.on('dragend', () => {
    const p = marker.getLatLng().wrap();
    opts.onMove?.(p.lat, p.lng);
  });

  // Die Karte entsteht, bevor das Element im DOM hängt: Größe nachziehen, sobald sie sichtbar ist
  const observer = new ResizeObserver(() => map.invalidateSize());
  observer.observe(element);

  return {
    element,
    map,
    setPosition(lat: number, lng: number) {
      marker.setLatLng([lat, lng]);
      map.setView([lat, lng]);
    },
    destroy() {
      observer.disconnect();
      map.remove();
    },
  };
}
