import { describe, expect, it } from "vitest";
import { parseOsRelease, resolveFamily } from "../../src/lib/osDetect.js";

describe("parseOsRelease", () => {
    it("extrai ID + ID_LIKE vazio quando ausente", () => {
        expect(parseOsRelease('NAME="Fedora Linux"\nID=fedora\nVERSION_ID=43\n')).toEqual({
            id: "fedora",
            idLike: [],
        });
    });

    it("parse ID_LIKE (space-separated, ordem preservada)", () => {
        const r = parseOsRelease(
            'NAME="Pop!_OS"\nID=pop\nID_LIKE="ubuntu debian"\nVERSION_ID="22.04"\n',
        );
        expect(r).toEqual({ id: "pop", idLike: ["ubuntu", "debian"] });
    });

    it("lowercase tanto ID quanto ID_LIKE entries", () => {
        const r = parseOsRelease('ID="Fedora"\nID_LIKE="RHEL Centos"\n');
        expect(r).toEqual({ id: "fedora", idLike: ["rhel", "centos"] });
    });

    it("lança quando ID= ausente", () => {
        expect(() => parseOsRelease('NAME="MysteryOS"\nVERSION=1\n')).toThrow(/couldn't find ID=/);
    });
});

describe("resolveFamily — direct match", () => {
    it("fedora → fedora-family (direct)", () => {
        const r = resolveFamily({ id: "fedora", idLike: [] });
        expect(r).toEqual({ id: "fedora", family: "fedora-family", matchedVia: "direct" });
    });

    it("debian → debian-family (direct)", () => {
        const r = resolveFamily({ id: "debian", idLike: [] });
        expect(r.family).toBe("debian-family");
        expect(r.matchedVia).toBe("direct");
    });

    it("alpine → debian-family (mesmo update-ca-certificates)", () => {
        const r = resolveFamily({ id: "alpine", idLike: [] });
        expect(r.family).toBe("debian-family");
    });
});

describe("resolveFamily — ID_LIKE fallback", () => {
    it("Rocky Linux: ID=rocky, ID_LIKE=rhel ... → fedora-family via rhel", () => {
        const r = resolveFamily({ id: "rocky", idLike: ["rhel", "centos", "fedora"] });
        expect(r).toEqual({
            id: "rocky",
            family: "fedora-family",
            matchedVia: "id-like",
            matchedAncestor: "rhel",
        });
    });

    it("AlmaLinux: ID=almalinux, ID_LIKE=rhel centos fedora → fedora-family via rhel", () => {
        const r = resolveFamily({ id: "almalinux", idLike: ["rhel", "centos", "fedora"] });
        expect(r.family).toBe("fedora-family");
        expect(r.matchedAncestor).toBe("rhel");
    });

    it("Pop!_OS: ID=pop, ID_LIKE=ubuntu debian → debian-family via ubuntu (ordem importa)", () => {
        const r = resolveFamily({ id: "pop", idLike: ["ubuntu", "debian"] });
        expect(r).toEqual({
            id: "pop",
            family: "debian-family",
            matchedVia: "id-like",
            matchedAncestor: "ubuntu",
        });
    });

    it("Oracle Linux: ID=ol, ID_LIKE=fedora → fedora-family via fedora", () => {
        const r = resolveFamily({ id: "ol", idLike: ["fedora"] });
        expect(r.family).toBe("fedora-family");
        expect(r.matchedAncestor).toBe("fedora");
    });
});

describe("resolveFamily — unknown", () => {
    it("lança quando ID não-conhecido sem ID_LIKE", () => {
        expect(() => resolveFamily({ id: "arch", idLike: [] })).toThrow(/not supported/);
    });

    it("lança quando ID_LIKE também não tem ancestor conhecido", () => {
        expect(() => resolveFamily({ id: "plan9", idLike: ["inferno"] })).toThrow(/not supported/);
    });

    it("mensagem de erro mostra ID_LIKE quando presente", () => {
        expect(() => resolveFamily({ id: "exotic", idLike: ["foo", "bar"] })).toThrow(
            /ID_LIKE=foo bar/,
        );
    });

    it("mensagem mostra 'none' quando ID_LIKE ausente", () => {
        expect(() => resolveFamily({ id: "exotic", idLike: [] })).toThrow(/ID_LIKE=none/);
    });

    it("mensagem inclui PR welcome pointer", () => {
        expect(() => resolveFamily({ id: "arch", idLike: [] })).toThrow(/PR welcome/);
    });
});
