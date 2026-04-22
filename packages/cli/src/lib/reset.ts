import http from "node:http";
import type { DnsRecord } from "../schemas/state.js";
import { emptyState } from "../schemas/state.js";
import { detectCompose, listRunningContainers } from "./compose.js";
import { CONTAINER } from "./constants.js";
import { detectHostIp } from "./hostIp.js";
import { readState, writeState } from "./state.js";

export type ResetResult = {
    // Quantos records o state tinha antes do reset (pra reportar "cleared N").
    recordsCleared: number;
    // `true` se conseguimos falar com challtestsrv pra limpar records
    // do DNS server. Quando a stack está down, vira `false` e a limpeza do
    // DNS é pulada — só o state.json é zerado. M2: cf-shim é a fonte da
    // verdade, então state.json + challtestsrv ficam em sync no próximo `up`.
    challtestsrvReachable: boolean;
};

// POST http://hostIp:8055/clear-a|/clear-cname  body: {"host":"..."}
// Endpoint confirmado no challtestsrv (https://github.com/letsencrypt/pebble).
const postClear = async (hostIp: string, record: DnsRecord): Promise<void> => {
    const endpoint = record.type === "A" ? "/clear-a" : "/clear-cname";
    const payload = JSON.stringify({ host: record.name });
    return new Promise((resolve, reject) => {
        const req = http.request(
            `http://${hostIp}:8055${endpoint}`,
            { method: "POST", timeout: 5000 },
            (res) => {
                res.resume();
                if (res.statusCode === 200) resolve();
                else reject(new Error(`HTTP ${res.statusCode} from ${endpoint}`));
            },
        );
        req.on("timeout", () => req.destroy(new Error("timeout clearing record")));
        req.on("error", reject);
        req.write(payload);
        req.end();
    });
};

const isChalltestsrvUp = async (): Promise<boolean> => {
    try {
        const tool = await detectCompose();
        const containers = await listRunningContainers(tool);
        return containers.has(CONTAINER.challtestsrv);
    } catch {
        return false;
    }
};

// Zera o state e — se challtestsrv está up — limpa os records correspondentes
// do DNS server. Preserva containers, cert, trust bundle, pebble-key,
// pebble-root, pebble-intermediate. Idempotente.
//
// M1: state.dns tipicamente vazio (ninguém escreve nele ainda), então a
// limpeza é no-op. O código chama postClear() de qualquer jeito pro
// caminho já ser exercitado — M2 (cf-shim) populará state.dns e o reset
// funcionará sem mudança de código.
export const runReset = async (): Promise<ResetResult> => {
    const current = readState();
    const toClear = current.dns;

    let challtestsrvReachable = false;
    if (await isChalltestsrvUp()) {
        const hostIp = await detectHostIp();
        for (const record of toClear) {
            await postClear(hostIp, record);
        }
        challtestsrvReachable = true;
    }

    writeState(emptyState());
    return { recordsCleared: toClear.length, challtestsrvReachable };
};
