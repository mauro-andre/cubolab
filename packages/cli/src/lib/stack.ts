import { existsSync } from "node:fs";
import { paths, readState } from "@cubolab/core";
import type { Component, StackState, StatusReport } from "../schemas/status.js";
import { detectCompose, listRunningContainers } from "./compose.js";
import { CONTAINER } from "./constants.js";
import { detectHostIp } from "./hostIp.js";
import { probeHttp } from "./probe.js";

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
    const cfShimRunning = containers.has(CONTAINER.cfShim);

    const pebbleAcme = `https://${hostIp}:14000/dir`;
    const challtestsrvMgmt = `http://${hostIp}:8055/`;
    const cfShimApi = `http://${hostIp}:4500/`;

    const [pebble, challtestsrv, cfShim] = await Promise.all([
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
        buildComponent(
            cfShimRunning,
            {
                api: `http://${hostIp}:4500`,
            },
            cfShimRunning ? cfShimApi : undefined,
        ),
    ]);

    const components = { pebble, challtestsrv, cfShim };

    // Lê state.splitDns (pode ou não existir). Só expõe no report se
    // aplicado — campo opcional, non-breaking no schema v1.
    const splitDnsState = existsSync(paths.state) ? readState().splitDns : undefined;
    const splitDnsReport = splitDnsState
        ? {
              domains: splitDnsState.domains,
              hostIp: splitDnsState.hostIp,
              method: splitDnsState.method,
              appliedAt: splitDnsState.appliedAt,
          }
        : undefined;

    return {
        version: 1,
        stack: deriveStack([pebble, challtestsrv, cfShim]),
        components,
        trustBundle: { path: paths.trustBundle, exists: existsSync(paths.trustBundle) },
        composeTool,
        hostIp,
        ...(splitDnsReport ? { splitDns: splitDnsReport } : {}),
    };
};
