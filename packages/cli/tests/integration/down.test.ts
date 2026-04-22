import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tempHome = mkdtempSync(join(tmpdir(), "cubolab-down-test-"));
process.env.CUBOLAB_HOME = tempHome;
process.env.CUBOLAB_HOST_IP = "127.0.0.1";

const { runUp } = await import("../../src/lib/up.js");
const { runDown } = await import("../../src/lib/down.js");
const { COMPOSE_PROJECT } = await import("../../src/lib/constants.js");
const { paths } = await import("../../src/lib/paths.js");
const { collectStatus } = await import("../../src/lib/stack.js");

describe("runDown — integration", () => {
    beforeAll(async () => {
        await execa("podman", ["rm", "-f", "cubolab-pebble", "cubolab-challtestsrv"], {
            reject: false,
        });
    }, 60_000);

    afterAll(async () => {
        if (existsSync(paths.composeFile)) {
            await execa(
                "podman-compose",
                ["-f", paths.composeFile, "-p", COMPOSE_PROJECT, "down", "-v"],
                { reject: false, timeout: 60_000 },
            );
        }
        rmSync(tempHome, { recursive: true, force: true });
    }, 120_000);

    it("derruba a stack e preserva ~/.cubolab/*", async () => {
        await runUp();

        const before = await collectStatus();
        expect(before.stack).toBe("up");

        const result = await runDown();
        expect(result.composeFileAbsent).toBe(false);
        expect(result.wasUp).toBe(true);

        const after = await collectStatus();
        expect(after.stack).toBe("down");

        // Todos os arquivos do ~/.cubolab/ sobrevivem ao down.
        expect(existsSync(paths.pebbleCert)).toBe(true);
        expect(existsSync(paths.pebbleKey)).toBe(true);
        expect(existsSync(paths.pebbleRoot)).toBe(true);
        expect(existsSync(paths.pebbleIntermediate)).toBe(true);
        expect(existsSync(paths.trustBundle)).toBe(true);
        expect(existsSync(paths.state)).toBe(true);
        expect(existsSync(paths.composeFile)).toBe(true);
    }, 180_000);

    it("é idempotente: 2º down sem stack de pé retorna wasUp=false", async () => {
        const result = await runDown();
        expect(result.composeFileAbsent).toBe(false);
        expect(result.wasUp).toBe(false);
    }, 60_000);
});

describe("runDown — sem ~/.cubolab/", () => {
    it("retorna composeFileAbsent=true quando CUBOLAB_HOME não tem compose file", async () => {
        const emptyHome = mkdtempSync(join(tmpdir(), "cubolab-empty-"));
        const prev = process.env.CUBOLAB_HOME;
        try {
            process.env.CUBOLAB_HOME = emptyHome;
            // Reimporta pra pegar novo paths? Não precisa — paths usa getters.
            const result = await runDown();
            expect(result.composeFileAbsent).toBe(true);
            expect(result.wasUp).toBe(false);
        } finally {
            if (prev !== undefined) {
                process.env.CUBOLAB_HOME = prev;
            }
            rmSync(emptyHome, { recursive: true, force: true });
        }
    });
});
