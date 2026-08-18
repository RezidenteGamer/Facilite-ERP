import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
