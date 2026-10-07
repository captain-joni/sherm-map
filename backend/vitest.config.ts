import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 20_000, // bcrypt mit 12 Runden und Bildverarbeitung brauchen etwas
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
