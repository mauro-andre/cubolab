import http from "node:http";
import https from "node:https";

export type ProbeResult = {
    healthy: boolean;
    statusCode?: number;
    error?: string;
};

// HTTP GET probe com timeout. Aceita cert self-signed (Pebble). Considera
// healthy qualquer resposta com status 2xx/3xx/4xx — endpoint responde HTTP,
// detalhe do status code fica em `statusCode`. 5xx ou erro de rede = unhealthy.
export const probeHttp = (url: string, timeoutMs = 3000): Promise<ProbeResult> => {
    const u = new URL(url);
    return new Promise((resolve) => {
        const onResponse = (res: http.IncomingMessage): void => {
            res.resume();
            const status = res.statusCode ?? 0;
            if (status >= 200 && status < 500) {
                resolve({ healthy: true, statusCode: status });
            } else {
                resolve({
                    healthy: false,
                    statusCode: status,
                    error: `HTTP ${status} from ${u.host}`,
                });
            }
        };
        const onError = (err: Error): void => {
            const msg = err.message || String(err);
            resolve({ healthy: false, error: describeError(msg, u) });
        };

        const req =
            u.protocol === "https:"
                ? https.request(
                      url,
                      { method: "GET", rejectUnauthorized: false, timeout: timeoutMs },
                      onResponse,
                  )
                : http.request(url, { method: "GET", timeout: timeoutMs }, onResponse);
        req.on("timeout", () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
        req.on("error", onError);
        req.end();
    });
};

const describeError = (msg: string, u: URL): string => {
    if (/ECONNREFUSED/i.test(msg)) return `connection refused on ${u.host}`;
    if (/timeout/i.test(msg)) return `timeout on ${u.host}`;
    if (/ENOTFOUND/i.test(msg)) return `host not found: ${u.hostname}`;
    if (/EHOSTUNREACH/i.test(msg)) return `host unreachable: ${u.hostname}`;
    return msg;
};
