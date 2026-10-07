import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// true, wenn die Datei direkt gestartet wurde (tsx src/scripts/x.ts) und nicht importiert
export function isMain(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

// Fortschritt für lange Skripte: "12/340"
export function progress(done: number, total: number, label = ''): void {
  if (process.stdout.isTTY) process.stdout.write(`\r${label}${done}/${total}`);
  if (done === total && process.stdout.isTTY) process.stdout.write('\n');
}
