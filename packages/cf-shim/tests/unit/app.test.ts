import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { parseZones } from "../../src/lib/zones.js";
import { zoneSchema } from "../../src/schemas/cloudflare.js";

type CfBody = {
    success: boolean;
    errors: Array<{ code: number; message: string }>;
    messages: Array<unknown>;
    result: unknown;
};

const buildApp = (env: string) => createApp({ zones: parseZones(env) });

describe("GET /client/v4/zones/:zoneId", () => {
    it("retorna 200 + CF-shaped response quando zone está cadastrada", async () => {
        const app = buildApp("podcubo.dev:zone-podcubo-v1");
        const res = await app.request("/client/v4/zones/zone-podcubo-v1");
        expect(res.status).toBe(200);

        const body = (await res.json()) as CfBody;
        expect(body.success).toBe(true);
        expect(body.errors).toEqual([]);
        expect(body.messages).toEqual([]);
        expect(() => zoneSchema.parse(body.result)).not.toThrow();

        const zone = zoneSchema.parse(body.result);
        expect(zone.id).toBe("zone-podcubo-v1");
        expect(zone.name).toBe("podcubo.dev");
        expect(zone.status).toBe("active");
    });

    it("retorna 404 + code 7003 quando zone é desconhecida", async () => {
        const app = buildApp("podcubo.dev:zone-v1");
        const res = await app.request("/client/v4/zones/unknown-id");
        expect(res.status).toBe(404);

        const body = (await res.json()) as CfBody;
        expect(body.success).toBe(false);
        expect(body.errors[0]?.code).toBe(7003);
        expect(body.errors[0]?.message).toMatch(/zone not found/);
        expect(body.result).toBeNull();
    });

    it("retorna 404 pra qualquer zoneId quando CUBOLAB_ZONES está vazio", async () => {
        const app = buildApp("");
        const res = await app.request("/client/v4/zones/whatever");
        expect(res.status).toBe(404);
    });

    it("retorna 404 (Hono default) pra path desconhecido", async () => {
        const app = buildApp("podcubo.dev:zone-v1");
        const res = await app.request("/foo");
        expect(res.status).toBe(404);
    });
});
