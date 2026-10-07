// "In meiner Nähe": eigener Standort plus die nächsten Sherms ins Bild holen
import L from 'leaflet';
import { LocateFixed } from 'lucide';
import type { MapSherm } from '@sherm/shared';
import { h, icon, toast } from '../lib/dom.ts';
import { distance, formatDistance } from '../lib/format.ts';

export function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Dein Browser kann keinen Standort bestimmen'));
    navigator.geolocation.getCurrentPosition(resolve, err => {
      reject(new Error(err.code === err.PERMISSION_DENIED
        ? 'Standort-Zugriff ist blockiert. Du kannst ihn in den Browser-Einstellungen erlauben.'
        : 'Standort konnte nicht bestimmt werden'));
    }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 });
  });
}

export function userMarker(): L.Marker {
  return L.marker([0, 0], {
    icon: L.divIcon({ className: 'user-dot', html: '<span></span>', iconSize: [22, 22] }),
    interactive: false,
    keyboard: false,
    zIndexOffset: 1000,
  });
}

export function createLocateButton(map: L.Map, sherms: () => MapSherm[]): HTMLElement {
  const dot = userMarker();
  const accuracy = L.circle([0, 0], { radius: 0, className: 'user-accuracy', interactive: false });
  const button = h('button', { class: 'fab fab-small', type: 'button', 'aria-label': 'Sherms in meiner Nähe' }, icon(LocateFixed));

  button.addEventListener('click', async () => {
    button.classList.add('busy');
    try {
      const { coords } = await getPosition();
      const me = { lat: coords.latitude, lng: coords.longitude };
      dot.setLatLng(me).addTo(map);
      accuracy.setLatLng(me).setRadius(coords.accuracy).addTo(map);

      const nearest = sherms()
        .map(s => ({ s, d: distance(me, s) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 3);
      if (!nearest.length) {
        map.setView(me, 15);
        return;
      }
      const bounds = L.latLngBounds([me, ...nearest.map(n => n.s)]);
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
      toast(`Nächster Sherm: ${formatDistance(nearest[0]!.d)} entfernt`);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      button.classList.remove('busy');
    }
  });

  return button;
}
