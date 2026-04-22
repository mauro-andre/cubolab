import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generatePebbleServerCert } from "./certGen.js";
import { paths } from "./paths.js";

// Gera cert+key se ausentes. Idempotente — segundo `cubolab up` reusa.
// Retorna true se gerou novo, false se reusou.
export const ensurePebbleCert = async (hostIp: string): Promise<boolean> => {
    if (existsSync(paths.pebbleCert) && existsSync(paths.pebbleKey)) {
        return false;
    }
    mkdirSync(dirname(paths.pebbleCert), { recursive: true });
    const { certPem, keyPem } = await generatePebbleServerCert({ hostIp });
    writeFileSync(paths.pebbleCert, certPem);
    writeFileSync(paths.pebbleKey, keyPem, { mode: 0o600 });
    return true;
};
