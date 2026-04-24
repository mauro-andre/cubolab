import { execa } from "execa";

// Resultado da detecção de suporte a split DNS via systemd-resolved no host.
// Quando `supported: false`, `reason` tem mensagem actionable (user entende
// o que falta e decide: upgrade, ajustar resolv.conf, ou pular feature).
export type ResolverSupport = { supported: true } | { supported: false; reason: string };

// Versões do systemd-resolved antes de 247 (nov/2020) ignoravam porta em
// `DNS=IP:PORT` silenciosamente, levando a split DNS configurado mas não
// funcional. Exigir ≥ 247 evita esse failure mode silencioso.
const MIN_SYSTEMD_VERSION = 247;

// `resolvectl --version` imprime algo como "systemd 258 (258.7-1.fc43)\n+PAM...".
// Extrai o inteiro major (primeiro número depois de "systemd ").
export const parseResolvectlVersion = (output: string): number | null => {
    const match = /^systemd\s+(\d+)/m.exec(output);
    if (!match?.[1]) return null;
    const n = Number.parseInt(match[1], 10);
    return Number.isNaN(n) ? null : n;
};

// Três gates sequenciais. Primeiro que falha → retorna reason específica.
// Ordem escolhida pra dar mensagem mais útil: service-ausente é mais comum
// que versão-velha que é mais comum que resolv.conf-overridden.
export const detectResolverSupport = async (): Promise<ResolverSupport> => {
    // 1. systemd-resolved service ativo?
    const active = await execa("systemctl", ["is-active", "systemd-resolved"], {
        reject: false,
        timeout: 5000,
    });
    if (active.exitCode !== 0) {
        return {
            supported: false,
            reason: "systemd-resolved service not active — split DNS requires it",
        };
    }

    // 2. Versão ≥ 247?
    const versionOut = await execa("resolvectl", ["--version"], {
        reject: false,
        timeout: 5000,
    });
    if (versionOut.exitCode !== 0) {
        return {
            supported: false,
            reason: "resolvectl CLI not available — split DNS requires systemd-resolved ≥ 247",
        };
    }
    const major = parseResolvectlVersion(versionOut.stdout);
    if (major === null) {
        return {
            supported: false,
            reason: "couldn't parse `resolvectl --version` output — split DNS skipped",
        };
    }
    if (major < MIN_SYSTEMD_VERSION) {
        return {
            supported: false,
            reason: `systemd ${major} is too old for DNS=IP:PORT syntax — split DNS requires ≥ ${MIN_SYSTEMD_VERSION}`,
        };
    }

    // 3. /etc/resolv.conf é gerido pelo systemd-resolved? (stub ou dynamic)
    // NetworkManager-com-dnsmasq clássico reescreve resolv.conf, o que faria
    // o drop-in ser ignorado pelo sistema — falha confusa. Validar cedo.
    const link = await execa("readlink", ["-f", "/etc/resolv.conf"], {
        reject: false,
        timeout: 5000,
    });
    if (link.exitCode !== 0) {
        return {
            supported: false,
            reason: "couldn't readlink /etc/resolv.conf",
        };
    }
    const target = link.stdout.trim();
    const acceptedTargets = [
        "/run/systemd/resolve/stub-resolv.conf",
        "/run/systemd/resolve/resolv.conf",
    ];
    if (!acceptedTargets.includes(target)) {
        return {
            supported: false,
            reason: `/etc/resolv.conf → ${target}, not managed by systemd-resolved — split DNS drop-in would be overridden by another resolver manager`,
        };
    }

    return { supported: true };
};
