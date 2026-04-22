import type { ChalltestsrvClient } from "../../src/lib/challtestsrv.js";

// Stub recording — registra calls em `log` pra assertions e permite
// injetar falha em qualquer método via `failOn: Set<method>`.

export type StubCall = { method: string; args: unknown[] };

export const createStubChalltestsrv = (
    options: { failOn?: Set<"addA" | "addCname" | "clearA" | "clearCname"> } = {},
): ChalltestsrvClient & { log: StubCall[]; reset(): void } => {
    const log: StubCall[] = [];
    const maybeFail = async (
        method: "addA" | "addCname" | "clearA" | "clearCname",
    ): Promise<void> => {
        if (options.failOn?.has(method)) {
            throw new Error(`stub: ${method} forced failure`);
        }
    };
    const client = {
        addA: async (host: string, address: string) => {
            log.push({ method: "addA", args: [host, address] });
            await maybeFail("addA");
        },
        addCname: async (host: string, target: string) => {
            log.push({ method: "addCname", args: [host, target] });
            await maybeFail("addCname");
        },
        clearA: async (host: string) => {
            log.push({ method: "clearA", args: [host] });
            await maybeFail("clearA");
        },
        clearCname: async (host: string) => {
            log.push({ method: "clearCname", args: [host] });
            await maybeFail("clearCname");
        },
    };
    return Object.assign(client, {
        log,
        reset: () => {
            log.length = 0;
        },
    });
};
