# Module resolution no monorepo cubolab

Este doc explica como `@cubolab/core` é resolvido em cada ferramenta do
workflow (tsc, tsx, vitest, node runtime). Quem estiver debugando "por que
tsc resolve daqui e não dali" deve começar aqui.

## O problema

`@cubolab/core` é um workspace package (não publicado no npm). Dev quer
iteração rápida — mudar `core/src/schemas/state.ts` e rodar `vitest` sem
esperar build. Mas Node runtime (quando `cubolab` CLI é instalado via `npm
link`) não roda TS — precisa de `dist/*.js` pré-buildado.

Tipos reconhecer pacote de 2 jeitos:

1. **Dev tooling** (tsc, tsx, vitest) — lê source TS direto, sem precisar de
   build do core.
2. **Node runtime** (bin do CLI via `npm link`/`npm install -g`) — lê JS
   compilado de `dist/`.

A tabela abaixo descreve onde cada ferramenta busca o módulo.

## Tabela de resolution path

| Ferramenta | Como resolve `@cubolab/core` | Lê de |
|---|---|---|
| `tsc` (typecheck) | `tsconfig.base.json` → `compilerOptions.paths` | `packages/core/src/index.ts` |
| `tsx` (dev mode, `npm run dev`) | `tsconfig.base.json` → `paths` | `packages/core/src/index.ts` |
| `vitest` | `vitest.config.ts` → `resolve.alias` | `packages/core/src/index.ts` |
| `node` (runtime pós-build) | `packages/core/package.json` → `exports` | `packages/core/dist/index.js` |
| `tsc` (build de cli/cf-shim) | `packages/core/package.json` → `exports` (paths do build json vazio override) | `packages/core/dist/index.js` |

## Por que a bifurcação

Se todas as ferramentas usassem só `package.json/exports` apontando pra
`dist`:
- Dev teria que rodar `npm run build` após cada mudança em `core/`.
- Vitest em watch ficaria stale.

Se todas usassem só source TS:
- Node runtime (bin do CLI) não funcionaria — `node` não interpreta `.ts`.
- `npm link` / eventual `npm install -g` quebrariam.

A bifurcação permite que cada ferramenta pegue o que é otimizado pra ela,
ao custo de redundância de config (`paths` em tsconfig **e** `alias` em
vitest **e** `exports` em package.json).

## Por que vitest precisa de `alias` separado (não herda tsconfig paths)

Vitest usa Vite por baixo dos panos. Vite não respeita `tsconfig paths`
nativamente — requer o plugin `vite-tsconfig-paths`. Preferimos adicionar
2 linhas em `vitest.config.ts` a adicionar uma dep (e o plugin tem seu
próprio quirk com ESM resolution).

## Por que o build do cli/cf-shim tem `paths: {}`

`tsconfig.base.json` declara `paths: { "@cubolab/core": [...] }` pra dev
tooling resolver pro source. Quando `tsc` builda o cli/cf-shim (modo
`--noEmit: false`), se os paths herdados forem aplicados, tsc inclui
`packages/core/src/*` no programa — mas `rootDir` do build aponta pra
`packages/cli/src/`. Conflict: `TS6059: File '...core/src/...' is not
under rootDir`.

Solução: cada `tsconfig.build.json` do cli e cf-shim override `paths: {}`.
tsc cai em `node_modules/@cubolab/core/package.json` → `exports` → `dist`.
Isso requer que core tenha sido buildado primeiro — garantido pela ordem
topológica explícita no `build` script da raiz:

```json
"build": "npm run build -w @cubolab/core && npm run build -w cubolab && npm run build -w @cubolab/cf-shim"
```

## Assets não-TS no build (PR12a)

`tsc` só compila `.ts` → `.js`. Assets como `packages/cli/src/assets/*.json`
e `*.yml` **não são copiados** pro `dist/assets/` — são invisíveis pro
`tsc`. Precisam de step separado no `build` script.

```json
"build": "tsc -p tsconfig.build.json && mkdir -p dist/assets && cp -r src/assets/* dist/assets/ && chmod +x dist/bin/cubolab.js"
```

O `chmod +x` é porque `tsc` preserva shebang mas não exec bit. Sem ele,
`cubolab` via `npm link` falha com "Permission denied".

## Padrão a replicar

Qualquer novo workspace package que vira dep interna (ex: `@cubolab/testing`
no M4 PR13 importando `cubolab`) segue o mesmo padrão:

1. Package-pai tem `exports` apontando pra `dist/`.
2. `tsconfig.base.json` ganha nova entry em `paths` apontando pro source.
3. `vitest.config.ts` do consumer ganha `resolve.alias` equivalente.
4. `tsconfig.build.json` do consumer ganha `paths: {}` pra build resolver via exports.

Esse doc deve ser atualizado quando um novo package entrar.
