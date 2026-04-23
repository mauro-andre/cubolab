import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        testTimeout: 10_000,
    },
    // Alias pra `@cubolab/core` resolver do source TS em dev/test. Ver
    // packages/cli/vitest.config.ts pra rationale completo.
    resolve: {
        alias: {
            "@cubolab/core": resolve(here, "../core/src/index.ts"),
        },
    },
});
