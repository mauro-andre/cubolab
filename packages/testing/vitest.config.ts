import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        testTimeout: 30_000,
        // Sandbox toma containers de nome fixo (cubolab-pebble etc) — um
        // teste por vez pode segurar esses nomes. Mesmo padrão dos workspaces cli/cf-shim.
        fileParallelism: false,
    },
    // Alias pra `@cubolab/core` e `cubolab` resolverem do source em dev/test.
    // Runtime Node (via `npm link` ou install) usa package.json/exports → dist.
    resolve: {
        alias: {
            "@cubolab/core": resolve(here, "../core/src/index.ts"),
            cubolab: resolve(here, "../cli/src/lib/index.ts"),
        },
    },
});
