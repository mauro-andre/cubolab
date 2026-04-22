# assets/

Static assets embutidos no pacote. `cubolab up` copia todos pra `~/.cubolab/`
antes de subir a stack.

- **`docker-compose.yml`** — compose file (2 services: pebble + challtestsrv).
  Volumes são relativos (`./`) e resolvem pra `~/.cubolab/` porque o compose
  file é copiado pra lá antes do `up`. `container_name` fixo é contrato
  público (ver ARCHITECTURE.md §Public contracts §5).

- **`pebble-config.json`** — config estática do Pebble. Referencia
  `/config/pebble-cert.pem` e `/config/pebble-key.pem`, que são mounted de
  `~/.cubolab/pebble-cert.pem` e `~/.cubolab/pebble-key.pem`. Esses certs são
  gerados on-the-fly pelo `cubolab up` via `@peculiar/x509` com SAN pro IP
  do host libvirt + `127.0.0.1` + `localhost`.

"Estático" aqui significa que o conteúdo dos assets não varia por host. O
que varia é o cert/key, gerados em tempo de `up` conforme o IP detectado.
