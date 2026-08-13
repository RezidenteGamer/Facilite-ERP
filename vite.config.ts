import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
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
