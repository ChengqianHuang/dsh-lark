import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: false,
  clean: true,
  outDir: 'lib',
  outExtensions: () => ({ js: '.mjs' }),
})
