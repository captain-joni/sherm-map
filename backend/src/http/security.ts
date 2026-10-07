import type { RequestHandler } from 'express';
import helmet from 'helmet';
import { forbidden } from './errors.ts';

const TILE_HOSTS = ['https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'];

export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:', ...TILE_HOSTS],
        // Der Service Worker lädt die Kacheln per fetch (zum Cachen), dafür gilt connect-src
        'connect-src': ["'self'", ...TILE_HOSTS],
        'worker-src': ["'self'"],
        'manifest-src': ["'self'"],
        'upgrade-insecure-requests': null, // HTTPS macht Traefik, lokal läuft alles über http
      },
    },
    // OSM-Tileserver verlangt einen Referer (Tile Usage Policy), helmets Default "no-referrer" führt zu 403
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
}

// CSRF-Schutz für ändernde Requests mit Session-Cookie: nur von der eigenen Seite.
// Das Cookie ist zusätzlich SameSite=Strict; das hier deckt ältere Browser und Subdomains ab.
export function sameOriginOnly(publicUrl: string): RequestHandler {
  const allowed = new URL(publicUrl).origin;
  return (req, _res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const site = req.get('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none') return next(forbidden('Fremde Herkunft'));
    const origin = req.get('origin');
    if (origin && origin !== allowed && origin !== `${req.protocol}://${req.get('host')}`) {
      return next(forbidden('Fremde Herkunft'));
    }
    next();
  };
}
