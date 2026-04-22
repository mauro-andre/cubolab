import type { Zone } from "../schemas/cloudflare.js";

// Parse do `CUBOLAB_ZONES` no formato `<name>:<id>,<name>:<id>,...`.
// Retorna Map<zoneId, Zone>. Usa `indexOf(":")` — domain names não têm `:`.
//
// Em falha lança Error com mensagem apontando a entry problema pro entry
// point registrar FATAL + exit(1). Isso é aceitável porque a stack sobe num
// estado inválido — melhor crashar cedo que servir 500s misteriosos depois.
export const parseZones = (
    raw: string,
    createdAt = new Date().toISOString(),
): Map<string, Zone> => {
    const zones = new Map<string, Zone>();
    const nameIndex = new Map<string, number>();
    const idIndex = new Map<string, number>();

    if (raw.trim() === "") return zones;

    const entries = raw.split(",");
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]?.trim() ?? "";
        if (!entry) continue;

        const sep = entry.indexOf(":");
        if (sep === -1) {
            throw new Error(
                `CUBOLAB_ZONES malformed — entry at index ${i} "${entry}" has no ':' separator`,
            );
        }

        const name = entry.slice(0, sep).trim();
        const id = entry.slice(sep + 1).trim();

        if (!name) throw new Error(`CUBOLAB_ZONES entry at index ${i} has empty name`);
        if (!id) throw new Error(`CUBOLAB_ZONES entry at index ${i} has empty id`);
        if (!name.includes(".")) {
            throw new Error(
                `CUBOLAB_ZONES entry at index ${i}: "${name}" is not a valid domain (missing '.')`,
            );
        }

        const existingName = nameIndex.get(name);
        if (existingName !== undefined) {
            throw new Error(
                `CUBOLAB_ZONES duplicate name '${name}' at entries ${existingName} and ${i}`,
            );
        }
        const existingId = idIndex.get(id);
        if (existingId !== undefined) {
            throw new Error(`CUBOLAB_ZONES duplicate id '${id}' at entries ${existingId} and ${i}`);
        }

        nameIndex.set(name, i);
        idIndex.set(id, i);
        zones.set(id, {
            id,
            name,
            status: "active",
            paused: false,
            type: "full",
            name_servers: [],
            created_on: createdAt,
            modified_on: createdAt,
        });
    }

    return zones;
};
