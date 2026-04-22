import { Command } from "commander";
import { runCa } from "../lib/ca.js";

export const caCommand = (): Command =>
    new Command("ca")
        .description("imprime o path do trust bundle (path + newline; safe pra `$(cubolab ca)`)")
        .action(() => {
            const result = runCa();
            if (result.warning) {
                process.stderr.write(`cubolab ca: ${result.warning}\n`);
            }
            process.stdout.write(`${result.path}\n`);
        });
