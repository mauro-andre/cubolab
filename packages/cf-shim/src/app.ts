import type { DnsRecord } from "@cubolab/core";
import { Hono } from "hono";
import { CF_CODE } from "./constants.js";
import { clearAll } from "./lib/admin.js";
import type { ChalltestsrvClient } from "./lib/challtestsrv.js";
import { CfShimError, ValidationError, ZoneNotFoundError } from "./lib/errors.js";
import { createRecord, deleteRecord, listRecords, updateRecord } from "./lib/records.js";
import {
    dnsRecordCreateSchema,
    dnsRecordUpdateSchema,
    errorResponse,
    successResponse,
    ZONE_NOT_FOUND_CODE,
    type Zone,
} from "./schemas/cloudflare.js";

export type AppContext = {
    zones: Map<string, Zone>;
    challtestsrv: ChalltestsrvClient;
};

const jsonResponse = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });

export const createApp = (ctx: AppContext): Hono => {
    const app = new Hono();

    app.onError((err, _c) => {
        if (err instanceof CfShimError) {
            return jsonResponse(
                errorResponse([{ code: err.code, message: err.message }]),
                err.httpStatus,
            );
        }
        console.error("cubolab-cf-shim: unhandled error:", err);
        return jsonResponse(
            errorResponse([{ code: CF_CODE.INTERNAL, message: "internal server error" }]),
            500,
        );
    });

    app.get("/client/v4/zones/:zoneId", (c) => {
        const zoneId = c.req.param("zoneId");
        const zone = ctx.zones.get(zoneId);
        if (!zone) {
            return jsonResponse(
                errorResponse([
                    { code: ZONE_NOT_FOUND_CODE, message: "zone not found — add to CUBOLAB_ZONES" },
                ]),
                404,
            );
        }
        return c.json(successResponse(zone), 200);
    });

    app.post("/client/v4/zones/:zoneId/dns_records", async (c) => {
        const zoneId = c.req.param("zoneId");
        const zone = ctx.zones.get(zoneId);
        if (!zone) throw new ZoneNotFoundError();

        const rawBody = await c.req.json().catch(() => null);
        if (rawBody === null) throw new ValidationError("body is not valid JSON");

        const parsed = dnsRecordCreateSchema.safeParse(rawBody);
        if (!parsed.success) {
            const detail = parsed.error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("; ");
            throw new ValidationError(detail);
        }

        const record = await createRecord({ zone, ...parsed.data }, ctx.challtestsrv);
        return c.json(successResponse(record), 200);
    });

    app.get("/client/v4/zones/:zoneId/dns_records", (c) => {
        const zoneId = c.req.param("zoneId");
        if (!ctx.zones.has(zoneId)) throw new ZoneNotFoundError();

        const name = c.req.query("name");
        const type = c.req.query("type");
        const records = listRecords(zoneId, {
            name: name || undefined,
            type: type === "A" || type === "CNAME" ? type : undefined,
        });

        return c.json(
            {
                success: true,
                errors: [] as Array<{ code: number; message: string }>,
                messages: [] as Array<{ code: number; message: string }>,
                result: records as DnsRecord[],
                result_info: {
                    page: 1,
                    per_page: records.length,
                    count: records.length,
                    total_count: records.length,
                },
            },
            200,
        );
    });

    app.put("/client/v4/zones/:zoneId/dns_records/:recordId", async (c) => {
        const zoneId = c.req.param("zoneId");
        const recordId = c.req.param("recordId");
        if (!ctx.zones.has(zoneId)) throw new ZoneNotFoundError();

        const rawBody = await c.req.json().catch(() => null);
        if (rawBody === null) throw new ValidationError("body is not valid JSON");

        const parsed = dnsRecordUpdateSchema.safeParse(rawBody);
        if (!parsed.success) {
            const detail = parsed.error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("; ");
            throw new ValidationError(detail);
        }

        const record = await updateRecord(zoneId, recordId, parsed.data, ctx.challtestsrv);
        return c.json(successResponse(record), 200);
    });

    app.delete("/client/v4/zones/:zoneId/dns_records/:recordId", async (c) => {
        const zoneId = c.req.param("zoneId");
        const recordId = c.req.param("recordId");
        if (!ctx.zones.has(zoneId)) throw new ZoneNotFoundError();

        const result = await deleteRecord(zoneId, recordId, ctx.challtestsrv);
        return c.json(successResponse(result), 200);
    });

    // POST /_admin/clear — chamado pelo CLI `cubolab reset` quando stack up.
    // Body vazio ou `{}` são ambos aceitos; content-type irrelevante.
    app.post("/_admin/clear", async (c) => {
        const result = await clearAll(ctx.challtestsrv);
        return c.json(successResponse(result), 200);
    });

    return app;
};
