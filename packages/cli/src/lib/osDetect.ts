import { type SshOptions, sshExec } from "./ssh.js";

export type Distro = "fedora" | "rhel" | "centos" | "debian" | "ubuntu" | "alpine";
export type DistroFamily = "fedora-family" | "debian-family";

const SUPPORTED: readonly Distro[] = ["fedora", "rhel", "centos", "debian", "ubuntu", "alpine"];

export const familyFor = (distro: Distro): DistroFamily =>
    distro === "fedora" || distro === "rhel" || distro === "centos"
        ? "fedora-family"
        : "debian-family";

// Parse `/etc/os-release` content (formato `KEY=value` ou `KEY="value"`,
// uma por linha). Extrai o `ID=`. Retorna distro conhecida ou lança
// mensagem clara de erro.
export const parseOsRelease = (content: string): Distro => {
    const idLine = content
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.startsWith("ID="));

    if (!idLine) {
        throw new Error(
            "couldn't find ID= in /etc/os-release — target may not follow os-release standard",
        );
    }

    const rawValue = idLine.slice("ID=".length).trim();
    const id = rawValue.replace(/^"(.*)"$/, "$1").toLowerCase();

    if ((SUPPORTED as readonly string[]).includes(id)) {
        return id as Distro;
    }

    throw new Error(
        `distro '${id}' not supported — cubolab worker bootstrap supports Fedora/RHEL/CentOS/Debian/Ubuntu/Alpine. PR welcome (see docs/worker-bootstrap.md)`,
    );
};

// Lê /etc/os-release no target via SSH e retorna a distro. Mensagem de erro
// útil quando o arquivo não existe (Alpine stripped, outros minimal images).
export const detectDistro = async (opts: SshOptions): Promise<Distro> => {
    let content: string;
    try {
        content = await sshExec(opts, "cat /etc/os-release");
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
            `couldn't read /etc/os-release on ${opts.target} — target may be minimal image without os-release file. Original: ${msg}`,
        );
    }
    return parseOsRelease(content);
};
