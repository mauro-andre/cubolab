import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectStatus } from "../../src/lib/stack.js";
import type { StatusReport } from "../../src/schemas/status.js";

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
const COMPOSE_FILE = `${fixturesDir}/docker-compose.yml`;
const PROJECT = "cubolab-status-test";

// Força `127.0.0.1` pra casar com o SAN do cert da fixture (o cert tem
// `192.168.122.1`, `127.0.0.1`, `localhost` no SAN — ver poc README §Quirks).
// Assim o teste roda mesmo fora de host com libvirt (CI, dev sem virbr0).
process.env.CUBOLAB_HOST_IP = "127.0.0.1";

const compose = (args: string[]) =>
    execa("podman-compose", ["-f", COMPOSE_FILE, "-p", PROJECT, ...args], {
        reject: false,
        timeout: 180_000,
    });

const waitUntil = async (
    predicate: () => Promise<boolean>,
    timeoutMs: number,
    label: string,
): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await predicate()) return;
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`timeout (${timeoutMs}ms) waiting for ${label}`);
};

describe("collectStatus — integration", () => {
    beforeAll(async () => {
        await compose(["down", "-v"]);
    }, 180_000);

    afterAll(async () => {
        await compose(["down", "-v"]);
    }, 120_000);

    it("reporta 'down' quando nenhum container cubolab-* está rodando", async () => {
        const r: StatusReport = await collectStatus();
        expect(r.version).toBe(1);
        expect(r.stack).toBe("down");
        expect(r.components.pebble?.running).toBe(false);
        expect(r.components.challtestsrv?.running).toBe(false);
        expect(r.components.pebble?.healthy).toBe(false);
        expect(r.components.challtestsrv?.healthy).toBe(false);
    });

    it("reporta 'partial' com apenas pebble rodando", async () => {
        await compose(["up", "-d", "pebble"]);
        await waitUntil(
            async () => (await collectStatus()).components.pebble?.healthy === true,
            60_000,
            "pebble healthy",
        );

        const r = await collectStatus();
        expect(r.components.pebble?.running).toBe(true);
        expect(r.components.pebble?.healthy).toBe(true);
        expect(r.components.challtestsrv?.running).toBe(false);
        expect(r.stack).toBe("partial");
    }, 120_000);

    it("reporta 'up' com toda a stack saudável", async () => {
        await compose(["up", "-d"]);
        await waitUntil(async () => (await collectStatus()).stack === "up", 60_000, "stack up");

        const r = await collectStatus();
        expect(r.stack).toBe("up");
        expect(r.components.pebble?.healthy).toBe(true);
        expect(r.components.challtestsrv?.healthy).toBe(true);
        expect(r.components.pebble?.endpoints.acme).toBe("https://127.0.0.1:14000/dir");
        expect(r.components.challtestsrv?.endpoints.mgmt).toBe("http://127.0.0.1:8055/");
    }, 120_000);
});
