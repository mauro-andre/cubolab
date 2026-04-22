import { Command } from "commander";
import pc from "picocolors";
import { runReset } from "../lib/reset.js";

export const resetCommand = (): Command =>
    new Command("reset")
        .description("limpa state (DNS records); mantém containers, cert e trust bundle")
        .action(async () => {
            try {
                const result = await runReset();
                process.stdout.write(`${pc.bold("cubolab reset")}\n\n`);
                const recLabel = result.recordsCleared === 1 ? "record" : "records";
                process.stdout.write(
                    `  ${pc.dim("state:")}         cleared (${result.recordsCleared} ${recLabel})\n`,
                );
                if (result.challtestsrvReachable) {
                    process.stdout.write(`  ${pc.dim("challtestsrv:")}  cleared\n`);
                } else {
                    process.stdout.write(
                        `  ${pc.dim("challtestsrv:")}  ${pc.yellow("skipped (not running)")}\n`,
                    );
                }
                process.stdout.write(
                    `\n  ${pc.dim("unchanged:")} containers, cert, trust bundle\n`,
                );
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                process.stderr.write(`${pc.red("cubolab reset:")} ${msg}\n`);
                process.exit(1);
            }
        });
