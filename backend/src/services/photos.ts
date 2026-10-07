import type pg from 'pg';
import { processPhoto } from './images.ts';
import { photoSourceFile } from './storage.ts';
import { progress } from '../util.ts';

interface PhotoRow {
  id: number;
  storage_key: string;
  legacy_path: string | null;
}

// Erzeugt die Varianten für alle Fotos mit processed_at IS NULL (oder alle mit all=true).
// Gibt die Fehlermeldungen zurück, statt beim ersten kaputten Bild abzubrechen.
export async function processPendingPhotos(pool: pg.Pool, { all = false } = {}): Promise<{ total: number; failed: string[] }> {
  const { rows } = await pool.query<PhotoRow>(
    `SELECT id, storage_key, legacy_path FROM photos ${all ? '' : 'WHERE processed_at IS NULL'} ORDER BY id`
  );
  const failed: string[] = [];

  for (const [i, photo] of rows.entries()) {
    // Ein vorhandenes Original hat Vorrang (Import, --all), sonst die alte v1-Datei
    const source = photoSourceFile(photo.storage_key, photo.legacy_path);

    try {
      if (!source) throw new Error(`Quelldatei fehlt (${photo.legacy_path ?? photo.storage_key})`);
      const meta = await processPhoto(source, photo.storage_key);
      await pool.query(
        `UPDATE photos SET width = $2, height = $3, bytes = $4, sha256 = $5, processed_at = now() WHERE id = $1`,
        [photo.id, meta.width, meta.height, meta.bytes, meta.sha256]
      );
    } catch (err) {
      failed.push(`Foto ${photo.id}: ${(err as Error).message.split('\n')[0]}`);
    }
    progress(i + 1, rows.length, 'Fotos: ');
  }

  return { total: rows.length, failed };
}
