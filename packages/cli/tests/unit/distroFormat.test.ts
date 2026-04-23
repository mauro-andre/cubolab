import { describe, expect, it } from "vitest";
import { formatResolvedDistro } from "../../src/lib/distroFormat.js";

describe("formatResolvedDistro", () => {
    it("direct match: 'id (family)'", () => {
        expect(
            formatResolvedDistro({
                id: "fedora",
                family: "fedora-family",
                matchedVia: "direct",
            }),
        ).toBe("fedora (fedora-family)");
    });

    it("direct match debian-family", () => {
        expect(
            formatResolvedDistro({
                id: "ubuntu",
                family: "debian-family",
                matchedVia: "direct",
            }),
        ).toBe("ubuntu (debian-family)");
    });

    it("via ID_LIKE: 'id (family, matched via ID_LIKE=ancestor)' — Rocky/RHEL", () => {
        expect(
            formatResolvedDistro({
                id: "rocky",
                family: "fedora-family",
                matchedVia: "id-like",
                matchedAncestor: "rhel",
            }),
        ).toBe("rocky (fedora-family, matched via ID_LIKE=rhel)");
    });

    it("via ID_LIKE: Pop!_OS resolvido via ubuntu", () => {
        expect(
            formatResolvedDistro({
                id: "pop",
                family: "debian-family",
                matchedVia: "id-like",
                matchedAncestor: "ubuntu",
            }),
        ).toBe("pop (debian-family, matched via ID_LIKE=ubuntu)");
    });

    it("nunca retorna '[object Object]' ou 'undefined' no output", () => {
        const direct = formatResolvedDistro({
            id: "alpine",
            family: "debian-family",
            matchedVia: "direct",
        });
        const idLike = formatResolvedDistro({
            id: "almalinux",
            family: "fedora-family",
            matchedVia: "id-like",
            matchedAncestor: "rhel",
        });
        for (const s of [direct, idLike]) {
            expect(s).not.toContain("[object Object]");
            expect(s).not.toContain("undefined");
        }
    });
});
