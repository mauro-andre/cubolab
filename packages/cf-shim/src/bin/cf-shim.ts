import { serve } from "@hono/node-server";
import { createApp } from "../app.js";
import { CHALLTESTSRV_URL } from "../constants.js";
import { createChalltestsrvClient } from "../lib/challtestsrv.js";
import { hydrateFromState } from "../lib/hydrate.js";
import { waitForChalltestsrv } from "../lib/waitForChalltestsrv.js";
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

const challtestsrv = createChalltestsrvClient(CHALLTESTSRV_URL);

// 1. Aguarda challtestsrv reachable (depends_on garante start, não readiness).
try {
    await waitForChalltestsrv();
} catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`cubolab-cf-shim: ${msg}`);
    process.exit(1);
}

// 2. Hidrata DNS a partir do state persistido. `state.json` é a fonte da
//    verdade; challtestsrv é re-povoado a cada boot do cf-shim.
const { hydrated, failed } = await hydrateFromState(challtestsrv);
if (hydrated > 0 || failed > 0) {
    console.log(`cubolab-cf-shim: hydrated ${hydrated} records (${failed} failed)`);
}

// 3. Inicia servidor HTTP.
const app = createApp({ zones, challtestsrv });
serve({ fetch: app.fetch, port: 4500 }, (info) => {
    console.log(`cubolab-cf-shim listening on :${info.port} (zones=${zones.size})`);
});
