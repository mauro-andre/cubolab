import { Command } from "commander";
import pc from "picocolors";
import { runDown } from "../lib/down.js";

export const downCommand = (): Command =>
    new Command("down")
        .description("derruba a stack; mantém ~/.cubolab/ intacto")
        .action(async () => {
            try {
                const result = await runDown();
                if (result.composeFileAbsent) {
                    process.stdout.write(
                        `${pc.dim("nothing to do")} — stack never came up (no ~/.cubolab/docker-compose.yml)\n`,
                    );
                    return;
                }
                if (!result.wasUp) {
                    process.stdout.write(`${pc.dim("nothing to do")} — stack already down\n`);
                    return;
                }
                process.stdout.write(`${pc.bold("sandbox down")}\n`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                process.stderr.write(`${pc.red("cubolab down:")} ${msg}\n`);
                process.exit(1);
            }
        });
