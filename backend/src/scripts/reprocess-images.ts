// Erzeugt die Bildvarianten (original/display/thumb) für alle Fotos, denen sie noch fehlen:
// alte v1-Uploads nach der Migration und Fotos aus einem Import.
//   npm run reprocess-images -w backend                    fehlende Varianten erzeugen
//   npm run reprocess-images -w backend -- --all           alle Fotos neu aus original/ berechnen
//   npm run reprocess-images -w backend -- --delete-legacy alte v1-Dateien verarbeiteter Fotos löschen
import { readdir, rm } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { config } from '../config.ts';
import { pool } from '../db/pool.ts';
import { processPendingPhotos } from '../services/photos.ts';
import { legacyFilePath } from '../services/storage.ts';

const { values } = parseArgs({
  options: {
    all: { type: 'boolean', default: false },
    'delete-legacy': { type: 'boolean', default: false },
  },
});

interface PhotoRow {
  id: number;
  legacy_path: string | null;
}

async function processMissing() {
  const { total, failed } = await processPendingPhotos(pool, { all: values.all });
  console.log(`✅ ${total - failed.length} von ${total} Fotos verarbeitet`);
  if (failed.length) {
    console.error(`❌ ${failed.length} fehlgeschlagen:\n  ${failed.join('\n  ')}`);
    process.exitCode = 1;
  }
}

async function deleteLegacy() {
  const { rows } = await pool.query<PhotoRow>(
    `SELECT id, legacy_path FROM photos WHERE legacy_path IS NOT NULL AND processed_at IS NOT NULL`
  );
  for (const photo of rows) {
    await rm(legacyFilePath(photo.legacy_path!), { force: true });
    await pool.query('UPDATE photos SET legacy_path = NULL WHERE id = $1', [photo.id]);
  }
  console.log(`🗑️  ${rows.length} alte Dateien gelöscht`);
}

// Alte Uploads ohne zugehöriges Foto (v1 hat beim Löschen die Bilder liegen lassen) nur melden
async function reportOrphans() {
  const files = (await readdir(config.uploadsDir, { withFileTypes: true })).filter(e => e.isFile()).map(e => e.name);
  const { rows } = await pool.query<{ legacy_path: string }>('SELECT legacy_path FROM photos WHERE legacy_path IS NOT NULL');
  const referenced = new Set(rows.map(r => legacyFilePath(r.legacy_path)));
  const orphans = files.filter(f => !referenced.has(legacyFilePath(f)) && !f.endsWith('.tmp'));
  if (orphans.length) {
    console.log(`ℹ️  ${orphans.length} alte Dateien in ${config.uploadsDir} gehören zu keinem Sherm (z.B. von gelöschten v1-Sherms):`);
    for (const f of orphans.slice(0, 20)) console.log(`   ${f}`);
    if (orphans.length > 20) console.log('   ...');
  }
}

async function main() {
  if (values['delete-legacy']) await deleteLegacy();
  else await processMissing();
  await reportOrphans();
}

main()
  .catch(err => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
