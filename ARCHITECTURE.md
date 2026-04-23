# Architecture

`cubolab` é **infraestrutura orquestrada** — diferente do PodCubo (que é um app web com camadas de página/ação/serviço), aqui o produto é um conjunto de peças que rodam em containers + um CLI que orquestra + um servidor HTTP (cf-shim) + ferramentas auxiliares. Esta arquitetura reflete essa natureza.

Não existem as camadas do PodCubo (pages, loaders, actions, streams, ZodMongo) porque não são aplicáveis. Em vez disso, organizamos por **componente** (peça que roda) e por **contrato** (o que é exposto pra fora).

## Components

```
┌──────────────────────────── host (máquina do dev) ────────────────────────────┐
│                                                                                │
│  ┌──── podman network "cubolab-net" (10.30.50.0/24) ────┐                     │
│  │                                                       │                     │
│  │   ┌─────────┐       ┌──────────────────┐              │                     │
│  │   │ pebble  │◀──DNS─│  challtestsrv    │              │                     │
│  │   │  ACME   │──────▶│  DNS + mgmt API  │◀──┐          │                     │
│  │   └────▲────┘       └──────────────────┘   │          │                     │
│  │        │                                    │          │                     │
│  └────────┼────────────────────────────────────┼──────────┘                     │
│           │                                    │                                │
│  ┌────────┴─────────┐              ┌───────────┴─────────┐                      │
│  │  cf-shim (Node)  │─────────────▶│  challtestsrv:8055  │                      │
│  │  :4500           │              │  POST /add-a        │                      │
│  │  Cloudflare API  │              │  DELETE /clear-a    │                      │
│  └──────────────────┘              └─────────────────────┘                      │
│                                                                                │
│  CLI (cubolab)     ~/.cubolab/      ┌──────────────────────┐                    │
│  - up/down/reset   - trust-bundle   │  libvirt/Vagrant     │                    │
│  - inspect         - state.json     │  workers (externos)  │                    │
│  - logs                             │  192.168.122.x       │                    │
│                                     └──────────────────────┘                    │
└────────────────────────────────────────────────────────────────────────────────┘
```

### pebble

Servidor ACME privado (imagem `ghcr.io/letsencrypt/pebble:latest`). Emite certs reais assinados por sua CA interna. Configurado via `config/pebble-config.json` e cert server customizado em `config/pebble-cert.pem` (gerado por `cubolab up` com SAN pro IP do host libvirt).

- **Porta externa 14000** — ACME directory (consumido por Caddy nos workers)
- **Porta externa 15000** — management API (consumido por `cubolab` pra baixar root + intermediate)

Não tem estado persistente entre restarts. Certs emitidos ficam no storage do cliente (Caddy dos workers).

### challtestsrv

DNS mock + management API (imagem `ghcr.io/letsencrypt/pebble-challtestsrv:latest`). Responde consultas DNS reais vindas dos workers Vagrant (e do Pebble, pra HTTP-01 validation).

- **Porta externa 8053 (UDP + TCP)** — servidor DNS
- **Porta externa 8055** — management API (CRUD de records via HTTP)

State in-memory — perdido em restart. Por isso `cubolab` re-hidrata via `cf-shim.state`.

### cf-shim

Servidor HTTP (Node.js + Hono, provavelmente) que implementa o subset da API do Cloudflare que PodCubo consome. Traduz operações de DNS records em chamadas ao challtestsrv, e persiste state próprio em `~/.cubolab/state.json`.

- **Porta externa 4500** (ajustável) — endpoint `https://api.cloudflare.com/client/v4` emulado
- **Endpoints v1**: `POST/GET/PUT/DELETE /client/v4/zones/:id/dns_records`, `GET /client/v4/zones/:id`

Responsabilidade: **o único componente com código próprio significativo** do projeto. Pebble e challtestsrv são binários upstream; o CLI orquestra; cf-shim é o tradutor.

### CLI (`cubolab`)

Comando de linha escrito em Node.js / TypeScript. Orquestra a stack (podman-compose up/down), gerencia trust bundle, hidrata state do cf-shim, provê subcomandos de inspeção.

Subcomandos:
- `up` — orquestra bring-up completo (idempotente)
- `down` — derruba containers, mantém state no filesystem
- `reset` — limpa state sem derrubar containers
- `status` — verifica endpoints, mostra resumo
- `logs` — tail agregado
- `ca` — printa path do trust bundle (consumidor é responsável por distribuí-lo nos workers via seu próprio provisionamento — ver PRD §6.6)

### ~/.cubolab/ (filesystem state)

```
~/.cubolab/
├── pebble-cert.pem         # cert server do Pebble (regenerado se inexistente)
├── pebble-key.pem          # chave privada do cert acima
├── pebble-root.pem         # root CA do Pebble (baixada via /roots/0)
├── pebble-intermediate.pem # intermediate CA (baixada via /intermediates/0)
├── trust-bundle.pem        # concatenação root+intermediate pra NODE_EXTRA_CA_CERTS
└── state.json              # DNS records registrados via cf-shim (pra re-hidratação)
```

## Data flows

### 1. Create DNS record (cliente → cf-shim → challtestsrv)

```
Cliente (PodCubo, curl, etc)
  POST http://localhost:4500/client/v4/zones/Z1/dns_records
  body: { type: "A", name: "foo.test.dev", content: "192.168.122.12" }
       │
       ▼
cf-shim
  1. valida schema
  2. armazena em state.json
  3. chama challtestsrv: POST :8055/add-a {host: "foo.test.dev.", addresses: ["192.168.122.12"]}
  4. responde cliente com shape idêntico à API Cloudflare real
       │
       ▼
Cliente recebe { success: true, result: { id, name, content, ... } }
```

### 2. Caddy (no worker) obtém cert via ACME

```
Caddy em worker-1 (192.168.122.12)
  detecta hostname "meu-app.test.dev"
  lê Caddyfile: acme_ca https://192.168.122.1:14000/dir
                acme_ca_root <path do bundle distribuído pelo consumidor>
                            # PodCubo: env var WORKER_CA_BUNDLE no provisioning
                            # Prod: unset — Caddy usa trust do sistema (Let's Encrypt)
       │
       ▼
pebble (rodando no host, mapeado pra 192.168.122.1:14000)
  valida TLS da conexão (cert server tem SAN pra 192.168.122.1)
  recebe ordem ACME, cria desafio HTTP-01
       │
       ▼
pebble resolve "meu-app.test.dev" via challtestsrv (10.30.50.3:8053)
  challtestsrv retorna 192.168.122.12 (registrado antes pelo cf-shim)
       │
       ▼
pebble faz GET http://192.168.122.12/.well-known/acme-challenge/TOKEN
  Caddy responde com o desafio correto
       │
       ▼
pebble finaliza ordem, emite cert (assinado pela cadeia root+intermediate privada)
Caddy recebe cert, armazena, inicia TLS termination
```

### 3. Cliente externo faz HTTP real contra a app

```
curl --cacert ~/.cubolab/trust-bundle.pem \
     --resolve meu-app.test.dev:443:192.168.122.12 \
     https://meu-app.test.dev
       │
       ▼
TLS handshake contra Caddy:443 do worker
  curl valida cert apresentado contra trust-bundle.pem (root + intermediate)
  handshake completa
       │
       ▼
Caddy faz reverse_proxy pro container backend
  container responde 200
       │
       ▼
curl exibe body
```

## Public contracts

Essas são as superfícies que consumidores (PodCubo e equivalentes) dependem. Mudanças aqui são **breaking** e requerem major bump.

### 1. Env vars expostas ao cliente

| Variável | Conteúdo | Consumido por |
|---|---|---|
| `CLOUDFLARE_API_URL` | URL do cf-shim (ex: `http://127.0.0.1:4500/client/v4`) | Driver Cloudflare do cliente |
| `ACME_CA` | URL do ACME directory do Pebble (ex: `https://192.168.122.1:14000/dir`) | Caddyfile gerado pelo cliente |
| `NODE_EXTRA_CA_CERTS` | Path pro `trust-bundle.pem` | Node.js runtime do cliente (pra `fetch` contra cf-shim) |

Distribuição de trust pros workers é **responsabilidade do consumidor** (PodCubo etc) via seu próprio provisionamento — cubolab só expõe o path do bundle. Ver PRD §6.6.

### 2. CLI — contrato de saída

- Exit code 0 = sucesso
- Exit code != 0 = falha; mensagem específica no stderr
- stdout de `status` é JSON parseable (pra uso em CI)
- `cubolab ca` printa só o path, sem linhas adicionais (pra `export NODE_EXTRA_CA_CERTS=$(cubolab ca)`)

### 3. Helper `cubolab/testing` (npm package API)

```ts
export const sandbox = {
    up(): Promise<void>,
    down(): Promise<void>,
    reset(): Promise<void>,
    readonly cloudflareApiUrl: string,
    readonly acmeDirectoryUrl: string,
    readonly trustBundlePath: string,
    inspect: {
        dns(hostname: string): Promise<DnsRecord[]>,
        cloudflareRecords(): Promise<CloudflareRecord[]>,
        issuedCerts(): Promise<IssuedCert[]>,
    },
};
```

Adições ao objeto: não-breaking. Remoções/mudanças de assinatura: breaking.

### 4. cf-shim HTTP API

Shape idêntico à Cloudflare v4. Se Cloudflare mudar shape, cf-shim acompanha (mas só nos endpoints que cobrimos). Clientes que usam outros endpoints (não implementados) recebem 404 claro.

### 5. Container names (observáveis via `podman ps` / `docker ps`)

- `cubolab-pebble`
- `cubolab-challtestsrv`
- (futuro) `cubolab-cf-shim`

Esses nomes são contrato estável. Consumidores que querem inspecionar containers diretamente (CI, scripts de debug, o próprio `cubolab status`) podem listar por esses prefixos. Renomear = breaking.

## Rules

### Design

- **Containers pra dependências upstream (Pebble, challtestsrv), código próprio só onde é inevitável (cf-shim + CLI)**. Resistir a tentação de "escrever nosso próprio DNS mock" ou similar — upstream já fez.
- **Zero estado dentro de containers**. Tudo que precisa sobreviver restart mora em `~/.cubolab/`.
- **cf-shim é o único tradutor**. Se precisar suportar novo provider (Route53 v2), é `r53-shim` novo componente, não extensão condicional do cf-shim.

### Código próprio (cf-shim + CLI)

- **TypeScript** como linguagem padrão. `strict: true` no tsconfig.
- **Arrow functions com `const`**, nunca `function` declarations. Alinha com PodCubo/velojs/zodmongo.
- **Zero mágica global**. Nada de singletons implícitos, ambient state, ou import com side effect (exceto `import "dotenv/config"` quando explicitamente usado).
- **Erro fala onde quebrou**. Stacktrace preservado, mensagens descritivas, exit codes estáveis.
- **Documentação inline** quando o "por que" não é óbvio. O "o que" fica claro pelo nome; o "por que" é quirk, workaround, decisão de design.

### Portas e endereços

- **Portas externas estáveis entre versões**. 14000/15000 (Pebble), 8053/8055 (challtestsrv), 4500 (cf-shim). Mudança é breaking.
- **IP do host libvirt é detectado automaticamente** via `ip route show default` + `ip addr show virbr0`. Configurável via `CUBOLAB_HOST_IP` pra ambientes não-libvirt (futuro).

### Trust bundle

- **Gerado uma vez** no primeiro `up`, reutilizado. Rotação só em `cubolab reset --full` (v2+).
- **Formato PEM concatenado** (root + intermediate). Compatível com OpenSSL, Node.js, Caddy, curl.
- **Nunca commitado no repo** — listado em `.gitignore`.

### Estado persistente (`~/.cubolab/state.json`)

- Formato JSON pretty-printed (pra debug humano).
- Schema versionado (`{ version: 1, dns: [...], ... }`) pra migração futura.
- Perdido não é catastrófico — `cubolab up` reconstrói oque der com base nos containers.

## Extensibility

### Adicionando endpoint ao cf-shim

1. Schema Zod do request/response em `cf-shim/schemas/<endpoint>.ts`.
2. Handler em `cf-shim/handlers/<endpoint>.ts`.
3. Registro da rota em `cf-shim/routes.ts`.
4. Teste em `cf-shim/tests/<endpoint>.test.ts` — prova contra OpenAPI spec da Cloudflare (ou fixture salvo de chamada real).

### Adicionando novo componente na stack (v2+)

Ex: OAuth provider mock (github-shim).

1. Criar `<componente>-shim/` como subdir.
2. Adicionar service no `docker-compose.yml`.
3. Adicionar endpoint ao `status` do CLI.
4. Adicionar contract na seção "Public contracts" da ARCH.
5. Documentar integração no PRD.

## Known quirks

Veja PRD §8 — cada quirk tem razão técnica e solução definida. Resumo:

1. Pebble cert server só vale pra 127.0.0.1 por default → regeramos com SAN pro IP do host.
2. Trust chain é root + intermediate → baixamos e concatenamos os dois.
3. challtestsrv é stateless → `cf-shim` re-hidrata no startup.
4. Caddy `acme_ca_root` quer server cert, não CA → consumidor distribui o bundle correto via seu próprio provisionamento (ver PRD §6.6).
5. Conflito de porta 80/443 com Caddy do cliente → responsabilidade do cliente parar o seu.

## Out of scope

O que `cubolab` **não** faz (e não deve fazer):

- Substituir produção — é ambiente de teste, não platform real.
- Emular comportamento de edge Cloudflare (cache, WAF, rate limit, workers).
- Criar ou gerenciar VMs/containers do cliente (workers Vagrant, Hetzner, etc).
- Terminar TLS pro cliente — Caddy no worker faz isso; cubolab só dá o ACME.
- Ser instalado em servidor remoto como produto de "staging em VPS" — é local-first.

## Checklist ao adicionar feature

1. Define contrato em `PRD.md` antes de codar.
2. Se afeta API pública (env var, CLI, helper `testing`), atualiza seção "Public contracts" desta ARCH.
3. Implementa.
4. Teste integrado (sobe stack, exercita, assert, derruba).
5. Atualiza README do `cubolab` se expõe ao usuário final.
6. Atualiza `INTEGRATION.md` (futuro) se afeta como consumidores integram.
