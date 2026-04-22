# @cubolab/core

Shared primitives entre os packages do cubolab. Exporta o resolver de
`~/.cubolab/*` (com override via `CUBOLAB_HOME`), o schema zod do
`state.json` versionado (`{ version: 1, dns: DnsRecord[] }`) e o I/O
atômico do state. Consumidores atuais: `cubolab` (CLI) e `@cubolab/cf-shim`
(M2 em diante).
