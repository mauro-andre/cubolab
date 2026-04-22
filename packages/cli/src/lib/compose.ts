import { execa } from "execa";
import type { ComposeTool } from "../schemas/status.js";

// Ordem importa: podman-compose primeiro (Fedora-first). Em Fedora,
// `docker compose` também pode existir como emulação via podman, mas a forma
// explícita (`podman-compose`) é preferida pra deixar o contrato claro.
const CANDIDATES: readonly ComposeTool[] = ["podman-compose", "docker compose", "docker-compose"];

export const detectCompose = async (): Promise<ComposeTool> => {
    for (const tool of CANDIDATES) {
        const parts = tool.split(" ");
        const cmd = parts[0];
        if (!cmd) continue;
        const rest = parts.slice(1);
        const result = await execa(cmd, [...rest, "--version"], {
            stdio: "ignore",
            reject: false,
            timeout: 5000,
        });
        if (result.exitCode === 0) return tool;
    }
    throw new Error("no compose tool found — install podman-compose or Docker Compose v2");
};

export const engineFor = (tool: ComposeTool): "podman" | "docker" =>
    tool === "podman-compose" ? "podman" : "docker";

// Lista os containers rodando do engine correspondente ao compose tool
// detectado. Retorna set de nomes. Usado pelo status pra determinar `running`
// por component via lookup por nome de container (ver CONTAINER constants em stack.ts).
export const listRunningContainers = async (tool: ComposeTool): Promise<Set<string>> => {
    const engine = engineFor(tool);
    const result = await execa(engine, ["ps", "--format", "{{.Names}}"], {
        reject: false,
        timeout: 5000,
    });
    if (result.exitCode !== 0) return new Set();
    const lines = String(result.stdout)
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    return new Set(lines);
};
