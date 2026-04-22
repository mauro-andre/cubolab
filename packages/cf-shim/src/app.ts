import { Hono } from "hono";
import {
    errorResponse,
    successResponse,
    ZONE_NOT_FOUND_CODE,
    type Zone,
} from "./schemas/cloudflare.js";

export type AppContext = {
    zones: Map<string, Zone>;
};

// Factory permite DI do `ctx.zones` nos tests sem precisar de env var real —
// unit tests via `app.request(...)` ficam 100% pure. Em produção, bin/cf-shim.ts
// parseia o CUBOLAB_ZONES e passa o Map pronto.
export const createApp = (ctx: AppContext): Hono => {
    const app = new Hono();

    app.get("/client/v4/zones/:zoneId", (c) => {
        const zoneId = c.req.param("zoneId");
        const zone = ctx.zones.get(zoneId);
        if (!zone) {
            return c.json(
                errorResponse([
                    {
                        code: ZONE_NOT_FOUND_CODE,
                        message: "zone not found — add to CUBOLAB_ZONES",
                    },
                ]),
                404,
            );
        }
        return c.json(successResponse(zone), 200);
    });

    return app;
};
