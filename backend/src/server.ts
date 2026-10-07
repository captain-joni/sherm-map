import { loadServerConfig } from './config.ts';
import { createApp } from './app.ts';
import { pool } from './db/pool.ts';
import { migrate } from './db/migrate.ts';
import { ensureAdmin, purgeDeleted } from './services/maintenance.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const cfg = loadServerConfig();

  const applied = await migrate(pool);
  if (applied.length) console.log(`✅ ${applied.length} Migration(en) angewendet`);
  await ensureAdmin(pool, cfg);

  const runPurge = () => purgeDeleted(pool)
    .then(n => n && console.log(`🗑️  ${n} Sherms endgültig aus dem Papierkorb gelöscht`))
    .catch(err => console.error('Papierkorb leeren fehlgeschlagen:', err));
  await runPurge();
  setInterval(runPurge, DAY_MS).unref();

  const server = createApp({ pool, cfg }).listen(cfg.port, () => {
    console.log(`🚀 Sherm Map v2 läuft auf http://localhost:${cfg.port}`);
  });

  // Sauber herunterfahren (docker stop): laufende Requests fertig machen, dann DB schließen
  const shutdown = () => {
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  console.error('Start fehlgeschlagen:', err instanceof Error ? err.message : err);
  process.exit(1);
});
