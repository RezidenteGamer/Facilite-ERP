# Facilite ERP — contexto permanente para Codex

## Como colaborar

- Comunique-se com o usuário em português do Brasil, de forma objetiva e acessível.
- Antes de alterar funcionalidades, explique brevemente o que será feito e valide o resultado ao concluir.
- Preserve o visual e a identidade existentes, a menos que a solicitação peça uma reformulação.
- Atualize este arquivo quando houver uma decisão relevante, uma mudança de arquitetura ou uma nova etapa importante do projeto.

## Estado atual (11 de agosto de 2026)

- Este é o front-end do Facilite ERP / SimpleSoft, feito em React + TypeScript + Vite.
- O ambiente já foi preparado neste computador com as dependências instaladas. Para iniciá-lo no Windows, use `npm.cmd run dev` na raiz do projeto.
- A aplicação de desenvolvimento usa `http://localhost:5173`.
- Rotas existentes:
  - `/` — login;
  - `/inicio` — tela inicial após o login;
  - `/clientes-fornecedores` — clientes e fornecedores;
  - `/produtos` — produtos;
  - `/realizar-venda` — vendas;
  - `/configuracoes` — configurações.
- A navegação e as telas são de front-end. Ainda não há autenticação, banco de dados nem integração real de vendas.
- O Supabase está apenas preparado em `src/lib/supabaseClient.ts`; as variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` ainda não foram fornecidas. Não crie, exponha ou invente credenciais. Quando elas existirem, use `.env.local` (que não deve ir para o Git).

## Pontos de atenção

- A tela inicial usa o layout `original` como padrão em `src/features/home/HomePage.tsx`.
- O repositório contém `legacy-static/` somente como referência do protótipo anterior; a aplicação ativa está em `src/`.
- Há um `.claude/launch.json` legado que apenas define o comando de inicialização do projeto. Ele não é uma fonte de preferências nem de contexto.
- Mantenha mudanças focadas e não altere arquivos não relacionados sem necessidade.
