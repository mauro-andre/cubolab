# Build do cf-shim — 4 quirks

Este documento explica as 4 armadilhas do `Dockerfile` que qualquer
refactor (ex: migração pra imagem pré-buildada no M5) tem que enfrentar.
Resumo: monorepo + npm workspaces + Docker não combinam naturalmente, e
cada quirk abaixo é um workaround explícito.

## 1. `tsconfig.base.json` copiado pra `/tsconfig.base.json` (root do FS)

Os `tsconfig.json` dos packages (`packages/core/`, `packages/cf-shim/`)
extendem `../../tsconfig.base.json`. De `/build/<package>/tsconfig.json`
dentro do container, `../../` resolve pra `/` — **filesystem root**,
não `/build/`. Por isso o `COPY tsconfig.base.json /tsconfig.base.json`
em cada build stage (não `COPY tsconfig.base.json ./`).

## 2. Workspace protocol patched pra `file:../core`

`npm install` dentro do container não tem acesso ao `package-lock.json`
do monorepo nem ao workspace resolver. Referenciar `"@cubolab/core": "^..."`
quebra com "package not found". O Dockerfile patch-a o `package.json` do
cf-shim antes do install, trocando pra `"@cubolab/core": "file:../core"` —
path local válido sem registro publicado. No M5 (imagem publicada com
`@cubolab/core` já em npm registry), esse patch desaparece.

## 3. `@cubolab/core` compilado inline no build stage

O cf-shim runtime roda `node dist/bin/cf-shim.js` (node puro, sem `tsx`).
Se `@cubolab/core` ficasse com `main: "./src/index.ts"`, require falharia
em runtime (node não roda `.ts`). Stage 1 do Dockerfile compila core via
`tsc`, re-aponta `main/types/exports` pra `./dist/`, e só então o stage 2
do cf-shim resolve o import.

## 4. `@types/node` e `typescript` explícitos em cada build stage

No monorepo dev, `@types/node` e `typescript` estão em `packages/cli/` mas
chegam em `packages/core/` e `packages/cf-shim/` via npm hoisting pro
`node_modules/` da raiz. Dentro do Docker, cada stage tem seu próprio
`node_modules/` isolado — hoisting não acontece. Cada stage faz
`npm install -D @types/node typescript` explicit pra que `tsc` consiga
type-check (sem `@types/node`, qualquer import de `node:fs`, `node:path`,
etc, falha com "Cannot find type definition").
