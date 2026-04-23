import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tempHome = mkdtempSync(join(tmpdir(), "cubolab-testing-integration-"));
process.env.CUBOLAB_HOME = tempHome;
process.env.CUBOLAB_HOST_IP = "127.0.0.1";

const { sandbox } = await import("../../src/index.js");

const ZONE_ID = "zone-sandbox-v1";

describe("sandbox — end-to-end", () => {
    beforeAll(async () => {
        await execa(
            "podman",
            ["rm", "-f", "cubolab-pebble", "cubolab-challtestsrv", "cubolab-cf-shim"],
            { reject: false },
        );
        await sandbox.up({
            zones: [{ name: "sandbox.cubolab.dev", id: ZONE_ID }],
            hostIp: "127.0.0.1",
        });
    }, 300_000);

    afterAll(async () => {
        await sandbox.down();
        rmSync(tempHome, { recursive: true, force: true });
    }, 120_000);

    it("cloudflareApiUrl aponta pra cf-shim rodando", () => {
        expect(sandbox.cloudflareApiUrl).toBe("http://127.0.0.1:4500/client/v4");
    });

    it("trustBundlePath existe após up", () => {
        expect(existsSync(sandbox.trustBundlePath)).toBe(true);
    });

    // Fluxo representativo de suite de consumer: cria record via CF API,
    // valida propagação DNS, limpa via sandbox.reset(), confirma limpeza.
    // sandbox.reset() internamente delega via cf-shim POST /_admin/clear —
    // valida o contrato single-writer do PR8 do ângulo do consumer.
    it("CRUD via cloudflareApiUrl + inspect + reset (single-writer do cf-shim)", async () => {
        const createRes = await fetch(`${sandbox.cloudflareApiUrl}/zones/${ZONE_ID}/dns_records`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                type: "A",
                name: "integration.sandbox.cubolab.dev",
                content: "10.99.0.1",
            }),
        });
        expect(createRes.status).toBe(200);

        const records = await sandbox.inspect.cloudflareRecords(ZONE_ID);
        expect(records).toHaveLength(1);
        expect(records[0]?.content).toBe("10.99.0.1");

        const dns = await sandbox.inspect.dns("integration.sandbox.cubolab.dev");
        expect(dns).toEqual(["10.99.0.1"]);

        await sandbox.reset();

        const afterReset = await sandbox.inspect.cloudflareRecords(ZONE_ID);
        expect(afterReset).toEqual([]);

        const afterDns = await sandbox.inspect.dns("integration.sandbox.cubolab.dev");
        expect(afterDns).toEqual([]);
    }, 60_000);

    it("inspect.issuedCerts() retorna [] (stub)", async () => {
        expect(await sandbox.inspect.issuedCerts()).toEqual([]);
    });
});
