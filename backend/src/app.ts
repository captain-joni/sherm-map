import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import type pg from 'pg';
import type { ServerConfig } from './config.ts';
import { loadSession } from './auth/sessions.ts';
import { apiNotFound, errorHandler } from './http/errors.ts';
import { createRateLimits } from './http/rate-limits.ts';
import { sameOriginOnly, securityHeaders } from './http/security.ts';
import { adminRouter } from './routes/admin/index.ts';
import { authRouter } from './routes/auth.ts';
import { mediaRouter } from './routes/media.ts';
import { publicRouter } from './routes/public.ts';
import { createGeocoder, type Geocoder } from './services/geocode.ts';
import { makeHasher } from './services/hashing.ts';
import { createNotifier, type Notify } from './services/notify.ts';
import { indexHtmlLoader, injectOg, ogTags } from './services/share.ts';
import { getPublicSherm } from './services/sherms.ts';

export interface AppDeps {
  pool: pg.Pool;
  cfg: ServerConfig;
  geocode?: Geocoder; // in Tests ersetzbar
  rateLimitScale?: number;
  notify?: Notify; // in Tests ersetzbar
}

export function createApp({ pool, cfg, geocode, rateLimitScale = 1, notify }: AppDeps): express.Express {
  const app = express();
  if (cfg.trustProxy) app.set('trust proxy', cfg.trustProxy);

  const limits = createRateLimits(rateLimitScale);
  const hasher = makeHasher(cfg.hashSecret);

  app.use(securityHeaders(cfg.frameAncestors));
  app.use(express.json({ limit: '20kb' }));
  app.use(loadSession(pool, cfg));
  app.use('/api', sameOriginOnly(cfg.publicUrl));

  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

  app.use('/api/auth', authRouter(pool, cfg, limits));
  app.use(mediaRouter(pool));
  app.use('/api/admin', adminRouter(pool, cfg));
  app.use('/api', publicRouter({
    pool, hasher, limits, publicUrl: cfg.publicUrl,
    notify: notify ?? createNotifier(cfg.notifyWebhookUrl, cfg.notifyWebhookToken),
    geocode: geocode ?? createGeocoder(cfg.geocoderUrl, `ShermMap/2.0 (${cfg.publicUrl})`),
  }));
  app.use('/api', apiNotFound);

  // Frontend (Phase 3): gebautes web/dist ausliefern, unbekannte Pfade ohne Dateiendung -> index.html
  if (existsSync(cfg.webDist)) {
    const indexHtml = indexHtmlLoader(path.join(cfg.webDist, 'index.html'), cfg.production);

    // Geteilte Links mit Vorschau (Titel + Foto) für Messenger
    app.get('/s/:id', async (req, res) => {
      const id = Number(req.params.id);
      const sherm = Number.isInteger(id) && id > 0 ? await getPublicSherm(pool, id) : null;
      const html = await indexHtml();
      res.set('Cache-Control', 'no-cache');
      res.type('html').send(sherm ? injectOg(html, ogTags(sherm, cfg.publicUrl)) : html);
    });

    // sw.js und index.html nie lange cachen, sonst bleiben Nutzer auf alten Versionen hängen
    app.use(express.static(cfg.webDist, {
      index: 'index.html',
      setHeaders: (res, file) => {
        const name = path.basename(file);
        res.set('Cache-Control', file.includes(`${path.sep}assets${path.sep}`)
          ? 'public, max-age=31536000, immutable'
          : name === 'sw.js' || name.endsWith('.html') || name.endsWith('.webmanifest') ? 'no-cache' : 'public, max-age=86400');
      },
    }));
    app.get(/^\/admin(\/.*)?$/, (_req, res) => res.sendFile(path.join(cfg.webDist, 'admin', 'index.html')));
    app.get(/^[^.]*$/, (_req, res) => res.sendFile(path.join(cfg.webDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
