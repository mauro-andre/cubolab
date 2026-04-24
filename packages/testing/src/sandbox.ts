import type { DnsRecord } from "@cubolab/core";
import { paths } from "@cubolab/core";
import { runDown, runReset, runUp } from "cubolab";
import { listCloudflareRecords } from "./inspect/cloudflareRecords.js";
import { dnsLookup } from "./inspect/dns.js";
import { type IssuedCert, listIssuedCerts } from "./inspect/issuedCerts.js";

export type SandboxUpOptions = {
    zones?: Array<{ name: string; id: string }>;
    // Domains pra configurar split DNS via systemd-resolved (Linux). Skip
    // graceful se systemd-resolved ausente, versão < 247, ou sudo não
    // disponível (test setup sem TTY). Idempotente: segunda chamada com
    // mesmos domains bate no drop-in match e não tenta sudo de novo.
    domains?: readonly string[];
    hostIp?: string;
    timeoutMs?: number;
};

export type Sandbox = {
    up(options?: SandboxUpOptions): Promise<void>;
    down(): Promise<void>;
    reset(): Promise<void>;

    readonly cloudflareApiUrl: string;
    readonly acmeDirectoryUrl: string;
    readonly trustBundlePath: string;

    inspect: {
        dns(hostname: string): Promise<string[]>;
        cloudflareRecords(zoneId: string): Promise<DnsRecord[]>;
        issuedCerts(): Promise<IssuedCert[]>;
    };
};

export type { IssuedCert };

const detectHostIp = (): string => process.env.CUBOLAB_HOST_IP ?? "127.0.0.1";

export const sandbox: Sandbox = {
    async up(options = {}) {
        // TODO(concurrency): mutação de process.env é OK enquanto testes
        // rodam serializados (vitest fileParallelism=false). Se aparecer
        // caso de multi-suite parallel sandbox, considerar isolation via
        // execa subprocess ou registro de instâncias por PID.
        if (options.zones) {
            process.env.CUBOLAB_ZONES = options.zones.map((z) => `${z.name}:${z.id}`).join(",");
        }
        if (options.hostIp) {
            process.env.CUBOLAB_HOST_IP = options.hostIp;
        }
        await runUp(undefined, { domains: options.domains ?? [] });
    },

    async down() {
        await runDown();
    },

    async reset() {
        await runReset();
    },

    get cloudflareApiUrl() {
        return `http://${detectHostIp()}:4500/client/v4`;
    },

    get acmeDirectoryUrl() {
        return `https://${detectHostIp()}:14000/dir`;
    },

    get trustBundlePath() {
        return paths.trustBundle;
    },

    inspect: {
        dns: dnsLookup,
        cloudflareRecords: listCloudflareRecords,
        issuedCerts: listIssuedCerts,
    },
};
