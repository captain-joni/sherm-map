// Foto vor dem Upload verkleinern und als JPEG neu kodieren: spart mobile Daten, macht HEIC
// (iPhone) zu JPEG und entfernt dabei schon auf dem Gerät die EXIF-Daten (GPS!).
const MAX_SIZE = 2048;
const QUALITY = 0.85;

export async function compressImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIZE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; // Transparenz wird weiß, wie im Backend
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise((resolve, reject) =>
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Bild konnte nicht verarbeitet werden'))), 'image/jpeg', QUALITY));
}
