// API-Tests für Phase 2. Laufen gegen eine echte PostGIS-DB (TEST_DATABASE_URL).
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, ADMIN_URL, loginAgent, phoneJpeg, setupTestApp } from './helpers.ts';

const { preEditPath, variantPath } = await import('../src/services/storage.ts');
const { purgeDeleted } = await import('../src/services/maintenance.ts');

type Env = Awaited<ReturnType<typeof setupTestApp>>;

describe.skipIf(!ADMIN_URL)('API v2', () => {
  let env: Env;
  let admin: request.Agent;
  let jpeg: Buffer;

  beforeAll(async () => {
    env = await setupTestApp();
    admin = await loginAgent(env.app, ADMIN.username, ADMIN.password);
    jpeg = await phoneJpeg();
    // Mini-"Deutschland" rund um Heidelberg, damit der Länder-Trigger etwas zu tun hat
    await env.pool.query(`
      INSERT INTO countries (code, name_de, name_en, geom)
      VALUES ('DE', 'Deutschland', 'Germany', ST_Multi(ST_MakeEnvelope(8, 49, 9.5, 50, 4326)));
      INSERT INTO country_parts (code, geom) SELECT code, (ST_Dump(geom)).geom FROM countries;
    `);
  }, 60_000);

  afterAll(async () => {
    await env?.cleanup();
  });

  // Sherm einsenden (öffentlich)
  async function submit(fields: Record<string, string | number> = {}, image: Buffer | null = jpeg) {
    const req = request(env.app).post('/api/sherms');
    const data = { uuid: randomUUID(), title: 'Test Sherm', description: 'Beschreibung', lat: 49.41, lng: 8.69, ...fields };
    for (const [k, v] of Object.entries(data)) req.field(k, String(v));
    if (image) req.attach('image', image, 'foto.jpg');
    return req;
  }

  async function submitAndApprove(fields: Record<string, string | number> = {}) {
    const res = await submit(fields);
    expect(res.status).toBe(201);
    const approved = await admin.post(`/api/admin/sherms/${res.body.id}/approve`).send({});
    expect(approved.status).toBe(200);
    return approved.body as { id: number; photos: { id: number; storage_key: string }[] };
  }

  it('health', async () => {
    expect((await request(env.app).get('/api/health')).body).toEqual({ ok: true });
  });

  describe('Einsenden', () => {
    it('legt einen Sherm als pending an, entfernt EXIF und setzt das Land', async () => {
      const res = await submit();
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('pending');

      const { rows } = await env.pool.query(
        'SELECT m.country_code, m.source_hash, p.storage_key, p.width FROM markers m JOIN photos p ON p.marker_id = m.id WHERE m.id = $1',
        [res.body.id]);
      expect(rows[0].country_code).toBe('DE');
      expect(rows[0].source_hash).toMatch(/^[\w-]{32}$/);
      expect(rows[0].width).toBe(2400);
      const meta = await sharp(variantPath(rows[0].storage_key, 'original')).metadata();
      expect(meta.exif).toBeUndefined();
      expect(existsSync(variantPath(rows[0].storage_key, 'thumb'))).toBe(true);
    });

    it('ist idempotent über die uuid (Offline-Wiederholung)', async () => {
      const uuid = randomUUID();
      const first = await submit({ uuid });
      const second = await submit({ uuid });
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.id).toBe(first.body.id);
    });

    it('speichert bei ausgefülltem Honeypot nichts', async () => {
      const before = (await env.pool.query('SELECT count(*)::int AS n FROM markers')).rows[0].n;
      const res = await submit({ website: 'http://spam.example' });
      expect(res.status).toBe(202);
      expect((await env.pool.query('SELECT count(*)::int AS n FROM markers')).rows[0].n).toBe(before);
    });

    it('lehnt ungültige Eingaben und Nicht-Bilder ab', async () => {
      expect((await submit({ lat: 91 })).status).toBe(400);
      expect((await submit({ title: '   ' })).status).toBe(400);
      expect((await submit({ title: 'x'.repeat(101) })).status).toBe(400);
      expect((await submit({ uuid: 'nicht-uuid' })).status).toBe(400);
      const fake = await submit({}, Buffer.from('<script>alert(1)</script>'));
      expect(fake.status).toBe(400);
      expect(fake.body.error).toBe('Datei ist kein gültiges Bild');
      const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).gif().toBuffer();
      expect((await submit({}, gif)).status).toBe(400);
    });

    it('geht auch ohne Foto', async () => {
      expect((await submit({}, null)).status).toBe(201);
    });

    it('geht ohne Beschreibung (Feld fehlt ganz, wie aus dem Frontend)', async () => {
      const res = await request(env.app).post('/api/sherms')
        .field('uuid', randomUUID()).field('title', 'Nur Titel').field('lat', '49.4').field('lng', '8.7');
      expect(res.status).toBe(201);
      const { rows } = await env.pool.query('SELECT description FROM markers WHERE id = $1', [res.body.id]);
      expect(rows[0].description).toBeNull();
    });
  });

  describe('Sichtbarkeit', () => {
    it('zeigt pending Sherms und ihre Bilder nicht öffentlich', async () => {
      const res = await submit({ title: 'Geheim' });
      const list = await request(env.app).get('/api/sherms');
      expect(list.body.find((s: { id: number }) => s.id === res.body.id)).toBeUndefined();
      expect((await request(env.app).get(`/api/sherms/${res.body.id}`)).status).toBe(404);

      const key = (await env.pool.query('SELECT storage_key FROM photos WHERE marker_id = $1', [res.body.id])).rows[0].storage_key;
      expect((await request(env.app).get(`/media/thumb/${key}.webp`)).status).toBe(404);
      expect((await admin.get(`/api/admin/media/thumb/${key}.webp`)).status).toBe(200);
    });

    it('zeigt freigegebene Sherms mit Fotos, Originale nur für Admins', async () => {
      const sherm = await submitAndApprove({ title: 'Öffentlich' });
      const list = await request(env.app).get('/api/sherms');
      expect(list.headers['access-control-allow-origin']).toBe('*');
      const entry = list.body.find((s: { id: number }) => s.id === sherm.id);
      expect(entry.thumb).toMatch(/^\/media\/thumb\/[\w-]+\.webp\?v=/);

      const detail = await request(env.app).get(`/api/sherms/${sherm.id}`);
      expect(detail.body).toMatchObject({ title: 'Öffentlich', country_code: 'DE', country_name: 'Deutschland', probably_gone: false });
      const thumb = await request(env.app).get(detail.body.photo.thumb);
      expect(thumb.status).toBe(200);
      expect(thumb.headers['content-type']).toBe('image/webp');

      const key = sherm.photos[0]!.storage_key;
      expect((await request(env.app).get(`/media/original/${key}.jpg`)).status).toBe(404);
      expect((await request(env.app).get(`/api/admin/media/original/${key}.jpg`)).status).toBe(401);
      expect((await admin.get(`/api/admin/media/original/${key}.jpg`)).status).toBe(200);
    });

    it('filtert per Bounding Box', async () => {
      const far = await submitAndApprove({ title: 'Sydney', lat: -33.86, lng: 151.21 });
      const europe = await request(env.app).get('/api/sherms?bbox=-10,35,30,60');
      expect(europe.body.some((s: { id: number }) => s.id === far.id)).toBe(false);
      const pacific = await request(env.app).get('/api/sherms?bbox=150,-40,-170,0'); // über die Datumsgrenze
      expect(pacific.body.map((s: { id: number }) => s.id)).toEqual([far.id]);
      expect((await request(env.app).get('/api/sherms?bbox=1,2,3')).status).toBe(400);
    });
  });

  describe('Reaktionen und Meldungen', () => {
    it('zählt Likes pro Gerät und hält "noch da"/"weg" exklusiv', async () => {
      const { id } = await submitAndApprove();
      const a = randomUUID(), b = randomUUID();
      const react = (kind: string, device_id: string) => request(env.app).post(`/api/sherms/${id}/reactions`).send({ kind, device_id });

      await react('like', a);
      expect((await react('like', a)).body.like_count).toBe(1);
      expect((await react('like', b)).body.like_count).toBe(2);
      expect((await react('still_there', a)).body).toMatchObject({ still_there_count: 1, gone_count: 0 });
      expect((await react('gone', a)).body).toMatchObject({ still_there_count: 0, gone_count: 1 });

      const unlike = await request(env.app).delete(`/api/sherms/${id}/reactions/like?device_id=${a}`);
      expect(unlike.body.like_count).toBe(1);
    });

    it('erlaubt keine Reaktionen auf nicht freigegebene Sherms', async () => {
      const { body } = await submit();
      expect((await request(env.app).post(`/api/sherms/${body.id}/reactions`).send({ kind: 'like' })).status).toBe(404);
    });

    it('nimmt Meldungen an, eine offene pro Person, und Admins erledigen sie', async () => {
      const { id } = await submitAndApprove();
      const report = () => request(env.app).post(`/api/sherms/${id}/reports`).send({ reason: 'privacy', comment: 'Gesicht' });
      expect((await report()).status).toBe(201);
      expect((await report()).status).toBe(201);
      expect((await request(env.app).post(`/api/sherms/${id}/reports`).send({ reason: 'quatsch' })).status).toBe(400);

      const list = await admin.get('/api/admin/reports');
      const entry = list.body.items.find((r: { id: number }) => r.id === id);
      expect(entry.reports).toHaveLength(1);

      const filtered = await admin.get('/api/admin/sherms?reported=true');
      expect(filtered.body.items.map((s: { id: number }) => s.id)).toContain(id);

      expect((await admin.post(`/api/admin/reports/sherm/${id}/resolve`).send({ status: 'resolved' })).body).toEqual({ updated: 1 });
      expect((await admin.get('/api/admin/reports')).body.items.find((r: { id: number }) => r.id === id)).toBeUndefined();
    });
  });

  describe('Login und Sessions', () => {
    it('verlangt Login für Admin-Routen und gibt keine Details zu falschen Logins', async () => {
      expect((await request(env.app).get('/api/admin/sherms')).status).toBe(401);
      const wrongUser = await request(env.app).post('/api/auth/login').send({ username: 'gibtsnicht', password: 'x' });
      const wrongPass = await request(env.app).post('/api/auth/login').send({ username: 'admin', password: 'x' });
      expect(wrongUser.status).toBe(401);
      expect(wrongUser.body).toEqual(wrongPass.body);
    });

    it('setzt ein httpOnly SameSite=Strict Cookie und speichert nur dessen Hash', async () => {
      const res = await request(env.app).post('/api/auth/login').send(ADMIN);
      const cookie = res.headers['set-cookie']![0]!;
      expect(cookie).toMatch(/sherm_session=/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      const token = cookie.split(';')[0]!.split('=')[1]!;
      const { rows } = await env.pool.query('SELECT token_hash FROM sessions');
      expect(rows.map(r => r.token_hash)).not.toContain(token);
    });

    it('blockiert ändernde Requests von fremden Seiten (CSRF)', async () => {
      const { body } = await submit();
      const res = await admin.post(`/api/admin/sherms/${body.id}/approve`).set('Origin', 'https://evil.example').send({});
      expect(res.status).toBe(403);
      const res2 = await admin.post(`/api/admin/sherms/${body.id}/approve`).set('Sec-Fetch-Site', 'cross-site').send({});
      expect(res2.status).toBe(403);
    });

    it('Logout beendet die Session', async () => {
      const agent = await loginAgent(env.app, ADMIN.username, ADMIN.password);
      expect((await agent.get('/api/auth/me')).status).toBe(200);
      await agent.post('/api/auth/logout');
      expect((await agent.get('/api/auth/me')).status).toBe(401);
    });
  });

  describe('Moderation', () => {
    it('sucht, filtert und liefert Prüf-Details', async () => {
      const first = await submit({ title: 'Brückenpfeiler Sherm', lat: 49.4136, lng: 8.7106 });
      await submit({ title: 'Nachbar', lat: 49.4137, lng: 8.7107 });

      const search = await admin.get('/api/admin/sherms?q=brückenpfeiler');
      expect(search.body.items.map((s: { id: number }) => s.id)).toEqual([first.body.id]);
      expect((await admin.get(`/api/admin/sherms?q=%23${first.body.id}`)).body.items[0].id).toBe(first.body.id);
      expect((await admin.get('/api/admin/sherms?q=%25')).body.total).toBe(0); // % ist kein Platzhalter

      const pending = await admin.get('/api/admin/sherms?status=pending&sort=oldest&page_size=2');
      expect(pending.body.items).toHaveLength(2);
      expect(pending.body.total).toBeGreaterThan(2);

      const detail = await admin.get(`/api/admin/sherms/${first.body.id}`);
      expect(detail.body.nearby[0]).toMatchObject({ title: 'Nachbar' });
      expect(detail.body.nearby[0].distance_m).toBeLessThan(20);
      expect(detail.body.same_source.length).toBeGreaterThan(0); // gleiche IP im Test
    });

    it('bearbeitet Text und Ort, mit Diff im Audit-Log', async () => {
      const { body } = await submit({ title: 'Tippfeler' });
      const res = await admin.patch(`/api/admin/sherms/${body.id}`).send({ title: 'Tippfehler', lat: 52.52, lng: 13.405 });
      expect(res.body).toMatchObject({ title: 'Tippfehler', lat: 52.52, lng: 13.405, country_code: null });
      expect((await admin.patch(`/api/admin/sherms/${body.id}`).send({ lat: 50 })).status).toBe(400);

      const audit = await admin.get(`/api/admin/audit?sherm_id=${body.id}`);
      expect(audit.body.items[0]).toMatchObject({ action: 'edit', username: 'admin' });
      expect(audit.body.items[0].details.changes.title).toEqual(['Tippfeler', 'Tippfehler']);
    });

    it('verlangt einen Grund beim Ablehnen', async () => {
      const { body } = await submit();
      expect((await admin.post(`/api/admin/sherms/${body.id}/reject`).send({})).status).toBe(400);
      const res = await admin.post(`/api/admin/sherms/${body.id}/reject`).send({ reason: 'Kein Sherm zu sehen' });
      expect(res.body).toMatchObject({ status: 'rejected', reject_reason: 'Kein Sherm zu sehen', reviewed_by: 'admin' });
    });

    it('Papierkorb: löschen, wiederherstellen, nach 30 Tagen endgültig weg', async () => {
      const sherm = await submitAndApprove();
      await admin.post(`/api/admin/sherms/${sherm.id}/delete`).send({});
      expect((await request(env.app).get(`/api/sherms/${sherm.id}`)).status).toBe(404);
      expect((await admin.get('/api/admin/sherms?deleted=true')).body.items.map((s: { id: number }) => s.id)).toContain(sherm.id);
      expect((await admin.post(`/api/admin/sherms/${sherm.id}/approve`).send({})).status).toBe(404);

      await admin.post(`/api/admin/sherms/${sherm.id}/restore`).send({});
      expect((await request(env.app).get(`/api/sherms/${sherm.id}`)).status).toBe(200);

      await admin.post(`/api/admin/sherms/${sherm.id}/delete`).send({});
      await env.pool.query(`UPDATE markers SET deleted_at = now() - interval '31 days' WHERE id = $1`, [sherm.id]);
      const key = sherm.photos[0]!.storage_key;
      expect(await purgeDeleted(env.pool)).toBe(1);
      expect((await env.pool.query('SELECT 1 FROM markers WHERE id = $1', [sherm.id])).rowCount).toBe(0);
      expect(existsSync(variantPath(key, 'original'))).toBe(false);
      const purgeLog = await admin.get(`/api/admin/audit?action=purge&sherm_id=${sherm.id}`);
      expect(purgeLog.body.items).toHaveLength(1);
    });

    it('Sammelaktionen', async () => {
      const ids = [(await submit()).body.id, (await submit()).body.id];
      const res = await admin.post('/api/admin/sherms/bulk').send({ ids: [...ids, 999999], action: 'approve' });
      expect(res.body).toEqual({ updated: 2, ids });
    });

    it('Foto bearbeiten, zurücknehmen, und Freigabe räumt das alte Original weg', async () => {
      const { body } = await submit();
      const detail = await admin.get(`/api/admin/sherms/${body.id}`);
      const photo = detail.body.sherm.photos[0];

      const blurred = await sharp(jpeg).blur(20).jpeg().toBuffer();
      const edited = await admin.put(`/api/admin/photos/${photo.id}/image`).attach('image', blurred, 'edit.jpg');
      expect(edited.body.edited).toBe(true);
      expect(edited.body.urls.thumb).not.toBe(photo.urls.thumb); // neue ?v= Version
      expect(existsSync(preEditPath(photo.storage_key))).toBe(true);

      const reverted = await admin.post(`/api/admin/photos/${photo.id}/revert`).send({});
      expect(reverted.body.edited).toBe(false);

      await admin.put(`/api/admin/photos/${photo.id}/image`).attach('image', blurred, 'edit.jpg');
      await admin.post(`/api/admin/sherms/${body.id}/approve`).send({});
      expect(existsSync(preEditPath(photo.storage_key))).toBe(false);
    });

    it('Galerie und Sterne', async () => {
      const sherm = await submitAndApprove();
      const photoId = sherm.photos[0]!.id;
      await admin.post(`/api/admin/photos/${photoId}/star`).send({ starred: true });
      const starred = await admin.get('/api/admin/photos?starred=true');
      expect(starred.body.items.map((p: { id: number }) => p.id)).toEqual([photoId]);
      expect(starred.body.items[0].sherm.id).toBe(sherm.id);
      expect((await admin.get('/api/admin/photos?page_size=1000')).status).toBe(400);
    });

    it('Kennzahlen', async () => {
      const res = await admin.get('/api/admin/metrics');
      expect(res.body.by_status.approved).toBeGreaterThan(0);
      expect(res.body.countries.top[0]).toMatchObject({ code: 'DE', name: 'Deutschland' });
      expect(res.body.weekly_submissions).toHaveLength(26);
      expect(res.body.review.approval_rate).toBeGreaterThan(0);
    });
  });

  describe('Benutzer und Rollen', () => {
    it('Moderator mit Einmal-Passwort: erst Passwort ändern, dann moderieren, aber nicht löschen', async () => {
      const created = await admin.post('/api/admin/users').send({ username: 'mod1', role: 'moderator' });
      expect(created.status).toBe(201);
      expect((await admin.post('/api/admin/users').send({ username: 'mod1', role: 'moderator' })).status).toBe(409);

      const mod = await loginAgent(env.app, 'mod1', created.body.one_time_password);
      const blocked = await mod.get('/api/admin/sherms');
      expect(blocked.status).toBe(403);
      expect(blocked.body.error).toBe('Bitte zuerst das Passwort ändern');

      expect((await mod.post('/api/auth/password').send({ current_password: 'falsch', new_password: 'neues-passwort-123' })).status).toBe(400);
      expect((await mod.post('/api/auth/password').send({ current_password: created.body.one_time_password, new_password: 'kurz' })).status).toBe(400);
      const changed = await mod.post('/api/auth/password')
        .send({ current_password: created.body.one_time_password, new_password: 'neues-passwort-123' });
      expect(changed.body.must_change_password).toBe(false);

      const { body } = await submit();
      expect((await mod.post(`/api/admin/sherms/${body.id}/approve`).send({})).status).toBe(200);
      expect((await mod.post(`/api/admin/sherms/${body.id}/delete`).send({})).status).toBe(403);
      expect((await mod.get('/api/admin/users')).status).toBe(403);
      expect((await mod.post('/api/admin/system/export')).status).toBe(403);

      // Sperren beendet die Session sofort
      await admin.patch(`/api/admin/users/${created.body.user.id}`).send({ disabled: true });
      expect((await mod.get('/api/admin/sherms')).status).toBe(401);
      expect((await request(env.app).post('/api/auth/login').send({ username: 'mod1', password: 'neues-passwort-123' })).status).toBe(401);
    });

    it('Admin kann sich nicht selbst sperren oder herabstufen', async () => {
      const me = (await admin.get('/api/auth/me')).body;
      expect((await admin.patch(`/api/admin/users/${me.id}`).send({ disabled: true })).status).toBe(400);
      expect((await admin.patch(`/api/admin/users/${me.id}`).send({ role: 'moderator' })).status).toBe(400);
    });
  });

  describe('Sonstiges', () => {
    it('Ortssuche über den (gemockten) Geocoder', async () => {
      const res = await request(env.app).get('/api/geocode?q=Heidelberg');
      expect(res.body[0]).toMatchObject({ name: 'Heidelberg' });
      expect(env.geocodeCalls).toContain('Heidelberg');
      expect((await request(env.app).get('/api/geocode?q=a')).status).toBe(400);
    });

    it('Export als Download für Admins', async () => {
      const res = await admin.post('/api/admin/system/export').buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toMatch(/sherm-export-.*\.tar\.gz/);
      expect((res.body as Buffer).subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b])); // gzip
    });

    it('einheitliches Fehlerformat', async () => {
      const bad = await request(env.app).post('/api/auth/login').set('Content-Type', 'application/json').send('{kaputt');
      expect(bad.status).toBe(400);
      expect(bad.body).toEqual({ error: 'Ungültige Anfrage' });
      expect((await request(env.app).get('/api/gibtsnicht')).body).toEqual({ error: 'Nicht gefunden' });
      expect((await request(env.app).get('/api/sherms/abc')).status).toBe(400);
    });

    it('Rate Limit beim Einsenden (echte Limits)', async () => {
      const strict = await setupTestApp({ rateLimitScale: 1 });
      try {
        const post = () => request(strict.app).post('/api/sherms').send({});
        for (let i = 0; i < 20; i++) expect((await post()).status).toBe(400); // zählt auch ungültige
        const limited = await post();
        expect(limited.status).toBe(429);
        expect(limited.body.error).toMatch(/Zu viele Sherms/);
      } finally {
        await strict.cleanup();
      }
    }, 30_000);

    it('Security-Header', async () => {
      const res = await request(env.app).get('/api/health');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers['content-security-policy']).toContain("script-src 'self'");
      // ohne das blockiert der Service Worker die Kartenkacheln (graue Karte)
      expect(res.headers['content-security-policy']).toContain("connect-src 'self' https://tile.openstreetmap.org");
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });
});
