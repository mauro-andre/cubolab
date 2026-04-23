# @cubolab/testing

Helper pra consumer tests: sobe/derruba o sandbox `cubolab` de dentro do test runner (vitest, jest, etc) + inspeciona estado da stack.

## Uso

```ts
import { sandbox } from "@cubolab/testing";
import { beforeAll, beforeEach, afterAll, it } from "vitest";

beforeAll(async () => {
    await sandbox.up({
        zones: [{ name: "podcubo.dev", id: "zone-podcubo-v1" }],
    });
});

beforeEach(async () => {
    await sandbox.reset();
});

afterAll(async () => {
    await sandbox.down();
});

it("creates DNS record via cf-shim", async () => {
    await fetch(`${sandbox.cloudflareApiUrl}/zones/zone-podcubo-v1/dns_records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "A", name: "app.podcubo.dev", content: "10.0.0.1" }),
    });

    const ips = await sandbox.inspect.dns("app.podcubo.dev");
    expect(ips).toEqual(["10.0.0.1"]);
});
```

## API

```ts
sandbox.up(options?): Promise<void>
    options.zones?: Array<{ name: string; id: string }>     // seta CUBOLAB_ZONES
    options.hostIp?: string                                  // override auto-detect
    options.timeoutMs?: number                               // default 180_000

sandbox.down(): Promise<void>
sandbox.reset(): Promise<void>      // delega via cf-shim /_admin/clear (single-writer)

sandbox.cloudflareApiUrl: string    // "http://<hostIp>:4500/client/v4"
sandbox.acmeDirectoryUrl: string    // "https://<hostIp>:14000/dir"
sandbox.trustBundlePath: string     // "~/.cubolab/trust-bundle.pem"

sandbox.inspect.dns(hostname): Promise<string[]>                   // via challtestsrv DNS
sandbox.inspect.cloudflareRecords(zoneId): Promise<DnsRecord[]>    // via cf-shim GET
sandbox.inspect.issuedCerts(): Promise<IssuedCert[]>               // v1: stub — ver abaixo
```

## `issuedCerts()` é stub em v0.x

`sandbox.inspect.issuedCerts()` sempre retorna `[]` em v0.x. **Pebble** (servidor ACME do cubolab) não expõe endpoint público de enumeração de certs emitidos — não há API stable upstream.

**May populate em M5+** via ACME account order enumeration ou fork do Pebble com endpoint adicional. Método fica exposto no contrato pra não forçar breaking change depois.

Workaround enquanto isso: pra validar cert emitido num test, use `openssl s_client -connect <host>:443 -servername <name>` com `CAfile=sandbox.trustBundlePath`, ou `curl --cacert sandbox.trustBundlePath https://<name>`.

## Requisitos

- `cubolab` (CLI) precisa estar disponível no sistema. Instalado via `npm i @cubolab/testing cubolab` + stack de runtime: **podman-compose** (Fedora-first) ou **Docker Compose v2**.
- `dig` no PATH pra `sandbox.inspect.dns`.
- Host Linux com SELinux configurado (Fedora) ou sem (Ubuntu/Debian/Alpine).

## Config via options, não env vars

Todas as configurações passam por `sandbox.up({...})`. Internamente, `sandbox` muta `process.env.CUBOLAB_ZONES` / `CUBOLAB_HOST_IP` antes de chamar o CLI — mutação global aceitável porque testes rodam serializados (`fileParallelism: false`). Pra rodar múltiplos sandboxes paralelos no mesmo host ver TODO em `src/sandbox.ts`.
