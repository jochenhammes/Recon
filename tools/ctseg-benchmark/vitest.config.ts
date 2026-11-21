import { defineConfig } from "vitest/config";

// Run from the repository root: npx vitest run --config tools/ctseg-benchmark/vitest.config.ts
export default defineConfig({ test: { environment: "node", include: ["tools/ctseg-benchmark/benchmark.test.ts"], testTimeout: 24 * 3600 * 1000 } });
