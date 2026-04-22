import { z } from "zod";

// Contrato público estável (schema v1). Adicionar campos opcionais = non-breaking.
// Remover/renomear campos ou adicionar components keys com semântica nova = breaking
// (bump `version`).
//
// `endpoints` contém URLs absolutas (com esquema http:// ou https://) OU hostport
// (ip:port) para endpoints sem protocolo de aplicação como DNS.
//
// `lastError` só é preenchido quando `running=true` mas `healthy=false`. Quando
// `running=false`, o estado já é óbvio e não precisa de mensagem redundante.

export const componentSchema = z.object({
    running: z.boolean(),
    healthy: z.boolean(),
    lastError: z.string().optional(),
    endpoints: z.record(z.string(), z.string()),
});

export const statusReportSchema = z.object({
    version: z.literal(1),
    stack: z.enum(["up", "down", "partial"]),
    components: z.record(z.string(), componentSchema),
    trustBundle: z.object({
        path: z.string(),
        exists: z.boolean(),
    }),
    composeTool: z.enum(["podman-compose", "docker compose", "docker-compose"]),
    hostIp: z.string(),
});

export type Component = z.infer<typeof componentSchema>;
export type StatusReport = z.infer<typeof statusReportSchema>;
export type ComposeTool = StatusReport["composeTool"];
export type StackState = StatusReport["stack"];
