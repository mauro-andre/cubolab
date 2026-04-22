import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Em dev (tsx), este arquivo roda em src/lib/assets.ts e resolve pra
// src/assets/. Em build futuro pra publish, o script de build precisa copiar
// src/assets/ pra dist/assets/ (tsc não copia non-.ts). M5.
export const assetsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets");
