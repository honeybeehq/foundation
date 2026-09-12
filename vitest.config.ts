import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // These suites use node:test; pnpm test runs them with Node after Vitest.
    exclude: [...configDefaults.exclude, 'packages/desktop/scripts/*.test.mjs', 'spikes/desktop-prototype/model.test.mjs'],
  },
})
