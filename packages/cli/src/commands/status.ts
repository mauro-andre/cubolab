import { Command } from "commander";
import { renderHuman, renderJson } from "../lib/render.js";
import { collectStatus } from "../lib/stack.js";

type StatusOpts = { json?: boolean; human?: boolean };

// Convention Unix: TTY → human; pipe/redirect → JSON. Flags forçam modo
// específico (útil em CI pra human colorido ou em script pra JSON mesmo em TTY).
const pickMode = (opts: StatusOpts, isTty: boolean): "json" | "human" => {
    if (opts.json) return "json";
    if (opts.human) return "human";
    return isTty ? "human" : "json";
};

export const statusCommand = (): Command =>
    new Command("status")
        .description("mostra endpoints ativos e estado da stack")
        .option("--json", "força output em JSON (default em pipe/redirect)")
        .option("--human", "força output humano (default em TTY)")
        .action(async (opts: StatusOpts) => {
            try {
                const report = await collectStatus();
                const mode = pickMode(opts, Boolean(process.stdout.isTTY));
                const out = mode === "json" ? renderJson(report) : renderHuman(report);
                process.stdout.write(out);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                process.stderr.write(`cubolab status: ${msg}\n`);
                process.exit(1);
            }
        });
