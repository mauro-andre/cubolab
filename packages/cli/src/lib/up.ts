import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureState, paths, readState, type SplitDnsState, writeState } from "@cubolab/core";
import { execa } from "execa";
import type { ComposeTool } from "../schemas/status.js";
import { assetsDir } from "./assets.js";
import { detectCompose } from "./compose.js";
import { COMPOSE_PROJECT } from "./constants.js";
import { ensurePebbleCert } from "./ensureCert.js";
import { detectHostIp } from "./hostIp.js";
import { probeHttp } from "./probe.js";
import { detectResolverSupport } from "./resolverDetect.js";
import {
    applySplitDns,
    DROP_IN_PATH,
    detectOrphanDropIn,
    removeSplitDns,
    validateDomain,
} from "./splitDns.js";
import { ensureTrustBundle } from "./trustBundle.js";

export type UpOptions = {
    // Lista opcional de domains pra configurar split DNS via systemd-resolved.
    // Se vazia/ausente, skip split DNS (comportamento pré-PR19 preservado).
    // Validados como FQDN lowercase, dedupe + sort antes de aplicar.
    domains?: readonly string[];
};

// Status do split DNS após o `up`. Feito pra reporter consumir e pra CLI
// exibir em output.
export type SplitDnsOutcome =
    | { state: "not-requested" }
    | { state: "applied"; domains: readonly string[]; hostIp: string }
    | { state: "already-matches"; domains: readonly string[]; hostIp: string }
    | { state: "skipped"; reason: string };

export type UpResult = {
    hostIp: string;
    composeTool: ComposeTool;
    certGenerated: boolean;
    trustBundleDownloaded: boolean;
    splitDns: SplitDnsOutcome;
};

export type UpReporter = {
    info(msg: string): void;
    step(label: string): void;
};

const NOOP_REPORTER: UpReporter = { info: () => {}, step: () => {} };

const waitHealthy = async (name: string, probeUrl: string, timeoutMs: number): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const r = await probeHttp(probeUrl, 1500);
        if (r.healthy) return;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`${name} didn't become healthy within ${timeoutMs}ms`);
};

const waitPebbleHealthy = (hostIp: string, timeoutMs: number): Promise<void> =>
    waitHealthy("pebble", `https://${hostIp}:14000/dir`, timeoutMs);

// cf-shim bind só acontece **depois** de waitForChalltestsrv + hidratação +
// serve(). `compose up -d` volta quando o container está "started", não
// quando o processo serve — há janela onde POST chega antes de Hono aceitar,
// causando ECONNRESET. Probe GET / aguarda o bind real. Hono retorna 404
// (sem route pra "/") que conta como "healthy" em probeHttp (< 500).
const waitCfShimHealthy = (hostIp: string, timeoutMs: number): Promise<void> =>
    waitHealthy("cf-shim", `http://${hostIp}:4500/`, timeoutMs);

// Resolve o path do cf-shim package e sobe 2 níveis até o monorepo root (pasta
// que contém packages/core e packages/cf-shim). O Dockerfile do cf-shim copia
// explicitamente `packages/core` e `packages/cf-shim` a partir desse context.
//
// TODO(M5): em install via node_modules (`node_modules/@cubolab/cf-shim` com
// `@cubolab/core` em paralelo em `node_modules/@cubolab/core`), a estrutura é
// diferente — Dockerfile + este resolver precisam adaptar. Pra M2 (monorepo
// dev), o layout packages/* funciona.
const resolveCfShimContext = (): string => {
    const url = import.meta.resolve("@cubolab/cf-shim/package.json");
    const path = fileURLToPath(url);
    return dirname(dirname(dirname(path)));
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
        env: {
            ...process.env,
            CUBOLAB_CF_SHIM_CONTEXT: resolveCfShimContext(),
            // Expandir pra path absoluto — compose precisa bind-mount
            // pra host filesystem. Sem isso, `${CUBOLAB_HOME}` expansion no
            // compose lê o valor bruto do ambiente (pode vir unset).
            CUBOLAB_HOME: paths.base,
        },
    });
};

// Detecta drop-in órfão (arquivo presente sem entry correspondente em
// state.splitDns) e tenta limpar. Cenário: `cubolab up domain` crashou entre
// `applySplitDns` e `writeState` → drop-in aplicado mas não registrado. Na
// próxima `up`, user (ou sandbox) espera que split DNS seja reconfigurado
// conforme input — o orphan tem que sair antes pra evitar conflito silencioso.
const cleanupOrphanDropIn = async (reporter: UpReporter): Promise<void> => {
    const hasOrphan = await detectOrphanDropIn();
    if (!hasOrphan) return;

    const state = readState();
    if (state.splitDns?.dropInPath === DROP_IN_PATH) return; // não é orphan

    reporter.info("split DNS: cleaning up orphan drop-in from previous run");
    const rm = await removeSplitDns(DROP_IN_PATH);
    if (rm.removed === false && rm.reason === "sudo-failed") {
        reporter.info(`split DNS: couldn't remove orphan drop-in (${rm.detail})`);
        // Não aborta — up continua sem split DNS ativo
    }
};

const handleSplitDns = async (
    hostIp: string,
    domains: readonly string[],
    reporter: UpReporter,
): Promise<SplitDnsOutcome> => {
    const support = await detectResolverSupport();
    if (!support.supported) {
        reporter.info(`split DNS: skipped (${support.reason})`);
        return { state: "skipped", reason: support.reason };
    }

    const result = await applySplitDns({ hostIp, domains });

    if (result.applied) {
        const entry: SplitDnsState = {
            domains: result.info.domains,
            appliedAt: result.info.appliedAt,
            method: "systemd-resolved",
            dropInPath: result.info.dropInPath,
            hostIp: result.info.hostIp,
        };
        const state = readState();
        writeState({ ...state, splitDns: entry });
        reporter.info(`split DNS: ${domains.join(", ")} → ${hostIp}:8053`);
        return { state: "applied", domains: result.info.domains, hostIp: result.info.hostIp };
    }

    if (result.reason === "already-matches") {
        // State pode estar ausente mesmo com drop-in match (ex: state zerado
        // manualmente). Re-escrevemos pra alinhar; idempotente.
        const state = readState();
        if (!state.splitDns) {
            const entry: SplitDnsState = {
                domains: Array.from(new Set(domains)).sort(),
                appliedAt: new Date().toISOString(),
                method: "systemd-resolved",
                dropInPath: DROP_IN_PATH,
                hostIp,
            };
            writeState({ ...state, splitDns: entry });
        }
        reporter.info("split DNS: already configured (drop-in matches)");
        return { state: "already-matches", domains: [...domains], hostIp };
    }

    // sudo-failed
    reporter.info(`split DNS: skipped (${result.detail})`);
    return { state: "skipped", reason: result.detail };
};

// Orquestra bring-up idempotente. Cada passo é seguro pra re-run.
export const runUp = async (
    reporter: UpReporter = NOOP_REPORTER,
    options: UpOptions = {},
): Promise<UpResult> => {
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

    // 5. state — garante que `~/.cubolab/state.json` existe (vazio se novo)
    // antes do compose subir; cf-shim monta via volume e espera arquivo
    // presente. Leitura/escrita do state em runtime é responsabilidade
    // exclusiva do cf-shim (via endpoints CRUD + /_admin/clear).
    ensureState();

    // 5b. Valida domains cedo (antes de subir containers) — erro imediato
    // em domain malformed, sem deixar stack up "quebrada" pelo meio.
    const normalizedDomains = (options.domains ?? []).map(validateDomain);

    // 5c. Cleanup de orphan drop-in de run anterior que tenha crashado entre
    // applySplitDns e writeState. Roda independente de `options.domains` —
    // user pode rodar `cubolab up` sem domains pra acabar de limpar o orphan.
    await cleanupOrphanDropIn(reporter);

    // 6. detect compose tool
    const composeTool = await detectCompose();
    reporter.info(`compose tool: ${composeTool}`);

    // 7. compose up (idempotente)
    reporter.step("starting containers");
    await runCompose(composeTool, ["up", "-d"]);

    // 8. aguarda pebble E cf-shim healthy em paralelo antes de retornar.
    //    - pebble necessário pro trust bundle download (step 9).
    //    - cf-shim necessário pra consumer (sandbox.up + POST imediato) —
    //      sem essa espera, há janela ECONNRESET entre `compose up -d` voltar
    //      e o bind do Hono estar pronto.
    //    Promise.all serializa só os bottlenecks naturais — se pebble
    //    demorar mais que cf-shim ou vice-versa, o slower domina.
    reporter.step("waiting for stack");
    await Promise.all([waitPebbleHealthy(hostIp, 30_000), waitCfShimHealthy(hostIp, 30_000)]);

    // 9. trust bundle (roots/0 + intermediates/0 → trust-bundle.pem). Idempotente.
    reporter.step("ensuring trust bundle");
    const trustBundleDownloaded = await ensureTrustBundle({ hostIp });

    // Hidratação do challtestsrv migrou pro cf-shim — ver
    // packages/cf-shim/src/lib/hydrate.ts. CLI só garante que o state.json
    // existe (passo 5); o container cf-shim lê, re-registra no challtestsrv
    // via /add-* no boot, e só então serve HTTP.

    // 10. Split DNS (último passo — requer cf-shim up; se falhar, containers
    // ficam up). Só aplica quando user passou domains. Janela sem race pra
    // writeState: stack subiu, consumer ainda não fez API calls.
    const splitDns: SplitDnsOutcome =
        normalizedDomains.length > 0
            ? await handleSplitDns(hostIp, normalizedDomains, reporter)
            : { state: "not-requested" };

    return { hostIp, composeTool, certGenerated, trustBundleDownloaded, splitDns };
};
