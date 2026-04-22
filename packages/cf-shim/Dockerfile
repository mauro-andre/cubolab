# Multi-stage build. Build context deve ser o MONOREPO ROOT (pasta que
# contém `packages/core` e `packages/cf-shim`). O CLI passa via env var
# `CUBOLAB_CF_SHIM_CONTEXT` resolvido de
# `import.meta.resolve("@cubolab/cf-shim/package.json")`.
#
# Stage 1 — build @cubolab/core pra dist/ (cf-shim runtime usa `node` puro,
# sem tsx, então core precisa estar compilado).
#
# Stage 2 — build @cubolab/cf-shim. Antes de `npm install`, patch-a o
# `package.json` pra substituir a referência de workspace `"@cubolab/core": "^..."`
# por `file:../core`. Workaround pro fato de workspace linking não funcionar
# dentro do Docker (sem acesso ao package-lock do monorepo).
#
# Stage 3 — runtime magro: package.json + node_modules + dist.

FROM node:22-alpine AS core-builder

# tsconfig dos packages extende `../../tsconfig.base.json` — de
# /build/core/tsconfig.json isso resolve pra /tsconfig.base.json (2 níveis acima).
COPY tsconfig.base.json /tsconfig.base.json

WORKDIR /build/core
COPY packages/core/package.json ./
# @types/node precisa ser explicit aqui (no monorepo dev vem via hoisting
# do cli, mas no build isolado não). typescript pra tsc.
RUN npm install --no-package-lock && npm install -D @types/node typescript --no-package-lock

COPY packages/core/tsconfig.json packages/core/tsconfig.build.json ./
COPY packages/core/src ./src
RUN npx tsc -p tsconfig.build.json

# Re-aponta main/types pra dist pra runtime resolver via node puro.
RUN node -e "const p=require('./package.json');p.main='./dist/index.js';p.types='./dist/index.d.ts';p.exports={'.':{'types':'./dist/index.d.ts','import':'./dist/index.js'}};require('fs').writeFileSync('./package.json',JSON.stringify(p,null,2));"


FROM node:22-alpine AS cf-shim-builder

# Mesma regra do stage 1: tsconfig.base.json em /tsconfig.base.json pra o
# extends `../../tsconfig.base.json` de /build/cf-shim/tsconfig.json resolver.
COPY tsconfig.base.json /tsconfig.base.json

WORKDIR /build
COPY --from=core-builder /build/core ./core

WORKDIR /build/cf-shim
COPY packages/cf-shim/package.json ./

# Substitui referência de workspace por file:../core (válido em npm install
# sem registro publicado).
RUN node -e "const p=require('./package.json');if(p.dependencies?.['@cubolab/core']){p.dependencies['@cubolab/core']='file:../core';require('fs').writeFileSync('./package.json',JSON.stringify(p,null,2));}"

RUN npm install --no-package-lock && npm install -D @types/node typescript --no-package-lock

COPY packages/cf-shim/tsconfig.json packages/cf-shim/tsconfig.build.json ./
COPY packages/cf-shim/src ./src
RUN npx tsc -p tsconfig.build.json


FROM node:22-alpine

WORKDIR /app
COPY --from=cf-shim-builder /build/cf-shim/package.json ./
COPY --from=cf-shim-builder /build/cf-shim/node_modules ./node_modules
COPY --from=cf-shim-builder /build/cf-shim/dist ./dist

EXPOSE 4500
CMD ["node", "dist/bin/cf-shim.js"]
