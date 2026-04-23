// Barrel da API pública do cli como biblioteca. Exports são EXPLÍCITOS
// (não `export *`) — surface é refactor-proof: mover arquivo interno não
// re-publica acidentalmente algo que não pertence à API.
//
// Consumido por `@cubolab/testing` e qualquer outro package que queira
// embutir o lifecycle do sandbox em código próprio (orquestradores, CI
// wrappers, etc). Binário (bin/cubolab.ts) continua independente via
// package.json `bin` field.

export type {
    Component,
    ComposeTool,
    StackState,
    StatusReport,
} from "../schemas/status.js";
export type { CaResult } from "./ca.js";
export { runCa } from "./ca.js";
export { detectCompose } from "./compose.js";
export { COMPOSE_PROJECT, CONTAINER } from "./constants.js";
export type { DownResult } from "./down.js";
export { runDown } from "./down.js";
export { detectHostIp } from "./hostIp.js";
export type { LogsOptions } from "./logs.js";
export { runLogs } from "./logs.js";
export type { ResetResult } from "./reset.js";
export { runReset } from "./reset.js";
export { collectStatus } from "./stack.js";
export type { UpReporter, UpResult } from "./up.js";
export { runUp } from "./up.js";
