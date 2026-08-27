// `.mts`, not `.ts`: Vite's native config loader treats a bare `.ts` here as
// CommonJS and warns about the ESM syntax below. The storefront predates that
// warning; a new package may as well start on the extension Vite is moving to.
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    restoreMocks: true,
    // The storefront's suite is pure logic only, because
    // @testing-library/react was never installed there. It is installed here,
    // so the console's forms and role guard can be tested as they actually
    // render rather than only as the functions behind them.
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
