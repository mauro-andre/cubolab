import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tempHome = mkdtempSync(join(tmpdir(), "cubolab-up-test-"));
process.env.CUBOLAB_HOME = tempHome;
process.env.CUBOLAB_HOST_IP = "127.0.0.1";

// Imports DEPOIS de setar env vars — garante que `paths` (getters) e outros
// leitores de env observem o override já na primeira avaliação.
const { runUp } = await import("../../src/lib/up.js");
const { COMPOSE_PROJECT } = await import("../../src/lib/constants.js");
const { paths } = await import("@cubolab/core");
const { collectStatus } = await import("../../src/lib/stack.js");

const compose = (args: readonly string[]) =>
    execa("podman-compose", ["-f", paths.composeFile, "-p", COMPOSE_PROJECT, ...args], {
        reject: false,
        timeout: 120_000,
    });

describe("runUp — integration", () => {
    beforeAll(async () => {
        // Garante estado limpo — caso um run anterior tenha deixado containers.
        await execa("podman", ["rm", "-f", "cubolab-pebble", "cubolab-challtestsrv"], {
            reject: false,
        });
    }, 60_000);

    afterAll(async () => {
        if (existsSync(paths.composeFile)) {
            await compose(["down", "-v"]);
        }
        rmSync(tempHome, { recursive: true, force: true });
    }, 120_000);

    it("cria ~/.cubolab/, gera cert, baixa trust bundle e stack fica 'up'", async () => {
        const result = await runUp();
        expect(result.certGenerated).toBe(true);
        expect(result.trustBundleDownloaded).toBe(true);
        expect(result.hostIp).toBe("127.0.0.1");

        expect(existsSync(paths.pebbleCert)).toBe(true);
        expect(existsSync(paths.pebbleKey)).toBe(true);
        expect(existsSync(paths.pebbleRoot)).toBe(true);
        expect(existsSync(paths.pebbleIntermediate)).toBe(true);
        expect(existsSync(paths.trustBundle)).toBe(true);
        expect(existsSync(paths.state)).toBe(true);
        expect(existsSync(paths.composeFile)).toBe(true);
        expect(existsSync(paths.pebbleConfig)).toBe(true);

        const report = await collectStatus();
        expect(report.stack).toBe("up");
        expect(report.trustBundle.exists).toBe(true);
        expect(report.components.pebble?.healthy).toBe(true);
        expect(report.components.challtestsrv?.healthy).toBe(true);
    }, 180_000);

    it("é idempotente: 2º run reusa cert e trust bundle", async () => {
        const result = await runUp();
        expect(result.certGenerated).toBe(false);
        expect(result.trustBundleDownloaded).toBe(false);

        const report = await collectStatus();
        expect(report.stack).toBe("up");
    }, 120_000);
});
