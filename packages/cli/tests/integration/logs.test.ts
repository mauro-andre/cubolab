import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tempHome = mkdtempSync(join(tmpdir(), "cubolab-logs-test-"));
process.env.CUBOLAB_HOME = tempHome;
process.env.CUBOLAB_HOST_IP = "127.0.0.1";

const { runUp } = await import("../../src/lib/up.js");
const { runDown } = await import("../../src/lib/down.js");
const { runLogs } = await import("../../src/lib/logs.js");

describe("runLogs — integration", () => {
    beforeAll(async () => {
        await execa("podman", ["rm", "-f", "cubolab-pebble", "cubolab-challtestsrv"], {
            reject: false,
        });
    }, 60_000);

    afterAll(async () => {
        await runDown();
        rmSync(tempHome, { recursive: true, force: true });
    }, 120_000);

    it("falha com mensagem clara quando stack nunca subiu (compose file ausente)", async () => {
        await expect(runLogs({ follow: false, stdio: "ignore" })).rejects.toThrow(/stack is down/);
    });

    it("retorna o snapshot dos logs sem erro quando a stack está up", async () => {
        await runUp();
        // stdio: "ignore" silencia a saída do compose pra não poluir vitest.
        await expect(runLogs({ follow: false, stdio: "ignore" })).resolves.toBeUndefined();
    }, 180_000);

    it("falha com mensagem clara após down (containers não rodando)", async () => {
        await runDown();
        await expect(runLogs({ follow: false, stdio: "ignore" })).rejects.toThrow(/stack is down/);
    }, 60_000);
});
