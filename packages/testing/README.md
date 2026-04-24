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
    options.domains?: readonly string[]                      // split DNS via systemd-resolved (Linux)
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

## Installation

```bash
npm install --save-dev cubolab @cubolab/testing
```

Transitive deps (`@cubolab/core`, `@cubolab/cf-shim`) são resolvidos automaticamente via npm registry quando consumir do npm.

### Testing locally before M5 (registry publish)

`npm install file:<path>` **não resolve transitive workspace refs** — precisa passar todos os 4 packages explicitamente no install local:

```bash
npm install \
    file:<monorepo>/packages/core \
    file:<monorepo>/packages/cli \
    file:<monorepo>/packages/cf-shim \
    file:<monorepo>/packages/testing
```

Ver `docs/monorepo-resolution.md` pra rationale.

## Requisitos

- Stack de runtime: **podman-compose** (Fedora-first) ou **Docker Compose v2**.
- `dig` no PATH pra `sandbox.inspect.dns`.
- Host Linux com SELinux configurado (Fedora) ou sem (Ubuntu/Debian/Alpine).
- Split DNS opcional (via `sandbox.up({ domains })`): requer **systemd-resolved ≥ 247** + `/etc/resolv.conf` gerido por ele + sudo no terminal **uma vez** (chamadas subsequentes com mesmos domains são idempotentes e não pedem sudo).

## Split DNS no setup de tests

```ts
await sandbox.up({
    zones: [{ name: "podcubo.dev", id: "zone-v1" }],
    domains: ["podcubo.dev"],
});
// Agora browser/fetch/curl do host resolve *.podcubo.dev via cubolab.
```

**Primeira vez (terminal)**: usuário roda `cubolab up podcubo.dev` manualmente, paga sudo uma vez. Depois disso, chamadas `sandbox.up({ domains: ["podcubo.dev"] })` em test setup batem no drop-in match e não tentam sudo (não travam esperando TTY). Se sudo não está disponível (CI, container sem TTY), split DNS skipa com warn, containers sobem normalmente — tests que só usam `sandbox.cloudflareApiUrl` diretamente seguem funcionando.

## Distribuição de trust no worker

`sandbox.trustBundlePath` retorna o path do bundle (`~/.cubolab/trust-bundle.pem`). Consumer é responsável por distribuí-lo pros workers **via o mesmo mecanismo que usaria pra instalar CA corporativa em produção** — tipicamente um step condicional no script de provisioning do worker (provisionar por SSH, copiar o arquivo, rodar `update-ca-trust` ou equivalente).

Razão: em produção o worker confia em CAs do sistema sem comando especial do sandbox. Se dev exige comando extra (`cubolab worker bootstrap` antigo, removido no PR18), o worker **sabe** que é sandbox e perde a simetria dev/prod. Ver PRD §3 princípio 2 corolário.

Exemplo de integração em consumer (PodCubo):

```ts
// build-provisioning-script.ts
const script = [...baseSteps];
const caBundle = process.env.WORKER_CA_BUNDLE;
if (caBundle) {
    script.push(`scp ${caBundle} root@${worker}:/etc/pki/ca-trust/source/anchors/cubolab.pem`);
    script.push(`ssh root@${worker} update-ca-trust`);
}
// em prod: WORKER_CA_BUNDLE unset, steps ausentes. Zero if/else runtime.
// em dev: WORKER_CA_BUNDLE=~/.cubolab/trust-bundle.pem, steps incluídos.
```

## Config via options, não env vars

Todas as configurações passam por `sandbox.up({...})`. Internamente, `sandbox` muta `process.env.CUBOLAB_ZONES` / `CUBOLAB_HOST_IP` antes de chamar o CLI — mutação global aceitável porque testes rodam serializados (`fileParallelism: false`). Pra rodar múltiplos sandboxes paralelos no mesmo host ver TODO em `src/sandbox.ts`.
