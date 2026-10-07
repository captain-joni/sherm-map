// Lädt die Länderpolygone (Natural Earth 1:10m, Public Domain) in die Tabelle countries und
// berechnet danach country_code für alle Sherms neu. Kann beliebig oft laufen.
//   npm run load-countries -w backend [-- --file ne_10m_admin_0_countries.geojson]
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pool } from '../db/pool.ts';

const SOURCE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries.geojson';
const SOURCE_SHA256 = '239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255';

interface Feature {
  properties: { ISO_A2_EH: string; NAME_DE: string; NAME_EN: string };
  geometry: unknown;
}

const { values } = parseArgs({ options: { file: { type: 'string' } } });

async function loadSource(): Promise<Buffer> {
  if (values.file) return readFile(values.file);
  console.log(`Lade ${SOURCE_URL}`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`Download fehlgeschlagen: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const data = await loadSource();
  const hash = createHash('sha256').update(data).digest('hex');
  if (hash !== SOURCE_SHA256) throw new Error(`Unerwartete Prüfsumme der Länderdaten: ${hash}`);

  // -99 = umstrittene Gebiete ohne ISO-Code, die bekommen das nächstgelegene Land (25 km) oder nichts
  const features = (JSON.parse(data.toString('utf8')).features as Feature[])
    .filter(f => /^[A-Z]{2}$/.test(f.properties.ISO_A2_EH));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE countries CASCADE');
    for (const f of features) {
      // Manche Codes kommen mehrfach vor (z.B. australische Außengebiete), die werden vereinigt
      await client.query(
        `INSERT INTO countries (code, name_de, name_en, geom)
         VALUES ($1, $2, $3, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)), 3)))
         ON CONFLICT (code) DO UPDATE SET
           geom = ST_Multi(ST_CollectionExtract(ST_Union(countries.geom, EXCLUDED.geom), 3))`,
        [f.properties.ISO_A2_EH, f.properties.NAME_DE, f.properties.NAME_EN, JSON.stringify(f.geometry)]
      );
    }
    await client.query(`
      INSERT INTO country_parts (code, geom)
      SELECT code, (ST_Dump(ST_Subdivide(geom, 256))).geom FROM countries`);
    await client.query('ANALYZE country_parts');
    const updated = await client.query('UPDATE markers SET country_code = country_for(location)');
    await client.query('COMMIT');

    const { rows } = await client.query<{ n: string }>('SELECT count(*) AS n FROM countries');
    console.log(`✅ ${rows[0]?.n} Länder geladen, ${updated.rowCount} Sherms neu zugeordnet`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch(err => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
