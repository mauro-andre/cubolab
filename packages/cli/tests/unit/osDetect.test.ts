import { describe, expect, it } from "vitest";
import { familyFor, parseOsRelease } from "../../src/lib/osDetect.js";

describe("parseOsRelease", () => {
    it("parse Fedora (ID sem aspas)", () => {
        expect(parseOsRelease('NAME="Fedora Linux"\nID=fedora\nVERSION_ID=43\n')).toBe("fedora");
    });

    it("parse Ubuntu (ID com aspas)", () => {
        expect(parseOsRelease('NAME="Ubuntu"\nID=ubuntu\nVERSION_ID="24.04"\n')).toBe("ubuntu");
    });

    it("parse Debian", () => {
        expect(parseOsRelease('NAME="Debian GNU/Linux"\nID=debian\nVERSION_ID="12"\n')).toBe(
            "debian",
        );
    });

    it("parse Alpine", () => {
        expect(parseOsRelease('NAME="Alpine Linux"\nID=alpine\n')).toBe("alpine");
    });

    it("parse RHEL/CentOS", () => {
        expect(parseOsRelease('ID="rhel"\nVERSION_ID="9"\n')).toBe("rhel");
        expect(parseOsRelease("ID=centos\n")).toBe("centos");
    });

    it("lança mensagem clara em distro não suportada", () => {
        expect(() => parseOsRelease('ID=arch\nNAME="Arch"\n')).toThrow(/not supported/);
        expect(() => parseOsRelease('ID=arch\nNAME="Arch"\n')).toThrow(/PR welcome/);
    });

    it("lança mensagem clara quando ID= está ausente (os-release estranho)", () => {
        expect(() => parseOsRelease('NAME="MysteryOS"\nVERSION=1\n')).toThrow(/couldn't find ID=/);
    });
});

describe("familyFor", () => {
    it("Fedora/RHEL/CentOS são fedora-family", () => {
        expect(familyFor("fedora")).toBe("fedora-family");
        expect(familyFor("rhel")).toBe("fedora-family");
        expect(familyFor("centos")).toBe("fedora-family");
    });

    it("Debian/Ubuntu/Alpine são debian-family", () => {
        expect(familyFor("debian")).toBe("debian-family");
        expect(familyFor("ubuntu")).toBe("debian-family");
        expect(familyFor("alpine")).toBe("debian-family");
    });
});
