import { z } from "zod";

// State persistente em ~/.cubolab/state.json. Schema versionado pra evolução
// futura. Em M2 em diante, o cf-shim é o único writer quando stack up (CLI
// delega via POST /_admin/clear). CLI escreve diretamente apenas quando
// stack down (single writer garantido em cada janela).
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

export const stateSchema = z.object({
    version: z.literal(1),
    dns: z.array(dnsRecordSchema),
});

export type DnsRecord = z.infer<typeof dnsRecordSchema>;
export type State = z.infer<typeof stateSchema>;

export const emptyState = (): State => ({ version: 1, dns: [] });
