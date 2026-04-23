import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sandbox } from "../../src/index.js";

const originalEnv = { ...process.env };

beforeEach(() => {
    process.env = { ...originalEnv };
});

afterEach(() => {
    process.env = { ...originalEnv };
});

describe("sandbox getters", () => {
    it("cloudflareApiUrl usa CUBOLAB_HOST_IP", () => {
        process.env.CUBOLAB_HOST_IP = "10.0.0.5";
        expect(sandbox.cloudflareApiUrl).toBe("http://10.0.0.5:4500/client/v4");
    });

    it("cloudflareApiUrl fallback 127.0.0.1 sem env", () => {
        delete process.env.CUBOLAB_HOST_IP;
        expect(sandbox.cloudflareApiUrl).toBe("http://127.0.0.1:4500/client/v4");
    });

    it("acmeDirectoryUrl usa CUBOLAB_HOST_IP", () => {
        process.env.CUBOLAB_HOST_IP = "192.168.122.1";
        expect(sandbox.acmeDirectoryUrl).toBe("https://192.168.122.1:14000/dir");
    });

    it("trustBundlePath resolve via @cubolab/core (respeita CUBOLAB_HOME)", () => {
        process.env.CUBOLAB_HOME = "/tmp/sandbox-getter-test";
        expect(sandbox.trustBundlePath).toBe("/tmp/sandbox-getter-test/trust-bundle.pem");
    });
});

describe("sandbox.inspect.issuedCerts", () => {
    it("retorna [] em v1 (stub — ver README)", async () => {
        expect(await sandbox.inspect.issuedCerts()).toEqual([]);
    });
});
