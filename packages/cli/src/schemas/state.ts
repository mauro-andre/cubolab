import { z } from "zod";

// State persistente em ~/.cubolab/state.json. Schema versionado pra evolução
// futura. Em M1 o array `dns` fica vazio; em M2 o cf-shim popula ao criar
// records via API e `cubolab up` re-hidrata o challtestsrv a partir daqui.

export const dnsRecordSchema = z.object({
    type: z.enum(["A", "CNAME"]),
    name: z.string(),
    content: z.string(),
});

export const stateSchema = z.object({
    version: z.literal(1),
    dns: z.array(dnsRecordSchema),
});

export type DnsRecord = z.infer<typeof dnsRecordSchema>;
export type State = z.infer<typeof stateSchema>;

export const emptyState = (): State => ({ version: 1, dns: [] });
