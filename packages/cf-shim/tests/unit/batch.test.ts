import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    tempHome = mkdtempSync(join(tmpdir(), "cubolab-batch-test-"));
    process.env.CUBOLAB_HOME = tempHome;
    stub = createStubChalltestsrv();
});

afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    delete process.env.CUBOLAB_HOME;
});

const buildApp = () => createApp({ zones: parseZones(ZONE_ENV), challtestsrv: stub });

const postBatch = (app: ReturnType<typeof buildApp>, body: unknown) =>
    app.request(`/client/v4/zones/${ZONE_ID}/dns_records/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

const createRecord = async (app: ReturnType<typeof buildApp>, name: string, content: string) => {
    const res = await app.request(`/client/v4/zones/${ZONE_ID}/dns_records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "A", name, content }),
    });
    const body = (await res.json()) as { result: { id: string } };
    return body.result.id;
};

describe("POST /client/v4/zones/:zoneId/dns_records/batch", () => {
    it("batch vazio retorna 200 + 3 arrays vazios", async () => {
        const app = buildApp();
        const res = await postBatch(app, {});
        expect(res.status).toBe(200);
        const body = (await res.json()) as CfBody;
        expect(body.success).toBe(true);
        expect(body.result).toEqual({ deletes: [], posts: [], patches: [] });
    });

    it("só posts: cria todos + propaga pro challtestsrv", async () => {
        const app = buildApp();
        const res = await postBatch(app, {
            posts: [
                { type: "A", name: "a.podcubo.dev", content: "10.0.0.1" },
                { type: "A", name: "b.podcubo.dev", content: "10.0.0.2" },
            ],
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as CfBody;
        const result = body.result as { posts: Array<{ name: string; content: string }> };
        expect(result.posts).toHaveLength(2);
        expect(result.posts.map((r) => r.name)).toEqual(["a.podcubo.dev", "b.podcubo.dev"]);
        expect(stub.log.map((c) => c.method)).toEqual(["addA", "addA"]);
    });

    it("só deletes: remove todos + clear no challtestsrv", async () => {
        const app = buildApp();
        const idA = await createRecord(app, "del-a.podcubo.dev", "10.0.0.1");
        const idB = await createRecord(app, "del-b.podcubo.dev", "10.0.0.2");
        stub.reset();

        const res = await postBatch(app, {
            deletes: [{ id: idA }, { id: idB }],
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as CfBody;
        const result = body.result as { deletes: Array<{ id: string }> };
        expect(result.deletes.map((d) => d.id)).toEqual([idA, idB]);
        expect(stub.log.map((c) => c.method)).toEqual(["clearA", "clearA"]);
    });

    it("misto deletes+posts+patches na ordem CF (delete→post→patch)", async () => {
        const app = buildApp();
        const idOld = await createRecord(app, "old.podcubo.dev", "10.0.0.99");
        const idPatch = await createRecord(app, "patchme.podcubo.dev", "10.0.0.50");
        stub.reset();

        const res = await postBatch(app, {
            deletes: [{ id: idOld }],
            posts: [{ type: "A", name: "new.podcubo.dev", content: "10.0.0.1" }],
            patches: [{ id: idPatch, content: "10.0.0.51" }],
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as CfBody;
        const result = body.result as {
            deletes: Array<{ id: string }>;
            posts: unknown[];
            patches: unknown[];
        };
        expect(result.deletes).toHaveLength(1);
        expect(result.posts).toHaveLength(1);
        expect(result.patches).toHaveLength(1);

        // Ordem das chamadas no challtestsrv: clear (delete), add (post),
        // clear+add (patch com content mudado).
        expect(stub.log.map((c) => c.method)).toEqual(["clearA", "addA", "clearA", "addA"]);
    });

    it("body malformado (delete sem id) → 400 ValidationError", async () => {
        const app = buildApp();
        const res = await postBatch(app, { deletes: [{ wrong_field: "x" }] });
        expect(res.status).toBe(400);
        const body = (await res.json()) as CfBody;
        expect(body.errors[0]?.code).toBe(9007);
    });

    it("404 zone desconhecida", async () => {
        const app = buildApp();
        const res = await app.request("/client/v4/zones/unknown/dns_records/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        expect(res.status).toBe(404);
        const body = (await res.json()) as CfBody;
        expect(body.errors[0]?.code).toBe(7003);
    });

    it("falha parcial: 1º post OK + 2º duplicate → 400 + result tem só o 1º", async () => {
        const app = buildApp();
        await createRecord(app, "existing.podcubo.dev", "10.0.0.1");
        stub.reset();

        const res = await postBatch(app, {
            posts: [
                { type: "A", name: "fresh.podcubo.dev", content: "10.0.0.2" },
                // Duplicate — mesmo type+name+content do existing.
                { type: "A", name: "existing.podcubo.dev", content: "10.0.0.1" },
            ],
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as CfBody;
        expect(body.success).toBe(false);
        expect(body.errors[0]?.code).toBe(81057);

        const result = body.result as { posts: Array<{ name: string }> };
        expect(result.posts).toHaveLength(1);
        expect(result.posts[0]?.name).toBe("fresh.podcubo.dev");
    });
});

describe("POST /client/v4/zones/:zoneId/purge_cache", () => {
    it("no-op retorna 200 + result.id (uuid) quando zone existe", async () => {
        const app = buildApp();
        const res = await app.request(`/client/v4/zones/${ZONE_ID}/purge_cache`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ purge_everything: true }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as CfBody;
        expect(body.success).toBe(true);
        const result = body.result as { id: string };
        expect(typeof result.id).toBe("string");
        expect(result.id.length).toBeGreaterThan(0);
    });

    it("ignora body vazio ou malformado (é no-op)", async () => {
        const app = buildApp();
        const res = await app.request(`/client/v4/zones/${ZONE_ID}/purge_cache`, {
            method: "POST",
        });
        expect(res.status).toBe(200);
    });

    it("404 zone desconhecida", async () => {
        const app = buildApp();
        const res = await app.request("/client/v4/zones/unknown/purge_cache", {
            method: "POST",
        });
        expect(res.status).toBe(404);
        const body = (await res.json()) as CfBody;
        expect(body.errors[0]?.code).toBe(7003);
    });
});
