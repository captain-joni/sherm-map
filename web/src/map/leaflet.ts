// leaflet.markercluster erwartet ein globales L, daher hier einmal setzen und überall von hier importieren
import L from 'leaflet';

(window as unknown as { L: typeof L }).L = L;

export default L;
