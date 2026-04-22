// Códigos de erro Cloudflare API v4 centralizados. Valores abaixo são
// "closest match" da doc pública/erros observados da CF real. Se OpenAPI
// spec oficial der código melhor pra algum caso, substitui aqui num lugar
// só (handlers usam o símbolo, não o número).

export const CF_CODE = {
    ZONE_NOT_FOUND: 7003,
    RECORD_NOT_FOUND: 81044,
    RECORD_TYPE_UNSUPPORTED: 9005,
    RECORD_DUPLICATE: 81057,
    VALIDATION: 9007,
    PERSISTENCE_FAILED: 1105,
    UPSTREAM_FAILED: 1106,
    INTERNAL: 1000,
} as const;

// URL do challtestsrv mgmt API dentro da network do compose (resolvido pelo
// DNS interno do podman/docker via nome do service).
export const CHALLTESTSRV_URL = process.env.CHALLTESTSRV_URL ?? "http://challtestsrv:8055";
