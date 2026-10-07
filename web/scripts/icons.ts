// Erzeugt die App-Icons (PWA, Apple Touch, Favicon) aus einem SVG. Ergebnis wird committet.
//   npm run icons -w web
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const OUT = path.join(import.meta.dirname, '..', 'public', 'icons');
const BLUE = '#1d4ed8';

// Weißer Kartenpin auf blauem Grund. padding = Anteil Rand (maskable Icons brauchen ~20 % Sicherheitszone)
function svg(size: number, padding: number, rounded: boolean): string {
  const inner = size * (1 - 2 * padding);
  const s = inner / 24;
  const o = size * padding;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${rounded ? size * 0.22 : 0}" fill="${BLUE}"/>
    <g transform="translate(${o} ${o}) scale(${s})">
      <path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" fill="#fff"/>
      <circle cx="12" cy="10" r="2.8" fill="${BLUE}"/>
    </g>
  </svg>`;
}

const icons = [
  { file: 'icon-192.png', size: 192, padding: 0.14, rounded: true },
  { file: 'icon-512.png', size: 512, padding: 0.14, rounded: true },
  { file: 'icon-maskable-512.png', size: 512, padding: 0.24, rounded: false },
  { file: 'apple-touch-icon.png', size: 180, padding: 0.16, rounded: false },
  { file: 'favicon-32.png', size: 32, padding: 0.08, rounded: true },
];

for (const icon of icons) {
  await sharp(Buffer.from(svg(icon.size, icon.padding, icon.rounded))).png().toFile(path.join(OUT, icon.file));
}
await writeFile(path.join(OUT, 'icon.svg'), svg(64, 0.1, true));
console.log(`✅ ${icons.length + 1} Icons in ${OUT}`);
