import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import https from "node:https";
import { dirname } from "node:path";
import { paths } from "./paths.js";

// Baixa um PEM do endpoint management do Pebble (cert self-signed, accept-all).
const fetchPem = (url: string, timeoutMs = 10_000): Promise<string> =>
    new Promise((resolve, reject) => {
        const req = https.request(
            url,
            { method: "GET", rejectUnauthorized: false, timeout: timeoutMs },
            (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`HTTP ${res.statusCode} from ${url}`));
                    return;
                }
                const chunks: Buffer[] = [];
                res.on("data", (c: Buffer) => chunks.push(c));
                res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
                res.on("error", reject);
            },
        );
        req.on("timeout", () => req.destroy(new Error(`timeout fetching ${url}`)));
        req.on("error", reject);
        req.end();
    });

export type EnsureTrustBundleParams = {
    hostIp: string;
    force?: boolean;
};

// Baixa roots/0 + intermediates/0 do Pebble management API, persiste cada um
// separado e grava o bundle concatenado em `trust-bundle.pem`. Idempotente.
// Retorna true se baixou novo, false se reusou.
//
// NB: este bundle é pra validar certs **emitidos** pelo Pebble pra apps
// (ex: Node.js com NODE_EXTRA_CA_CERTS validando cert de meu-app.podcubo.dev
// servido por Caddy). NÃO serve pra validar a conexão TLS com o ACME
// directory em si — pra isso o cliente precisa confiar no `pebble-cert.pem`
// (server cert self-signed). Ver PRD §8 quirks #2 e #4.
export const ensureTrustBundle = async ({
    hostIp,
    force = false,
}: EnsureTrustBundleParams): Promise<boolean> => {
    const allExist =
        existsSync(paths.trustBundle) &&
        existsSync(paths.pebbleRoot) &&
        existsSync(paths.pebbleIntermediate);
    if (!force && allExist) return false;

    mkdirSync(dirname(paths.trustBundle), { recursive: true });

    const rootPem = await fetchPem(`https://${hostIp}:15000/roots/0`);
    const intermediatePem = await fetchPem(`https://${hostIp}:15000/intermediates/0`);

    writeFileSync(paths.pebbleRoot, rootPem);
    writeFileSync(paths.pebbleIntermediate, intermediatePem);

    const rootTrailing = rootPem.endsWith("\n") ? rootPem : `${rootPem}\n`;
    writeFileSync(paths.trustBundle, `${rootTrailing}${intermediatePem}`);

    return true;
};
