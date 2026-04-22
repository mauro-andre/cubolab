import { SubjectAlternativeNameExtension, X509Certificate } from "@peculiar/x509";
import { describe, expect, it } from "vitest";
import { generatePebbleServerCert } from "../../src/lib/certGen.js";

const sanValues = (certPem: string): Set<string> => {
    const cert = new X509Certificate(certPem);
    const ext = cert.extensions.find(
        (e): e is SubjectAlternativeNameExtension => e instanceof SubjectAlternativeNameExtension,
    );
    if (!ext) return new Set();
    return new Set(ext.names.items.map((n) => n.value));
};

describe("generatePebbleServerCert", () => {
    it("gera um cert com SAN incluindo hostIp, 127.0.0.1, localhost e cubolab-pebble.local", async () => {
        const { certPem, keyPem } = await generatePebbleServerCert({ hostIp: "192.168.122.1" });

        expect(certPem).toMatch(/-----BEGIN CERTIFICATE-----/);
        expect(certPem).toMatch(/-----END CERTIFICATE-----/);
        expect(keyPem).toMatch(/-----BEGIN PRIVATE KEY-----/);
        expect(keyPem).toMatch(/-----END PRIVATE KEY-----/);

        const sans = sanValues(certPem);
        const joined = [...sans].join("|");
        expect(joined).toContain("192.168.122.1");
        expect(joined).toContain("127.0.0.1");
        expect(joined).toContain("localhost");
        expect(joined).toContain("cubolab-pebble.local");
    });

    it("defaulta pra ~10 anos de validade", async () => {
        const { certPem } = await generatePebbleServerCert({ hostIp: "127.0.0.1" });
        const cert = new X509Certificate(certPem);
        const years =
            (cert.notAfter.getTime() - cert.notBefore.getTime()) / (365 * 24 * 60 * 60 * 1000);
        expect(years).toBeGreaterThan(9.9);
        expect(years).toBeLessThan(10.1);
    });

    it("CN é cubolab-pebble", async () => {
        const { certPem } = await generatePebbleServerCert({ hostIp: "127.0.0.1" });
        const cert = new X509Certificate(certPem);
        expect(cert.subject).toContain("CN=cubolab-pebble");
    });
});
