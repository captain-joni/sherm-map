// Link-Vorschau für geteilte Sherms (/s/:id): WhatsApp, Telegram, Instagram & Co. führen kein
// JavaScript aus, daher setzt der Server Titel und Foto als Open-Graph-Tags ins HTML.
import { readFile } from 'node:fs/promises';
import type { PublicSherm } from '@sherm/shared';

const OG_BLOCK = /<!--og-start-->[\s\S]*?<!--og-end-->/;

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function ogTags(sherm: PublicSherm, publicUrl: string): string {
  const place = [sherm.place_name, sherm.country_name].filter(Boolean).join(', ');
  const description = sherm.description
    ? sherm.description.slice(0, 200) + (sherm.description.length > 200 ? '…' : '')
    : place ? `Ein Sherm in ${place}` : 'Ein Sherm auf der Sherm Map';
  const tags: [string, string][] = [
    ['og:type', 'website'],
    ['og:site_name', 'Sherm Map'],
    ['og:title', sherm.title],
    ['og:description', description],
    ['og:url', `${publicUrl}/s/${sherm.id}`],
  ];
  if (sherm.photo) {
    tags.push(['og:image', `${publicUrl}${sherm.photo.display}`]);
    if (sherm.photo.width && sherm.photo.height) {
      // display ist max. 1600 px, Seitenverhältnis wie das Original
      const scale = Math.min(1, 1600 / Math.max(sherm.photo.width, sherm.photo.height));
      tags.push(['og:image:width', String(Math.round(sherm.photo.width * scale))]);
      tags.push(['og:image:height', String(Math.round(sherm.photo.height * scale))]);
    }
  } else {
    tags.push(['og:image', `${publicUrl}/icons/icon-512.png`]);
  }
  return [
    ...tags.map(([property, content]) => `<meta property="${property}" content="${escapeAttr(content)}">`),
    `<meta name="twitter:card" content="${sherm.photo ? 'summary_large_image' : 'summary'}">`,
    `<title>${escapeAttr(sherm.title)} – Sherm Map</title>`,
  ].join('\n  ');
}

export function injectOg(html: string, tags: string): string {
  // Den Standard-<title> ersetzen die Tags mit, damit es keinen doppelten gibt
  return html.replace(OG_BLOCK, tags).replace(/<title>Sherm Map<\/title>\s*/, '');
}

// index.html einmal lesen; im Dev-Betrieb (kein production) jedes Mal neu
export function indexHtmlLoader(file: string, cache: boolean) {
  let cached: string | null = null;
  return async () => {
    if (cached && cache) return cached;
    cached = await readFile(file, 'utf8');
    return cached;
  };
}
