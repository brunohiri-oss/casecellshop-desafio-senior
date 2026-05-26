import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Os testes usam DB + Redis + filas compartilhados — rodar sequencial
    // para evitar interferência cruzada. Em CI real usaríamos testcontainers
    // ou schemas isolados.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
