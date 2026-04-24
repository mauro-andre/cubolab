import { existsSync } from "node:fs";
import { paths, readState, writeState } from "@cubolab/core";
import { execa } from "execa";
import type { ComposeTool } from "../schemas/status.js";
import { detectCompose, listRunningContainers } from "./compose.js";
import { COMPOSE_PROJECT, CONTAINER } from "./constants.js";
import { removeSplitDns } from "./splitDns.js";

export type SplitDnsTeardown =
    | { state: "not-applied" }
    | { state: "removed"; domains: readonly string[] }
    | { state: "already-absent"; domains: readonly string[] }
    | { state: "sudo-failed"; detail: string };

export type DownResult = {
    // `true` quando `~/.cubolab/docker-compose.yml` não existe — stack nunca
    // foi brought up via `cubolab up` (ou foi manualmente limpo).
    composeFileAbsent: boolean;
    // `true` quando pelo menos um container cubolab-* estava rodando antes
    // de `compose down` executar.
    wasUp: boolean;
    // Resultado do teardown do split DNS (se estava aplicado no state).
    splitDns: SplitDnsTeardown;
};

const runCompose = async (tool: ComposeTool, subargs: readonly string[]): Promise<void> => {
    const parts = tool.split(" ");
    const cmd = parts[0];
    if (!cmd) throw new Error(`invalid compose tool: ${tool}`);
    const rest = parts.slice(1);
    const stdio = process.stdout.isTTY ? "inherit" : "ignore";
    await execa(cmd, [...rest, "-f", paths.composeFile, "-p", COMPOSE_PROJECT, ...subargs], {
        stdio,
        timeout: 60_000,
    });
};

// Remove split DNS do sistema antes de derrubar containers. Ordem escolhida
// pra dois motivos: (1) se sudo falha, user ainda tem containers up (chance
// de debug); (2) se compose down falhar, split DNS já foi revertido (sem
// pegada residual no /etc/).
//
// Se sudo-failed: state.splitDns permanece (próxima `down` tenta de novo).
// Idempotente: chamar sem state.splitDns = no-op silencioso.
const teardownSplitDns = async (): Promise<SplitDnsTeardown> => {
    const state = readState();
    if (!state.splitDns) return { state: "not-applied" };

    const domains = state.splitDns.domains;
    const result = await removeSplitDns(state.splitDns.dropInPath);

    if (result.removed) {
        const { splitDns: _omit, ...rest } = state;
        writeState(rest);
        return { state: "removed", domains };
    }

    if (result.reason === "already-absent") {
        const { splitDns: _omit, ...rest } = state;
        writeState(rest);
        return { state: "already-absent", domains };
    }

    // sudo-failed — mantém state.splitDns pra próxima tentativa.
    return { state: "sudo-failed", detail: result.detail };
};

// Derruba a stack preservando `~/.cubolab/*` inteiro (cert, bundle, state,
// assets). Idempotente — `down` sem nada de pé é no-op + sucesso. Split DNS
// é desmontado primeiro (se aplicado); containers depois.
//
// Não usamos `-v` em `compose down`: nossa stack não declara volumes nomeados
// em M1, mas passar o `-v` implicitamente comunicaria "limpar dados" e pode
// conflitar com M2+ se algum componente ganhar volume (cf-shim persistence).
export const runDown = async (): Promise<DownResult> => {
    const splitDns = existsSync(paths.state)
        ? await teardownSplitDns()
        : { state: "not-applied" as const };

    if (!existsSync(paths.composeFile)) {
        return { composeFileAbsent: true, wasUp: false, splitDns };
    }

    const composeTool = await detectCompose();
    const containers = await listRunningContainers(composeTool);
    const wasUp =
        containers.has(CONTAINER.pebble) ||
        containers.has(CONTAINER.challtestsrv) ||
        containers.has(CONTAINER.cfShim);
    await runCompose(composeTool, ["down"]);

    return { composeFileAbsent: false, wasUp, splitDns };
};
