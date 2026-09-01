import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Núcleo fiscal compartilhado entre as duas bordas: a Edge Function
      // fiscal-emit (Deno, que importa pelo caminho relativo com .ts explícito)
      // e o front, que o usa só para prévia na tela — nunca para emitir.
      // O mesmo alias existe em vitest.config.ts; os dois precisam concordar.
      '@fiscal-core': fileURLToPath(new URL('./supabase/functions/_shared/fiscal', import.meta.url)),
    },
  },
  build: {
    // O minificador padrão de CSS (lightningcss) está descartando a
    // declaração "backdrop-filter" sem prefixo quando ela convive com
    // "-webkit-backdrop-filter" na mesma regra — funciona local (CSS não
    // minificado no dev server), mas quebra o efeito "glass" no build de
    // produção (ex.: Cloudflare Pages). Este projeto (rolldown-vite) não
    // empacota o esbuild como alternativa de minificador de CSS, então a
    // saída é desativar a minificação de CSS — o ganho de tamanho era
    // pequeno perto do JS mesmo, e gzip/Brotli do Cloudflare já comprime
    // o CSS não minificado quase tão bem.
    cssMinify: false,
    rollupOptions: {
      output: {
        // React/router mudam bem menos que o código do app — em chunk
        // separado, o navegador reaproveita o cache deles entre deploys em
        // vez de rebaixar tudo de novo a cada versão nova do app.
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-router')) {
            return 'vendor'
          }
        },
      },
    },
  },
})
