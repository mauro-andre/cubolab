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

const ZONE_ENV = "podcubo.dev:zone-v1";
const ZONE_ID = "zone-v1";

let tempHome: string;
let stub: ReturnType<typeof createStubChalltestsrv>;

beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "cubolab-admin-test-"));
    process.env.CUBOLAB_HOME = tempHome;
    stub = createStubChalltestsrv();
});

afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    delete process.env.CUBOLAB_HOME;
});

const buildApp = () => createApp({ zones: parseZones(ZONE_ENV), challtestsrv: stub });

const createRecord = (
    app: ReturnType<typeof buildApp>,
    type: "A" | "CNAME",
    name: string,
    content: string,
) =>
    app.request(`/client/v4/zones/${ZONE_ID}/dns_records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, name, content }),
    });

describe("POST /_admin/clear", () => {
    it("com body vazio retorna records_cleared=0 quando state já vazio", async () => {
        const app = buildApp();
        const res = await app.request("/_admin/clear", { method: "POST" });
        expect(res.status).toBe(200);
        const body = (await res.json()) as CfBody;
        expect(body.success).toBe(true);
        expect((body.result as { records_cleared: number }).records_cleared).toBe(0);
    });

    it("com body `{}` retorna mesmo shape (dois formatos aceitos)", async () => {
        const app = buildApp();
        const res = await app.request("/_admin/clear", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as CfBody;
        expect((body.result as { records_cleared: number }).records_cleared).toBe(0);
    });

    it("limpa records existentes + propaga clear pro challtestsrv", async () => {
        const app = buildApp();
        await createRecord(app, "A", "a.podcubo.dev", "10.0.0.1");
        await createRecord(app, "CNAME", "www.podcubo.dev", "podcubo.dev");
        stub.reset();

        const res = await app.request("/_admin/clear", { method: "POST" });
        expect(res.status).toBe(200);
        const body = (await res.json()) as CfBody;
        expect((body.result as { records_cleared: number }).records_cleared).toBe(2);

        const methods = stub.log.map((c) => c.method).sort();
        expect(methods).toEqual(["clearA", "clearCname"]);

        // Confirma que state foi zerado via GET /dns_records
        const after = await app.request(`/client/v4/zones/${ZONE_ID}/dns_records`);
        const afterBody = (await after.json()) as CfBody;
        expect((afterBody.result as unknown[]).length).toBe(0);
    });
});
