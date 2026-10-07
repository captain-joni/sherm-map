// Nach dem Build: zod darf nicht im Browser-Bundle landen (Werte aus @sherm/shared/constants importieren,
// Typen per "import type" aus @sherm/shared). Bricht den Build sonst ab.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const dir = path.join(import.meta.dirname, '..', 'dist', 'assets');
const offenders = [];
for (const file of (await readdir(dir)).filter(f => f.endsWith('.js'))) {
  if ((await readFile(path.join(dir, file), 'utf8')).includes('ZodError')) offenders.push(file);
}
if (offenders.length) {
  console.error(`❌ zod im Browser-Bundle: ${offenders.join(', ')}. Werte aus '@sherm/shared/constants' importieren.`);
  process.exit(1);
}
console.log('✅ Bundle ohne zod');
