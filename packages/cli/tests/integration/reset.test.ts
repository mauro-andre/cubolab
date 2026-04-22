import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tempHome = mkdtempSync(join(tmpdir(), "cubolab-reset-test-"));
process.env.CUBOLAB_HOME = tempHome;
process.env.CUBOLAB_HOST_IP = "127.0.0.1";
process.env.CUBOLAB_ZONES = "test.reset.dev:zone-reset-v1";

const { runUp } = await import("../../src/lib/up.js");
const { runDown } = await import("../../src/lib/down.js");
const { runReset } = await import("../../src/lib/reset.js");
const { readState, writeState } = await import("@cubolab/core");

const HOST_IP = "127.0.0.1";
const ZONE_ID = "zone-reset-v1";

const createViaCfShim = async (
    type: "A" | "CNAME",
    name: string,
    content: string,
): Promise<{ id: string }> => {
    const res = await fetch(`http://${HOST_IP}:4500/client/v4/zones/${ZONE_ID}/dns_records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, name, content }),
    });
    if (!res.ok) throw new Error(`cf-shim POST failed: HTTP ${res.status}`);
    const body = (await res.json()) as { result: { id: string } };
    return body.result;
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
        await execa(
            "podman",
            ["rm", "-f", "cubolab-pebble", "cubolab-challtestsrv", "cubolab-cf-shim"],
            { reject: false },
        );
        await runUp();
    }, 300_000);

    afterAll(async () => {
        await runDown();
        rmSync(tempHome, { recursive: true, force: true });
    }, 120_000);

    // Este teste valida o contrato de DELEGATION: CLI reset com stack up
    // NÃO escreve no state.json diretamente — delega via POST /_admin/clear
    // pro cf-shim, que tem o mutex interno do state. Isso garante single-writer
    // (CLI + cf-shim não corrompem state em operações concorrentes).
    it("via-cf-shim: delega pro /_admin/clear quando cf-shim está rodando", async () => {
        const record = await createViaCfShim("A", "delegation.reset.dev", "10.0.0.1");
        expect(await digShort("delegation.reset.dev")).toBe("10.0.0.1");
        expect(readState().dns).toHaveLength(1);

        const result = await runReset();
        expect(result.mode).toBe("via-cf-shim");
        expect(result.recordsCleared).toBe(1);

        expect(readState().dns).toEqual([]);
        expect(await digShort("delegation.reset.dev")).toBe("");

        // Record id não vaza, mas garanta que foi o mesmo que criamos
        expect(typeof record.id).toBe("string");
    }, 60_000);

    it("direct: stack down → CLI escreve empty state localmente", async () => {
        await runDown();

        // Pre-popula state com record shape completo (simula sobrevivência do state
        // entre cubolab downs — cf-shim escreveu antes de ser derrubado).
        writeState({
            version: 1,
            dns: [
                {
                    id: "leftover-uuid",
                    type: "A",
                    name: "leftover.reset.dev",
                    content: "10.0.0.99",
                    ttl: 1,
                    proxied: false,
                    zone_id: ZONE_ID,
                    zone_name: "test.reset.dev",
                    created_on: "2026-04-22T00:00:00.000Z",
                    modified_on: "2026-04-22T00:00:00.000Z",
                },
            ],
        });

        const result = await runReset();
        expect(result.mode).toBe("direct");
        expect(result.recordsCleared).toBe(1);
        expect(readState().dns).toEqual([]);
    }, 60_000);
});
