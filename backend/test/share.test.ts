// Ausliefern des Frontends und Link-Vorschau für geteilte Sherms
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, ADMIN_URL, loginAgent, phoneJpeg, setupTestApp } from './helpers.ts';

const INDEX = `<!doctype html><html><head>
  <title>Sherm Map</title>
  <!--og-start-->
  <meta property="og:title" content="Sherm Map">
  <!--og-end-->
</head><body><div id="app"></div></body></html>`;

describe.skipIf(!ADMIN_URL)('Frontend und Link-Vorschau', () => {
  let env: Awaited<ReturnType<typeof setupTestApp>>;
  let dist: string;

  beforeAll(async () => {
    dist = await mkdtemp(path.join(os.tmpdir(), 'sherm-dist-'));
    await mkdir(path.join(dist, 'assets'));
    await mkdir(path.join(dist, 'admin'));
    await writeFile(path.join(dist, 'index.html'), INDEX);
    await writeFile(path.join(dist, 'admin', 'index.html'), '<html>admin</html>');
    await writeFile(path.join(dist, 'assets', 'main-abc.js'), 'console.log(1)');
    await writeFile(path.join(dist, 'sw.js'), '// sw');
    env = await setupTestApp({ webDist: dist });
  });

  afterAll(async () => {
    await env?.cleanup();
    await rm(dist, { recursive: true, force: true });
  });

  it('setzt Titel und Foto eines freigegebenen Sherms als Open-Graph-Tags, sicher escaped', async () => {
    const res = await request(env.app).post('/api/sherms')
      .field('uuid', randomUUID()).field('title', 'Sherm "am" <Fluss> & so').field('lat', '49.41').field('lng', '8.69')
      .attach('image', await phoneJpeg(), 'a.jpg');
    const admin = await loginAgent(env.app, ADMIN.username, ADMIN.password);

    // Vor der Freigabe: keine Details verraten
    const hidden = await request(env.app).get(`/s/${res.body.id}`);
    expect(hidden.text).toContain('<meta property="og:title" content="Sherm Map">');

    const approved = await admin.post(`/api/admin/sherms/${res.body.id}/approve`).send({});
    expect([res.status, approved.status]).toEqual([201, 200]);
    const page = await request(env.app).get(`/s/${res.body.id}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('<meta property="og:title" content="Sherm &quot;am&quot; &lt;Fluss&gt; &amp; so">');
    expect(page.text).toMatch(/<meta property="og:image" content="http:\/\/localhost:3000\/media\/display\/[\w-]+\.webp\?v=\w+">/);
    expect(page.text).toContain('<meta property="og:image:width" content="1600">');
    expect(page.text).not.toContain('<title>Sherm Map</title>');
    expect(page.text).not.toContain('<Fluss>');
  });

  it('liefert die App für unbekannte Pfade, Admin-Seite und Cache-Header', async () => {
    expect((await request(env.app).get('/irgendwo')).text).toContain('<div id="app">');
    expect((await request(env.app).get('/s/999999')).text).toContain('og:title" content="Sherm Map"');
    expect((await request(env.app).get('/admin/sherms')).text).toContain('admin');
    expect((await request(env.app).get('/assets/main-abc.js')).headers['cache-control']).toContain('immutable');
    expect((await request(env.app).get('/sw.js')).headers['cache-control']).toBe('no-cache');
    expect((await request(env.app).get('/api/gibtsnicht')).status).toBe(404);
  });
});
