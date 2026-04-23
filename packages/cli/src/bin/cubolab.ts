#!/usr/bin/env node
import { Command } from "commander";
import { caCommand } from "../commands/ca.js";
import { downCommand } from "../commands/down.js";
import { logsCommand } from "../commands/logs.js";
import { resetCommand } from "../commands/reset.js";
import { statusCommand } from "../commands/status.js";
import { upCommand } from "../commands/up.js";
import { workerCommand } from "../commands/worker.js";

const program = new Command();

program
    .name("cubolab")
    .description("sandbox local de ACME/DNS/Cloudflare pra testar PaaS self-hosted")
    .version("0.0.0");

program.addCommand(upCommand());
program.addCommand(downCommand());
program.addCommand(resetCommand());
program.addCommand(statusCommand());
program.addCommand(logsCommand());
program.addCommand(caCommand());
program.addCommand(workerCommand());

await program.parseAsync(process.argv);
