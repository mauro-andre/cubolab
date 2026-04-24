import { z } from "zod";

// State persistente em ~/.cubolab/state.json. Schema versionado pra evolução
// futura. Em M2 em diante, o cf-shim é o único writer de `dns` quando stack
// up (CLI delega via POST /_admin/clear). CLI é o único writer de `splitDns`
// (M4.1, PR19) — aplicado e removido exclusivamente pelo cli em up/down.
//
// DnsRecord reflete o shape que a Cloudflare API v4 retorna em
// GET /zones/:id/dns_records — pra que o state.json sirva como cache fiel
// do que foi exposto aos consumidores, sem transformação.

export const dnsRecordSchema = z.object({
    id: z.string(),
    type: z.enum(["A", "CNAME"]),
    name: z.string(),
    content: z.string(),
    ttl: z.number().int().min(1),
    proxied: z.boolean(),
    zone_id: z.string(),
    zone_name: z.string(),
    created_on: z.string(),
    modified_on: z.string(),
});

// Split DNS config aplicada pelo cli em `cubolab up [domains...]`. Ausente
// quando não aplicado (comportamento default). Presente = drop-in existe em
// disk e systemd-resolved foi reiniciado com ele.
export const splitDnsSchema = z.object({
    domains: z.array(z.string()).min(1),
    appliedAt: z.string(), // ISO 8601
    method: z.literal("systemd-resolved"),
    dropInPath: z.string(), // absolute — facilita remoção no down
    hostIp: z.string(), // DNS= value
});

export const stateSchema = z.object({
    version: z.literal(1),
    dns: z.array(dnsRecordSchema),
    splitDns: splitDnsSchema.optional(),
});

export type DnsRecord = z.infer<typeof dnsRecordSchema>;
export type SplitDnsState = z.infer<typeof splitDnsSchema>;
export type State = z.infer<typeof stateSchema>;

export const emptyState = (): State => ({ version: 1, dns: [] });
