import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// Dedicated Vitest config for the frontend component tests.
// Kept separate from vite.config.ts so the dev/build proxy/host settings
// (which reference deployment hosts) never leak into the test runtime.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    pool: 'threads',
    minWorkers: 1,
    maxWorkers: 3,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
