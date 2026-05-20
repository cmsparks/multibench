import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@multibench/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      "@multibench/harness": fileURLToPath(
        new URL("./packages/harness/src/index.ts", import.meta.url),
      ),
      "@multibench/runner": fileURLToPath(
        new URL("./packages/runner/src/index.ts", import.meta.url),
      ),
      "@multibench/tasks": fileURLToPath(new URL("./packages/tasks/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: [
      "harnesses/**/*.test.ts",
      "packages/**/*.test.ts",
      "tasks/**/*.test.ts",
      "test/**/*.test.ts",
    ],
    globals: false,
    passWithNoTests: true,
  },
});
