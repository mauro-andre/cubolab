import type { DnsRecord } from "@cubolab/core";

const detectHostIp = (): string => process.env.CUBOLAB_HOST_IP ?? "127.0.0.1";

// Lista DNS records que o cf-shim tem registrados pra uma zona. Usa o mesmo
// endpoint público consumido por clientes (PodCubo) — garante que o test
// vê a mesma view que o consumidor real.
export const listCloudflareRecords = async (zoneId: string): Promise<DnsRecord[]> => {
    const hostIp = detectHostIp();
    const res = await fetch(`http://${hostIp}:4500/client/v4/zones/${zoneId}/dns_records`);
    if (!res.ok) {
        throw new Error(`cf-shim GET /dns_records failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as { result: DnsRecord[] };
    return body.result;
};
