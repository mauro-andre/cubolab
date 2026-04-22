import { Command } from "commander";
import pc from "picocolors";
import { renderHuman } from "../lib/render.js";
import { collectStatus } from "../lib/stack.js";
import { runUp, type UpReporter } from "../lib/up.js";

const ttyReporter: UpReporter = {
    info: (msg) => process.stdout.write(`  ${pc.dim(msg)}\n`),
    step: (label) => process.stdout.write(`  ${pc.dim(`${label}...`)}\n`),
};

export const upCommand = (): Command =>
    new Command("up")
        .description("sobe a stack (pebble + challtestsrv) de forma idempotente")
        .action(async () => {
            try {
                process.stdout.write(`${pc.bold("cubolab up")}\n\n`);
                const result = await runUp(ttyReporter);
                process.stdout.write(
                    `  ${pc.dim("cert:")}         ${result.certGenerated ? "generated" : "reused"}\n`,
                );
                process.stdout.write(
                    `  ${pc.dim("trust bundle:")} ${result.trustBundleDownloaded ? "downloaded" : "reused"}\n\n`,
                );
                const report = await collectStatus();
                process.stdout.write(renderHuman(report));
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                process.stderr.write(`${pc.red("cubolab up:")} ${msg}\n`);
                process.exit(1);
            }
        });
