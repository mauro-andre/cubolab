import { describe, expect, it } from "vitest";
import { buildScpArgs, buildSshArgs } from "../../src/lib/ssh.js";

describe("buildSshArgs", () => {
    it("target only + StrictHostKeyChecking off por default", () => {
        const args = buildSshArgs({ target: "root@worker-1" }, "whoami");
        expect(args).toContain("-o");
        expect(args).toContain("StrictHostKeyChecking=no");
        expect(args).toContain("root@worker-1");
        expect(args).toContain("whoami");
    });

    it("com --identity adiciona -i <path>", () => {
        const args = buildSshArgs(
            { target: "root@worker-1", identity: "/home/me/.ssh/podcubo" },
            "ls",
        );
        const iIndex = args.indexOf("-i");
        expect(iIndex).toBeGreaterThanOrEqual(0);
        expect(args[iIndex + 1]).toBe("/home/me/.ssh/podcubo");
    });

    it("com --port adiciona -p <number>", () => {
        const args = buildSshArgs({ target: "root@localhost", port: 2231 }, "uptime");
        const pIndex = args.indexOf("-p");
        expect(pIndex).toBeGreaterThanOrEqual(0);
        expect(args[pIndex + 1]).toBe("2231");
    });
});

describe("buildScpArgs", () => {
    it("usa -P (uppercase) pra port, diferente do ssh", () => {
        const args = buildScpArgs(
            { target: "root@worker-1", port: 2231 },
            "/local/file",
            "/remote/dest",
        );
        expect(args).toContain("-P");
        expect(args).not.toContain("-p");
        const pIndex = args.indexOf("-P");
        expect(args[pIndex + 1]).toBe("2231");
    });

    it("paths local e `target:remote` aparecem no final", () => {
        const args = buildScpArgs(
            { target: "root@worker-1" },
            "/local/trust.pem",
            "/remote/anchor.pem",
        );
        expect(args[args.length - 2]).toBe("/local/trust.pem");
        expect(args[args.length - 1]).toBe("root@worker-1:/remote/anchor.pem");
    });
});
