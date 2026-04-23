import { type SshOptions, sshExec } from "./ssh.js";

export type DistroFamily = "fedora-family" | "debian-family";

// Map de IDs conhecidos pra família correspondente. Não é exaustivo —
// distros novas/derivadas caem no fallback de ID_LIKE (ver resolveFamily).
const DIRECT_MAP: Record<string, DistroFamily> = {
    fedora: "fedora-family",
    rhel: "fedora-family",
    centos: "fedora-family",
    debian: "debian-family",
    ubuntu: "debian-family",
    alpine: "debian-family",
};

// Shape paste-direto do /etc/os-release (spec freedesktop). `idLike` é
// array ordenado (mais-específico-primeiro) — Pop!_OS declara
// `ID_LIKE="ubuntu debian"` querendo que tools resolvam via ubuntu antes
// de cair em debian.
export type ParsedOsRelease = {
    id: string;
    idLike: readonly string[];
};

// Resolução final: id tal qual reportado (útil pra output transparente)
// + family (usada pro dispatcher de comandos) + detalhe de como resolveu
// (direct vs ID_LIKE fallback).
export type ResolvedDistro = {
    id: string;
    family: DistroFamily;
    matchedVia: "direct" | "id-like";
    matchedAncestor?: string; // o ID do ID_LIKE que bateu (só em matchedVia === "id-like")
};

const parseValue = (line: string, key: string): string | undefined => {
    if (!line.startsWith(`${key}=`)) return undefined;
    const raw = line.slice(key.length + 1).trim();
    return raw.replace(/^"(.*)"$/, "$1");
};

// Parse /etc/os-release. Extrai `ID=` (obrigatório) + `ID_LIKE=` (opcional,
// space-separated). Ambos em lowercase. Lança se ID= ausente.
export const parseOsRelease = (content: string): ParsedOsRelease => {
    const lines = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    let id: string | undefined;
    let idLikeRaw: string | undefined;
    for (const line of lines) {
        id ??= parseValue(line, "ID");
        idLikeRaw ??= parseValue(line, "ID_LIKE");
    }

    if (!id) {
        throw new Error(
            "couldn't find ID= in /etc/os-release — target may not follow os-release standard",
        );
    }

    const idLike = idLikeRaw
        ? idLikeRaw
              .split(/\s+/)
              .map((s) => s.toLowerCase())
              .filter((s) => s.length > 0)
        : [];

    return { id: id.toLowerCase(), idLike };
};

// Dispatch de família: direct match no `id` primeiro, depois itera `ID_LIKE`
// na ordem (mais-específico-primeiro). Lança com mensagem clara se nenhum
// ID direto nem ancestor do ID_LIKE for conhecido.
export const resolveFamily = (parsed: ParsedOsRelease): ResolvedDistro => {
    const direct = DIRECT_MAP[parsed.id];
    if (direct) {
        return { id: parsed.id, family: direct, matchedVia: "direct" };
    }

    for (const ancestor of parsed.idLike) {
        const family = DIRECT_MAP[ancestor];
        if (family) {
            return {
                id: parsed.id,
                family,
                matchedVia: "id-like",
                matchedAncestor: ancestor,
            };
        }
    }

    const known = Object.keys(DIRECT_MAP).join("/");
    throw new Error(
        `distro '${parsed.id}' not supported (ID_LIKE=${parsed.idLike.join(" ") || "none"}) — cubolab worker bootstrap supports ${known} directly or via ID_LIKE ancestor. PR welcome (see docs/worker-bootstrap.md)`,
    );
};

// Lê /etc/os-release no target via SSH e resolve a família. Mensagem de
// erro útil quando o arquivo não existe (Alpine stripped, outros minimal).
export const detectDistro = async (opts: SshOptions): Promise<ResolvedDistro> => {
    let content: string;
    try {
        content = await sshExec(opts, "cat /etc/os-release");
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
            `couldn't read /etc/os-release on ${opts.target} — target may be minimal image without os-release file. Original: ${msg}`,
        );
    }
    return resolveFamily(parseOsRelease(content));
};
