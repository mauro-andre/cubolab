// Constantes compartilhadas entre os comandos up/down/reset/status.
// Container names são contrato público (ARCH §Public contracts §5) — status
// detecta a stack via lookup por nome, down/reset esperam esses nomes ao
// chamar compose/podman.

export const COMPOSE_PROJECT = "cubolab";

export const CONTAINER = {
    pebble: "cubolab-pebble",
    challtestsrv: "cubolab-challtestsrv",
} as const;
