import { serve } from "@hono/node-server";
import { createApp } from "../app.js";
import { parseZones } from "../lib/zones.js";
import type { Zone } from "../schemas/cloudflare.js";

const raw = process.env.CUBOLAB_ZONES ?? "";

let zones: Map<string, Zone>;
try {
    zones = parseZones(raw);
} catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`cubolab-cf-shim: ${msg}`);
    process.exit(1);
}

const app = createApp({ zones });

serve({ fetch: app.fetch, port: 4500 }, (info) => {
    console.log(`cubolab-cf-shim listening on :${info.port} (zones=${zones.size})`);
});
