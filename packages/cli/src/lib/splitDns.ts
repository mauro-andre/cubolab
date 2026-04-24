import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

// Path único e fixo — não configurável. Único drop-in do cubolab em qualquer
// host é este arquivo; múltiplas invocações substituem o conteúdo.
export const DROP_IN_PATH = "/etc/systemd/resolved.conf.d/cubolab.conf";

export type SplitDnsConfig = {
    hostIp: string;
    domains: readonly string[];
};

export type AppliedSplitDns = {
    dropInPath: string;
    appliedAt: string; // ISO 8601
    hostIp: string;
    domains: string[];
};

// Determinístico: mesmo input → mesmo output byte-a-byte. Fundamental pra
// idempotência forte (string equality sobre conteúdo atual vs desejado).
// Domains sempre ordenados + dedup pra normalizar ordem do user.
export const generateDropIn = (config: SplitDnsConfig): string => {
    const sortedDomains = Array.from(new Set(config.domains)).sort();
    const domainsLine = sortedDomains.map((d) => `~${d}`).join(" ");
    return [
        "# Managed by cubolab — do not edit.",
        "# Remove via `cubolab down` or delete this file + `systemctl restart systemd-resolved`.",
        "",
        "[Resolve]",
        `DNS=${config.hostIp}:8053`,
        `Domains=${domainsLine}`,
        "",
    ].join("\n");
};

// Lê o drop-in atual (sem sudo — arquivos /etc são readable por default).
// Retorna null se ausente.
export const readExistingDropIn = async (): Promise<string | null> => {
    const r = await execa("cat", [DROP_IN_PATH], { reject: false, timeout: 5000 });
    return r.exitCode === 0 ? r.stdout : null;
};

export type ApplyResult =
    | { applied: true; info: AppliedSplitDns }
    | { applied: false; reason: "already-matches" }
    | { applied: false; reason: "sudo-failed"; detail: string };

// Idempotência forte: se conteúdo atual do drop-in já bate com o desejado,
// retorna sem sudo call. Crítico em contexto de test setup (sem TTY) onde
// sudo prompt travaria indefinidamente — primeira `cubolab up podcubo.dev`
// do user paga o sudo, chamadas subsequentes via `sandbox.up({domains})` em
// suite de tests batem no skip early.
export const applySplitDns = async (config: SplitDnsConfig): Promise<ApplyResult> => {
    const desired = generateDropIn(config);
    const existing = await readExistingDropIn();
    if (existing === desired) {
        return { applied: false, reason: "already-matches" };
    }

    // Sudo exige TTY pra prompt de senha. Se ausente (test setup, CI sem
    // sudo NOPASSWD), retorna falha explícita em vez de travar esperando
    // input que não vai chegar. User roda `cubolab up <domains>` uma vez do
    // terminal, autoriza sudo, e daí em diante state match basta.
    if (!process.stdin.isTTY) {
        return {
            applied: false,
            reason: "sudo-failed",
            detail: "no TTY for sudo prompt — run `cubolab up <domains...>` from interactive terminal first to authorize",
        };
    }

    // Stage em /tmp (user-writable), depois install via sudo pro path final.
    // Evita `sudo tee` pipe shell que mistura stdio.
    const staging = join(tmpdir(), `cubolab-dropin-${randomUUID()}.conf`);
    writeFileSync(staging, desired);

    try {
        await execa("sudo", ["mkdir", "-p", "/etc/systemd/resolved.conf.d"], {
            stdio: "inherit",
            timeout: 30_000,
        });
        await execa("sudo", ["install", "-m", "0644", staging, DROP_IN_PATH], {
            stdio: "inherit",
            timeout: 30_000,
        });
        await execa("sudo", ["systemctl", "restart", "systemd-resolved"], {
            stdio: "inherit",
            timeout: 30_000,
        });
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return { applied: false, reason: "sudo-failed", detail };
    }

    return {
        applied: true,
        info: {
            dropInPath: DROP_IN_PATH,
            appliedAt: new Date().toISOString(),
            hostIp: config.hostIp,
            domains: Array.from(new Set(config.domains)).sort(),
        },
    };
};

export type RemoveResult =
    | { removed: true }
    | { removed: false; reason: "already-absent" }
    | { removed: false; reason: "sudo-failed"; detail: string };

// Idempotente: se drop-in já não existe, skip sem sudo. Cobre cenário de
// `cubolab down` pós-crash (orphan) onde cleanup pode estar incompleto.
export const removeSplitDns = async (dropInPath: string): Promise<RemoveResult> => {
    const exists = await execa("test", ["-f", dropInPath], { reject: false, timeout: 5000 });
    if (exists.exitCode !== 0) {
        return { removed: false, reason: "already-absent" };
    }

    if (!process.stdin.isTTY) {
        return {
            removed: false,
            reason: "sudo-failed",
            detail: "no TTY for sudo prompt — run `cubolab down` from interactive terminal",
        };
    }

    try {
        await execa("sudo", ["rm", "-f", dropInPath], { stdio: "inherit", timeout: 30_000 });
        await execa("sudo", ["systemctl", "restart", "systemd-resolved"], {
            stdio: "inherit",
            timeout: 30_000,
        });
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return { removed: false, reason: "sudo-failed", detail };
    }

    return { removed: true };
};

// Existe um drop-in no disk? Usado em `cubolab up` pra detectar orphan
// (drop-in presente sem entry no state.json = crash anterior).
export const detectOrphanDropIn = async (): Promise<boolean> => {
    const r = await execa("test", ["-f", DROP_IN_PATH], { reject: false, timeout: 5000 });
    return r.exitCode === 0;
};

// Domain FQDN validation. Rejeita entrada como "foo" (sem ponto), "foo.."
// (double dot), uppercase (domain names são case-insensitive mas normalizamos
// pra lower). Regex conservador — DNS name RFC 1035-ish.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

export const validateDomain = (raw: string): string => {
    const normalized = raw.trim().toLowerCase();
    if (!DOMAIN_RE.test(normalized)) {
        throw new Error(
            `"${raw}" is not a valid FQDN (expected e.g. "podcubo.dev", "foo.example.com")`,
        );
    }
    return normalized;
};
