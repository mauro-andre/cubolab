import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { paths } from "@cubolab/core";
import { type Distro, type DistroFamily, detectDistro, familyFor } from "./osDetect.js";
import { type SshOptions, scpUpload, sshExec } from "./ssh.js";

const ANCHOR_PATH: Record<DistroFamily, string> = {
    "fedora-family": "/etc/pki/ca-trust/source/anchors/cubolab.pem",
    "debian-family": "/usr/local/share/ca-certificates/cubolab.crt",
};

const UPDATE_CMD: Record<DistroFamily, string> = {
    "fedora-family": "update-ca-trust",
    "debian-family": "update-ca-certificates",
};

export type BootstrapOptions = {
    target: string;
    identity?: string | undefined;
    port?: number | undefined;
};

export type BootstrapResult = {
    distro: Distro;
    anchorPath: string;
    bundleUploaded: boolean; // true = new upload, false = reused (hash match)
    envVarAdded: boolean; // true = appended to /etc/environment, false = already present
    bundleSha256: string;
};

const sha256File = (path: string): string =>
    createHash("sha256").update(readFileSync(path)).digest("hex");

export const runBootstrap = async (opts: BootstrapOptions): Promise<BootstrapResult> => {
    const sshOpts: SshOptions = {
        target: opts.target,
        identity: opts.identity,
        port: opts.port,
    };

    const distro = await detectDistro(sshOpts);
    const family = familyFor(distro);
    const anchorPath = ANCHOR_PATH[family];
    const updateCmd = UPDATE_CMD[family];

    const localBundle = paths.trustBundle;
    const localHash = sha256File(localBundle);

    // Compare SHA256 do remote com o local; skip upload se idênticos.
    const remoteHashRaw = await sshExec(
        sshOpts,
        `sha256sum "${anchorPath}" 2>/dev/null | cut -d" " -f1 || echo ABSENT`,
    );
    const remoteHash = remoteHashRaw.trim();
    const bundleUploaded = remoteHash !== localHash;

    if (bundleUploaded) {
        // Staging em /tmp pra não assumir permissão de write no dir final durante scp.
        // Depois mv + update-ca-* tudo num ssh call.
        await scpUpload(sshOpts, localBundle, "/tmp/cubolab-trust.pem");
        await sshExec(
            sshOpts,
            `mkdir -p "$(dirname "${anchorPath}")" && mv /tmp/cubolab-trust.pem "${anchorPath}" && ${updateCmd}`,
        );
    }

    // Contrato público: CUBOLAB_TRUST=/etc/cubolab/trust.pem aponta pro anchor.
    // Symlink é idempotente (ln -sf overrides se existir, cria se não).
    await sshExec(
        sshOpts,
        `mkdir -p /etc/cubolab && ln -sf "${anchorPath}" /etc/cubolab/trust.pem`,
    );

    // /etc/environment idempotente via grep antes do append.
    const envLine = "CUBOLAB_TRUST=/etc/cubolab/trust.pem";
    const envCheck = await sshExec(
        sshOpts,
        `grep -q "^${envLine}" /etc/environment && echo PRESENT || echo ABSENT`,
    );
    const envVarAdded = envCheck.trim() === "ABSENT";
    if (envVarAdded) {
        await sshExec(sshOpts, `echo "${envLine}" >> /etc/environment`);
    }

    return {
        distro,
        anchorPath,
        bundleUploaded,
        envVarAdded,
        bundleSha256: localHash,
    };
};
