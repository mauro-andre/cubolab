import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyState, stateSchema } from "../../src/schemas/state.js";

let tempHome: string;

beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "cubolab-state-test-"));
    process.env.CUBOLAB_HOME = tempHome;
});

afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    delete process.env.CUBOLAB_HOME;
});

// Record shape CF-completo. Usado nos tests abaixo e nos tests de I/O.
const sampleRecord = {
    id: "f3c1-test-uuid-1",
    type: "A" as const,
    name: "app.test.dev",
    content: "192.168.122.12",
    ttl: 1,
    proxied: false,
    zone_id: "zone-test",
    zone_name: "test.dev",
    created_on: "2026-04-22T00:00:00.000Z",
    modified_on: "2026-04-22T00:00:00.000Z",
};

describe("state schema", () => {
    it("aceita state vazio válido", () => {
        expect(() => stateSchema.parse(emptyState())).not.toThrow();
    });

    it("aceita state com records completos", () => {
        const valid = {
            version: 1,
            dns: [
                sampleRecord,
                {
                    ...sampleRecord,
                    id: "uuid-2",
                    type: "CNAME",
                    name: "www.test.dev",
                    content: "app.test.dev",
                },
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
                dns: [{ ...sampleRecord, type: "MX" }],
            }),
        ).toThrow();
    });

    it("rejeita record sem campos obrigatórios (id, zone_id, timestamps)", () => {
        expect(() =>
            stateSchema.parse({
                version: 1,
                dns: [{ type: "A", name: "x", content: "1.2.3.4" }],
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
        const written = { version: 1, dns: [sampleRecord] };
        writeFileSync(paths.state, JSON.stringify(written));
        expect(readState()).toEqual(written);
    });

    it("writeState valida schema antes de gravar", async () => {
        const { writeState } = await import("../../src/lib/state.js");
        // biome-ignore lint/suspicious/noExplicitAny: forçando shape inválido pra provar validação
        expect(() => writeState({ version: 2, dns: [] } as any)).toThrow();
    });
});
