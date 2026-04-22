import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForChalltestsrv } from "../../src/lib/waitForChalltestsrv.js";

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("waitForChalltestsrv", () => {
    it("retorna imediatamente quando fetch succeeda na primeira tentativa", async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
            new Response("", { status: 404 }),
        );
        await expect(waitForChalltestsrv(1000)).resolves.toBeUndefined();
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("retry até succeeder depois de falhas transitórias", async () => {
        const mock = globalThis.fetch as ReturnType<typeof vi.fn>;
        mock.mockRejectedValueOnce(new Error("ECONNREFUSED"))
            .mockRejectedValueOnce(new Error("ECONNREFUSED"))
            .mockResolvedValue(new Response("", { status: 200 }));
        await expect(waitForChalltestsrv(5000)).resolves.toBeUndefined();
        expect(mock).toHaveBeenCalledTimes(3);
    });

    it("lança com mensagem clara após timeout total", async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("ECONNREFUSED"));
        await expect(waitForChalltestsrv(500)).rejects.toThrow(/didn't become reachable/);
    });
});
