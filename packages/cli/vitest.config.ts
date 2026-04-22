import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        setupFiles: ["./tests/setup.ts"],
        testTimeout: 30_000,
        // Testes de integração tomam containers com nome fixo (cubolab-pebble /
        // cubolab-challtestsrv) — só um teste por vez pode segurar esses nomes.
        fileParallelism: false,
    },
});
