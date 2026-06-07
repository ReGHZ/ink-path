import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: "./test/globalSetup.ts",
    setupFiles: ["./test/setupEnvironment.ts"],
    testTimeout: 60_000,
  },
});
