import { Command } from "commander";
import pc from "picocolors";
import { runLogs } from "../lib/logs.js";

export const logsCommand = (): Command =>
    new Command("logs")
        .description("tail agregado dos containers (follow por default)")
        .option("--no-follow", "imprime snapshot e sai (default é follow)")
        .action(async (opts: { follow: boolean }) => {
            try {
                await runLogs({ follow: opts.follow });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                process.stderr.write(`${pc.red("cubolab logs:")} ${msg}\n`);
                process.exit(1);
            }
        });
