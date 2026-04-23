import { type Distro, type DistroFamily, detectDistro, familyFor } from "./osDetect.js";
import { type SshOptions, sshExec } from "./ssh.js";

const ANCHOR_PATH: Record<DistroFamily, string> = {
    "fedora-family": "/etc/pki/ca-trust/source/anchors/cubolab.pem",
    "debian-family": "/usr/local/share/ca-certificates/cubolab.crt",
};

const UPDATE_CMD: Record<DistroFamily, string> = {
    "fedora-family": "update-ca-trust",
    "debian-family": "update-ca-certificates",
};

export type TeardownOptions = {
    target: string;
    identity?: string | undefined;
    port?: number | undefined;
};

export type TeardownResult = {
    distro: Distro;
    anchorRemoved: boolean;
    envVarRemoved: boolean;
};

// Reverte o bootstrap. Idempotente: rodar contra target nunca-bootstrapped
// retorna sem erro (rm -f ignora ausência; grep antes evita sed em string
// inexistente; rmdir `/etc/cubolab` silenciado). Também idempotente em
// re-runs — nada acontece na segunda call.
export const runTeardown = async (opts: TeardownOptions): Promise<TeardownResult> => {
    const sshOpts: SshOptions = {
        target: opts.target,
        identity: opts.identity,
        port: opts.port,
    };

    const distro = await detectDistro(sshOpts);
    const family = familyFor(distro);
    const anchorPath = ANCHOR_PATH[family];
    const updateCmd = UPDATE_CMD[family];

    const anchorExists =
        (await sshExec(sshOpts, `test -f "${anchorPath}" && echo YES || echo NO`)).trim() === "YES";

    // Remove anchor + /etc/cubolab/* + run update. `rmdir` com `|| true` em
    // vez de rm -rf — paranoia: se alguém puser arquivo extra no /etc/cubolab/,
    // preserva.
    await sshExec(
        sshOpts,
        `rm -f "${anchorPath}" && ${updateCmd} && rm -f /etc/cubolab/trust.pem && (rmdir /etc/cubolab 2>/dev/null || true)`,
    );

    const envHadIt =
        (
            await sshExec(
                sshOpts,
                `grep -q "^CUBOLAB_TRUST=" /etc/environment && echo YES || echo NO`,
            )
        ).trim() === "YES";
    if (envHadIt) {
        await sshExec(sshOpts, `sed -i '/^CUBOLAB_TRUST=/d' /etc/environment`);
    }

    return {
        distro,
        anchorRemoved: anchorExists,
        envVarRemoved: envHadIt,
    };
};
