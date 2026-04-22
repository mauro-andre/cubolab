import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyState, stateSchema } from "../../src/schemas/state.js";

// Re-importa state.ts de forma fresca pra cada teste — garante que `paths`
// veja o valor atualizado de `CUBOLAB_HOME`. Paths usa getters, então
// import único seria suficiente, mas isolamos o diretório por teste pra não
// cruzar state entre eles.
let tempHome: string;

beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "cubolab-state-test-"));
    process.env.CUBOLAB_HOME = tempHome;
});

afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    delete process.env.CUBOLAB_HOME;
});

describe("state schema", () => {
    it("aceita state vazio válido", () => {
        expect(() => stateSchema.parse(emptyState())).not.toThrow();
    });

    it("aceita state com records", () => {
        const valid = {
            version: 1,
            dns: [
                { type: "A", name: "app.test.dev", content: "192.168.122.12" },
                { type: "CNAME", name: "www.test.dev", content: "app.test.dev" },
            ],
        };
        expect(() => stateSchema.parse(valid)).not.toThrow();
    });

    it("rejeita version ≠ 1", () => {
        expect(() => stateSchema.parse({ version: 2, dns: [] })).toThrow();
    });

    it("rejeita record com type desconhecido", () => {
        expect(() =>
            stateSchema.parse({
                version: 1,
                dns: [{ type: "MX", name: "x", content: "y" }],
            }),
        ).toThrow();
    });
});

describe("state I/O", () => {
    it("ensureState cria arquivo vazio se não existe", async () => {
        const { ensureState } = await import("../../src/lib/state.js");
        const { paths } = await import("../../src/lib/paths.js");
        const state = ensureState();
        expect(state).toEqual(emptyState());
        expect(existsSync(paths.state)).toBe(true);
        const onDisk = JSON.parse(readFileSync(paths.state, "utf8"));
        expect(onDisk).toEqual(emptyState());
    });

    it("readState carrega o arquivo existente", async () => {
        const { readState } = await import("../../src/lib/state.js");
        const { paths } = await import("../../src/lib/paths.js");
        const written = {
            version: 1,
            dns: [{ type: "A", name: "x.test.dev", content: "10.0.0.1" }],
        };
        writeFileSync(paths.state, JSON.stringify(written));
        expect(readState()).toEqual(written);
    });

    it("writeState valida schema antes de gravar", async () => {
        const { writeState } = await import("../../src/lib/state.js");
        // biome-ignore lint/suspicious/noExplicitAny: forçando shape inválido pra provar validação
        expect(() => writeState({ version: 2, dns: [] } as any)).toThrow();
    });
});
