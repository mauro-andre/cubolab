export { paths } from "./lib/paths.js";
export { ensureState, readState, writeState } from "./lib/state.js";
export type { DnsRecord, SplitDnsState, State } from "./schemas/state.js";
export { dnsRecordSchema, emptyState, splitDnsSchema, stateSchema } from "./schemas/state.js";
