import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    /**
     * Real DB + real Supabase Auth. Tests are integration-style — fast (no
     * LLM calls) and deterministic (use UUID-based test fixtures we clean
     * up afterwards).
     */
    environment: "node",
    /**
     * Run sequentially. Each test creates and cleans up its own auth user
     * + company; running in parallel would race on the post-signup trigger.
     */
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    /**
     * Net + DB hops eat into the default 5s timeout.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
    /**
     * Surface the env file the api would normally read at startup.
     */
    setupFiles: ["test/setup-env.ts"],
  },
});
