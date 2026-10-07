// Bildverarbeitung: jedes Foto wird neu kodiert. Dabei fallen EXIF-Daten weg (Handyfotos enthalten
// GPS-Position und Geräteinfos) und eventuell in der Datei versteckte Inhalte gleich mit.
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { ensureStorageDirs, variantPath, writeFileAtomic } from './storage.ts';

const SIZES = { original: 4096, display: 1600, thumb: 400 } as const;

export interface ProcessedPhoto {
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

export async function processPhoto(input: string | Buffer, storageKey: string): Promise<ProcessedPhoto> {
  await ensureStorageDirs();

  const original = await sharp(input, { failOn: 'error', limitInputPixels: 120_000_000 })
    .rotate() // nach EXIF-Orientierung drehen, bevor die Metadaten wegfallen
    .resize({ width: SIZES.original, height: SIZES.original, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }) // Transparenz (PNG/WebP) würde in JPEG sonst schwarz
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const display = await sharp(original.data)
    .resize({ width: SIZES.display, height: SIZES.display, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  const thumb = await sharp(original.data)
    .resize({ width: SIZES.thumb, height: SIZES.thumb, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer();

  await writeFileAtomic(variantPath(storageKey, 'original'), original.data);
  await writeFileAtomic(variantPath(storageKey, 'display'), display);
  await writeFileAtomic(variantPath(storageKey, 'thumb'), thumb);

  return {
    width: original.info.width,
    height: original.info.height,
    bytes: original.data.length,
    sha256: createHash('sha256').update(original.data).digest('hex'),
  };
}
