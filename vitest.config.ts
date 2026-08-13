import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Without this, vitest also collects the COMPILED copies of the source
    // tests from `dist/` (tsc emits `*.test.js` alongside everything else).
    // Those copies are frozen at whatever the last build produced, so they keep
    // reporting green against code that no longer exists — and they inflate
    // every suite count this project has used as gate evidence.
    exclude: [...configDefaults.exclude, "dist/**"],
    environment: "node",
    globalSetup: "./test/globalSetup.ts",
    setupFiles: ["./test/setupEnvironment.ts"],
    testTimeout: 60_000,
  },
});
