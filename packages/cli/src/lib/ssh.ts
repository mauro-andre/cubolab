import { execa } from "execa";

export type SshOptions = {
    target: string;
    identity?: string | undefined;
    port?: number | undefined;
};

// Args comuns entre ssh e scp. Em SSH, port é `-p`; em scp é `-P` (uppercase
// histórico do OpenSSH). Handled nos builders específicos.
const commonOpts = (opts: SshOptions): string[] => {
    const args: string[] = [];
    if (opts.identity) args.push("-i", opts.identity);
    args.push("-o", "StrictHostKeyChecking=no", "-o", "LogLevel=ERROR");
    return args;
};

export const buildSshArgs = (opts: SshOptions, command: string): string[] => {
    const args = commonOpts(opts);
    if (opts.port !== undefined) args.push("-p", String(opts.port));
    args.push(opts.target, command);
    return args;
};

export const buildScpArgs = (opts: SshOptions, localPath: string, remotePath: string): string[] => {
    const args = commonOpts(opts);
    if (opts.port !== undefined) args.push("-P", String(opts.port));
    args.push(localPath, `${opts.target}:${remotePath}`);
    return args;
};

export const sshExec = async (opts: SshOptions, command: string): Promise<string> => {
    const r = await execa("ssh", buildSshArgs(opts, command), {
        reject: false,
        timeout: 30_000,
    });
    if (r.exitCode !== 0) {
        throw new Error(
            `ssh to ${opts.target} failed (exit ${r.exitCode}): ${String(r.stderr) || String(r.stdout)}`,
        );
    }
    return String(r.stdout);
};

export const scpUpload = async (
    opts: SshOptions,
    localPath: string,
    remotePath: string,
): Promise<void> => {
    const r = await execa("scp", buildScpArgs(opts, localPath, remotePath), {
        reject: false,
        timeout: 60_000,
    });
    if (r.exitCode !== 0) {
        throw new Error(
            `scp ${localPath} → ${opts.target}:${remotePath} failed (exit ${r.exitCode}): ${String(r.stderr)}`,
        );
    }
};
