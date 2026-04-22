# @cubolab/cf-shim

HTTP shim que implementa o subset da API Cloudflare v4 consumido por clientes
tipo PodCubo. Propaga mutações em DNS records pro pebble-challtestsrv
(mantém DNS real em sync com o state da API mock).

Executa em container dentro da stack `cubolab`. Não é publicado (em M2). Em
M5 será publicado como `@cubolab/cf-shim` e usado como imagem OCI.

## Config runtime

Zones são **config**, não state: lidas do env var `CUBOLAB_ZONES` só no boot.
Mudanças requerem `cubolab down && cubolab up`. (`cubolab restart` é TODO.)

Formato:
```
CUBOLAB_ZONES=podcubo.dev:zone-podcubo-v1,otherapp.dev:zone-other-v1
```

Records ficam em `~/.cubolab/state.json` (persistência atravessa restart do
cf-shim; re-hidratação do challtestsrv no startup é feita pelo próprio
cf-shim, não pelo CLI — ver PR9).

## Endpoints v1 (M2 progresso)

- [x] `GET /client/v4/zones/:id` — zone metadata (PR7)
- [ ] `POST /client/v4/zones/:id/dns_records` (PR8)
- [ ] `GET /client/v4/zones/:id/dns_records` (PR8)
- [ ] `PUT /client/v4/zones/:id/dns_records/:recordId` (PR8)
- [ ] `DELETE /client/v4/zones/:id/dns_records/:recordId` (PR8)
