import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCa } from "../../src/lib/ca.js";

let tempHome: string;

beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "cubolab-ca-test-"));
    process.env.CUBOLAB_HOME = tempHome;
});

afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    delete process.env.CUBOLAB_HOME;
});

describe("runCa", () => {
    it("retorna path com warning quando trust bundle não existe", () => {
        const r = runCa();
        expect(r.path).toBe(join(tempHome, "trust-bundle.pem"));
        expect(r.warning).toMatch(/run `cubolab up` first/);
    });

    it("retorna path sem warning quando trust bundle existe", () => {
        mkdirSync(tempHome, { recursive: true });
        writeFileSync(join(tempHome, "trust-bundle.pem"), "dummy\n");

        const r = runCa();
        expect(r.path).toBe(join(tempHome, "trust-bundle.pem"));
        expect(r.warning).toBeUndefined();
    });
});
