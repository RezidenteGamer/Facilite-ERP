# Facilite ERP — contexto permanente para Codex

## Como colaborar

- Comunique-se com o usuário em português do Brasil, de forma objetiva e acessível.
- Antes de alterar funcionalidades, explique brevemente o que será feito e valide o resultado ao concluir.
- Preserve o visual e a identidade existentes, a menos que a solicitação peça uma reformulação.
- Atualize este arquivo quando houver uma decisão relevante, uma mudança de arquitetura ou uma nova etapa importante do projeto.

## Estado atual (13 de agosto de 2026, tarde)

- Este é o front-end do Facilite ERP / SimpleSoft, feito em React + TypeScript + Vite.
- O ambiente já foi preparado neste computador com as dependências instaladas. Para iniciá-lo no Windows, use `npm.cmd run dev` na raiz do projeto.
- A aplicação de desenvolvimento usa `http://localhost:5173`.
- Rotas existentes:
  - `/` — login;
  - `/inicio` — tela inicial após o login;
  - `/clientes-fornecedores` — clientes e fornecedores (piloto do motor genérico, compartilhado entre filiais);
  - `/produtos` — produtos (motor genérico, isolado por filial — ver decisão de multiempresa abaixo);
  - `/permissoes` — administração de papéis e permissões (`can_manage_permissions`);
  - `/usuarios-operadores` — usuários reais, com "Resetar senha" (`can_manage_users`);
  - `/realizar-venda` — vendas;
  - `/configuracoes` — configurações.
- A navegação e a maioria das telas ainda são de front-end (arrays mockados). Não há integração real de vendas.
- Existe agora um projeto Supabase real (`Facilite-ERP`, id `ifmdedruuetbbqjbnrkd`, região sa-east-1), configurado em `.env.local` (não versionado). `src/lib/supabaseClient.ts` usa `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` de lá. Não crie, exponha ou invente credenciais.
- **Autenticação é real** (Supabase Auth, email/senha) — ver decisão de RBAC abaixo. Rotas internas são protegidas por `src/components/ProtectedRoute.tsx`.

### Decisão arquitetural: motor genérico de metadados (13/08/2026)

Decisão do usuário: para viabilizar futuramente um recurso "Faça você mesmo" (usuário final cria seus próprios módulos), **todos** os módulos — inclusive os oficiais — devem ser construídos sobre o mesmo motor dirigido por metadados desde já, em vez de ter uma engine hardcoded para módulos oficiais e outra dinâmica só para os customizados. Módulo piloto: **Clientes e Fornecedores**.

- Metadados de módulo ficam em tabelas Supabase: `modules`, `module_tabs`, `module_fields` (colunas, larguras, obrigatoriedade, onde cada campo aparece — tabela/ficha/formulário).
- Os **dados** de cada módulo oficial ficam em tabela dedicada e tipada (ex.: `contacts`), não em JSONB genérico — módulos oficiais precisam de índices, FKs futuras e constraints, e o catálogo de módulos oficiais cresce devagar (controlado pelo time, não pelo usuário final). Um "Faça você mesmo" futuro pode implementar o mesmo contrato (`ModuleDataRepository<T>` em `src/lib/repositories/types.ts`) sobre uma tabela JSONB genérica, sem mudar a camada de apresentação.
- A engine (`src/features/registry-engine/`) lê a definição do módulo e monta as props dos componentes existentes em `src/components/registry/` (`RegistryTable`, `RegistryActions`, `RegistryDetails`, `RegistryLayout`) — esses componentes **não foram alterados**, continuam 100% dirigidos por props.
- Roteamento e menu (`src/App.tsx`, `src/features/home/modules.ts`) permanecem estáticos por enquanto — só o conteúdo interno da página do módulo passa a vir de metadados. Rotas dinâmicas só fazem sentido quando houver mais de um módulo na engine.
- Plano completo da implementação: ver histórico de conversa / commits relacionados ao módulo Clientes e Fornecedores.

### Decisão arquitetural: autenticação real + permissões granulares (RBAC) (13/08/2026)

Decisão do usuário: quer poder controlar, por usuário, exatamente o que cada um pode fazer em cada módulo (ex.: "cria e edita cliente, mas não exclui"), quem pode mexer nas próprias permissões, e poder resetar a senha de outro usuário. Concluímos que isso deveria ser feito **antes** de mais módulos existirem (retrofit de RLS por módulo é caro), não no fim do projeto.

- **Auth**: Supabase Auth (email/senha). `src/features/auth/AuthContext.tsx` expõe sessão, perfil (`profiles`) e `hasPermission(moduleId, action)`. Login foi migrado de "usuário" (texto livre) para email real (`src/features/auth/LoginForm.tsx`).
- **Schema RBAC**: `roles` (papel + duas flags globais `can_manage_permissions`/`can_manage_users`), `role_permissions` (papel × módulo → `can_view`/`can_create`/`can_edit`/`can_delete`), `profiles` (1:1 com `auth.users`, tem `role_id`). Função `has_permission(module_id, action)` é usada nas policies de RLS de `contacts` (e de qualquer módulo futuro) — a permissão é imposta pelo banco, não só pela UI.
- **Anti-escalação**: trigger `prevent_role_escalation` em `profiles` impede que alguém sem `can_manage_users` troque o próprio `role_id`.
- **Edge Function `admin-users`** (`supabase/functions` não existe localmente — a função foi implantada direto via MCP; código-fonte também não está versionado no repo, só na Supabase). Roda com `service_role`, nunca exposta no front. Duas ações: `create` (cria usuário + perfil) e `reset-password`. Protegida por `can_manage_users`, exceto na primeira chamada (bootstrap) quando `profiles` está vazia.
- Papéis semeados: **Administrador** (acesso total) e **Operador** (ver/criar/editar em Clientes e Fornecedores, sem excluir) — exemplo direto do caso de uso pedido pelo usuário.
- Primeiro admin criado: `brunovenzodebacco@gmail.com` (senha definida pelo usuário na conversa, não documentada aqui).
- Tela `/permissoes` (`src/features/permissions/PermissionsPage.tsx`) mostra a grade papel × módulo com checkboxes, editável por quem tem `can_manage_permissions`. `/usuarios-operadores` foi migrada para dados reais e ganhou "Resetar senha" (chama a Edge Function).
- **Pendência de segurança não crítica**: o advisor do Supabase recomenda habilitar "Leaked Password Protection" (checa senhas vazadas via HaveIBeenPwned) — **só disponível no plano Pro** do Supabase, não dá pra ligar no free tier.
- Advisors de performance (índices faltando em `profiles.role_id`/`role_permissions.module_id`, RLS reavaliando `auth.uid()` por linha, policies permissivas duplicadas em `modules`/`module_tabs`/`module_fields`/`roles`/`role_permissions`/`profiles`) foram todos corrigidos.
- **Fora de escopo por enquanto**: não há ação de excluir usuário (só criar/editar/resetar senha/ativar-desativar); `/usuarios-operadores` e `/permissoes` continuam como telas fixas (não passaram pelo motor genérico de metadados, diferente de Clientes e Fornecedores).

### Decisão arquitetural: multiempresa (filiais) + módulo Produtos (13/08/2026, tarde)

Decisão do usuário: aprofundar módulos é a prioridade (não refinar login), e multiempresa/filiais está no radar em breve — então a camada de filiais nasceu **antes** de replicar o RBAC em mais módulos, para não precisar retrofitar RLS depois. Produtos foi o módulo escolhido para nascer já com isolamento por filial.

- **Filiais são reais agora**: `branches` (código/nome/CNPJ) + `user_branches` (many-to-many usuário×filial). Função `has_branch_access(branch_id)` — igual em espírito a `has_permission()`, mas resolve "essa filial" em vez de "essa ação". RLS de tabelas operacionais combina as duas: `has_permission(...) and has_branch_access(branch_id)`.
- **Clientes e Fornecedores continuam compartilhados entre filiais** (decisão explícita do usuário) — `contacts` não tem `branch_id`. Só dados operacionais (Produtos, e futuramente estoque/vendas/compras) são isolados por filial.
- Nova flag global em `roles`: `can_manage_branches` (cria filiais, vincula usuários a filiais) — mesmo padrão de `can_manage_permissions`/`can_manage_users`. Administrador tem; Operador não.
- `src/features/auth/AuthContext.tsx` carrega as filiais do usuário e a filial ativa (`currentBranchId`, persistida em `localStorage`, chave `facilite:currentBranchId`). `src/components/BranchesModal.tsx` (antes decorativo, listava um mock) agora é o seletor real — troca a filial ativa e persiste.
- **Módulo Produtos** (`src/features/products/`) é o segundo módulo sobre o motor genérico (`modules.id = 'produtos'`), com tabela `products` própria (`branch_id`, preços numéricos de verdade — corrigindo uma inconsistência do mock antigo que tratava preço como string). Repositório/hook seguem o mesmo padrão de `contactsRepository.ts`/`useContactsData.ts`. Ação "Clonar" reaproveita o modal de criação com `initialValues` do produto selecionado.
- Testado e confirmado: dois usuários sem vínculo com a mesma filial não enxergam os produtos um do outro, mesmo tentando ler via console diretamente (RLS bloqueia no banco, não só a UI).
- **Lição aplicada desta vez**: as policies de gerência (`manage X`) já nasceram separadas por `insert`/`update`/`delete` (em vez de `for all`), evitando duplicar a cobertura de `SELECT` que a policy `read X` já dá — rodada anterior gerou avisos de "multiple permissive policies" que precisaram ser corrigidos depois; desta vez não apareceu nenhum.
- **Fora de escopo por enquanto**: upload real de imagem de produto (o campo "Imagem" continua só um placeholder decorativo — ver decisão de foto de contato abaixo, que resolveu isso só para Clientes); tela de administração de filiais (criar/editar filial, vincular usuários a filiais ainda só é feito via SQL — não há UI); demais módulos (compras, vendas, estoque etc.) continuam mock.

### Decisão arquitetural: upload de foto do contato (13/08/2026, noite)

Pedido do usuário: Clientes e Fornecedores não tinha nenhuma forma real de anexar imagem (o campo "Foto" na ficha era só um placeholder decorativo, mesmo já tendo o texto "Ou arraste para cá"). Implementado upload de verdade nos três pontos pedidos: no cadastro, na edição, e arrastando direto na ficha do registro selecionado.

- **Storage**: bucket `contact-photos` no Supabase Storage (público para leitura — URLs de foto não são sensíveis). Caminho dos arquivos: `{contact_id}/{timestamp}.{ext}`. RLS em `storage.objects` usa a mesma `has_permission('clientes-fornecedores', ...)` já existente (insert exige `create` ou `edit`; update/delete exigem `edit`) — mesmo padrão de imposição no banco usado no resto do RBAC.
- **Coluna nova**: `contacts.photo_url` (text, nullable).
- **Componente compartilhado**: `src/features/registry-engine/PhotoDropzone.tsx` — clicável (abre seletor de arquivo) e arrastável (drag-and-drop), sem saber nada de domínio (cliente, produto etc.). Usado em dois lugares:
  - `RegistryDetails` (`src/components/registry/RegistryDetails.tsx`) — o prop `media` ganhou `imageUrl`/`onFileSelected`/`uploading`/`disabled` opcionais; quando `onFileSelected` é passado, a área vira interativa (upload imediato ao soltar/escolher um arquivo para o registro selecionado). Sem esses props, continua sendo o placeholder estático de antes — é assim que Produtos (`ProductsPage.tsx`) permanece decorativo por enquanto.
  - `RegistryFormModal` (`src/features/registry-engine/RegistryFormModal.tsx`) — novo prop opcional `mediaField`, renderizado dentro do modal de criação/edição.
- **Fluxo de criação**: como o contato ainda não existe, o arquivo escolhido fica só em preview local (`URL.createObjectURL`) até o "Salvar" da ficha criar o registro; só então a foto é enviada e o `photo_url` é atualizado com o `id` real. Fluxo de edição/arrastar-para-a-tela: upload imediato, já que o `id` já existe.
- **Débito técnico deliberado**: `src/lib/repositories/contactPhotos.ts` não normaliza/redimensiona a imagem (o Supabase Storage aceita qualquer imagem, sem limite de tamanho aplicado no cliente) — ok para uso interno, mas vale revisar se isso for para produção com usuários externos.

## Pontos de atenção

- A tela inicial usa o layout `original` como padrão em `src/features/home/HomePage.tsx`.
- O repositório contém `legacy-static/` somente como referência do protótipo anterior; a aplicação ativa está em `src/`.
- Há um `.claude/launch.json` legado que apenas define o comando de inicialização do projeto. Ele não é uma fonte de preferências nem de contexto.
- Mantenha mudanças focadas e não altere arquivos não relacionados sem necessidade.
