import { describe, expect, it } from "vitest";
import { parseZones } from "../../src/lib/zones.js";

describe("parseZones", () => {
    it("retorna map vazio pra input vazio", () => {
        expect(parseZones("").size).toBe(0);
    });

    it("retorna map vazio pra whitespace apenas", () => {
        expect(parseZones("  \n  ").size).toBe(0);
    });

    it("parse de single entry válida", () => {
        const z = parseZones("podcubo.dev:zone-v1");
        expect(z.size).toBe(1);
        const zone = z.get("zone-v1");
        expect(zone?.name).toBe("podcubo.dev");
        expect(zone?.status).toBe("active");
        expect(zone?.type).toBe("full");
        expect(zone?.paused).toBe(false);
        expect(zone?.name_servers).toEqual([]);
        expect(typeof zone?.created_on).toBe("string");
        expect(zone?.created_on).toBe(zone?.modified_on);
    });

    it("parse de múltiplas entries válidas", () => {
        const z = parseZones("a.dev:id-a,b.dev:id-b,c.dev:id-c");
        expect(z.size).toBe(3);
        expect(z.get("id-a")?.name).toBe("a.dev");
        expect(z.get("id-c")?.name).toBe("c.dev");
    });

    it("tolera espaços em volta das entries", () => {
        const z = parseZones("  a.dev:id-a  ,  b.dev:id-b  ");
        expect(z.size).toBe(2);
    });

    it("lança com mensagem específica se entry não tem ':'", () => {
        expect(() => parseZones("foo.dev")).toThrow(/no ':' separator/);
    });

    it("lança se name vazio", () => {
        expect(() => parseZones(":id-1")).toThrow(/empty name/);
    });

    it("lança se id vazio", () => {
        expect(() => parseZones("foo.dev:")).toThrow(/empty id/);
    });

    it("lança se name não parece domain (sem '.')", () => {
        expect(() => parseZones("nodot:id")).toThrow(/not a valid domain/);
    });

    it("lança em duplicate name com índices das entries", () => {
        expect(() => parseZones("foo.dev:a,foo.dev:b")).toThrow(
            /duplicate name 'foo.dev' at entries 0 and 1/,
        );
    });

    it("lança em duplicate id com índices das entries", () => {
        expect(() => parseZones("a.dev:same,b.dev:same")).toThrow(
            /duplicate id 'same' at entries 0 and 1/,
        );
    });
});
