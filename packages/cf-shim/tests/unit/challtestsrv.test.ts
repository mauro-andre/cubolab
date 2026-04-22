import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChalltestsrvClient } from "../../src/lib/challtestsrv.js";
import { UpstreamError } from "../../src/lib/errors.js";

// Único mock do projeto — wrapper puro sobre fetch, sem lógica de negócio.
// Tudo que tem comportamento (records, admin, zones) é testado com stack ou
// stub próprio.

const BASE = "http://challtestsrv:8055";

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const okResponse = () => new Response("{}", { status: 200 });
const failResponse = (status: number) => new Response("err", { status });

describe("createChalltestsrvClient", () => {
    it("addA POST /add-a com host FQDN + addresses", async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(okResponse());
        const client = createChalltestsrvClient(BASE);
        await client.addA("meu-app.podcubo.dev", "192.168.122.12");

        expect(globalThis.fetch).toHaveBeenCalledWith(
            `${BASE}/add-a`,
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({
                    host: "meu-app.podcubo.dev.",
                    addresses: ["192.168.122.12"],
                }),
            }),
        );
    });

    it("addA normaliza host com trailing dot (já FQDN, não duplica)", async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(okResponse());
        const client = createChalltestsrvClient(BASE);
        await client.addA("meu-app.podcubo.dev.", "10.0.0.1");

        const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        const body = JSON.parse(call?.[1].body);
        expect(body.host).toBe("meu-app.podcubo.dev.");
    });

    it("addCname POST /add-cname com host + target ambos FQDN", async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(okResponse());
        const client = createChalltestsrvClient(BASE);
        await client.addCname("www.podcubo.dev", "podcubo.dev");

        expect(globalThis.fetch).toHaveBeenCalledWith(
            `${BASE}/add-cname`,
            expect.objectContaining({
                body: JSON.stringify({ host: "www.podcubo.dev.", target: "podcubo.dev." }),
            }),
        );
    });

    it("clearA POST /clear-a", async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(okResponse());
        const client = createChalltestsrvClient(BASE);
        await client.clearA("app.podcubo.dev");

        expect(globalThis.fetch).toHaveBeenCalledWith(
            `${BASE}/clear-a`,
            expect.objectContaining({ body: JSON.stringify({ host: "app.podcubo.dev." }) }),
        );
    });

    it("clearCname POST /clear-cname", async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(okResponse());
        const client = createChalltestsrvClient(BASE);
        await client.clearCname("www.podcubo.dev");

        expect(globalThis.fetch).toHaveBeenCalledWith(
            `${BASE}/clear-cname`,
            expect.objectContaining({ body: JSON.stringify({ host: "www.podcubo.dev." }) }),
        );
    });

    it("lança UpstreamError em HTTP 5xx do challtestsrv", async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(failResponse(500));
        const client = createChalltestsrvClient(BASE);
        await expect(client.addA("x.dev", "1.2.3.4")).rejects.toThrow(UpstreamError);
    });

    it("lança UpstreamError em network failure (fetch throws)", async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("ECONNREFUSED"));
        const client = createChalltestsrvClient(BASE);
        await expect(client.addA("x.dev", "1.2.3.4")).rejects.toThrow(UpstreamError);
    });
});
