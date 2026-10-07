// Die wichtigsten Abläufe einmal durch: eintragen (online und offline), prüfen, auf der Karte sehen,
// Link-Vorschau, Like, Meldung.
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

test.describe.configure({ mode: 'serial' });

let photo: Buffer;
test.beforeAll(async () => {
  photo = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#2563eb' } }).jpeg().toBuffer();
});

async function addSherm(page: Page, title: string) {
  await page.getByRole('button', { name: 'Sherm eintragen' }).click();
  await expect(page.locator('.add-coords')).toContainText('GPS'); // Standort ist erlaubt -> wird direkt geholt
  await page.getByRole('button', { name: 'Hier ist der Sherm' }).click();
  await page.locator('.add-step-photo input[type=file]:not([capture])').setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect(page.locator('.add-preview img')).toBeVisible();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.locator('input[name=title]').fill(title);
  await page.getByRole('button', { name: 'Sherm eintragen' }).click();
}

async function adminLogin(page: Page) {
  await page.goto('/admin');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible();
}

test('Sherm eintragen mit GPS und Foto', async ({ page }) => {
  await page.goto('/');
  await addSherm(page, 'E2E Sherm Online');
  await expect(page.getByText('Dein Sherm ist eingetragen')).toBeVisible();
});

test('Offline eintragen, wird nachgereicht sobald wieder Netz da ist', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('#map .leaflet-tile-pane')).toBeAttached();
  await context.setOffline(true);
  await addSherm(page, 'E2E Sherm Offline');
  await expect(page.getByText('Wird hochgeladen, sobald du Netz hast')).toBeVisible();
  await page.getByRole('button', { name: 'Zur Karte' }).click();
  await expect(page.locator('.queue-chip')).toContainText('wartet auf Upload');
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.queue-chip')).toBeHidden({ timeout: 15_000 });
});

test('Admin prüft und gibt frei, Sherm erscheint auf der Karte', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/pruefen');
  await expect(page.locator('.queue-info h2')).toHaveText('E2E Sherm Online');
  await page.keyboard.press('a');
  await expect(page.locator('.toast')).toContainText('freigegeben');
  await expect(page.locator('.queue-info h2')).toHaveText('E2E Sherm Offline');
  await page.getByRole('button', { name: /Ablehnen/ }).click();
  await page.getByRole('button', { name: 'Kein Sherm zu sehen' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Ablehnen' }).click();
  await expect(page.getByText('Alles geprüft')).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: 'Suchen', exact: true }).click();
  await page.getByLabel('Suche', { exact: true }).fill('E2E');
  await expect(page.locator('.search-item')).toHaveCount(1); // nur der freigegebene
  await page.locator('.search-item').click();
  await expect(page.locator('.detail-header h2')).toHaveText('E2E Sherm Online');
  await expect(page).toHaveURL(/\/s\/\d+$/);
});

test('Geteilter Link hat eine Vorschau mit Titel und Foto', async ({ request }) => {
  const list = await (await request.get('/api/sherms')).json();
  const html = await (await request.get(`/s/${list[0].id}`)).text();
  expect(html).toContain('<meta property="og:title" content="E2E Sherm Online">');
  expect(html).toMatch(/og:image" content="http:\/\/localhost:3990\/media\/display\//);
});

test('Liken und melden, Meldung landet im Admin', async ({ page }) => {
  const list = await (await page.request.get('/api/sherms')).json();
  await page.goto(`/s/${list[0].id}`);
  await page.getByRole('button', { name: /Gefällt mir · 0/ }).click();
  await expect(page.getByRole('button', { name: /Gefällt mir · 1/ })).toHaveAttribute('aria-pressed', 'true');

  await page.locator('.sheet-handle').click();
  await page.getByRole('button', { name: 'Sherm melden' }).click();
  await page.getByLabel('Person, Gesicht oder Kennzeichen zu erkennen').check();
  await page.locator('dialog').getByRole('button', { name: 'Melden' }).click();
  await expect(page.locator('.toast')).toContainText('Danke');

  await adminLogin(page);
  await page.goto('/admin/meldungen');
  await expect(page.locator('.report h2')).toContainText('E2E Sherm Online');
});
