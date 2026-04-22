import { homedir } from "node:os";
import { join } from "node:path";

// Resolvido lazy a cada acesso pra respeitar override dinâmico via
// `CUBOLAB_HOME` (usado principalmente em testes de integração).
const base = (): string => process.env.CUBOLAB_HOME ?? join(homedir(), ".cubolab");

export const paths = {
    get base(): string {
        return base();
    },
    get pebbleCert(): string {
        return join(base(), "pebble-cert.pem");
    },
    get pebbleKey(): string {
        return join(base(), "pebble-key.pem");
    },
    get pebbleRoot(): string {
        return join(base(), "pebble-root.pem");
    },
    get pebbleIntermediate(): string {
        return join(base(), "pebble-intermediate.pem");
    },
    get trustBundle(): string {
        return join(base(), "trust-bundle.pem");
    },
    get state(): string {
        return join(base(), "state.json");
    },
    get composeFile(): string {
        return join(base(), "docker-compose.yml");
    },
    get pebbleConfig(): string {
        return join(base(), "pebble-config.json");
    },
};
