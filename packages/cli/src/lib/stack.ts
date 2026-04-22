import { existsSync } from "node:fs";
import type { Component, StackState, StatusReport } from "../schemas/status.js";
import { detectCompose, listRunningContainers } from "./compose.js";
import { detectHostIp } from "./hostIp.js";
import { paths } from "./paths.js";
import { probeHttp } from "./probe.js";

// Contrato firmado pra M1+: compose file usa container_name fixo pra cada
// service, assim `listRunningContainers` + set membership resolve `running`
// sem depender do compose file estar presente em disco.
const CONTAINER = {
    pebble: "cubolab-pebble",
    challtestsrv: "cubolab-challtestsrv",
} as const;

const buildComponent = async (
    running: boolean,
    endpoints: Record<string, string>,
    healthProbeUrl: string | undefined,
): Promise<Component> => {
    if (!running) {
        return { running: false, healthy: false, endpoints };
    }
    if (!healthProbeUrl) {
        return { running: true, healthy: true, endpoints };
    }
    const probe = await probeHttp(healthProbeUrl);
    if (probe.healthy) {
        return { running: true, healthy: true, endpoints };
    }
    return {
        running: true,
        healthy: false,
        endpoints,
        lastError: probe.error ?? "unknown probe error",
    };
};

const deriveStack = (comps: readonly Component[]): StackState => {
    const anyRunning = comps.some((c) => c.running);
    if (!anyRunning) return "down";
    const allHealthy = comps.every((c) => c.healthy);
    return allHealthy ? "up" : "partial";
};

export const collectStatus = async (): Promise<StatusReport> => {
    const composeTool = await detectCompose();
    const hostIp = await detectHostIp();
    const containers = await listRunningContainers(composeTool);

    const pebbleRunning = containers.has(CONTAINER.pebble);
    const challtestsrvRunning = containers.has(CONTAINER.challtestsrv);

    const pebbleAcme = `https://${hostIp}:14000/dir`;
    const challtestsrvMgmt = `http://${hostIp}:8055/`;

    const [pebble, challtestsrv] = await Promise.all([
        buildComponent(
            pebbleRunning,
            {
                acme: pebbleAcme,
                mgmt: `https://${hostIp}:15000`,
            },
            pebbleRunning ? pebbleAcme : undefined,
        ),
        buildComponent(
            challtestsrvRunning,
            {
                dns: `${hostIp}:8053`,
                mgmt: challtestsrvMgmt,
            },
            challtestsrvRunning ? challtestsrvMgmt : undefined,
        ),
    ]);

    const components = { pebble, challtestsrv };

    return {
        version: 1,
        stack: deriveStack([pebble, challtestsrv]),
        components,
        trustBundle: { path: paths.trustBundle, exists: existsSync(paths.trustBundle) },
        composeTool,
        hostIp,
    };
};
