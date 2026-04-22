import { existsSync } from "node:fs";
import { paths } from "@cubolab/core";
import { execa } from "execa";
import type { ComposeTool } from "../schemas/status.js";
import { detectCompose, listRunningContainers } from "./compose.js";
import { COMPOSE_PROJECT, CONTAINER } from "./constants.js";

export type DownResult = {
    // `true` quando `~/.cubolab/docker-compose.yml` não existe — stack nunca
    // foi brought up via `cubolab up` (ou foi manualmente limpo).
    composeFileAbsent: boolean;
    // `true` quando pelo menos um container cubolab-* estava rodando antes
    // de `compose down` executar.
    wasUp: boolean;
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

// Derruba a stack preservando `~/.cubolab/*` inteiro (cert, bundle, state,
// assets). Idempotente — `down` sem nada de pé é no-op + sucesso.
//
// Não usamos `-v` em `compose down`: nossa stack não declara volumes nomeados
// em M1, mas passar o `-v` implicitamente comunicaria "limpar dados" e pode
// conflitar com M2+ se algum componente ganhar volume (cf-shim persistence).
export const runDown = async (): Promise<DownResult> => {
    if (!existsSync(paths.composeFile)) {
        return { composeFileAbsent: true, wasUp: false };
    }

    let wasUp = false;
    try {
        const composeTool = await detectCompose();
        const containers = await listRunningContainers(composeTool);
        wasUp = containers.has(CONTAINER.pebble) || containers.has(CONTAINER.challtestsrv);
        await runCompose(composeTool, ["down"]);
    } catch (err) {
        // Se o compose tool sumiu entre up/down, reporta; mas se só os
        // containers já estavam stopped, `compose down` é no-op e não lança.
        throw err instanceof Error ? err : new Error(String(err));
    }

    return { composeFileAbsent: false, wasUp };
};
