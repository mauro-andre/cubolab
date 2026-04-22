# POC — Pebble ACME + challtestsrv DNS contra worker Vagrant

Objetivo: provar que conseguimos fazer o fluxo **real** de obtenção de cert TLS via ACME contra um worker Vagrant local, sem bater em Let's Encrypt nem criar DNS records em domínio público.

Se essa POC passar, a tese da ferramenta está provada.

## Pré-requisitos

- VMs Vagrant do podcubo rodando (`vagrant status` em `podcubo/dev/workers/` deve mostrar `running`)
- `podman-compose` v2 **ou** `podman-compose` no PATH
- `ssh` + acesso root às VMs via `podcubo_key`

## Roteiro

A POC é executada **passo a passo manualmente** — cada passo tem um comando e um resultado esperado. Se falhar em qualquer passo, paramos e investigamos.

### 1. Subir Pebble + challtestsrv

```bash
cd poc
podman-compose up -d
# aguarda ~3s
curl -sk https://localhost:14000/dir | head -c 200
```

**Esperado**: JSON com `newNonce`, `newAccount`, `newOrder` etc. Isso prova que o Pebble tá de pé e o ACME directory é válido.

### 2. Baixar o CA root do Pebble

```bash
mkdir -p out
curl -sk https://localhost:15000/roots/0 > out/pebble-ca.pem
cat out/pebble-ca.pem | head -2
```

**Esperado**: `-----BEGIN CERTIFICATE-----`. Esse é o CA que vamos colocar no trust dos workers e do host.

### 3. Registrar um A record no challtestsrv

O worker-1 tem IP `192.168.122.12` (verificar com `ssh -i podcubo_key -p 2231 root@localhost "ip -4 addr show ens5"`).

```bash
curl -sS -X POST http://localhost:8055/add-a \
  -d '{"host":"meu-app-test.podcubo.dev.","addresses":["192.168.122.12"]}'
# testar resolução
dig @localhost -p 8053 meu-app-test.podcubo.dev +short
```

**Esperado**: `192.168.122.12`.

### 4. Configurar o worker-1

Passar o CA do Pebble pro trust do worker e subir um Caddy temporário com container nginx atrás, usando Pebble como ACME endpoint.

Ver `scripts/setup-worker.sh` (a escrever no passo seguinte).

### 5. Teste final: curl com DNS do challtestsrv e CA do Pebble

```bash
curl --cacert out/pebble-ca.pem \
     --resolve meu-app-test.podcubo.dev:443:192.168.122.12 \
     https://meu-app-test.podcubo.dev
```

**Esperado**: response 200 do nginx (HTML padrão "Welcome to nginx!").

## Limpeza

```bash
podman-compose down
```

## Status atual

- [x] docker-compose com Pebble + challtestsrv
- [x] Passo 1 — ACME directory responde
- [x] Passo 2 — CA root + intermediate baixados
- [x] Passo 3 — A record registrado e resolvendo
- [x] Setup do worker automatizado (`scripts/setup-worker.sh` + `teardown-worker.sh`)
- [x] **Passo 5 retornando 200 com TLS real emitido via ACME** ✅

## Quirks descobertos (vão pro PRD)

1. **Server cert do Pebble** — a imagem vem com cert válido só pra `127.0.0.1`. Pra workers acessarem via IP do host libvirt (`192.168.122.1`), precisamos gerar cert próprio com SAN incluindo esse IP e montar via volume. `cubolab up` faz isso no primeiro uso.

2. **Trust chain** — Pebble emite certs numa cadeia **root + intermediate**. O trust bundle entregue ao cliente (node `NODE_EXTRA_CA_CERTS`, curl, browser) precisa dos dois. Baixar via:
   ```
   curl -sk https://localhost:15000/roots/0         # root
   curl -sk https://localhost:15000/intermediates/0 # intermediate
   ```

3. **State volátil do challtestsrv** — restart do compose perde os A records (é in-memory). OK pra teste, mas `cubolab` precisa lembrar do estado ou re-registrar no `up`.

4. **Caddy `acme_ca_root`** — precisa do server cert do Pebble (não só da CA), pra trust a conexão HTTPS com o ACME directory.

5. **Port lock** — Caddy do PodCubo ocupa 80/443 no worker. Sandbox precisa ou coexistir (outras portas) ou parar o Caddy do podcubo temporariamente.

## Limpeza completa

```bash
scripts/teardown-worker.sh    # restaura Caddy do podcubo
podman-compose down           # para Pebble + challtestsrv
```
