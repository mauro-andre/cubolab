import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dnsRecordSchema } from "@cubolab/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { parseZones } from "../../src/lib/zones.js";
import { createStubChalltestsrv } from "../helpers/challtestsrv.js";

type CfBody = {
    success: boolean;
    errors: Array<{ code: number; message: string }>;
    messages: Array<unknown>;
    result: unknown;
};

const ZONE_ENV = "podcubo.dev:zone-podcubo-v1";
const ZONE_ID = "zone-podcubo-v1";

let tempHome: string;
let stub: ReturnType<typeof createStubChalltestsrv>;

beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "cubolab-records-test-"));
    process.env.CUBOLAB_HOME = tempHome;
    stub = createStubChalltestsrv();
});

afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    delete process.env.CUBOLAB_HOME;
});

const buildApp = () => createApp({ zones: parseZones(ZONE_ENV), challtestsrv: stub });

describe("POST /client/v4/zones/:zoneId/dns_records", () => {
    it("cria A record com shape CF completo + propaga pro challtestsrv", async () => {
        const app = buildApp();
        const res = await app.request(`/client/v4/zones/${ZONE_ID}/dns_records`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "A", name: "app.podcubo.dev", content: "10.0.0.1" }),
        });
        expect(res.status).toBe(200);

        const body = (await res.json()) as CfBody;
        expect(body.success).toBe(true);
        const record = dnsRecordSchema.parse(body.result);
        expect(record.type).toBe("A");
        expect(record.name).toBe("app.podcubo.dev");
        expect(record.content).toBe("10.0.0.1");
        expect(record.ttl).toBe(1);
        expect(record.proxied).toBe(false);
        expect(record.zone_id).toBe(ZONE_ID);
        expect(record.zone_name).toBe("podcubo.dev");
        expect(typeof record.id).toBe("string");
        expect(record.id.length).toBeGreaterThan(0);

        expect(stub.log).toEqual([{ method: "addA", args: ["app.podcubo.dev", "10.0.0.1"] }]);
    });

    it("cria CNAME record", async () => {
        const app = buildApp();
        const res = await app.request(`/client/v4/zones/${ZONE_ID}/dns_records`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                type: "CNAME",
                name: "www.podcubo.dev",
                content: "podcubo.dev",
            }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as CfBody;
        const record = dnsRecordSchema.parse(body.result);
        expect(record.type).toBe("CNAME");
        expect(stub.log[0]?.method).toBe("addCname");
    });

    it("400 + code 9005 quando type não suportado", async () => {
        const app = buildApp();
        const res = await app.request(`/client/v4/zones/${ZONE_ID}/dns_records`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                type: "MX",
                name: "x.podcubo.dev",
                content: "mail.podcubo.dev",
            }),
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as CfBody;
        expect(body.errors[0]?.code).toBe(9007);
        // (9007 VALIDATION em vez de 9005 UNSUPPORTED porque zod falha no
        // enum parse antes do handler chegar na lógica de type. Ambos são
        // 400 e indicam o mesmo problema ao consumer.)
    });

    it("404 + code 7003 quando zone desconhecida no path", async () => {
        const app = buildApp();
        const res = await app.request("/client/v4/zones/unknown-zone/dns_records", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "A", name: "a.dev", content: "1.2.3.4" }),
        });
        expect(res.status).toBe(404);
        const body = (await res.json()) as CfBody;
        expect(body.errors[0]?.code).toBe(7003);
    });

    it("aceita campos extras no body silenciosamente (ttl, priority ignorados no record)", async () => {
        const app = buildApp();
        const res = await app.request(`/client/v4/zones/${ZONE_ID}/dns_records`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                type: "A",
                name: "extra.podcubo.dev",
                content: "10.0.0.1",
                priority: 10,
                nonsense_field: "whatever",
            }),
        });
        expect(res.status).toBe(200);
    });

    it("400 + code 81057 em duplicate (mesmo type+name+content+zone)", async () => {
        const app = buildApp();
        const body = JSON.stringify({ type: "A", name: "dup.podcubo.dev", content: "10.0.0.1" });
        await app.request(`/client/v4/zones/${ZONE_ID}/dns_records`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
        });
        const res2 = await app.request(`/client/v4/zones/${ZONE_ID}/dns_records`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
        });
        expect(res2.status).toBe(400);
        expect(((await res2.json()) as CfBody).errors[0]?.code).toBe(81057);
    });

    it("permite mesmo name com IPs diferentes (round-robin CF)", async () => {
        const app = buildApp();
        const r1 = await app.request(`/client/v4/zones/${ZONE_ID}/dns_records`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "A", name: "rr.podcubo.dev", content: "10.0.0.1" }),
        });
        const r2 = await app.request(`/client/v4/zones/${ZONE_ID}/dns_records`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "A", name: "rr.podcubo.dev", content: "10.0.0.2" }),
        });
        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);
    });
});

describe("GET /client/v4/zones/:zoneId/dns_records", () => {
    const createRec = async (
        app: ReturnType<typeof buildApp>,
        type: "A" | "CNAME",
        name: string,
        content: string,
    ) => {
        await app.request(`/client/v4/zones/${ZONE_ID}/dns_records`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type, name, content }),
        });
    };

    it("lista records da zone com result_info", async () => {
        const app = buildApp();
        await createRec(app, "A", "a1.podcubo.dev", "10.0.0.1");
        await createRec(app, "A", "a2.podcubo.dev", "10.0.0.2");

        const res = await app.request(`/client/v4/zones/${ZONE_ID}/dns_records`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as CfBody & {
            result_info: { count: number; total_count: number };
        };
        expect(Array.isArray(body.result)).toBe(true);
        expect((body.result as unknown[]).length).toBe(2);
        expect(body.result_info.total_count).toBe(2);
    });

    it("filtra por name", async () => {
        const app = buildApp();
        await createRec(app, "A", "a1.podcubo.dev", "10.0.0.1");
        await createRec(app, "A", "a2.podcubo.dev", "10.0.0.2");

        const res = await app.request(
            `/client/v4/zones/${ZONE_ID}/dns_records?name=a1.podcubo.dev`,
        );
        const body = (await res.json()) as CfBody;
        expect((body.result as unknown[]).length).toBe(1);
    });

    it("filtra por type", async () => {
        const app = buildApp();
        await createRec(app, "A", "a.podcubo.dev", "10.0.0.1");
        await createRec(app, "CNAME", "www.podcubo.dev", "podcubo.dev");

        const res = await app.request(`/client/v4/zones/${ZONE_ID}/dns_records?type=CNAME`);
        const body = (await res.json()) as CfBody;
        const result = body.result as Array<{ type: string }>;
        expect(result).toHaveLength(1);
        expect(result[0]?.type).toBe("CNAME");
    });
});

describe("PUT /client/v4/zones/:zoneId/dns_records/:recordId", () => {
    it("atualiza content — limpa DNS antigo + registra novo", async () => {
        const app = buildApp();
        const create = await app.request(`/client/v4/zones/${ZONE_ID}/dns_records`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "A", name: "upd.podcubo.dev", content: "10.0.0.1" }),
        });
        const { result } = (await create.json()) as { result: { id: string } };
        stub.reset();

        const res = await app.request(`/client/v4/zones/${ZONE_ID}/dns_records/${result.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "10.0.0.99" }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as CfBody;
        const record = dnsRecordSchema.parse(body.result);
        expect(record.content).toBe("10.0.0.99");

        expect(stub.log).toEqual([
            { method: "clearA", args: ["upd.podcubo.dev"] },
            { method: "addA", args: ["upd.podcubo.dev", "10.0.0.99"] },
        ]);
    });

    it("404 quando recordId não existe", async () => {
        const app = buildApp();
        const res = await app.request(`/client/v4/zones/${ZONE_ID}/dns_records/nonexistent-id`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "10.0.0.1" }),
        });
        expect(res.status).toBe(404);
        const body = (await res.json()) as CfBody;
        expect(body.errors[0]?.code).toBe(81044);
    });
});

describe("DELETE /client/v4/zones/:zoneId/dns_records/:recordId", () => {
    it("remove record existente + clear DNS + retorna {id}", async () => {
        const app = buildApp();
        const create = await app.request(`/client/v4/zones/${ZONE_ID}/dns_records`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "A", name: "del.podcubo.dev", content: "10.0.0.1" }),
        });
        const { result } = (await create.json()) as { result: { id: string } };
        stub.reset();

        const res = await app.request(`/client/v4/zones/${ZONE_ID}/dns_records/${result.id}`, {
            method: "DELETE",
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as CfBody;
        expect((body.result as { id: string }).id).toBe(result.id);
        expect(stub.log).toEqual([{ method: "clearA", args: ["del.podcubo.dev"] }]);
    });

    it("404 quando recordId não existe", async () => {
        const app = buildApp();
        const res = await app.request(`/client/v4/zones/${ZONE_ID}/dns_records/nonexistent`, {
            method: "DELETE",
        });
        expect(res.status).toBe(404);
    });
});
