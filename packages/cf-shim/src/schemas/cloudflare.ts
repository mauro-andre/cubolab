import { z } from "zod";

// Shapes seguem a Cloudflare API v4 real. Campos extras que o CF retorna
// (account, plan, development_mode, etc) não estão aqui em M2 — se algum
// consumer precisar, adicionamos on-demand. Tudo que está aqui bate com
// o formato do CF real pra que client code funcione sem mudança.

export const zoneSchema = z.object({
    id: z.string(),
    name: z.string(),
    status: z.literal("active"),
    paused: z.literal(false),
    type: z.literal("full"),
    name_servers: z.array(z.string()),
    created_on: z.string(),
    modified_on: z.string(),
});

export type Zone = z.infer<typeof zoneSchema>;

export type CfError = {
    code: number;
    message: string;
};

export type CfResponse<T> = {
    success: boolean;
    errors: CfError[];
    messages: CfError[];
    result: T;
    result_info?: {
        page: number;
        per_page: number;
        count: number;
        total_count: number;
    };
};

export const successResponse = <T>(result: T): CfResponse<T> => ({
    success: true,
    errors: [],
    messages: [],
    result,
});

export const errorResponse = (errors: CfError[]): CfResponse<null> => ({
    success: false,
    errors,
    messages: [],
    result: null,
});

// Code 7003 é o mais próximo encontrado na doc pública da CF ("Could not
// route to /zones/:id, perhaps your object identifier is invalid"). Código
// específico para "zone not found" em path válido não consta claramente na
// API reference; ajustável se aparecer source better (ex: OpenAPI spec).
export const ZONE_NOT_FOUND_CODE = 7003;
