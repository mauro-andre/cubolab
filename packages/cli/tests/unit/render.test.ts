import { describe, expect, it } from "vitest";
import { renderHuman, renderJson } from "../../src/lib/render.js";
import { type StatusReport, statusReportSchema } from "../../src/schemas/status.js";

const pebbleEndpoints = {
    acme: "https://192.168.122.1:14000/dir",
    mgmt: "https://192.168.122.1:15000",
};
const challtestsrvEndpoints = {
    dns: "192.168.122.1:8053",
    mgmt: "http://192.168.122.1:8055/",
};

const reportUp: StatusReport = {
    version: 1,
    stack: "up",
    components: {
        pebble: { running: true, healthy: true, endpoints: pebbleEndpoints },
        challtestsrv: { running: true, healthy: true, endpoints: challtestsrvEndpoints },
    },
    trustBundle: { path: "/home/u/.cubolab/trust-bundle.pem", exists: true },
    composeTool: "podman-compose",
    hostIp: "192.168.122.1",
};

const reportDown: StatusReport = {
    version: 1,
    stack: "down",
    components: {
        pebble: { running: false, healthy: false, endpoints: pebbleEndpoints },
        challtestsrv: { running: false, healthy: false, endpoints: challtestsrvEndpoints },
    },
    trustBundle: { path: "/home/u/.cubolab/trust-bundle.pem", exists: false },
    composeTool: "podman-compose",
    hostIp: "192.168.122.1",
};

const reportPartial: StatusReport = {
    version: 1,
    stack: "partial",
    components: {
        pebble: {
            running: true,
            healthy: false,
            lastError: "connection refused on 192.168.122.1:14000",
            endpoints: pebbleEndpoints,
        },
        challtestsrv: { running: true, healthy: true, endpoints: challtestsrvEndpoints },
    },
    trustBundle: { path: "/home/u/.cubolab/trust-bundle.pem", exists: true },
    composeTool: "podman-compose",
    hostIp: "192.168.122.1",
};

describe("renderJson", () => {
    it("produz JSON que re-parse no mesmo shape (up)", () => {
        const parsed = statusReportSchema.parse(JSON.parse(renderJson(reportUp)));
        expect(parsed).toEqual(reportUp);
    });

    it("produz JSON que re-parse no mesmo shape (down)", () => {
        const parsed = statusReportSchema.parse(JSON.parse(renderJson(reportDown)));
        expect(parsed).toEqual(reportDown);
    });

    it("produz JSON que re-parse no mesmo shape (partial com lastError)", () => {
        const parsed = statusReportSchema.parse(JSON.parse(renderJson(reportPartial)));
        expect(parsed).toEqual(reportPartial);
    });

    it("termina com newline (pra clean pipe)", () => {
        expect(renderJson(reportUp).endsWith("\n")).toBe(true);
    });
});

describe("renderHuman", () => {
    it("mostra o estado 'up'", () => {
        const out = renderHuman(reportUp);
        expect(out).toMatch(/cubolab sandbox:\s*\S*up/);
        expect(out).toContain("pebble");
        expect(out).toContain("challtestsrv");
        expect(out).toContain("https://192.168.122.1:14000/dir");
    });

    it("mostra o estado 'down'", () => {
        const out = renderHuman(reportDown);
        expect(out).toContain("down");
        expect(out).toContain("absent");
    });

    it("expõe lastError no estado 'partial'", () => {
        const out = renderHuman(reportPartial);
        expect(out).toContain("partial");
        expect(out).toContain("connection refused on 192.168.122.1:14000");
    });

    it("nunca vaza 'undefined' no output", () => {
        for (const r of [reportUp, reportDown, reportPartial]) {
            expect(renderHuman(r)).not.toContain("undefined");
        }
    });
});
