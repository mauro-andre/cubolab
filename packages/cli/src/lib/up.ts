import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ensureState, paths } from "@cubolab/core";
import { execa } from "execa";
import type { ComposeTool } from "../schemas/status.js";
import { assetsDir } from "./assets.js";
import { detectCompose } from "./compose.js";
import { COMPOSE_PROJECT } from "./constants.js";
import { ensurePebbleCert } from "./ensureCert.js";
import { detectHostIp } from "./hostIp.js";
import { probeHttp } from "./probe.js";
import { ensureTrustBundle } from "./trustBundle.js";

export type UpResult = {
    hostIp: string;
    composeTool: ComposeTool;
    certGenerated: boolean;
    trustBundleDownloaded: boolean;
};

export type UpReporter = {
    info(msg: string): void;
    step(label: string): void;
};

const NOOP_REPORTER: UpReporter = { info: () => {}, step: () => {} };

const waitPebbleHealthy = async (hostIp: string, timeoutMs: number): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const r = await probeHttp(`https://${hostIp}:14000/dir`, 1500);
        if (r.healthy) return;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`pebble didn't become healthy within ${timeoutMs}ms`);
};

const runCompose = async (tool: ComposeTool, subargs: readonly string[]): Promise<void> => {
    const parts = tool.split(" ");
    const cmd = parts[0];
    if (!cmd) throw new Error(`invalid compose tool: ${tool}`);
    const rest = parts.slice(1);
    // Pass-through em TTY (usuário vê progresso do pull frio, que pode levar
    // minutos na primeira vez). Em pipe/CI/teste, silencia ruído.
    const stdio = process.stdout.isTTY ? "inherit" : "ignore";
    await execa(cmd, [...rest, "-f", paths.composeFile, "-p", COMPOSE_PROJECT, ...subargs], {
        stdio,
        timeout: 300_000,
    });
};

// Orquestra bring-up idempotente. Cada passo é seguro pra re-run.
export const runUp = async (reporter: UpReporter = NOOP_REPORTER): Promise<UpResult> => {
    // 1. ~/.cubolab/ exists
    mkdirSync(paths.base, { recursive: true });

    // 2. detect host IP (virbr0 ou override)
    const hostIp = await detectHostIp();
    reporter.info(`host IP: ${hostIp}`);

    // 3. cert server com SAN (idempotente)
    reporter.step("ensuring pebble cert");
    const certGenerated = await ensurePebbleCert(hostIp);

    // 4. copiar assets estáticos (overwrite pra pegar atualizações cross-version)
    copyFileSync(join(assetsDir, "pebble-config.json"), paths.pebbleConfig);
    copyFileSync(join(assetsDir, "docker-compose.yml"), paths.composeFile);

    // 5. state (empty em M1; cf-shim popula em M2)
    const state = ensureState();

    // 6. detect compose tool
    const composeTool = await detectCompose();
    reporter.info(`compose tool: ${composeTool}`);

    // 7. compose up (idempotente)
    reporter.step("starting containers");
    await runCompose(composeTool, ["up", "-d"]);

    // 8. aguarda Pebble healthy antes de baixar trust bundle
    reporter.step("waiting for pebble");
    await waitPebbleHealthy(hostIp, 30_000);

    // 9. trust bundle (roots/0 + intermediates/0 → trust-bundle.pem). Idempotente.
    reporter.step("ensuring trust bundle");
    const trustBundleDownloaded = await ensureTrustBundle({ hostIp });

    // 10. re-hidratação do challtestsrv a partir do state.
    // M1: state.dns sempre vazio → loop é no-op.
    // M2: cf-shim escreve aqui; enviaremos POST /add-a|/add-cname pra challtestsrv.
    for (const _record of state.dns) {
        // reservado pra M2
    }

    return { hostIp, composeTool, certGenerated, trustBundleDownloaded };
};
