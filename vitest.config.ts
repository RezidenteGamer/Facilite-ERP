import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Config própria de teste, separada de vite.config.ts de propósito: aquele
// arquivo carrega o plugin do React e as opções de build (manualChunks,
// cssMinify) que não têm nada a ver com rodar teste em Node.
//
// `@fiscal-core` aponta para o núcleo compartilhado que roda nas duas bordas:
// dentro da Edge Function `fiscal-emit` (Deno, que exige a extensão `.ts`
// explícita no import) e no front, só para a prévia da tela. É o mesmo alias
// declarado em vite.config.ts — os dois precisam concordar.
export default defineConfig({
  resolve: {
    alias: {
      "@fiscal-core": fileURLToPath(new URL("./supabase/functions/_shared/fiscal", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // As baterias que falam com o Supabase real (tests/isolation) criam e
    // apagam dados; rodar duas ao mesmo tempo na mesma filial daria falso
    // negativo. Testes puros não se importam.
    fileParallelism: false,
    testTimeout: 30_000,
    setupFiles: ["./tests/setup.ts"],
  },
});
