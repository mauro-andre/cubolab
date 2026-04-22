import { existsSync } from "node:fs";
import { paths } from "./paths.js";

export type CaResult = {
    path: string;
    // Preenchido quando o trust bundle ainda não foi gerado. O command
    // imprime o `path` em stdout mesmo assim (é previsível — pode ser
    // colocado em `.envrc` antes do `up`) e joga o `warning` em stderr.
    warning?: string;
};

export const runCa = (): CaResult => {
    if (!existsSync(paths.trustBundle)) {
        return {
            path: paths.trustBundle,
            warning: "trust bundle not yet generated — run `cubolab up` first",
        };
    }
    return { path: paths.trustBundle };
};
