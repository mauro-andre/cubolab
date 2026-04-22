#!/usr/bin/env node
import { Command } from "commander";
import { statusCommand } from "../commands/status.js";
import { upCommand } from "../commands/up.js";

const program = new Command();

const notImplemented = (name: string) => (): never => {
    console.error(`cubolab ${name}: not implemented yet`);
    process.exit(2);
};

program
    .name("cubolab")
    .description("sandbox local de ACME/DNS/Cloudflare pra testar PaaS self-hosted")
    .version("0.0.0");

program.addCommand(upCommand());

program
    .command("down")
    .description("derruba a stack; mantém state em ~/.cubolab/")
    .action(notImplemented("down"));

program
    .command("reset")
    .description("limpa state, mantém containers")
    .action(notImplemented("reset"));

program.addCommand(statusCommand());

program
    .command("logs")
    .description("tail agregado de todos os componentes")
    .action(notImplemented("logs"));

program.command("ca").description("imprime o path do trust bundle").action(notImplemented("ca"));

await program.parseAsync(process.argv);
