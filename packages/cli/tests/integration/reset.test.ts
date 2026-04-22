import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tempHome = mkdtempSync(join(tmpdir(), "cubolab-reset-test-"));
process.env.CUBOLAB_HOME = tempHome;
process.env.CUBOLAB_HOST_IP = "127.0.0.1";

const { runUp } = await import("../../src/lib/up.js");
const { runDown } = await import("../../src/lib/down.js");
const { runReset } = await import("../../src/lib/reset.js");
const { readState, writeState } = await import("@cubolab/core");

const HOST_IP = "127.0.0.1";

const postAddA = async (host: string, address: string): Promise<void> => {
    const res = await fetch(`http://${HOST_IP}:8055/add-a`, {
        method: "POST",
        body: JSON.stringify({ host, addresses: [address] }),
    });
    if (!res.ok) throw new Error(`add-a failed: HTTP ${res.status}`);
};

const digShort = async (host: string): Promise<string> => {
    const r = await execa(
        "dig",
        ["@127.0.0.1", "-p", "8053", host, "+short", "+time=2", "+tries=1"],
        { reject: false, timeout: 5000 },
    );
    return r.stdout.trim();
};

describe("runReset — integration", () => {
    beforeAll(async () => {
        await execa("podman", ["rm", "-f", "cubolab-pebble", "cubolab-challtestsrv"], {
            reject: false,
        });
        await runUp();
    }, 180_000);

    afterAll(async () => {
        await runDown();
        rmSync(tempHome, { recursive: true, force: true });
    }, 120_000);

    it("limpa state e challtestsrv quando a stack está up", async () => {
        // Simula o que M2 fará: cf-shim escreve no state.json E registra no
        // challtestsrv via API. Aqui fazemos os dois manualmente.
        const record = { type: "A" as const, name: "demo-reset.test.", content: "10.0.0.1" };
        writeState({ version: 1, dns: [record] });
        await postAddA(record.name, record.content);

        // Valida setup: DNS resolve pro IP
        expect(await digShort(record.name)).toBe("10.0.0.1");

        const result = await runReset();
        expect(result.recordsCleared).toBe(1);
        expect(result.challtestsrvReachable).toBe(true);

        expect(readState().dns).toEqual([]);
        expect(await digShort(record.name)).toBe("");
    }, 60_000);

    it("avisa (não falha) quando challtestsrv não está up", async () => {
        await runDown();

        writeState({
            version: 1,
            dns: [{ type: "A", name: "leftover.test.", content: "10.0.0.2" }],
        });
        const result = await runReset();

        expect(result.challtestsrvReachable).toBe(false);
        // State ainda é zerado mesmo sem o DNS ser limpo.
        expect(readState().dns).toEqual([]);

        // Religa a stack pra próximo teste não herdar estado bagunçado.
        await runUp();
    }, 180_000);
});
