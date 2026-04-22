import { emptyState, readState, writeState } from "@cubolab/core";
import { type ChalltestsrvClient, clearRecordFromDns } from "./challtestsrv.js";
import { withStateLock } from "./stateLock.js";

// Limpa todos os records do state + propaga clear pro challtestsrv.
// Best-effort: se clear individual falhar, log WARN e continua — `reset`
// é "limpa o que der; rerun pega o resto". State é sempre zerado ao final.
export const clearAll = async (
    challtestsrv: ChalltestsrvClient,
): Promise<{ records_cleared: number }> => {
    return withStateLock(async () => {
        const state = readState();
        const count = state.dns.length;

        for (const record of state.dns) {
            try {
                await clearRecordFromDns(challtestsrv, record);
            } catch (err) {
                console.error(
                    `cubolab-cf-shim: failed to clear ${record.type} ${record.name}:`,
                    err,
                );
            }
        }

        writeState(emptyState());

        return { records_cleared: count };
    });
};
