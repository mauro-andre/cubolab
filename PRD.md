# cubolab — Product Requirements Document

## 1. Contexto

Self-hosted PaaS (e infra similar) dependem de uma constelação de sistemas externos — DNS provider (Cloudflare, Route53), ACME CA (Let's Encrypt), eventualmente OAuth providers, e workers distribuídos atrás de reverse proxies. Testar o caminho completo desses sistemas **em dev local** é caro ou impossível:

- **Cloudflare não tem sandbox oficial** (confirmado pela própria comunidade deles).
- **Let's Encrypt em staging** ainda exige domínio público real e tem rate limits.
- **IP público em dev** exige VPS ou tunnel — custo $ + complexidade.

A consequência prática é código cheio de guards `if (isLocal) return` (ou equivalentes) que pulam exatamente as partes onde mais se descobre bug em produção: TLS/ACME, propagação DNS, comportamento do edge. Testes locais ficam empíricos — você só sabe se deploy funciona indo até produção.

**cubolab resolve isso** montando um sandbox de rede autocontido onde o código sob teste acredita que está falando com Cloudflare e Let's Encrypt reais, mas tudo roda contra mocks com comportamento funcionalmente idêntico — incluindo cert TLS real emitido por uma CA interna via ACME de verdade.

### Origem

Nasceu como satélite do [PodCubo](https://github.com/bit-cubo/podcubo) (PaaS self-hosted), resolvendo dor específica da sua suite de testes. Após a POC inicial (ver `poc/`), ficou claro que o padrão — e a ausência de ferramentas nesse nicho — justifica extração como produto próprio.

## 2. Público-alvo

- **Primário**: times que constroem PaaS self-hosted Node.js (qualquer stack — não é acoplado a nenhum framework).
- **Secundário**: qualquer projeto que integre com Cloudflare API **e** ACME e queira testar o caminho real em CI sem domínio público.
- **Fora de escopo (v1)**: projetos que usam AWS Route53, GCP Cloud DNS, ou outros providers — só Cloudflare no início (extensível depois).

## 3. Princípios

Listados em ordem de prioridade — quando houver conflito, o mais alto vence.

1. **Reuse over reinvent** — cada peça pronta, mantida upstream (Pebble, challtestsrv), é preferível a código próprio equivalente.
2. **Real > mock** — sempre que possível, exercitar o caminho real (TLS de verdade, DNS de verdade, ACME de verdade) em vez de simular resultado.
3. **Zero-config default** — `cubolab up` sem argumento deve funcionar out-of-the-box contra as convenções padrão; configuração é pra casos específicos.
4. **Reversível sem pegada** — tudo que `up` faz, `down` desfaz. Sem sujeira residual no sistema host.
5. **Transparência sobre mágica** — stacktrace claro, logs inspecionáveis, estado observável via CLI (`status`). Falhas devem dizer o que quebrou e onde.
6. **API pública estável, interior negociável** — quem integra com `cubolab` (via CLI, env vars, helper de teste) não deve ser quebrado por refactor interno.

## 4. Goals / Non-goals

### Goals v1

- Dev roda `cubolab up` na máquina local e ganha um ambiente onde:
  - A API Cloudflare está simulada em `http://localhost:<porta>` com todos os endpoints de DNS records que o PodCubo usa.
  - Registros DNS criados via essa API são resolvíveis via DNS real (workers podem consultar e achar o host esperado).
  - ACME endpoint em `https://<ip-host>:14000/dir` emite cert real via CA privada do sandbox.
  - Trust bundle pronto pra ser consumido pelo cliente (via `NODE_EXTRA_CA_CERTS` ou trust store).
- PodCubo (ou outro consumidor) troca 2 env vars e roda sua suite sem nenhum guard `.local`.
- Teardown idempotente que devolve o sistema host ao estado pré-cubolab.

### Non-goals v1

- Não substitui Let's Encrypt staging pra validar rate limits reais.
- Não emula comportamento de edge Cloudflare (WAF, cache rules, workers).
- Não cria workers/VMs — assume que já existem (Vagrant, Hetzner, qualquer coisa). `cubolab` só simula o mundo externo a eles.
- Não tem UI gráfica. CLI only.
- Não suporta clusters multi-máquina de `cubolab` (single-host only).

### Goals futuros (v2+, explicitamente fora do escopo v1)

- Suporte a mais providers de DNS (Route53 shim, Cloud DNS shim).
- Emulação de OAuth providers (GitHub App fake, Google OAuth fake) pra testes de login.
- Webhooks inbound routing (receber webhook GitHub no sandbox, rotear pra app sob teste).
- Interface web de inspeção (ver records criados, certs emitidos, requests em trânsito).
- Publicação como image Docker standalone (ao invés de node_modules + binários).

## 5. Tese validada pela POC

A POC inicial (em `poc/`) provou que:

- **Caddy no worker Vagrant consegue obter cert real via ACME** contra Pebble rodando no host, resolvendo via challtestsrv.
- **O fluxo usa exatamente o mesmo código de Caddy** que usaria em produção contra Let's Encrypt — zero mock do lado do cliente.
- **`curl` externo valida TLS** com o bundle de trust do Pebble, retornando 200 do container atrás do proxy.
- **Tempo de setup end-to-end**: ~1-2 segundos após Pebble de pé (vs. skipado completamente hoje).

Cinco quirks foram descobertos durante a POC, todos com solução clara (ver seção 8).

## 6. Feature set v1

### 6.1 CLI

```
cubolab up        # sobe toda a stack (pebble + challtestsrv + cf-shim)
cubolab down      # derruba tudo, restaura host
cubolab reset     # limpa state (DNS records, certs emitidos), mantém containers
cubolab status    # mostra o que está rodando, endpoints ativos, last errors
cubolab logs      # tail logs agregados de todas as peças
cubolab ca        # printa path do trust bundle pra NODE_EXTRA_CA_CERTS
```

Todos comandos devem:
- Retornar exit code claro (0 = sucesso, >0 com mensagem específica no stderr).
- Ser idempotentes (`up` várias vezes não explode; `down` sem nada de pé também não).
- Completar em < 10s em máquina moderna.

### 6.2 cf-shim (HTTP server implementando a API Cloudflare)

Implementa os endpoints que PodCubo (e consumidores similares) usam. Mantém estado em memória (e opcionalmente no filesystem pra persistir entre restarts).

**Endpoints obrigatórios v1**:
- `POST /client/v4/zones/:zoneId/dns_records` — cria record (A, CNAME)
- `GET /client/v4/zones/:zoneId/dns_records` — lista
- `PUT /client/v4/zones/:zoneId/dns_records/:recordId` — atualiza
- `DELETE /client/v4/zones/:zoneId/dns_records/:recordId` — deleta
- `GET /client/v4/zones/:zoneId` — metadata da zona

Quando um record é criado/atualizado, `cf-shim` propaga pro `challtestsrv` via `POST /add-a` (ou remove via `/clear-a`). Assim DNS real reflete estado da API.

Auth: `cf-shim` aceita qualquer token Bearer (é sandbox). Mas loga tokens recebidos pra ajudar debug.

### 6.3 docker-compose embutido

`cubolab` gerencia sua própria stack de containers (Pebble + challtestsrv + cf-shim). Usa podman-compose (default em Fedora) com fallback pra `docker compose` v2.

Imagens em `ghcr.io/letsencrypt/pebble` e `ghcr.io/letsencrypt/pebble-challtestsrv`.

### 6.4 Trust bundle management

`cubolab` gera no primeiro `up`:
- `~/.cubolab/pebble-cert.pem` — cert self-signed do servidor Pebble com SAN pro IP do host.
- `~/.cubolab/pebble-root.pem` — CA root emitida pelo Pebble (baixada de `/roots/0`).
- `~/.cubolab/pebble-intermediate.pem` — intermediate (baixada de `/intermediates/0`).
- `~/.cubolab/trust-bundle.pem` — concatenação pra uso em `NODE_EXTRA_CA_CERTS`, `--cacert`, etc.

Bundle é regenerado apenas quando inexistente; `up` subsequente reusa.

### 6.5 Helper de teste

Pacote npm `cubolab/testing` exportando:

```ts
import { sandbox } from "cubolab/testing";

// Use em beforeAll:
await sandbox.up();           // idempotent
await sandbox.reset();        // between tests
await sandbox.inspect.dns("meu-app.podcubo.dev");  // => [{ type: "A", content: "192.168.122.12" }]
await sandbox.inspect.cloudflareRecords();         // => [{ id, name, content, type }]
await sandbox.inspect.issuedCerts();               // => [{ cn, sans, notAfter }]

// Primary endpoint pro cliente configurar:
sandbox.cloudflareApiUrl   // => "http://127.0.0.1:4500/client/v4"
sandbox.acmeDirectoryUrl   // => "https://192.168.122.1:14000/dir"
sandbox.trustBundlePath    // => "~/.cubolab/trust-bundle.pem"
```

### 6.6 Worker bootstrap (opcional helper)

Como parte da POC apareceu o problema de instalar o trust bundle no worker e configurar Caddy pra apontar pro Pebble. Em v1, `cubolab` entrega um helper:

```
cubolab worker bootstrap <ssh-target>
```

Que:
1. Copia `trust-bundle.pem` pro worker (via SSH).
2. Adiciona ao trust store do sistema (`update-ca-trust` ou equivalente).
3. Exporta path do bundle numa variável conhecida (`CUBOLAB_TRUST=/etc/cubolab/trust.pem`) via `/etc/environment`.

Cliente (PodCubo) usa essa env var no Caddyfile que gera pros workers.

## 7. UX / User flow

### Dev local com PodCubo

```bash
# uma vez, terminal persistente
cubolab up

# em outro terminal
cd podcubo
export CLOUDFLARE_API_URL=http://127.0.0.1:4500/client/v4
export ACME_CA=https://192.168.122.1:14000/dir
export NODE_EXTRA_CA_CERTS=~/.cubolab/trust-bundle.pem
npm run dev
```

Abre browser em `https://dev.podcubo.dev` (com CA importado manualmente uma vez no perfil do navegador, ou aceitar warning), cria stack + app, e `https://meu-app.podcubo.dev` funciona.

### Suite de testes automatizados

```ts
import { sandbox } from "cubolab/testing";

beforeAll(async () => {
    await sandbox.up();
});

beforeEach(async () => {
    await sandbox.reset();
});

it("deploys app with real TLS", async () => {
    // Testa o fluxo completo do PodCubo — zero mock.
    const app = await testApp.action(AppNew.action_create, {
        body: { stackId, name: "test-app", type: "image", image: "nginx" },
        cookies,
    });

    // Consulta o sandbox pra confirmar efeitos colaterais
    const cfRecords = await sandbox.inspect.cloudflareRecords();
    expect(cfRecords).toHaveLength(1);

    // HTTP real contra o domínio fake
    const res = await fetch("https://test-app.podcubo.dev");
    expect(res.status).toBe(200);
});
```

## 8. Quirks descobertos na POC (e suas soluções)

| # | Quirk | Solução v1 |
|---|---|---|
| 1 | Pebble image vem com cert server só pra `127.0.0.1`; workers via libvirt acessam por `192.168.122.1` e falham TLS | `cubolab up` gera cert server custom com SAN incluindo IP do host libvirt (detectado via `ip route`), monta via volume, aponta config do Pebble pra ele |
| 2 | Trust chain é root + intermediate; só root não valida certs emitidos | `cubolab up` baixa ambos via management API, concatena em `trust-bundle.pem` |
| 3 | challtestsrv é in-memory; restart do container perde records | `cf-shim` mantém state em `~/.cubolab/state.json` e re-hidrata o challtestsrv no startup |
| 4 | Caddy `acme_ca_root` precisa do server cert (não da CA); nomenclatura confusa | Helper `cubolab worker bootstrap` injeta o bundle correto, cliente só referencia `CUBOLAB_TRUST` |
| 5 | Portas 80/443 no worker podem estar ocupadas por Caddy pré-existente | Responsabilidade do cliente; `cubolab worker bootstrap` NÃO toca processos externos (explicitamente documentado) |

## 9. Integração com PodCubo

Mudanças mínimas no código do PodCubo pra viabilizar cubolab:

1. **`CLOUDFLARE_API_URL` virar env var** no driver Cloudflare (hoje hardcode `https://api.cloudflare.com/client/v4`):
   ```ts
   const CF_API = process.env.CLOUDFLARE_API_URL ?? "https://api.cloudflare.com/client/v4";
   ```

2. **`ACME_CA` referenciado no Caddyfile gerado** (`domain.service.ts → generateCaddyfile`):
   ```
   tls {
       ca {env.ACME_CA}
       dns cloudflare {env.CLOUDFLARE_API_TOKEN}
   }
   ```
   Em prod, `ACME_CA` unset → Caddy usa Let's Encrypt default. Em sandbox, aponta pro Pebble.

3. **Remover os 6 guards `BASE_URL.endsWith(".local")`** (2 em `cloudflare.ts` nos métodos createDns/updateDns/deleteDns/syncDns, 1 em `deploy.service.ts:waitForSsl`, 1 em `domain.service.ts:generateCaddyfile`, 1 em `DomainList.tsx`).

O guard em `AppEdit.tsx:buildConnectionStrings` (DB connection strings) e o de `Servers.tsx` (listar VMs Vagrant) ficam — são bifurcações semânticas, não "skip dev", e precisam de outra flag específica se quiser eliminar.

## 10. Roadmap

### Milestone 0 — POC ✅

Concluído. Conteúdo em `poc/`. Prova que a tese é sólida.

### Milestone 1 — Infraestrutura e CLI básico

- `cubolab up/down/reset/status/logs/ca` funcionando com idempotência
- Gerenciamento de trust bundle em `~/.cubolab/`
- Cert server com SAN automático (detecta IP do host)
- Hidratação do challtestsrv via `cf-shim` state
- Testes próprios do `cubolab` (vitest) cobrindo o CLI

**Critério de aceitação**: `cubolab up && cubolab status` mostra todos endpoints ativos em < 10s.

### Milestone 2 — cf-shim

- Endpoints de DNS records (CRUD)
- Endpoint de zone metadata
- Persistência em `~/.cubolab/state.json`
- Propagação automática pro challtestsrv
- Logging detalhado pra debug

**Critério**: PodCubo consegue criar/listar/deletar record via seu próprio driver Cloudflare apontado pro cf-shim sem saber da diferença.

### Milestone 3 — Integração com PodCubo

- Aplicar as 3 mudanças listadas em (9) no código do PodCubo
- Remover os 6 guards `.local`
- Rodar `npm test` do PodCubo contra cubolab até passar
- Adicionar CI step no PodCubo que sobe cubolab antes de testes

**Critério**: `npm test` do PodCubo passa sem os guards `.local` no código.

### Milestone 4 — Helper `cubolab/testing` + `cubolab worker bootstrap`

- Empacotar como npm package
- Documentar API pública
- Exemplo completo no README

**Critério**: outro projeto (dummy test repo) consegue integrar cubolab em < 30min lendo só o README.

### Milestone 5 — Publicação

- `cubolab` publicado no npm
- Repo público no GitHub com README, docs, exemplos
- Domínio `cubolab.dev` com landing básica
- Post anunciando no Hacker News / Lobsters

**Critério**: primeira issue de um dev externo reportando bug ou pedindo feature.

## 11. Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Cloudflare muda API em versões existentes | Baixa | Médio | Implementar só endpoints que PodCubo usa; adicionar quando consumidor precisa |
| Pebble descontinua / quebra compat | Baixa | Alto | Pin major version; fork se necessário |
| Podman-compose tem quirks em outras distros | Média | Médio | CI em múltiplas distros; docker compose como fallback explícito |
| Cert server do Pebble requer SAN diferente em arquitetura X | Baixa | Baixo | Cert regenerado no primeiro up; processo documentado |
| Usuários querem outros DNS providers além de Cloudflare | Alta | N/A (v2+) | Arquitetura de cf-shim já segrega adaptação por provider; v2 adiciona |

## 12. Open questions

- [ ] Distribuição: npm package executável (`npx cubolab`) ou binário standalone (via `pkg` / `bun compile`)?
- [ ] Estado persistente: `~/.cubolab/state.json` ou SQLite embedded?
- [ ] Como o `cubolab worker bootstrap` ganha acesso SSH? Reusa chaves do cliente ou pede path?
- [ ] Versionamento da API interna entre CLI e cf-shim — semver do package inteiro ou dois packages separados?
- [ ] Testes do próprio cubolab: como testamos a ferramenta que simula a internet? (meta-sandbox?)

Essas ficam abertas — quem pegar o projeto decide à medida que implementa.
