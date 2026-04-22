import { emptyState, readState, writeState } from "@cubolab/core";
import { detectCompose, listRunningContainers } from "./compose.js";
import { CONTAINER } from "./constants.js";
import { detectHostIp } from "./hostIp.js";

export type ResetResult = {
    recordsCleared: number;
    // 'via-cf-shim': delegamos o clear pro cf-shim via POST /_admin/clear
    //   (stack up + cf-shim rodando). Garante single-writer do state.json.
    // 'direct': escrevemos empty state localmente (stack down ou cf-shim
    //   unreachable). Sem concorrente nesse caso, safe.
    mode: "via-cf-shim" | "direct";
};

const isCfShimRunning = async (): Promise<boolean> => {
    try {
        const tool = await detectCompose();
        const containers = await listRunningContainers(tool);
        return containers.has(CONTAINER.cfShim);
    } catch {
        return false;
    }
};

type CfShimClearResponse = {
    success: boolean;
    result: { records_cleared: number };
};

const delegateToShim = async (hostIp: string): Promise<number> => {
    const res = await fetch(`http://${hostIp}:4500/_admin/clear`, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
        throw new Error(`cf-shim /_admin/clear returned HTTP ${res.status}`);
    }
    const body = (await res.json()) as CfShimClearResponse;
    return body.result.records_cleared;
};

// Zera o state + limpa DNS. Idempotente. Duas vias:
//
// - Stack up (cf-shim rodando) → delega via HTTP pro cf-shim, que faz
//   read-modify-write do state.json sob seu mutex interno (single writer).
//   Isso evita race entre CLI e cf-shim escrevendo o mesmo arquivo.
//
// - Stack down (cf-shim não está rodando) → CLI escreve empty state
//   diretamente. Não há concorrente nesse caso.
export const runReset = async (): Promise<ResetResult> => {
    if (await isCfShimRunning()) {
        const hostIp = await detectHostIp();
        const recordsCleared = await delegateToShim(hostIp);
        return { recordsCleared, mode: "via-cf-shim" };
    }

    const current = readState();
    writeState(emptyState());
    return { recordsCleared: current.dns.length, mode: "direct" };
};
