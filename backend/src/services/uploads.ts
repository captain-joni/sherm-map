import multer from 'multer';
import sharp from 'sharp';
import { LIMITS } from '@sherm/shared';
import { badRequest } from '../http/errors.ts';

// Bild landet im Speicher (max. 15 MB) und wird sofort neu kodiert, nie roh auf die Platte geschrieben
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.imageMaxBytes, files: 1, fields: 10, fieldSize: 16 * 1024 },
});

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif']);

// Prüft am Inhalt (nicht am Dateinamen/Mimetype), ob es ein unterstütztes Bild ist
export async function assertImage(buffer: Buffer): Promise<void> {
  let format: string | undefined;
  try {
    format = (await sharp(buffer).metadata()).format;
  } catch {
    throw badRequest('Datei ist kein gültiges Bild', undefined, 'invalid_image');
  }
  if (!format || !ALLOWED_FORMATS.has(format)) {
    throw badRequest('Bildformat nicht unterstützt (JPEG, PNG oder WebP)', undefined, 'unsupported_image');
  }
}
