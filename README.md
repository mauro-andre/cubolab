# cubolab

Ambiente de testes pra PaaS self-hosted — simula a "internet externa" (DNS, ACME, Cloudflare API) contra workers locais, pra que a aplicação sob teste não precise de guards `.local` e o caminho real (TLS real via ACME real, resolução DNS real) seja exercitado.

Projeto em fase de **POC** — validando a tese antes de extrair como ferramenta completa.

## Stack

- **[Pebble](https://github.com/letsencrypt/pebble)** (Let's Encrypt) — servidor ACME de teste com CA privada
- **pebble-challtestsrv** — mock DNS + gerenciamento via HTTP API
- **cf-shim** (a escrever) — HTTP server implementando a API do Cloudflare, delegando pro challtestsrv
- Workers Vagrant/libvirt do projeto consumidor

## Status

Ver `poc/README.md`.
