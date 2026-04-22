import { randomUUID } from "node:crypto";
import { type DnsRecord, readState, writeState } from "@cubolab/core";
import type { Zone } from "../schemas/cloudflare.js";
import { addRecordToDns, type ChalltestsrvClient, clearRecordFromDns } from "./challtestsrv.js";
import { DuplicateRecordError, PersistenceError, RecordNotFoundError } from "./errors.js";
import { withStateLock } from "./stateLock.js";

const nowIso = (): string => new Date().toISOString();

// Duplicate = type + name + content + zone_id idênticos. Dois A records com
// mesmo name mas IPs diferentes são PERMITIDOS (CF permite round-robin).
const isDuplicate = (
    records: readonly DnsRecord[],
    candidate: Pick<DnsRecord, "type" | "name" | "content" | "zone_id">,
): boolean =>
    records.some(
        (r) =>
            r.type === candidate.type &&
            r.name === candidate.name &&
            r.content === candidate.content &&
            r.zone_id === candidate.zone_id,
    );

const rollbackBestEffort = async (fn: () => Promise<void>): Promise<void> => {
    try {
        await fn();
    } catch (err) {
        console.error("cubolab-cf-shim: rollback failed (state drift possible):", err);
    }
};

export type CreateRecordInput = {
    zone: Zone;
    type: "A" | "CNAME";
    name: string;
    content: string;
    ttl: number;
    proxied: boolean;
};

export const createRecord = async (
    input: CreateRecordInput,
    challtestsrv: ChalltestsrvClient,
): Promise<DnsRecord> => {
    return withStateLock(async () => {
        const state = readState();
        if (
            isDuplicate(state.dns, {
                type: input.type,
                name: input.name,
                content: input.content,
                zone_id: input.zone.id,
            })
        ) {
            throw new DuplicateRecordError();
        }

        const now = nowIso();
        const record: DnsRecord = {
            id: randomUUID(),
            type: input.type,
            name: input.name,
            content: input.content,
            ttl: input.ttl,
            proxied: input.proxied,
            zone_id: input.zone.id,
            zone_name: input.zone.name,
            created_on: now,
            modified_on: now,
        };

        // Ordem: challtestsrv primeiro (se falhar, state intacto). Persiste
        // depois; rollback best-effort se write falhar após challtestsrv OK.
        await addRecordToDns(challtestsrv, record);
        try {
            writeState({ ...state, dns: [...state.dns, record] });
        } catch (err) {
            await rollbackBestEffort(() => clearRecordFromDns(challtestsrv, record));
            console.error("cubolab-cf-shim: state write failed:", err);
            throw new PersistenceError();
        }

        return record;
    });
};

// Explicit `| undefined` por campo pra casar com o output do zod
// `.optional()` sob `exactOptionalPropertyTypes: true`.
export type UpdateRecordInput = {
    type?: "A" | "CNAME" | undefined;
    name?: string | undefined;
    content?: string | undefined;
    ttl?: number | undefined;
    proxied?: boolean | undefined;
};

export const updateRecord = async (
    zoneId: string,
    recordId: string,
    input: UpdateRecordInput,
    challtestsrv: ChalltestsrvClient,
): Promise<DnsRecord> => {
    return withStateLock(async () => {
        const state = readState();
        const existing = state.dns.find((r) => r.id === recordId && r.zone_id === zoneId);
        if (!existing) throw new RecordNotFoundError(recordId, zoneId);

        const updated: DnsRecord = {
            ...existing,
            ...(input.type !== undefined ? { type: input.type } : {}),
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.content !== undefined ? { content: input.content } : {}),
            ...(input.ttl !== undefined ? { ttl: input.ttl } : {}),
            ...(input.proxied !== undefined ? { proxied: input.proxied } : {}),
            modified_on: nowIso(),
        };

        if (
            isDuplicate(
                state.dns.filter((r) => r.id !== recordId),
                updated,
            )
        ) {
            throw new DuplicateRecordError();
        }

        const dnsKeyChanged =
            existing.type !== updated.type ||
            existing.name !== updated.name ||
            existing.content !== updated.content;

        if (dnsKeyChanged) {
            await clearRecordFromDns(challtestsrv, existing);
            try {
                await addRecordToDns(challtestsrv, updated);
            } catch (err) {
                await rollbackBestEffort(() => addRecordToDns(challtestsrv, existing));
                throw err;
            }
        }

        try {
            writeState({
                ...state,
                dns: state.dns.map((r) => (r.id === recordId ? updated : r)),
            });
        } catch (err) {
            if (dnsKeyChanged) {
                await rollbackBestEffort(() => clearRecordFromDns(challtestsrv, updated));
                await rollbackBestEffort(() => addRecordToDns(challtestsrv, existing));
            }
            console.error("cubolab-cf-shim: state write failed (update):", err);
            throw new PersistenceError();
        }

        return updated;
    });
};

export const deleteRecord = async (
    zoneId: string,
    recordId: string,
    challtestsrv: ChalltestsrvClient,
): Promise<{ id: string }> => {
    return withStateLock(async () => {
        const state = readState();
        const existing = state.dns.find((r) => r.id === recordId && r.zone_id === zoneId);
        if (!existing) throw new RecordNotFoundError(recordId, zoneId);

        await clearRecordFromDns(challtestsrv, existing);

        try {
            writeState({
                ...state,
                dns: state.dns.filter((r) => r.id !== recordId),
            });
        } catch (err) {
            await rollbackBestEffort(() => addRecordToDns(challtestsrv, existing));
            console.error("cubolab-cf-shim: state write failed (delete):", err);
            throw new PersistenceError();
        }

        return { id: existing.id };
    });
};

export const listRecords = (
    zoneId: string,
    filters: { name?: string | undefined; type?: "A" | "CNAME" | undefined },
): DnsRecord[] => {
    const state = readState();
    return state.dns.filter(
        (r) =>
            r.zone_id === zoneId &&
            (filters.name === undefined || r.name === filters.name) &&
            (filters.type === undefined || r.type === filters.type),
    );
};
