import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      // Scope to units that have tests. Files excluded below require real external
      // services (Supabase, GitHub, LLM) and belong in integration tests, not unit tests.
      include: ['lib/jugnus/**', 'lib/orchestration/**'],
      exclude: [
        'node_modules', '.next', 'vitest.config.ts', 'vitest.setup.ts',
        'lib/jugnus/dispatch.ts',    // integration test territory — requires real Supabase
        'lib/jugnus/github.ts',      // requires real GitHub API
        'lib/jugnus/pipeline.ts',    // requires real Supabase + LLM
        'lib/jugnus/deploy-static.ts', // deployment utility
      ],
      // Threshold reflects current unit-test coverage; raise as more tool handlers are tested.
      thresholds: { lines: 50, functions: 50, branches: 45, statements: 50 },
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
