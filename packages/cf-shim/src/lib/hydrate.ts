import { readState } from "@cubolab/core";
import { addRecordToDns, type ChalltestsrvClient } from "./challtestsrv.js";

export type HydrateResult = {
    hydrated: number;
    failed: number;
};

// Re-registra todos os records persistidos em state.json no challtestsrv.
// Chamado no startup do cf-shim (após waitForChalltestsrv) pra que um
// restart do container recupere o estado DNS sem intervention do CLI —
// challtestsrv é in-memory, perde records em qualquer restart.
//
// Best-effort: falha individual é logged mas não aborta; state continua
// sendo a fonte de verdade. Próximo restart do cf-shim tenta de novo.
export const hydrateFromState = async (client: ChalltestsrvClient): Promise<HydrateResult> => {
    const state = readState();
    let hydrated = 0;
    let failed = 0;
    for (const record of state.dns) {
        try {
            await addRecordToDns(client, record);
            hydrated++;
        } catch (err) {
            console.error(
                `cubolab-cf-shim: hydration failed for ${record.type} ${record.name}:`,
                err,
            );
            failed++;
        }
    }
    return { hydrated, failed };
};
