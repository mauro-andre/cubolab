import type { DnsRecord } from "@cubolab/core";
import { UpstreamError } from "./errors.js";

export type ChalltestsrvClient = {
    addA(host: string, address: string): Promise<void>;
    addCname(host: string, target: string): Promise<void>;
    clearA(host: string): Promise<void>;
    clearCname(host: string): Promise<void>;
};

// challtestsrv exige hostnames FQDN (trailing dot). O cliente CF não manda
// necessariamente (PodCubo passa sem o dot) — normalizamos aqui.
const fqdn = (host: string): string => (host.endsWith(".") ? host : `${host}.`);

export const createChalltestsrvClient = (baseUrl: string, timeoutMs = 5000): ChalltestsrvClient => {
    const post = async (path: string, body: unknown): Promise<void> => {
        let res: Response;
        try {
            res = await fetch(`${baseUrl}${path}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new UpstreamError(`${path}: ${msg}`);
        }
        if (!res.ok) {
            await res.body?.cancel();
            throw new UpstreamError(`${path} HTTP ${res.status}`);
        }
        await res.body?.cancel();
    };

    return {
        addA: (host, address) => post("/add-a", { host: fqdn(host), addresses: [address] }),
        addCname: (host, target) => post("/add-cname", { host: fqdn(host), target: fqdn(target) }),
        clearA: (host) => post("/clear-a", { host: fqdn(host) }),
        clearCname: (host) => post("/clear-cname", { host: fqdn(host) }),
    };
};

// Wrappers que dispatcham pelo record.type. Usados nas rotas.
export const addRecordToDns = async (
    client: ChalltestsrvClient,
    record: Pick<DnsRecord, "type" | "name" | "content">,
): Promise<void> => {
    if (record.type === "A") await client.addA(record.name, record.content);
    else await client.addCname(record.name, record.content);
};

export const clearRecordFromDns = async (
    client: ChalltestsrvClient,
    record: Pick<DnsRecord, "type" | "name">,
): Promise<void> => {
    if (record.type === "A") await client.clearA(record.name);
    else await client.clearCname(record.name);
};
