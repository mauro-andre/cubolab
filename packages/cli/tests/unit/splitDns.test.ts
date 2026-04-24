import { describe, expect, it } from "vitest";
import { generateDropIn, validateDomain } from "../../src/lib/splitDns.js";

describe("generateDropIn", () => {
    it("single domain, hostIp normal", () => {
        const out = generateDropIn({
            hostIp: "192.168.122.1",
            domains: ["podcubo.dev"],
        });
        expect(out).toContain("[Resolve]");
        expect(out).toContain("DNS=192.168.122.1:8053");
        expect(out).toContain("Domains=~podcubo.dev");
        expect(out).toContain("Managed by cubolab");
    });

    it("multi-domain: ordenado alfabeticamente e com ~ prefix", () => {
        const out = generateDropIn({
            hostIp: "10.0.0.1",
            domains: ["zebra.test", "alpha.test", "mike.test"],
        });
        expect(out).toContain("Domains=~alpha.test ~mike.test ~zebra.test");
    });

    it("dedupe: domains repetidos aparecem 1 vez só", () => {
        const out = generateDropIn({
            hostIp: "127.0.0.1",
            domains: ["foo.test", "foo.test", "bar.test"],
        });
        expect(out).toContain("Domains=~bar.test ~foo.test");
        expect(out.match(/~foo\.test/g)).toHaveLength(1);
    });

    it("determinístico: mesmo input produz output byte-a-byte igual", () => {
        const input = { hostIp: "192.168.122.1", domains: ["a.dev", "b.dev"] };
        expect(generateDropIn(input)).toBe(generateDropIn(input));
    });

    it("ordem do user não afeta output (normalização)", () => {
        const a = generateDropIn({ hostIp: "1.2.3.4", domains: ["a.test", "b.test"] });
        const b = generateDropIn({ hostIp: "1.2.3.4", domains: ["b.test", "a.test"] });
        expect(a).toBe(b);
    });
});

describe("validateDomain", () => {
    it("aceita FQDNs válidos", () => {
        expect(validateDomain("podcubo.dev")).toBe("podcubo.dev");
        expect(validateDomain("foo.bar.example.com")).toBe("foo.bar.example.com");
        expect(validateDomain("test-123.local")).toBe("test-123.local");
    });

    it("normaliza uppercase pra lowercase", () => {
        expect(validateDomain("PodCubo.DEV")).toBe("podcubo.dev");
    });

    it("trim whitespace extra", () => {
        expect(validateDomain("  podcubo.dev  ")).toBe("podcubo.dev");
    });

    it("rejeita sem ponto (single label)", () => {
        expect(() => validateDomain("foo")).toThrow(/not a valid FQDN/);
    });

    it("rejeita double dot", () => {
        expect(() => validateDomain("foo..bar")).toThrow(/not a valid FQDN/);
    });

    it("rejeita leading/trailing dot", () => {
        expect(() => validateDomain(".podcubo.dev")).toThrow(/not a valid FQDN/);
        expect(() => validateDomain("podcubo.dev.")).toThrow(/not a valid FQDN/);
    });

    it("rejeita caracteres inválidos", () => {
        expect(() => validateDomain("foo_bar.test")).toThrow(/not a valid FQDN/);
        expect(() => validateDomain("foo bar.test")).toThrow(/not a valid FQDN/);
    });

    it("rejeita string vazia", () => {
        expect(() => validateDomain("")).toThrow(/not a valid FQDN/);
    });
});
