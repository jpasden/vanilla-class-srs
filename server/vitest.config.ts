import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', 'dist/**'],
    alias: {
      '@vanilla-srs/shared': path.resolve(__dirname, '../shared/index.ts'),
    },
  },
})
