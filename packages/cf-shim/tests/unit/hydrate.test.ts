import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DnsRecord } from "@cubolab/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hydrateFromState } from "../../src/lib/hydrate.js";
import { createStubChalltestsrv } from "../helpers/challtestsrv.js";

let tempHome: string;

beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "cubolab-hydrate-test-"));
    process.env.CUBOLAB_HOME = tempHome;
});

afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    delete process.env.CUBOLAB_HOME;
});

const baseRecord = (overrides: Partial<DnsRecord>): DnsRecord => ({
    id: "test-id",
    type: "A",
    name: "a.dev",
    content: "10.0.0.1",
    ttl: 1,
    proxied: false,
    zone_id: "z1",
    zone_name: "test",
    created_on: "2026-01-01T00:00:00.000Z",
    modified_on: "2026-01-01T00:00:00.000Z",
    ...overrides,
});

describe("hydrateFromState", () => {
    it("state ausente → no-op (ensureState nunca foi chamado; readState retorna vazio)", async () => {
        const stub = createStubChalltestsrv();
        const result = await hydrateFromState(stub);
        expect(result).toEqual({ hydrated: 0, failed: 0 });
        expect(stub.log).toEqual([]);
    });

    it("state com 2 records → 2 adds no challtestsrv (A + CNAME)", async () => {
        writeFileSync(
            join(tempHome, "state.json"),
            JSON.stringify({
                version: 1,
                dns: [
                    baseRecord({ id: "1", type: "A", name: "a.dev", content: "10.0.0.1" }),
                    baseRecord({ id: "2", type: "CNAME", name: "www.dev", content: "a.dev" }),
                ],
            }),
        );
        const stub = createStubChalltestsrv();
        const result = await hydrateFromState(stub);
        expect(result).toEqual({ hydrated: 2, failed: 0 });
        expect(stub.log.map((c) => c.method).sort()).toEqual(["addA", "addCname"]);
    });

    it("falha individual não aborta — continua pros próximos records", async () => {
        writeFileSync(
            join(tempHome, "state.json"),
            JSON.stringify({
                version: 1,
                dns: [
                    baseRecord({ id: "1", type: "A", name: "fail.dev", content: "10.0.0.1" }),
                    baseRecord({ id: "2", type: "CNAME", name: "ok.dev", content: "target.dev" }),
                ],
            }),
        );
        const stub = createStubChalltestsrv({ failOn: new Set(["addA"]) });
        const result = await hydrateFromState(stub);
        expect(result).toEqual({ hydrated: 1, failed: 1 });
    });
});
