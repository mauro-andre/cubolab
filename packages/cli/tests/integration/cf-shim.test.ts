import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tempHome = mkdtempSync(join(tmpdir(), "cubolab-cfshim-test-"));
process.env.CUBOLAB_HOME = tempHome;
process.env.CUBOLAB_HOST_IP = "127.0.0.1";
process.env.CUBOLAB_ZONES = "e2e.cubolab.dev:zone-e2e-v1";

const { runUp } = await import("../../src/lib/up.js");
const { runDown } = await import("../../src/lib/down.js");
const { readState } = await import("@cubolab/core");

const HOST_IP = "127.0.0.1";
const ZONE_ID = "zone-e2e-v1";
const CF_SHIM = `http://${HOST_IP}:4500`;

type CfBody<T> = { success: boolean; errors: Array<{ code: number; message: string }>; result: T };
type DnsRecord = {
    id: string;
    type: "A" | "CNAME";
    name: string;
    content: string;
    zone_id: string;
};

const postRecord = async (body: unknown): Promise<Response> =>
    fetch(`${CF_SHIM}/client/v4/zones/${ZONE_ID}/dns_records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

const digShort = async (host: string): Promise<string> => {
    const r = await execa(
        "dig",
        ["@127.0.0.1", "-p", "8053", host, "+short", "+time=2", "+tries=1"],
        { reject: false, timeout: 5000 },
    );
    return r.stdout.trim();
};

describe("cf-shim — CRUD integration (stack real + fetch + dig)", () => {
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

    it("POST A record → dig resolve → DELETE → dig vazio", async () => {
        const res = await postRecord({
            type: "A",
            name: "app.e2e.cubolab.dev",
            content: "10.1.2.3",
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as CfBody<DnsRecord>;
        expect(body.result.zone_id).toBe(ZONE_ID);

        expect(await digShort("app.e2e.cubolab.dev")).toBe("10.1.2.3");

        const del = await fetch(
            `${CF_SHIM}/client/v4/zones/${ZONE_ID}/dns_records/${body.result.id}`,
            { method: "DELETE" },
        );
        expect(del.status).toBe(200);
        expect(await digShort("app.e2e.cubolab.dev")).toBe("");
    }, 30_000);

    it("PUT altera content → dig reflete novo IP", async () => {
        const create = await postRecord({
            type: "A",
            name: "mutable.e2e.cubolab.dev",
            content: "10.1.0.1",
        });
        const record = ((await create.json()) as CfBody<DnsRecord>).result;
        expect(await digShort("mutable.e2e.cubolab.dev")).toBe("10.1.0.1");

        const put = await fetch(`${CF_SHIM}/client/v4/zones/${ZONE_ID}/dns_records/${record.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "10.1.0.99" }),
        });
        expect(put.status).toBe(200);

        expect(await digShort("mutable.e2e.cubolab.dev")).toBe("10.1.0.99");

        // cleanup
        await fetch(`${CF_SHIM}/client/v4/zones/${ZONE_ID}/dns_records/${record.id}`, {
            method: "DELETE",
        });
    }, 30_000);

    // Este teste valida SINGLE-WRITER sob carga: 3 POSTs paralelos no mesmo
    // arquivo state.json. Sem o mutex interno do cf-shim (withStateLock), o
    // read-modify-write interleave perderia records. Aqui confirmamos que
    // os 3 aparecem tanto no state quanto no DNS.
    it("3 POSTs paralelos: state + DNS consistentes (mutex exerccitado)", async () => {
        const results = await Promise.all([
            postRecord({ type: "A", name: "p1.e2e.cubolab.dev", content: "10.2.0.1" }),
            postRecord({ type: "A", name: "p2.e2e.cubolab.dev", content: "10.2.0.2" }),
            postRecord({ type: "A", name: "p3.e2e.cubolab.dev", content: "10.2.0.3" }),
        ]);
        expect(results.map((r) => r.status)).toEqual([200, 200, 200]);

        const state = readState();
        const inParallel = state.dns.filter(
            (r) => r.name.startsWith("p") && r.name.endsWith(".e2e.cubolab.dev"),
        );
        expect(inParallel).toHaveLength(3);

        expect(await digShort("p1.e2e.cubolab.dev")).toBe("10.2.0.1");
        expect(await digShort("p2.e2e.cubolab.dev")).toBe("10.2.0.2");
        expect(await digShort("p3.e2e.cubolab.dev")).toBe("10.2.0.3");

        // cleanup via /_admin/clear
        await fetch(`${CF_SHIM}/_admin/clear`, { method: "POST" });
    }, 60_000);

    it("POST /_admin/clear: zera state + remove todos records do DNS", async () => {
        await postRecord({ type: "A", name: "pre1.e2e.cubolab.dev", content: "10.3.0.1" });
        await postRecord({ type: "A", name: "pre2.e2e.cubolab.dev", content: "10.3.0.2" });

        expect(readState().dns.length).toBeGreaterThanOrEqual(2);

        const res = await fetch(`${CF_SHIM}/_admin/clear`, { method: "POST" });
        expect(res.status).toBe(200);
        const body = (await res.json()) as CfBody<{ records_cleared: number }>;
        expect(body.result.records_cleared).toBeGreaterThanOrEqual(2);

        expect(readState().dns).toEqual([]);
        expect(await digShort("pre1.e2e.cubolab.dev")).toBe("");
        expect(await digShort("pre2.e2e.cubolab.dev")).toBe("");
    }, 30_000);

    it("batch: deletes + posts + patches numa chamada → state + DNS consistentes", async () => {
        // Pré-condição: 2 records existentes (pra deletar + editar no batch).
        const old = (
            (await (
                await postRecord({ type: "A", name: "old.e2e.cubolab.dev", content: "10.5.0.1" })
            ).json()) as CfBody<DnsRecord>
        ).result;
        const patchable = (
            (await (
                await postRecord({ type: "A", name: "patch.e2e.cubolab.dev", content: "10.5.0.2" })
            ).json()) as CfBody<DnsRecord>
        ).result;
        expect(await digShort("old.e2e.cubolab.dev")).toBe("10.5.0.1");
        expect(await digShort("patch.e2e.cubolab.dev")).toBe("10.5.0.2");

        const res = await fetch(`${CF_SHIM}/client/v4/zones/${ZONE_ID}/dns_records/batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                deletes: [{ id: old.id }],
                posts: [{ type: "A", name: "fresh.e2e.cubolab.dev", content: "10.5.0.3" }],
                patches: [{ id: patchable.id, content: "10.5.0.99" }],
            }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as CfBody<{
            deletes: Array<{ id: string }>;
            posts: DnsRecord[];
            patches: DnsRecord[];
        }>;
        expect(body.success).toBe(true);
        expect(body.result.deletes).toHaveLength(1);
        expect(body.result.posts).toHaveLength(1);
        expect(body.result.patches).toHaveLength(1);

        // DNS reflete todas as 3 operações.
        expect(await digShort("old.e2e.cubolab.dev")).toBe("");
        expect(await digShort("fresh.e2e.cubolab.dev")).toBe("10.5.0.3");
        expect(await digShort("patch.e2e.cubolab.dev")).toBe("10.5.0.99");

        await fetch(`${CF_SHIM}/_admin/clear`, { method: "POST" });
    }, 60_000);

    it("purge_cache: no-op retorna success + uuid", async () => {
        const res = await fetch(`${CF_SHIM}/client/v4/zones/${ZONE_ID}/purge_cache`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ purge_everything: true }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as CfBody<{ id: string }>;
        expect(body.success).toBe(true);
        expect(typeof body.result.id).toBe("string");
        expect(body.result.id.length).toBeGreaterThan(0);
    }, 30_000);

    // challtestsrv é in-memory → restart apaga os records. cf-shim hidrata
    // a partir do state.json no boot (`hydrateFromState`) pra que restart
    // da stack recupere o DNS sem intervenção do CLI. Este teste valida o
    // caminho completo: waitForChalltestsrv + hydrate + DNS consistente.
    it("hidratação após restart: records sobrevivem ao reboot do stack", async () => {
        await postRecord({ type: "A", name: "hyd.e2e.cubolab.dev", content: "10.4.0.1" });
        expect(await digShort("hyd.e2e.cubolab.dev")).toBe("10.4.0.1");

        // Restart: challtestsrv perde records in-memory, cf-shim reboots
        // e chama waitForChalltestsrv + hydrateFromState no startup.
        await execa("podman", ["restart", "cubolab-challtestsrv", "cubolab-cf-shim"], {
            timeout: 60_000,
        });

        const ready = async (): Promise<boolean> => {
            try {
                const r = await fetch(`${CF_SHIM}/client/v4/zones/${ZONE_ID}`);
                return r.ok;
            } catch {
                return false;
            }
        };
        const start = Date.now();
        while (Date.now() - start < 60_000) {
            if (await ready()) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        expect(await ready()).toBe(true);

        // Record do state re-injetado no challtestsrv via hidratação — dig resolve.
        expect(await digShort("hyd.e2e.cubolab.dev")).toBe("10.4.0.1");

        await fetch(`${CF_SHIM}/_admin/clear`, { method: "POST" });
    }, 180_000);
});
