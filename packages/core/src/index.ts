export { paths } from "./lib/paths.js";
export { ensureState, readState, writeState } from "./lib/state.js";
export type { DnsRecord, State } from "./schemas/state.js";
export {
    dnsRecordSchema,
    emptyState,
    stateSchema,
} from "./schemas/state.js";
