import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin } from '../vitest.shared.ts'

// Lark bundle lives outside the dsh workspace; run from the dsh repo root
// (`npx vitest run --config dsh-lark/vitest.config.ts`) so tsconfig paths
// resolve the @deepseek-ai/* dev imports against the checkout.
export default defineConfig({
  plugins: [standardDecoratorPlugin(), tsconfigPaths({ projects: ['./tsconfig.base.json'] })],
  test: {
    include: ['dsh-lark/tests/**/*.spec.ts'],
    setupFiles: ['scripts/test-invariants.ts'],
    environment: 'node',
  },
})
