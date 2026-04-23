import { Command } from "commander";
import pc from "picocolors";
import { formatResolvedDistro } from "../lib/distroFormat.js";
import { runBootstrap } from "../lib/workerBootstrap.js";
import { runTeardown } from "../lib/workerTeardown.js";

type WorkerOpts = {
    identity?: string;
    port?: string;
};

const parsePort = (raw: string | undefined): number | undefined => {
    if (raw === undefined) return undefined;
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n) || n <= 0 || n > 65535) {
        throw new Error(`--port must be 1..65535, got '${raw}'`);
    }
    return n;
};

export const workerCommand = (): Command => {
    const worker = new Command("worker").description(
        "gerencia trust bundle em workers remotos via SSH",
    );

    worker
        .command("bootstrap <ssh-target>")
        .description(
            "instala trust bundle + CUBOLAB_TRUST no worker (<ssh-target> precisa aceitar SSH como user root/sudo — update-ca-* escreve em /etc)",
        )
        .option("-i, --identity <path>", "caminho da chave SSH (default: ssh-agent)")
        .option("-p, --port <number>", "porta SSH (default: 22)")
        .action(async (sshTarget: string, opts: WorkerOpts) => {
            try {
                process.stdout.write(`${pc.bold("cubolab worker bootstrap")} ${sshTarget}\n\n`);
                const result = await runBootstrap({
                    target: sshTarget,
                    identity: opts.identity,
                    port: parsePort(opts.port),
                });
                process.stdout.write(
                    `  ${pc.dim("distro:")}         ${formatResolvedDistro(result.distro)}\n`,
                );
                process.stdout.write(`  ${pc.dim("anchor:")}         ${result.anchorPath}\n`);
                process.stdout.write(
                    `  ${pc.dim("bundle:")}         ${
                        result.bundleUploaded
                            ? `uploaded (sha256: ${result.bundleSha256.slice(0, 12)}...)`
                            : "reused (hash match)"
                    }\n`,
                );
                process.stdout.write(
                    `  ${pc.dim("env var:")}        ${
                        result.envVarAdded ? "added (/etc/environment)" : "already present"
                    }\n\n`,
                );
                process.stdout.write(
                    `${pc.green("Worker ready.")} ${pc.dim("CUBOLAB_TRUST=/etc/cubolab/trust.pem")}\n`,
                );
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                process.stderr.write(`${pc.red("cubolab worker bootstrap:")} ${msg}\n`);
                process.exit(1);
            }
        });

    worker
        .command("teardown <ssh-target>")
        .description(
            "reverte o bootstrap: remove trust bundle + CUBOLAB_TRUST do worker. Idempotente.",
        )
        .option("-i, --identity <path>", "caminho da chave SSH (default: ssh-agent)")
        .option("-p, --port <number>", "porta SSH (default: 22)")
        .action(async (sshTarget: string, opts: WorkerOpts) => {
            try {
                process.stdout.write(`${pc.bold("cubolab worker teardown")} ${sshTarget}\n\n`);
                const result = await runTeardown({
                    target: sshTarget,
                    identity: opts.identity,
                    port: parsePort(opts.port),
                });
                process.stdout.write(
                    `  ${pc.dim("distro:")}     ${formatResolvedDistro(result.distro)}\n`,
                );
                process.stdout.write(
                    `  ${pc.dim("anchor:")}     ${
                        result.anchorRemoved ? "removed" : pc.yellow("not found (nothing to do)")
                    }\n`,
                );
                process.stdout.write(
                    `  ${pc.dim("env var:")}    ${
                        result.envVarRemoved ? "removed" : pc.yellow("not found")
                    }\n\n`,
                );
                process.stdout.write(`${pc.green("Worker restored.")}\n`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                process.stderr.write(`${pc.red("cubolab worker teardown:")} ${msg}\n`);
                process.exit(1);
            }
        });

    return worker;
};
