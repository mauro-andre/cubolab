import { describe, expect, it } from "vitest";
import { parseResolvectlVersion } from "../../src/lib/resolverDetect.js";

describe("parseResolvectlVersion", () => {
    it("Fedora 43 (systemd 258)", () => {
        const output = "systemd 258 (258.7-1.fc43)\n+PAM +AUDIT +SELINUX -APPARMOR +IMA +IPE";
        expect(parseResolvectlVersion(output)).toBe(258);
    });

    it("Ubuntu 24.04 (systemd 255)", () => {
        const output = "systemd 255 (255.4-1ubuntu8.10)\n+PAM +AUDIT +SELINUX";
        expect(parseResolvectlVersion(output)).toBe(255);
    });

    it("Fedora 33 (systemd 246 — pré-IP:PORT)", () => {
        expect(parseResolvectlVersion("systemd 246 (246.6-1.fc33)\n+PAM")).toBe(246);
    });

    it("retorna null em output não-reconhecido", () => {
        expect(parseResolvectlVersion("not a version string")).toBeNull();
        expect(parseResolvectlVersion("")).toBeNull();
    });

    it("retorna null quando número não é parseable (corner case)", () => {
        expect(parseResolvectlVersion("systemd abc (def)")).toBeNull();
    });
});
