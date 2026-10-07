// Ablage der Fotos unter UPLOADS_DIR:
//   original/<key>.jpg   max. 4096 px, nie öffentlich (Instagram, Neuberechnung)
//   display/<key>.webp   1600 px für die Detailansicht
//   thumb/<key>.webp     400 px für Karte und Galerie
//   <datei>              alte Uploads der v1-App (photos.legacy_path), bis sie neu verarbeitet sind
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.ts';

export const VARIANTS = {
  original: '.jpg',
  display: '.webp',
  thumb: '.webp',
} as const;

export type Variant = keyof typeof VARIANTS;

export function variantPath(storageKey: string, variant: Variant): string {
  return path.join(config.uploadsDir, variant, safeKey(storageKey) + VARIANTS[variant]);
}

export function legacyFilePath(legacyPath: string): string {
  return path.join(config.uploadsDir, path.basename(legacyPath));
}

// Beste vorhandene Quelldatei eines Fotos: das Original, sonst die alte v1-Datei. null, wenn beides fehlt.
export function photoSourceFile(storageKey: string, legacyPath: string | null): string | null {
  const original = variantPath(storageKey, 'original');
  if (existsSync(original)) return original;
  const legacy = legacyPath ? legacyFilePath(legacyPath) : null;
  return legacy && existsSync(legacy) ? legacy : null;
}

export async function ensureStorageDirs(): Promise<void> {
  for (const variant of Object.keys(VARIANTS)) {
    await mkdir(path.join(config.uploadsDir, variant), { recursive: true });
  }
}

// Erst in eine temporäre Datei schreiben, dann umbenennen: nie halb geschriebene Bilder
export async function writeFileAtomic(file: string, data: Buffer): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

export async function deletePhotoFiles(storageKey: string): Promise<void> {
  for (const variant of Object.keys(VARIANTS) as Variant[]) {
    await rm(variantPath(storageKey, variant), { force: true });
  }
}

function safeKey(storageKey: string): string {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(storageKey)) throw new Error(`Ungültiger storage_key: ${storageKey}`);
  return storageKey;
}
