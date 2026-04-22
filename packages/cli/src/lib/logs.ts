import { existsSync } from "node:fs";
import { execa } from "execa";
import { detectCompose, listRunningContainers } from "./compose.js";
import { COMPOSE_PROJECT, CONTAINER } from "./constants.js";
import { paths } from "./paths.js";

export type LogsOptions = {
    // Default true — convention do ecosistema compose (`logs -f`) é streamar.
    follow: boolean;
    // Override do stdio repassado pro compose. Default "inherit" — faz
    // `cubolab logs` funcionar tanto em TTY interativo (Ctrl-C encerra) quanto
    // em redirect (`cubolab logs > f.log`) sem silenciar saída por engano.
    // Testes passam "ignore" pra não poluir o output do vitest.
    stdio?: "inherit" | "ignore" | "pipe";
};

// Tail dos logs da stack. Em follow mode passa o controle pro compose e só
// retorna quando o usuário manda Ctrl-C (SIGINT propaga via stdio herdado).
// Em snapshot mode, retorna quando o compose termina de imprimir os logs
// existentes.
//
// Falha com erro claro quando a stack não está up (ao invés de retornar
// silenciosamente), pra que o usuário que bate `logs` por engano saiba o
// motivo imediato sem ficar olhando pra terminal vazio.
export const runLogs = async ({ follow, stdio = "inherit" }: LogsOptions): Promise<void> => {
    if (!existsSync(paths.composeFile)) {
        throw new Error("stack is down — start with `cubolab up`");
    }

    const tool = await detectCompose();
    const containers = await listRunningContainers(tool);
    const hasAny = containers.has(CONTAINER.pebble) || containers.has(CONTAINER.challtestsrv);
    if (!hasAny) {
        throw new Error("stack is down — start with `cubolab up`");
    }

    const parts = tool.split(" ");
    const cmd = parts[0];
    if (!cmd) throw new Error(`invalid compose tool: ${tool}`);
    const rest = parts.slice(1);

    const args = [...rest, "-f", paths.composeFile, "-p", COMPOSE_PROJECT, "logs"];
    if (follow) args.push("-f");

    await execa(cmd, args, { stdio, reject: false });
};
