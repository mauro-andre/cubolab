import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        setupFiles: ["./tests/setup.ts"],
        testTimeout: 30_000,
        // Testes de integração tomam containers com nome fixo (cubolab-pebble /
        // cubolab-challtestsrv) — só um teste por vez pode segurar esses nomes.
        fileParallelism: false,
    },
    // Alias pra `@cubolab/core` resolver do source TS em dev/test, sem depender
    // do dist/ buildado. Runtime Node (via `npm link` do bin) segue
    // package.json/exports pra dist. Paga build só pra entrega binária.
    resolve: {
        alias: {
            "@cubolab/core": resolve(here, "../core/src/index.ts"),
        },
    },
});
