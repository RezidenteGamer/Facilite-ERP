# Facilite ERP — contexto permanente para Codex

## Como colaborar

- Comunique-se com o usuário em português do Brasil, de forma objetiva e acessível.
- Antes de alterar funcionalidades, explique brevemente o que será feito e valide o resultado ao concluir.
- Preserve o visual e a identidade existentes, a menos que a solicitação peça uma reformulação.
- Atualize este arquivo quando houver uma decisão relevante, uma mudança de arquitetura ou uma nova etapa importante do projeto.

## Como abrir o sistema e testar no navegador

Sempre que for necessário ver o sistema rodando (mudança visual, verificação de fluxo, teste de módulo novo):

1. **Suba o servidor de dev** usando a configuração já existente em `.claude/launch.json` (nome `facilite-login`) — não rode `npm run dev` direto por Bash; use a ferramenta de preview do Claude Code apontando para esse nome.
   - **Pegadinha da porta, que custou uma sessão inteira (etapa 8.5) e foi diagnosticada na etapa 9**: com `autoPort: true`, a ferramenta de preview **reserva** uma porta livre (ex.: 56183) e espera o servidor subir nela — mas `runtimeArgs` é só `["run", "dev"]`, sem `--port`, então o **Vite ignora essa porta** e sobe na dele (5173, ou 5174 se 5173 estiver ocupada por outra sessão). Navegar para a porta que a ferramenta devolveu falha sempre, e o sintoma parece "o Browser pane não alcança servidor local nenhum" — não é. **Leia `preview_logs` logo depois de subir o servidor e navegue para a URL que o Vite imprimiu** (`➜ Local: http://localhost:XXXX/`), não para a porta do retorno de `preview_start`. Foi assim que o teste de navegador da etapa 9 funcionou.
2. **Faça login com a conta de testes**, que já existe no Supabase:
   - Email: `claude.testes@facilite.com`
   - Senha: `claude2026`
3. Depois do login, navegue para a rota que precisa testar.

**Por quê**: a autenticação é real (Supabase Auth) — não existe mais bypass. Toda rota interna (`/produtos`, `/clientes-fornecedores`, `/realizar-venda`, etc.) redireciona para `/` se não houver sessão. Sem logar primeiro com essa conta, nenhuma verificação no navegador funciona.

## Fase do projeto: desenvolvimento (14 de agosto de 2026)

**O sistema ainda não tem uso em produção nem cliente real.** Decisão explícita do usuário: enquanto isso for verdade, **refatorar o banco inteiro é aceitável e não precisa ser negociado**.

O que isso permite, sem pedir permissão a cada vez:

- Migrations destrutivas — `drop`/`recreate` de tabela, renomear colunas, mudar tipo, trocar chave primária.
- Redesenhar schema sem compatibilidade retroativa e sem script de migração de dados.
- Corrigir modelagem errada de raiz em vez de acumular camada por cima. Exemplo pendente: o motor genérico hoje guarda campo numérico como `data_type: 'text'` e converte no submit da página (ver "Roteiro para criar um novo módulo", item 1) — isso é candidato a correção real, não a contorno.
- Revisitar decisões de schema já tomadas (ex.: `contacts` sem `branch_id`) se um módulo novo mostrar que estavam erradas.

O que **não** muda por causa disso:

- **A ordem de implementação entre módulos continua valendo.** Liberdade de refatorar reduz o custo de errar o *schema*, não o custo de errar a *sequência* — construir Financeiro antes de Compras e ter que refazer os dois continua sendo retrabalho de código, que nenhuma migration desfaz.
- RLS continua tendo que nascer correta (é imposição de segurança, não formato de dado).
- Os dados de teste e a conta de testes continuam sendo necessários para verificar de verdade no navegador.

**Quando isso deixa de valer**: no primeiro cliente real ou uso em produção. A partir daí, migration destrutiva volta a exigir conversa e plano de migração. Atualize esta seção quando isso acontecer.

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
  - `/realizar-venda` — vendas (real: grava em `sales`/`sale_items`/`sale_payments` e baixa estoque — ver decisão abaixo);
  - `/ajuste-estoque` — ajuste de estoque (real, motor genérico em modo lote — ver decisão do motor de lote abaixo);
  - `/pedidos-venda`, `/pedidos-venda/novo` e `/pedidos-venda/:id/editar` — pedidos de venda (real: grava em `sale_orders`/`sale_order_items` e converte em venda de verdade via `create_sale` — ver decisão abaixo; a rota de edição reaproveita a mesma tela do "novo", ver a decisão de 27/08/2026);
  - `/financeiro` — contas a pagar/receber (real, motor genérico simples sobre `financial_entries` — ver decisão abaixo);
  - `/compras` e `/compras/nova` — compras (real: grava em `purchases`/`purchase_items`, sobe estoque e lança financeiro a pagar via `create_purchase` — ver decisão abaixo);
  - `/controle-caixa` — controle de caixa (real: sessão de caixa e sangria/suprimento sobre `cash_registers`/`cash_sessions`/`cash_movements`, lê vendas em dinheiro de `financial_entries` sem escrever nela — ver decisão abaixo);
  - `/ponto-de-venda` — PDV (real: exige sessão de caixa aberta e grava a venda via `create_pos_sale`, que reaproveita `create_sale` — ver decisão abaixo);
  - `/tributacoes` — regras de **CFOP** por natureza da operação × UF origem/destino × tipo de cliente × regime (real: motor genérico puro sobre `tax_rules`, sem componente próprio — ver decisão abaixo e a correção de 19/08/2026);
  - `/grupos-tributarios` — grupos tributários (CST/CSOSN + alíquotas), o perfil de tributação que se atrela ao produto (real: motor genérico puro sobre `tax_groups`, sem componente próprio — ver a correção de 19/08/2026);
  - `/devolucao-venda` — devolução de venda (real: grava em `sale_returns`/`sale_return_items` via `create_sale_return`, repõe estoque, gera um `a_pagar` novo no Financeiro e oferece as duas ações fiscais — ver decisão abaixo);
  - `/modulos` — construtor de módulos: cria um módulo (rota, tile, campos, CRUD) sem deploy, edita os campos de módulos que já rodam no motor genérico, e configura o **workflow** deles (situações, transições e ações automáticas). **Ferramenta interna da Facilite, não recurso do cliente**: desde 28/08/2026 o portão de entrada é `profiles.is_facilite_developer` (flag de pessoa, ligada só por SQL), não mais a flag de papel `can_manage_modules` — ver a decisão de produto no fim deste arquivo, além das decisões de M3 e M4 abaixo. O `access_gate` da linha continua sendo `manage_modules` (o nome diz o que o portão protege; quem passa por ele é que mudou);
  - `/condicionais` e `/condicionais/nova` — condicionais: peças enviadas ao cliente para experimentar em casa (real: grava em `conditionals`/`conditional_items` via `create_conditional`, que já baixa estoque na hora; devolução e conversão em venda resolvem o saldo aos poucos por item — ver decisão abaixo);
  - `/relatorios` — relatórios: grade de 12 blocos, cada um com filtro + tabela + resumo, lendo de views/tabelas de outros módulos, sem escrever nada (real: tela própria sobre views com `security_invoker` — ver decisão abaixo);
  - `/configuracoes` — configurações.
- **As rotas acima não são mais escritas à mão**: desde 18/08/2026 elas vêm do catálogo na tabela `modules` (só `/` e `/inicio` continuam declaradas em `src/App.tsx`). Um módulo novo passa a existir inserindo uma linha nessa tabela — e, se não tiver componente próprio registrado, abre pelo motor genérico assim mesmo. Ver a decisão "catálogo de módulos no banco + roteador dirigido por metadados" abaixo.
- A navegação e a maioria das telas ainda são de front-end (arrays mockados) — exceção feita a Clientes/Fornecedores, Produtos, Realizar Venda, Ajuste de estoque, Pedidos de venda, Financeiro, Compras, Controle de caixa, Ponto de venda, Tributações, Grupos tributários, Notas Emitidas, Devolução de venda, Condicionais e Relatórios, que já são reais.
- Existe agora um projeto Supabase real (`Facilite-ERP`, id `ifmdedruuetbbqjbnrkd`, região sa-east-1), configurado em `.env.local` (não versionado). `src/lib/supabaseClient.ts` usa `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` de lá. Não crie, exponha ou invente credenciais.
- **Autenticação é real** (Supabase Auth, email/senha) — ver decisão de RBAC abaixo. Rotas internas são protegidas por `src/components/ProtectedRoute.tsx`.

### Decisão arquitetural: motor genérico de metadados (13/08/2026)

Decisão do usuário: para viabilizar futuramente um recurso "Faça você mesmo" (usuário final cria seus próprios módulos), **todos** os módulos — inclusive os oficiais — devem ser construídos sobre o mesmo motor dirigido por metadados desde já, em vez de ter uma engine hardcoded para módulos oficiais e outra dinâmica só para os customizados. Módulo piloto: **Clientes e Fornecedores**.

- Metadados de módulo ficam em tabelas Supabase: `modules`, `module_tabs`, `module_fields` (colunas, larguras, obrigatoriedade, onde cada campo aparece — tabela/ficha/formulário).
- Os **dados** de cada módulo oficial ficam em tabela dedicada e tipada (ex.: `contacts`), não em JSONB genérico — módulos oficiais precisam de índices, FKs futuras e constraints, e o catálogo de módulos oficiais cresce devagar (controlado pelo time, não pelo usuário final). Um "Faça você mesmo" futuro pode implementar o mesmo contrato (`ModuleDataRepository<T>` em `src/lib/repositories/types.ts`) sobre uma tabela JSONB genérica, sem mudar a camada de apresentação.
- A engine (`src/features/registry-engine/`) lê a definição do módulo e monta as props dos componentes existentes em `src/components/registry/` (`RegistryTable`, `RegistryActions`, `RegistryDetails`, `RegistryLayout`) — esses componentes **não foram alterados**, continuam 100% dirigidos por props.
- ~~Roteamento e menu (`src/App.tsx`, `src/features/home/modules.ts`) permanecem estáticos por enquanto — só o conteúdo interno da página do módulo passa a vir de metadados. Rotas dinâmicas só fazem sentido quando houver mais de um módulo na engine.~~ — **superado em 18/08/2026**: a condição ("mais de um módulo na engine") se cumpriu com folga, e roteamento, tela inicial e dock passaram a vir do catálogo no banco. Ver a decisão "catálogo de módulos no banco + roteador dirigido por metadados" abaixo.
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
- **Fora de escopo por enquanto**: tela de administração de filiais (criar/editar filial, vincular usuários a filiais ainda só é feito via SQL — não há UI); demais módulos (compras, vendas, estoque etc.) continuam mock. Upload de imagem de produto foi resolvido em 25/08/2026 — ver decisão no fim do arquivo.

### Decisão arquitetural: upload de foto do contato (13/08/2026, noite)

Pedido do usuário: Clientes e Fornecedores não tinha nenhuma forma real de anexar imagem (o campo "Foto" na ficha era só um placeholder decorativo, mesmo já tendo o texto "Ou arraste para cá"). Implementado upload de verdade nos três pontos pedidos: no cadastro, na edição, e arrastando direto na ficha do registro selecionado.

- **Storage**: bucket `contact-photos` no Supabase Storage (público para leitura — URLs de foto não são sensíveis). Caminho dos arquivos: `{contact_id}/{timestamp}.{ext}`. RLS em `storage.objects` usa a mesma `has_permission('clientes-fornecedores', ...)` já existente (insert exige `create` ou `edit`; update/delete exigem `edit`) — mesmo padrão de imposição no banco usado no resto do RBAC.
- **Coluna nova**: `contacts.photo_url` (text, nullable).
- **Componente compartilhado**: `src/features/registry-engine/PhotoDropzone.tsx` — clicável (abre seletor de arquivo) e arrastável (drag-and-drop), sem saber nada de domínio (cliente, produto etc.). Usado em dois lugares:
  - `RegistryDetails` (`src/components/registry/RegistryDetails.tsx`) — o prop `media` ganhou `imageUrl`/`onFileSelected`/`uploading`/`disabled` opcionais; quando `onFileSelected` é passado, a área vira interativa (upload imediato ao soltar/escolher um arquivo para o registro selecionado). Sem esses props, continua sendo o placeholder estático de antes — é assim que Produtos (`ProductsPage.tsx`) permanece decorativo por enquanto.
  - `RegistryFormModal` (`src/features/registry-engine/RegistryFormModal.tsx`) — novo prop opcional `mediaField`, renderizado dentro do modal de criação/edição.
- **Fluxo de criação**: como o contato ainda não existe, o arquivo escolhido fica só em preview local (`URL.createObjectURL`) até o "Salvar" da ficha criar o registro; só então a foto é enviada e o `photo_url` é atualizado com o `id` real. Fluxo de edição/arrastar-para-a-tela: upload imediato, já que o `id` já existe.
- **Débito técnico deliberado**: `src/lib/repositories/contactPhotos.ts` não normaliza/redimensiona a imagem (o Supabase Storage aceita qualquer imagem, sem limite de tamanho aplicado no cliente) — ok para uso interno, mas vale revisar se isso for para produção com usuários externos.

### Decisão arquitetural: módulo Realizar Venda (13/08/2026, noite)

Primeiro módulo transacional real do sistema (cabeçalho + itens + pagamentos), diferente de Clientes/Fornecedores e Produtos (que são CRUD simples sobre o motor genérico de metadados).

- **Não usa o motor genérico** (`module_fields`/`module_tabs`): a tela (`src/features/sales/SalePage.tsx`) é feita à mão, como o Ponto de Venda, porque o formato (formulário de cabeçalho → carrinho de itens → split de pagamentos → totais) não é um CRUD de lista+ficha. Mesmo assim, precisa de uma linha em `modules` (`realizar-venda`) só para aparecer na grade de `/permissoes` — sem isso `has_permission('realizar-venda', ...)` nunca encontra nada e ninguém acessa a tela, nem o Administrador. **Depois de criar um módulo assim, é preciso ir em `/permissoes` e marcar manualmente `can_view`/`can_create` para os papéis que devem usá-lo** — isso não é automático.
- **Tabelas**: `sales` (cabeçalho, `branch_id` — dado operacional, isolado por filial), `sale_items` e `sale_payments` (sem `branch_id` próprio, herdam a filial via `sale_id`; RLS de leitura usa `exists (select 1 from sales where ...)`).
- **Gravação atômica via função RPC** (`create_sale`, `security definer`): a venda inteira (cabeçalho + itens + pagamentos + baixa de estoque em `products.stock`) é criada numa única chamada, porque o cliente não tem transação multi-tabela nativa e a baixa de estoque não pode ficar inconsistente com os itens vendidos. A função valida permissão (`has_permission`) e filial (`has_branch_access`) manualmente logo no início — só depois disso é que ela pode "confiar" em rodar com privilégio elevado (senão qualquer usuário autenticado decrementaria estoque de qualquer filial). Por isso não há policy de `insert` em `sale_items`/`sale_payments`: só a função grava, nunca o cliente direto.
- **Split de pagamento**: uma venda pode ter N linhas em `sale_payments` (ex.: metade PIX, metade dinheiro) — decisão do usuário. A função recusa a venda se a soma dos pagamentos não bater com o total (itens + frete − desconto).
- **Campos sem cadastro próprio**: Tipo de operação, Departamento e Centro de custos ficam como texto livre em `sales` — não existe (ainda) um módulo de cadastro para eles, e criar três módulos novos só para isso ficou fora do escopo desta rodada. Se um dia isso incomodar, é candidato a virar cadastro de verdade (com FK), não um problema a esconder.
- **Endereço / Endereço de entrega**: texto livre, snapshot copiado do cadastro do cliente (`contacts.address`) no momento em que o cliente é selecionado — não é FK, de propósito: a venda não deve mudar retroativamente se o cadastro do cliente for editado depois.
- **Componente novo reutilizável**: `src/components/form/LookupModal.tsx` — modal de busca genérico (usado por Cliente, Vendedor e Produto nesta tela); qualquer campo `lookup` de telas futuras (pedido, compra, devolução) pode reaproveitar.
- **Cuidado ao tratar erro de RPC no front**: erros do supabase-js (`PostgrestError`, inclusive os de dentro da função `create_sale`) são objetos simples, não instâncias de `Error` — checar só `err instanceof Error` engole a mensagem real e mostra um erro genérico. `useSaleDraft.ts` tem um `extractErrorMessage` que também olha `err.message` diretamente; replicar esse padrão em qualquer tela nova que chame RPC.
- **Fora de escopo por enquanto**: não há tela de listagem/consulta de vendas feitas (ver `/pedidos-venda`, ainda mock); não há edição/cancelamento de venda confirmada (`sales.status` só sai de `confirmed` manualmente por enquanto); não há rascunho (a venda é criada já confirmada, de uma vez).
- **UX revisada (13/08/2026, mais tarde)**: a primeira versão em 2 etapas ("Continuar" só depois de preencher 9 campos de cabeçalho pra então liberar o carrinho) ficou pouco intuitiva — o usuário não enxergava como "vender" de fato. Virou tela única: buscar/adicionar produto é a ação em destaque desde o início (não fica atrás de nenhum gate), Cliente/Vendedor ficam visíveis mas só são cobrados na hora de confirmar, e Tipo de operação/Departamento/Centro de custos/Endereços foram para uma seção "Detalhes da operação" recolhida por padrão. Lição: campos opcionais não devem competir visualmente com a ação principal da tela, e a ação principal não deveria depender de um botão "Continuar" só para aparecer.
- **Seleção de produto por arrastar (13/08/2026, noite)**: pedido do usuário para deixar a tela "como realizar uma venda de verdade" — produtos numa lista à esquerda (clicável e arrastável), soltando sobre o card da venda à direita; lápis ao lado de cada produto (só com permissão de editar Produtos) abre o mesmo modal de edição do módulo Produtos, sem duplicar formulário. Virou componente reutilizável: `src/components/product-picker/ProductPickerPanel.tsx` (lista + busca + clique-para-adicionar + lápis) — quem usa entra num `DndContext` e lê `event.active.data.current.product` no `onDragEnd` para tratar o drop (o painel não sabe nada sobre "onde" o produto vai cair, só disponibiliza o item pra arrastar, via `PRODUCT_PICKER_DRAG_PREFIX` no id do draggable).
  - **Pegadinha real do dnd-kit que custou tempo depurando**: `useDroppable`/`useDraggable` só enxergam o `DndContext` mais próximo **na árvore de componentes acima deles** — chamar `useDroppable` no mesmo componente que declara `<DndContext>...</DndContext>` não funciona (nesse ponto do render o Provider ainda não existe do ponto de vista de hooks daquele componente). A área de soltar da venda precisou virar um componente filho à parte (`CartDropzone` dentro de `SalePage.tsx`) só para poder chamar `useDroppable` de dentro do `DndContext`.
  - **Segunda pegadinha**: os `sensors` passados pro `DndContext` (`useSensors(useSensor(...))`) precisam ter identidade estável entre renders — um objeto de opções literal (`{ activationConstraint: { distance: 6 } }`) criado inline no corpo do componente é recriado a cada render, e o próprio `handleDragStart` já causa um re-render (`setState` pra mostrar o `DragOverlay`) **no meio do drag**, o que reinicia os sensores e cancela o drag em andamento. Solução: o objeto de opções do sensor mora fora do componente, em uma constante do módulo.

### Decisão arquitetural: campos fiscais para Tributações/NF-e/NFC-e — etapa 0 (14/08/2026)

Primeira etapa de um plano maior para viabilizar emissão fiscal (NF-e/NFC-e) e o módulo Tributações. Esta etapa só prepara dado — nenhuma lógica de cálculo de imposto, seleção de CFOP ou emissão foi implementada.

- **Produtos** (`products`) ganhou tratamento completo (schema + UI, via `module_fields`): `cest`, `origem_mercadoria`, `unidade_comercial`, `unidade_tributavel`, `cst_ipi`, `cst_pis`, `cst_cofins`, `cst_ibs_cbs` (Reforma Tributária, NT 2025.002-RTC), `cclasstrib`. `ncm` já existia. Para ICMS, **os dois campos convivem**: `cst_icms` e `csosn`, ambos opcionais — decisão do usuário, porque Produtos já é isolado por filial (`branch_id`) e o regime tributário é decidido por filial (`branches.regime_tributario`, ver abaixo), não por produto; um mesmo cadastro de produto pode em tese ser usado por filiais em regimes diferentes, então guardar só um dos dois exigiria migração futura.
- **Clientes e Fornecedores** (`contacts`) ganhou `inscricao_estadual`, `indicador_ie`, `codigo_ibge_municipio` (schema + UI). `document` (CPF/CNPJ) já existia — **não foi adicionada validação de formato**: o motor genérico não tem tipo de dado com validação de formato hoje (`data_type` só distingue `text`/`date`/`phone`/`email` para o `<input>`, sem regex/máscara), e nenhum módulo existente valida CPF/CNPJ. Estender o motor para isso é maior que o escopo desta etapa — documentado aqui como pendência, não escondido.
- **Filiais** (`branches`) ganhou **só schema, sem UI** (decisão já registrada: administração de filial é só SQL por enquanto): `inscricao_estadual`, `regime_tributario` (texto livre guardando o código CRT: 1 = Simples Nacional, 2 = Simples com excesso de sublimite, 3 = Regime Normal — sem enum/constraint por ora), `cnae`, `address`, `codigo_ibge_municipio`, `certificado_digital_ref` (placeholder de referência ao certificado digital — sem upload nem lógica de certificado, isso é de uma etapa de ativação fiscal futura). `cnpj` já existia.
- **Realizar Venda** (`sales`/`sale_items`) ganhou **só schema, sem UI**: `sale_items.cfop` (por item) e, em `sales`, totais quebrados por imposto — `icms_total`, `ipi_total`, `pis_total`, `cofins_total`, `ibs_total`, `cbs_total` — todos `numeric` nuláveis. **Nada disso aparece na tela `SalePage.tsx` ainda** (não usa o motor genérico, é tela feita à mão — ver decisão de Realizar Venda) nem é preenchido pela função `create_sale`. Isso é trabalho pendente para quando o módulo Tributações/CFOP for implementado.
- Todos os campos novos são `text` (mesmo os que são código/enum, como origem da mercadoria 0-8 ou os CSTs) — mesma convenção já documentada no roteiro item 1: a engine trata tudo como texto, sem conversão de tipo.
- Nenhuma policy de RLS nova foi necessária — as quatro tabelas já tinham policies de `select`/`insert`/`update`/`delete` cobrindo a tabela inteira; colunas novas nuláveis não mudam a superfície de acesso.

### Decisão arquitetural: motor de lote (`layout_variant: 'batch'`) + módulo Ajuste de estoque (17/08/2026)

Extensão do motor genérico de metadados, no mesmo peso da decisão original dele. Até aqui o motor só sabia montar **lista + ficha + formulário de um registro por vez** (`RegistryFormModal`). Faltava a capacidade de "acumular N itens e confirmar tudo numa escrita atômica" — necessária para loja lançando uma lista de contagem física de uma vez. Ajuste de estoque é o módulo-piloto que exercita a capacidade de verdade (decisão só no papel não conta).

**Houve uma tentativa anterior deste módulo como tela feita à mão** (modal de um produto por vez, RPC `adjust_stock` de um item só, commit `35a1f32`). Foi descartada por inteiro nesta rodada — a tela à mão não deixava nada reaproveitável para Compras/Devolução, que é o ponto.

#### O que foi generalizado (mora no motor)

- **`layout_variant: 'batch'`** em `modules` / `ModuleDefinition.layoutVariant` (`src/features/registry-engine/types.ts`). Não há CHECK constraint na coluna — o valor novo é só convenção + tipo TS.
- **`RegistryBatchFormModal`** (`src/features/registry-engine/RegistryBatchFormModal.tsx`): genérico sobre `ModuleFieldDefinition[]`. Mantém uma lista de linhas pendentes, cada linha um `Record<string, string>` — **exatamente o mesmo formato de `values` do `RegistryFormModal`** —, renderiza os campos de cada linha via `buildFormFields` (reaproveitado, não duplicado), cobre `isRequired` sozinho, e tem um botão único que confirma o lote inteiro.
- **Onde fica a fronteira do genérico**: a escolha de *qual item* cada linha representa **não** está dentro do componente. Ele recebe `renderItemPicker: (onPick) => ReactNode` e conhece o item só como `BatchItem` (`id`, `label`, `hint?`). Quem monta o seletor é o módulo — Ajuste de estoque passa `ProductPickerPanel`; Compras/Devolução passarão o seu. Se o componente do motor soubesse procurar produto, ele não seria genérico, seria `StockAdjustModal` disfarçado.
- **Arrastar o item para a lista também é do motor**: o `RegistryBatchFormModal` fornece o `DndContext`, a área de soltar (`BatchDropzone`, componente filho — `useDroppable` não funciona no mesmo componente que declara o contexto) e o `DragOverlay`. Ele continua sem saber o que está sendo arrastado: quem consome passa `resolveDraggedItem(dragData)`, que recebe `event.active.data.current` e devolve um `BatchItem` (ou `null` para ignorar o drop). Sem essa prop, a lista só aceita clique. O `DndContext` precisa estar **acima do seletor e da lista ao mesmo tempo** — por isso subiu para o motor e saiu da página do módulo.
  - **Pegadinha do dnd-kit que custou depuração**: a colisão padrão (`rectIntersection`) dava `isOver = true` com o cursor longe da lista quando existe um único droppable — o item entrava ao soltar em qualquer lugar da tela. Solução: `collisionDetection={pointerWithin}`, que só considera o alvo se o **ponteiro** estiver dentro dele. Para telas com um alvo só, `pointerWithin` é o padrão certo, não o `rectIntersection`.
  - **Segunda pegadinha, mais séria (reportada pelo usuário: "o produto fica deslocado para o canto direito em vez de seguir o cursor")**: nesta versão do `@dnd-kit/core` (6.x), `<DragOverlay>` **não** se porta sozinho para `document.body` — ele renderiza `position: fixed` no lugar onde foi declarado na árvore React/DOM. Qualquer modal do sistema tem `backdrop-filter` no `Dialog.Content` (acrílico), e `backdrop-filter` cria um *containing block* novo para `position: fixed` — mesma categoria de `transform`/`filter`/`perspective`. Sem tratamento, o fantasma do arraste fica posicionado relativo ao **modal**, não à viewport: a coordenada calculada pelo dnd-kit (viewport-relativa) é reaplicada como se fosse relativa ao canto do modal, somando o próprio deslocamento do modal na tela — quanto mais o modal estiver deslocado do canto superior esquerdo, maior o erro visual. Diagnosticado lendo o código-fonte instalado (`node_modules/@dnd-kit/core/dist/core.esm.js`, função `DragOverlay`) em vez de supor. **Correção**: envolver o `<DragOverlay>` num `createPortal(..., document.body)` explícito, escapando o `backdrop-filter` do modal — o contexto React (`useDndContext`) continua funcionando normalmente através do portal. Verificado por eventos de ponteiro reais: soltando em `(x, y)` com deslocamento de garra `(dx, dy)` a partir do canto do item, o fantasma aparece exatamente em `(x−dx, y−dy)`, sem erro. Realizar Venda nunca teve esse bug porque seu `DragOverlay` não vive dentro de nenhum ancestral com `backdrop-filter`/`transform`/`filter` — **qualquer novo módulo que arraste dentro de um modal acrílico precisa do mesmo portal explícito**.
- Validação além de `isRequired` também entra por prop (`validateRow`), pelo mesmo motivo: "delta ou saldo contado, nunca os dois" é regra de estoque, não do motor.
- Duplicata do mesmo item no lote é recusada pelo componente, tanto por clique quanto por arraste (quase sempre é repetição, não intenção); o item é identificado por `BatchItem.id`.

#### O que continua específico de cada módulo (de propósito)

- **A escrita atômica é uma RPC Postgres por módulo** (`adjust_stock_batch`), não um "executor de escrita genérico" no banco. O motor generaliza a UI e os metadados de campo; a transação em si é regra de negócio (o que validar, em que ordem, o que trava) e uma função dedicada por módulo é melhor do que qualquer executor genérico. **Não tente generalizar isso.**
- **Contrato de repositório**: `ModuleBatchRepository<TRow, TBatchItem>` (`src/lib/repositories/types.ts`) — só `list` + `createBatch`. É contrato **irmão** de `ModuleDataRepository`, não uma extensão: módulo de lote é registro de auditoria, não existe "editar o ajuste 3" nem "excluir o ajuste 3". Encaixar `create`/`update`/`remove` só para reaproveitar a mesma interface daria três métodos que lançam erro — pior que um contrato menor e honesto. `createBatch` não devolve as linhas criadas porque a RPC é transacional e quem consome recarrega a lista.

#### Módulo Ajuste de estoque (piloto)

- **A listagem/ficha rodam pelo motor de verdade** (`useModuleDefinition` + `buildTableColumns`/`buildDetailFields`), igual a Produtos — não há coluna hardcoded. Só a criação usa o componente de lote. Como todo módulo, precisa da linha em `modules` para aparecer em `/permissoes`; **depois da migration é preciso marcar `can_view`/`can_create` manualmente** (feito para Administrador; Operador segue sem acesso, decisão pendente do usuário).
- **Tabela**: `stock_adjustments` (`branch_id`, `product_id`, `change` — delta, pode ser negativo —, `reason`, `balance_after`, `created_at`, `created_by`). Dado operacional, isolado por filial.
- **`module_fields`**: campos de entrada por linha (`change`, `counted_balance`, `reason`) com `show_in_form = true`; campos de leitura (`product_code`, `product_description`, `balance_after`, `created_at`, `operator_name`, `product_current_stock`, `product_cost_price`, `product_location`, `product_sub_location`) com `show_in_table`/`show_in_details`. **`counted_balance` não é coluna de `stock_adjustments`** — é só entrada de formulário, convertida em delta dentro da RPC; `module_fields` descreve a *tela*, não obrigatoriamente a tabela.
- **`reason` (Motivo) não é obrigatório** (mudado de `is_required = true` para `false` — decisão do usuário, 17/08/2026). A mudança é só o metadado: `RegistryBatchFormModal` cobre `isRequired` genericamente lendo `module_fields`, então mudar essa flag no banco já basta para tirar o asterisco e a validação — **nenhum código mudou**. Essa é a razão de existir a flag como metadado em vez de hardcoded no componente: obrigatoriedade de campo é decisão de negócio, ajustável sem deploy. A RPC `adjust_stock_batch` foi atualizada em conjunto para não recusar mais motivo vazio (antes rejeitava com `22023` independente do que a UI exigia) — sem isso a UI aceitaria o envio e a RPC devolveria erro mesmo assim. Motivo vazio grava `reason = ''` (a coluna continua `NOT NULL`, string vazia é um valor válido).
- **RPC `adjust_stock_batch(p_branch_id uuid, p_items jsonb)`, `security definer`**: valida `has_permission('ajuste-estoque', 'create')` e `has_branch_access(p_branch_id)` **uma vez para o lote inteiro, antes de qualquer escrita** (a função roda com privilégio elevado e não pode confiar em quem a chama — mesmo raciocínio de `create_sale`); depois, por item, trava o produto com `select ... for update`, aplica `stock = stock + delta` e insere a auditoria. `revoke execute ... from anon` explícito. Sem policy de `insert`/`update` em `stock_adjustments` para o cliente direto — só a função grava; RLS de `select` normal (`has_permission` + `has_branch_access`).
- **Dois jeitos de informar a quantidade**: delta (+10/−5) **ou** saldo contado. Quando é saldo contado, o delta é calculado a partir do `stock` lido **dentro da transação** (`v_counted - v_stock`), nunca de um valor que a tela carregou antes — outra operação pode ter mudado o estoque nesse meio-tempo. Consequência de design: **delta 0 é erro** (digitação), mas **saldo contado que bate com o sistema grava uma linha com `change = 0`** — "contei e conferiu" é um fato auditável, não um não-evento.
- **Sem exclusão/estorno**: apagar um registro de auditoria não desfaz a alteração de estoque que ele representa. O conserto de um ajuste errado é um **novo ajuste inverso**. O botão "Excluir" não existe na tela, em vez de existir desabilitado.
- **Dois jeitos de pôr o produto no lote**: clicar na linha do `ProductPickerPanel` ou arrastá-la para a lista à direita. Os dois passam pelo mesmo `toBatchItem(product)` em `StockAdjustPage.tsx`, de propósito — se divergirem, o mesmo produto entra diferente dependendo do gesto.
- **Pegadinha do dnd-kit que vale para qualquer consumidor do `ProductPickerPanel`**: o painel chama `useDraggable` internamente, então quem o usa precisa de um `DndContext` **com `activationConstraint: { distance: 6 }`** acima dele, mesmo que a tela não tenha nenhum "drop" de verdade — sem isso o dnd-kit intercepta o clique simples como início de arraste e o `onAddProduct` nunca dispara. E o objeto de opções do sensor mora fora do componente (identidade estável), como já documentado em Realizar Venda.
- `ProductPickerPanel` ganhou prop opcional `hint` porque a frase de instrução muda com o destino ("à venda" × "ao lote de ajuste"); o padrão continua o de Realizar Venda, então o call site do wizard não mudou.
- **Testado no navegador**: lote de 3 produtos misturando delta (+12, −3) e saldo contado (55 a partir de 60 → delta −5) confirmado de uma vez — `products.stock` e a listagem batem, e os 3 registros compartilham o mesmo `created_at` ao microssegundo (uma transação só). Também verificados: rollback do lote inteiro quando um item falha (estoque negativo) sem deixar linha órfã, mensagem de erro da RPC chegando na tela, recusa de duplicata, as duas validações de quantidade, contagem sem diferença gravando `change = 0`, e botão desabilitado sem `can_create`. Produtos, Clientes e Fornecedores e Permissões conferidos sem regressão.
- **Testado o arrastar** (eventos de ponteiro reais, exercitando o sensor do dnd-kit): soltar dentro da lista realça a área e adiciona; soltar fora não realça nem adiciona; arrastar duplicata é recusado; clique continua funcionando junto do arraste; e um lote montado metade por arraste, metade por clique gravou numa transação só.
- **Fora de escopo por enquanto**: teste de isolamento entre duas filiais não foi refeito manualmente (mesma `has_branch_access` já validada em Produtos/Realizar Venda); "Local"/"Sub-local" na ficha vêm do cadastro do produto (não existe local por ajuste); Compras/Devolução ainda não consomem o motor de lote.

### Decisão arquitetural: módulo Pedidos de venda (17/08/2026)

Pedido é a etapa que antecede a venda confirmada (orçamento → pedido → venda). Estruturalmente é o **mesmo formato de Realizar Venda** (cabeçalho + itens aninhados, um registro só), não o do motor de lote (`RegistryBatchFormModal`) — pedido não é uma lista de lançamentos independentes, é um registro com itens dentro, igual venda. Espelha `SalePage.tsx`/`useSaleDraft.ts`, não `StockAdjustPage.tsx`.

- **Não usa o motor genérico**, pelo mesmo motivo de Realizar Venda: a tela (`src/features/sales/SaleOrderFormPage.tsx`) é feita à mão. Precisa da linha em `modules` (`pedidos-venda`) para aparecer em `/permissoes` — sem isso `has_permission('pedidos-venda', ...)` nunca encontra nada. **Depois da migration foi preciso marcar `can_view`/`can_create` manualmente** (feito para Administrador; Operador segue sem acesso, mesma pendência já registrada em Ajuste de estoque).
- **Tabelas**: `sale_orders` (cabeçalho, `branch_id` — dado operacional) e `sale_order_items` (sem `branch_id` próprio, herda via `sale_order_id`; RLS de leitura usa `exists (select 1 from sale_orders where ...)` — mesmo padrão de `sales`/`sale_items`). `sale_orders.status` é `aberto`/`convertido`/`cancelado` (`cancelado` reservado para uma etapa futura — não há ação de cancelar pedido nesta rodada).
- **Pedido não baixa estoque** — só reserva no papel, por instrução explícita do usuário ao pedir o módulo (reserva de estoque no momento do pedido ficou marcada como decisão de negócio a não implementar sem confirmação, e a confirmação foi "não"). O estoque só sai de verdade na conversão em venda.
- **RPC `create_sale_order(payload jsonb)`, `security definer`**: mesmo padrão de `create_sale` — valida `has_permission('pedidos-venda', 'create')` e `has_branch_access` antes de qualquer escrita, grava cabeçalho + itens numa transação, numeração de código própria (`sale_orders.code`, sequência separada da de `sales`). Diferente de `create_sale`: não trava (`for update`) nem decrementa `products.stock`, e não grava `sale_payments` — o pedido guarda só `payment_method`/`installments` como campos do próprio cabeçalho (é a forma de pagamento *pretendida*, não um split de pagamento real; `useSaleDraft.ts` na época já tinha migrado para split em N linhas, mas isso é regra da venda confirmada, não do pedido).
- **Conversão em venda**: RPC `convert_sale_order_to_sale(p_sale_order_id uuid)`, `security definer`. Valida permissão/filial/`status = 'aberto'`, monta o mesmo formato de `payload` que `create_sale` já espera (itens do pedido + um pagamento único com `payment_method`/`installments`/total do pedido) e **chama `create_sale` internamente** — não duplica a lógica de baixa de estoque, numeração de venda nem validação de produto/filial, só traduz o formato. Depois marca `sale_orders.status = 'convertido'` e `converted_sale_id`. Como `create_sale` roda com o mesmo `auth.uid()` de quem chamou (SECURITY DEFINER não muda `auth.uid()`), converter também exige `has_permission('realizar-venda', 'create')` de fato — documentado aqui para não ser surpresa numa sessão futura.
- **Grants**: `revoke execute ... from public` (não só `from anon`) nas duas funções novas — `from anon` sozinho não bastou; o advisor de segurança acusou `anon_security_definer_function_executable` até revogar de `public` também, porque `anon`/`authenticated` herdam de `PUBLIC` por padrão no Postgres. Vale para qualquer função nova daqui pra frente, não só esta.
- **Ação "Converter em venda"** foi adicionada à tela de listagem (`SaleOrdersPage.tsx`), com `ConfirmDialog` antes de confirmar — não existia no mock antigo (`SALE_ORDERS` hardcoded, ações "Gerar NF"/"Pré visualizar"/"Trocar"/"Financeiro"/"Editar"/"Excluir", nenhuma com `onClick`). Fica desabilitada quando o pedido não está `aberto`. "Gerar NF"/"Pré visualizar"/"Trocar"/"Financeiro"/"Editar"/"Excluir" continuam sem função — são de etapas mais adiante do plano (Notas Emitidas, Devolução, Financeiro) ou fora de escopo (não há edição/exclusão de pedido nesta rodada, mesma decisão de "sem exclusão" de Ajuste de estoque, mas por falta de escopo aqui, não por ser registro de auditoria).
- **Ficha do pedido selecionado** usa o prop `fields` de `RegistryActions` (ficha resumida sem caixa, já usado em outros módulos), não `RegistryDetails` — mais simples e já suficiente para "ver ficha" sem puxar o motor genérico.
- **Testado no navegador**: criado um pedido com 2 produtos (Doritos + Arroz, R$ 43,90), confirmado que aparece na listagem com cliente/forma de pagamento/parcelas/total corretos, convertido em venda (venda 0004 criada, `sale_orders.status` virou `convertido` com `converted_sale_id` preenchido) e confirmado que `products.stock` só baixou na conversão, não na criação do pedido. "Converter em venda" confirmado desabilitado depois de convertido.
- **Fora de escopo por enquanto**: cancelamento de pedido (`status = 'cancelado'` existe no enum mas nada escreve nele ainda); ~~edição de pedido em aberto~~ — **feita em 27/08/2026**, ver a decisão "editar pedido de venda" abaixo; reserva de estoque no momento do pedido (fora de escopo por instrução explícita do usuário — ver acima).

### Decisão arquitetural: pré-visualização de Pedidos de venda (27/08/2026)

Primeira de três rodadas para "ver/editar pedidos": esta constrói só a visualização somente-leitura, base para as próximas duas (editar/trocar via RPC nova, e o layout de impressão/orçamento).

- **`listSaleOrders` nunca fez join com os itens** — a ficha lateral (`fields` de `RegistryActions`, decisão acima) mostra só o cabeçalho. O botão "Pré visualizar" precisa dos itens, então ganhou uma busca própria em vez de esticar `listSaleOrders` para todo mundo carregar itens que a listagem não usa.
- **`fetchSaleOrderWithItems(id)`** (`saleOrdersRepository.ts`) faz o join com `sale_order_items` + `products(code, description)`, mesmo padrão de `fetchReturnableSaleDetail` em `saleReturnsRepository.ts` (que já faz o mesmo tipo de leitura para `sales`/`sale_items`).
- **`SaleOrderPreviewModal.tsx`** é modal bespoke, não o motor genérico nem `RegistryDetails` — mesmo critério já registrado para `SaleReturnModal`/`FinanceEntryPlanModal`: ficha de um registro existente com lista de itens dentro. Busca o pedido de novo ao abrir (não reaproveita a linha da listagem, que não tem itens). Botão "Pré visualizar" habilita com qualquer pedido selecionado, independente do `status`.
- **"Trocar"/"Editar" continuam desabilitados** — são as próximas duas rodadas (envolvem RPC de update nova, mais risco). Não foi criada RPC nem alterado `create_sale_order`/`convert_sale_order_to_sale` nesta rodada.
- **Testado no navegador**: selecionado o pedido 0002 (Padaria do Bairro LTDA, R$ 118,40, 3 itens) e clicado "Pré visualizar" — modal mostrou os 3 produtos (Farinha, Açúcar, Ovos) com quantidade/preço unitário/total de cada linha batendo com o banco, e o total do pedido (R$ 118,40) confirmado.

### Decisão arquitetural: editar pedido de venda (27/08/2026)

Segunda de três rodadas de "ver/editar pedidos" (a primeira foi a pré-visualização, acima). Esta é a que **altera dado real**: nasce a primeira RPC de UPDATE de documento do projeto.

- **RPC `update_sale_order(p_id uuid, payload jsonb)`, `security definer`**: mesma validação de `create_sale_order` (permissão, filial, ao menos um item, produto existente e da filial certa) **mais uma barreira que só existe aqui — o pedido precisa estar `aberto`**. Pedido `convertido` ou `cancelado` é dado histórico: a venda gerada já baixou estoque e já lançou financeiro em cima dos valores do pedido, então reescrever o pedido depois deixaria os dois documentos divergentes. `revoke execute ... from public, anon` nos dois, como sempre.
- **Diferenças deliberadas em relação a `create_sale_order`**: as checagens de permissão usam `coalesce(has_permission(...), false)` (a regra do item 3 do roteiro, que `create_sale_order` não seguiu na época — não foi corrigida aqui de propósito, para não mexer numa rotina de criação fora do escopo desta rodada); a permissão cobrada é `'edit'`, não `'create'`; e `branch_id`/`code` **não** entram no `update` — mudar a filial de um pedido driblaria a validação de filial dos produtos, e o código é a numeração sequencial da filial.
- **Itens são substituídos, não casados linha a linha**: `delete from sale_order_items where sale_order_id = ...` seguido dos `insert` novos, tudo dentro da transação da função. **Não havia precedente no projeto** — foi procurado antes de decidir: nenhuma outra rotina faz "substituir itens" (as `save_module_*` são upsert de uma linha só). O critério: item de pedido não tem nada pendurado nele (nem movimento de estoque, nem financeiro, nem nota), então update incremental só acrescentaria caminhos de erro sem ganho.
- **Permissão que precisou ser marcada à mão**: `role_permissions` tinha `can_edit = false` para `pedidos-venda` em todo mundo (o módulo só recebeu `view`/`create` quando nasceu, em 17/08/2026). Sem isso a RPC recusaria até o Administrador. Marcado `can_edit` para **Administrador**; Operador segue sem acesso ao módulo, mesma pendência de sempre.
- **Uma tela só para criar e editar** (`SaleOrderFormPage.tsx`): o que separa os dois modos é a presença do `:id` na rota (`useParams`). Duplicar a tela significaria manter dois formulários em sincronia para sempre; o que de fato difere — o rascunho nascer carregado e o submit chamar `update_sale_order` — mora inteiro em `useSaleOrderDraft`, que ganhou um quarto parâmetro `editingOrderId`.
- **Reidratar o carrinho custa duas buscas**: `fetchSaleOrderWithItems` (da rodada anterior) devolve o `product_id` de cada item, mas a linha do carrinho guarda o `Product` inteiro (unidade comercial, preço, código) — daí `fetchProductsByIds(branchId, ids)`, novo em `productsRepository.ts`. Se algum produto do pedido não existir mais na filial, a tela **recusa a edição** com o nome do produto em vez de abrir um carrinho com uma linha a menos em silêncio.
- **O rascunho por janela precisou de um slot por pedido** (ver a decisão "estado por janela no `OpenWindowsProvider`", 25/08/2026). Lista e formulário compartilham **um id de janela só** (`"pedidos-venda"`), então o slot único `"sale-order-draft"` faria o rascunho de "novo pedido" e o de "editar o pedido X" se sobrescreverem. O modo edição usa `sale-order-draft:<id>`. **O `windowId` continua o mesmo de propósito** — é ele que `closeWindow` usa para jogar fora tudo o que a janela guardava; trocar o id de janela criaria uma segunda entrada no dock e vazaria estado ao fechar.
  - Consequência disso no fim de vida do rascunho: salvar uma **edição** limpa **só o slot daquele pedido** (`setWindowState(..., undefined)`), não `clearWindowState`, que é por janela inteira e levaria junto o rascunho de "novo pedido". Salvar um pedido **novo** continua chamando `clearWindowState`, como antes.
  - O efeito que grava o rascunho também **não grava enquanto o pedido está carregando**: sem isso, montar a tela de edição salvaria um formulário vazio por cima do slot, e uma troca de janela nessa fresta faria a volta restaurar o vazio em vez do pedido.
- **Dupla barreira na UI, como no resto do projeto**: "Editar" na listagem só habilita com `status === "aberto"` (mesma condição de "Converter em venda") e `has_permission('pedidos-venda','edit')`; e a própria tela de edição se recusa a abrir se o pedido carregado não estiver `aberto` — isso cobre quem chega pela URL direto e quem deixou a tela aberta enquanto o pedido era convertido em outra janela.
- **"Trocar"/"Gerar NF"/"Financeiro"/"Excluir" continuam desabilitados** — fora do escopo desta rodada, e nada em `create_sale_order`/`convert_sale_order_to_sale` foi tocado.

#### Testado no navegador

Pedido 0005 criado (Padaria do Bairro, 1× Arroz, R$ 29,90) → "Editar" → formulário abriu preenchido com cliente/vendedor/item corretos → quantidade do Arroz para 3 e Café Torrado adicionado → "Salvar alterações" → "Pedido 0005 atualizado! Total: R$ 109,60". "Pré visualizar" confirmou a persistência (Arroz 3× R$ 89,70 + Café R$ 19,90 = R$ 109,60), e o banco bate.

**Isolamento dos rascunhos, in-app (sem reload)**: rascunho de "novo pedido" com Doritos → voltar para a lista → editar o pedido 0004 → a tela de edição veio com os dados **do 0004** (Bruno, Arroz + Leite), sem traço do Doritos → "Cancelar" → "Novo pedido" → o rascunho do Doritos **intacto**, sem nada do 0004. Os dois sentidos.

**Dupla barreira**: pedido 0005 convertido em venda (venda 0038) — "Editar" e "Converter em venda" ficaram desabilitados na listagem, "Pré visualizar" continuou habilitado. Abrir `/pedidos-venda/<id>/editar` pela URL mostrou "Este pedido está convertido e não pode mais ser editado". E chamando `update_sale_order` **direto pelo console**, contornando a UI inteira, o banco recusou: `P0001 — "Só é possível editar pedido em aberto."`.

`get_advisors` (security) não trouxe nada novo além do `authenticated_security_definer_function_executable` que **todas** as RPCs do projeto já têm (é intencional: elas existem para o usuário logado chamar, e a permissão é cobrada dentro). `vite build` limpo, com o code splitting por página preservado (`SaleOrderFormPage` segue em chunk próprio). Console sem erros — os dois 401/400 que aparecem foram os testes de barreira acima. `tsc` continua acusando erros **pré-existentes** em `moduleWorkflow.ts` e `cashControlRepository.ts`, de outras frentes em andamento; nenhum arquivo desta rodada aparece.

### Decisão arquitetural: módulo Financeiro (17/08/2026)

Terceiro módulo sobre o **motor genérico simples** (registro único, `RegistryFormModal`), junto de Clientes/Fornecedores e Produtos — deliberadamente **não** o motor de lote nem tela feita à mão. Uma conta a pagar/receber é um registro só (contato, valor, vencimento, forma de pagamento, parcela, documento), criado um de cada vez: não são N lançamentos independentes confirmados juntos (isso é Ajuste de estoque) nem um cabeçalho com itens dentro (isso é Realizar Venda / Pedidos de venda). Antes desta rodada `FinancePage.tsx`/`finance.ts` eram mock (`FINANCE_ENTRIES` hardcoded, nenhuma ação com `onClick`).

- **Tipo é permanente, status é o que muda.** `financial_entries.type` (`a_pagar`/`a_receber`) nasce com o lançamento e nunca muda; `status` (`aberto`/`baixado`/`cancelado`) é o que a baixa altera. **"Baixados" não é um terceiro tipo** — a aba mostra `status = 'baixado'` dos dois tipos juntos, enquanto "A pagar"/"A receber" mostram `status = 'aberto'` filtrado por tipo. Não existem três buckets nem três tabelas. `cancelado` está no enum mas nada escreve nele ainda (mesma situação de `sale_orders.status = 'cancelado'`).
- **Parcela são dois inteiros** (`installment_number`, `installment_total`), formatados como "1/3" só na tela (acessor derivado `installment`) — mesma correção já aplicada a preço em Produtos, que era string no mock. Constraint garante `1 <= number <= total`.
- **Tabela**: `financial_entries` (`branch_id` — dado operacional, isolado por filial), com `contact_id` FK real para `contacts` **nulável de propósito** (nem toda conta tem contato cadastrado: conta de luz, imposto). `total` é `numeric(14,2)`, `due_date`/`issue_date` são `date`, `settled_at`/`created_at`/`updated_at` são `timestamptz`. Constraint `(status = 'baixado') = (settled_at is not null)` — não dá para ter baixa sem data nem data sem baixa.
- **`payment_method` é texto livre**, não enum, mesmo já existindo `sale_payment_method`: o motor genérico não tem campo de seleção (`module_fields.data_type` só distingue `text`/`date`/`phone`/`email`), então um enum viraria erro de banco a cada digitação diferente. Mesmo precedente de "Tipo de operação"/"Departamento" em `sales`. Candidato a virar cadastro de verdade quando existir um tipo de campo com opções.
- **Gatilho `financial_entries_before_write` (`security definer`) faz três coisas**, e mora no banco justamente para o item 5 do plano (Compras vai inserir uma linha aqui dentro da própria transação dela): (1) preenche `code` com o próximo sequencial da filial quando ele chega vazio — `code` tem `default ''`, então quem insere nem precisa mencioná-lo, e um `pg_advisory_xact_lock` por filial serializa a numeração; (2) atualiza `updated_at` no update (é o campo "Alteração" da ficha); (3) recusa contato do tipo errado — conta a pagar só aceita `contacts.kind = 'fornecedores'`, a receber só `'clientes'`. É `security definer` porque lê `financial_entries` e `contacts`: quem tem `create` em financeiro pode não ter `view` em clientes-fornecedores, e sob RLS de invocador a consulta voltaria vazia e o gatilho recusaria uma escrita legítima. `revoke execute` de `public`/`anon`/`authenticated` (gatilho dispara mesmo sem EXECUTE).
- **`insert`/`update`/`delete` de uma parcela avulsa vão direto pelo repositório**, com a RLS de `financial_entries` fazendo a validação (`has_permission('financeiro', ...)` + `has_branch_access(branch_id)`, quatro policies separadas por operação) — isso continua valendo. **Mas a afirmação original desta seção, de que o módulo "não precisa de RPC `security definer` porque é escrita de registro único", ficou errada** assim que a criação passou a gerar N parcelas de uma operação numa transação só (17/08/2026, etapa de parcelamento) — ver a decisão logo abaixo. Criar uma conta continua sendo uma RPC; só editar/baixar/excluir uma parcela avulsa (uma linha por vez) é que dispensa RPC.
- **`ModuleDataRepository<TRow>` ganhou um segundo parâmetro opcional `TInput`** (`src/lib/repositories/types.ts`), com o padrão antigo (`Omit<TRow, "id" | "createdAt">`) preservado — Clientes e Produtos não mudaram. O Financeiro precisa disso porque metade da linha (`contactName`, `installment`, `totalFormatted`, os `*Formatted` de data) é acessor de tela, não coluna gravável. **Atualização (etapa de parcelamento): o repositório do Financeiro (`financialEntriesRepository.ts`) acabou nem implementando `ModuleDataRepository` — ver decisão abaixo.**
- **`module_fields` descreve a tela, não a tabela** (mesma lição de `counted_balance` em Ajuste de estoque, aqui em maior escala). Há pares de campos de propósito: `total`/`total_formatted`, `due_date`/`due_date_formatted`, `issue_date`/`issue_date_formatted`. O motor renderiza tudo com `String(valor)`, então o que aparece na tabela/ficha já chega formatado do repositório (pt-BR), enquanto o campo cru é o que volta para o `<input>` do formulário. A alternativa — ensinar `buildDetailFields` a formatar `data_type: 'date'` — mudaria a ficha de todos os módulos existentes e ficou fora de escopo.
  - `contact_name` e `operator_name` vêm de join (`contacts(name)`, `profiles(name)`); `installment` é `"n/total"` montado no repositório.
  - "Data da baixa" só aparece na aba Baixados: a página filtra `definition.fields` por `accessorKey` **antes** de chamar `buildDetailFields`, em vez de filtrar o resultado por rótulo — a ficha continua dirigida por metadados.
- **Prop `lookupField` no `RegistryFormModal`** (item 2 do pedido): mesmo papel do `mediaField` que já existia para o `PhotoDropzone`. `module_fields` **não** ganhou um `data_type: 'lookup'` — isso generalizaria o motor inteiro por causa de um campo. O prop injeta o `LookupModal` (o mesmo de Realizar Venda), cuida de abrir/fechar sozinho, e quem consome só passa `fetchItems`/`getKey`/`renderItem`/`onSelect`. O componente virou genérico (`RegistryFormModal<TItem = unknown>`), então os call sites sem lookup não mudaram.
  - **Detalhe que importa**: o `LookupModal` é renderizado **dentro** do `Dialog.Content` do formulário, não como irmão do `Dialog.Root`. É assim que o Radix empilha um modal sobre outro sem que o de baixo interprete o clique como "clicou fora" e feche. O `LookupModal` tem portal próprio, então isso não afeta o layout.
  - O rótulo do campo acompanha o tipo ("Fornecedor" em A pagar, "Cliente" em A receber) e a busca já filtra por `contacts.kind` — o gatilho do banco é a segunda barreira, não a primeira.
  - `fetchSaleContacts` (`salesLookups.ts`) foi extraído para `fetchContactsByKind(kind, query)` em `src/lib/repositories/contactLookups.ts`; a função antiga virou um delegate de uma linha, então Realizar Venda e Pedidos de venda não mudaram.
- **"Baixar" não passa pelo formulário**: é `update(id, { status: 'baixado', settledAt: now() })` com `onClick` próprio na `RegistryActions`. O oposto, **"Excluir baixa"** (aba Baixados), volta para `aberto` com `settled_at = null` — "excluir *a baixa*", não excluir o lançamento; as duas exigem `can_edit`.
- **Ações que continuam sem função**: "Renegociar" e "Boletos" ficam desabilitadas (cobrança/boleto é fase bem mais adiante do roadmap). "Excluir" está implementado de verdade (com `ConfirmDialog`) mas nasce desabilitado porque `can_delete` não foi marcado — se um dia for marcado em `/permissoes`, funciona sem deploy.
- ~~Não há "Editar" lançamento nesta etapa~~ — **revertido na etapa de parcelamento (17/08/2026, mais tarde)**: o pedido passou a exigir edição de lançamento em aberto. O motivo do adiamento (sexto botão estourando a viewport em 720px) virou uma correção genérica em `RegistryActions.css` (`.registry-actions--panel { overflow-y: auto }`) em vez de uma feature cortada — ver decisão abaixo.
- **Permissões**: linha em `modules` (`financeiro`, `layout_variant: 'table-controls'`, `data_table: financial_entries`) + três linhas em `module_tabs`. Como todo módulo, **depois da migration foi preciso marcar manualmente em `/permissoes`** — feito `can_view`/`can_create`/`can_edit` para Administrador; `can_delete` deixado desmarcado e Operador segue sem acesso.
- **Testado no navegador**: criada uma conta a pagar (Distribuidora Alfa, Boleto, 1/3, R$ 450, NF 001, venc. 20/09) e uma a receber (Stefani, Cartão de crédito, 2/4, R$ 1.250,50, NF 002, venc. 30/08); confirmado que cada uma aparece só na aba do seu tipo; baixa feita nas duas migrando para "Baixados" com `settled_at` preenchido e "Data da baixa" na ficha; "Excluir baixa" devolvendo o lançamento para a aba de origem com `settled_at` nulo; edição de valor pelo formulário (antes de o botão ser removido) atualizando "Alteração" sem mexer em `settled_at`. Também verificados: código sequencial automático por filial (001, 002, 003), lançamento **sem** contato aceito, contato do tipo errado recusado pelo gatilho ("Uma conta a pagar só pode referenciar um fornecedor."), validação de campo obrigatório do formulário, todos os botões desabilitados com só `can_view`, e `insert` direto pelo console recusado pela RLS (`42501`) — banco, não UI. Produtos e o lookup de cliente de Pedidos de venda conferidos sem regressão.
- **Fora de escopo por enquanto** (na época desta rodada — ver decisão de 17/08/2026, mais tarde, para o que mudou): integração com Compras/Vendas/Notas Emitidas/Devolução; geração automática de N parcelas a partir de um total; cancelamento (`status = 'cancelado'`); relatório/totalizador por período.

### Decisão arquitetural: parcelamento e integração com Vendas no módulo Financeiro (17/08/2026, mais tarde)

Um teste completo no navegador logo depois da rodada acima mostrou que o módulo, apesar de "funcionar", não respondia a nenhuma das quatro perguntas que são o objetivo declarado do Financeiro ("quanto entra, quanto sai, quanto vai entrar, quanto vai sair"): venda não gerava lançamento nenhum, nada nascia baixado, parcelamento era manual (uma parcela = um formulário inteiro repetido), as parcelas de uma mesma operação não tinham vínculo entre si, não havia total nenhum em nenhuma aba, "Baixados" não distinguia entrada de saída, nada indicava vencido, `abc` no valor virava R$ 0,00 em silêncio, e não dava para editar. Esta etapa resolve a causa raiz (falta de origem e de vínculo entre parcelas) e as consequências diretas dela — é o motivo de vir **antes** de Compras: sem coluna de origem, cada compra geraria um lançamento órfão.

#### Schema: origem e grupo de parcelas

- **`origin_kind` (enum: `manual`, `venda`, ...) + `origin_id uuid`** — par polimórfico, não FKs nomeadas (`sale_id`, `purchase_id`...). A lista de origens só cresce (compra, devolução, nota emitida — cada uma na hora certa do roadmap) e cada uma viraria uma coluna quase sempre nula. Custo aceito conscientemente: `origin_id` não tem constraint de FK — quem lê precisa saber o `origin_kind` antes de decidir em qual tabela fazer o join. `origin_kind`/`origin_id` nunca mudam depois de criados (ver gatilho abaixo).
- **`installment_group_id uuid not null default gen_random_uuid()`** — igual em todas as parcelas de uma mesma operação, inclusive parcela única (grupo de um). O `default` garante que isso vale mesmo para um insert hipotético que não passe pela função de parcelamento — nenhuma consulta futura precisa tratar `null` como caso especial.
- Índices em `(origin_kind, origin_id)` e em `installment_group_id`. Constraint de `total` trocada de `>= 0` para `> 0` (valor zero nunca fazia sentido; agora é rejeitado no banco, não só desencorajado na UI).
- Os lançamentos de teste da rodada anterior (001-007) foram apagados antes da migration — eram de um teste manual sem origem/grupo coerentes com o modelo novo, instrução explícita do usuário.

#### A função de parcelamento — o núcleo da etapa

Duas funções, não uma, e a separação é deliberada:

- **`financial_entries_create_installments(...)`** — o núcleo. Recebe uma operação inteira (filial, tipo, contato, valor total, nº de parcelas, primeiro vencimento, intervalo em dias, forma de pagamento, documento, origem, se já nasce baixada) e grava as N linhas numa transação só, todas com o mesmo `installment_group_id` novo. **Não verifica `has_permission` de módulo nenhum** — só `has_branch_access` (defesa em profundidade barata) e as regras estruturais (total > 0, parcelas >= 1, intervalo >= 1). `revoke execute` de `public`/`anon`/`authenticated`: não é chamável direto pelo cliente, só por outras funções `security definer` (que rodam como o owner da função, então a revogação de EXECUTE não impede a chamada interna — só impede `/rest/v1/rpc/...` direto).
  - **Por que o núcleo não faz `has_permission`**: se fizesse, `create_sale` chamando-o internamente exigiria que todo vendedor tivesse permissão de **Financeiro** só para conseguir vender — mesmo problema, em espírito, do gotcha já documentado de `convert_sale_order_to_sale` (que exige `has_permission('realizar-venda', 'create')` de quem só tinha permissão de Pedidos de venda). A solução desta vez foi não repetir o padrão: cada chamador valida a permissão do **seu próprio** módulo antes de chamar o núcleo, que confia nisso.
  - **Arredondamento em centavos inteiros (`bigint`), não `numeric`/float**: `v_base_cents := v_total_cents / p_installment_count` (divisão inteira, trunca pra baixo) e a sobra (`v_total_cents - v_base_cents * count`) vai inteira na primeira parcela. R$100,00 em 3x = 33,34 + 33,33 + 33,33. Uma asserção (`raise exception` se a soma das parcelas geradas não bater com o total, arredondado a 2 casas) fecha a função — é checagem de verdade, não comentário confiando que a matemática está certa.
  - **Achado durante o teste**: o primeiro `CREATE OR REPLACE` falhou em produção com `column "status" is of type financial_entry_status but expression is of type text` — um `CASE WHEN ... THEN 'baixado' ELSE 'aberto' END` com dois literais de texto não herda o tipo da coluna de destino automaticamente dentro de um `CASE` (diferente de um literal simples num INSERT, que o Postgres costuma converter sozinho pelo contexto). Precisou de cast explícito: `(case when p_settled then 'baixado' else 'aberto' end)::financial_entry_status`. Vale para qualquer `CASE` retornando enum daqui pra frente neste projeto.
- **`create_financial_entry_installments(...)`** — a porta de entrada pública, usada pelo formulário manual do Financeiro. Valida `has_permission('financeiro', 'create')` + `has_branch_access`, fixa `origin_kind = 'manual'`/`origin_id = null`, e delega pro núcleo. **Pegadinha de grant que custou uma rodada extra**: `revoke execute ... from anon` sozinho não bastou — o advisor continuou acusando `anon_security_definer_function_executable`, porque o Postgres concede EXECUTE a `PUBLIC` por padrão ao criar qualquer função, e `anon` herda isso mesmo depois de perder sua concessão própria. Precisou de `revoke ... from public` também (sem tocar `authenticated`, que mantém acesso pela concessão própria dele). Mesma lição já registrada para `create_sale_order`/`convert_sale_order_to_sale`, reaprendida aqui porque desta vez só uma parte da revogação foi feita de início.
- **`create_sale` chama o núcleo diretamente** (não a porta pública) — é o terceiro consumidor, e a razão de o núcleo existir separado da porta pública: `create_sale` já validou `has_permission('realizar-venda', 'create')`, então não precisa (nem deve) exigir permissão de Financeiro também. **Compras (etapa 4) vai ser o quarto consumidor**, chamando o núcleo do mesmo jeito depois de validar a permissão dela — é exatamente a porta que a etapa anterior foi instruída a deixar aberta (código de `financial_entries` gerado pelo gatilho, não pelo cliente), agora em uso de verdade.

#### Venda gera lançamento (`create_sale`)

- Cada linha de `payload.payments` (o `sale_payments` real, um por forma de pagamento — a venda já suporta split) chama o núcleo separadamente, com `origin_kind = 'venda'`/`origin_id = <id da venda>` e `document = 'Venda ' || código`. Uma venda dividida (metade dinheiro, metade crédito) gera dois grupos de parcela independentes, um por forma de pagamento — não um grupo só misturando tipos de pagamento diferentes.
- **Regra por forma de pagamento** (`sale_payments.method`): `dinheiro`/`pix`/`debito` → o dinheiro já entrou: `a_receber`, parcela única, nasce **baixado** com `settled_at` = confirmação da venda (é isso que faz a venda à vista aparecer direto em "Baixados", resolvendo o item "não existe lançamento que nasça baixado" do teste). `credito`/`boleto` → entra depois: `a_receber` em aberto, N parcelas (o `sale_payments.installments` daquela forma), **primeiro vencimento a 30 dias da emissão** — o projeto não tinha convenção anterior para isso, 30 dias foi adotado agora e vale como padrão daqui pra frente. `outro` → tratado como a prazo, conservador: parcela única em aberto (melhor uma conta a mais pro usuário baixar manualmente do que dinheiro fantasma aparecendo como recebido sem ter entrado).
- **Cancelamento de venda**: não implementado nesta etapa porque **não existe fluxo de cancelamento em Realizar Venda ainda** (`sales.status` só sai de `confirmed` manualmente, nenhuma RPC/UI faz isso — ver decisão de Realizar Venda). A porta fica aberta: `financial_entries.origin_kind = 'venda' and origin_id = <sale.id>` já é a consulta que um futuro fluxo de cancelamento precisaria pra mover os lançamentos daquela venda para `status = 'cancelado'`. Não construir esse fluxo agora é escopo, não esquecimento.
- **Nota para sessões futuras**: durante esta etapa, `/realizar-venda` estava sendo reescrita em paralelo por outra sessão como um wizard de 6 passos (`SaleWizard.tsx`), sem ainda estar documentada no AGENTS.md. As mudanças em `create_sale` descritas aqui são no **banco**, independentes de qual front-end chama a função — o contrato do `payload` (`branch_id`/`contact_id`/`seller_id`/`items`/`payments`) não mudou. Por isso o teste desta etapa (venda à vista e venda em 3x) foi feito chamando `create_sale` diretamente via `supabase.rpc(...)` autenticado no console do navegador, não clicando pelo wizard — evita confundir um bug do wizard (que não é desta etapa) com um bug desta mudança.

#### Formulário: motor genérico com ponte, ou modal bespoke?

**Decisão: modal bespoke** (`FinanceEntryPlanModal.tsx`), só para a criação. Listagem e ficha continuam 100% no motor genérico (`module_fields`/`RegistryTable`/`RegistryDetails`) — só o "Adicionar" saiu.

- O motivo é o mesmo critério que o pedido já apontava: o `RegistryFormModal` já tinha dois props de ponte (`mediaField` para foto, `lookupField` para contato). Este formulário precisava de nº de parcelas + intervalo com **prévia calculada ao vivo** e um checkbox ("já foi pago/recebido") — um terceiro prop de ponte só pra isso seria o motor se distorcendo para caber um módulo só, exatamente o sinal de alerta que o pedido descreveu. `FinanceEntryPlanModal` reaproveita o CSS do `RegistryFormModal` (mesma cara visual) e o `LookupModal` existente, mas é HTML/estado feito à mão — mesmo recorte já usado em Realizar Venda/Pedidos de venda (tela feita à mão ao lado de módulos genéricos no mesmo sistema).
- **A prévia no front replica a matemática da RPC** (`computeInstallmentPreview` em `finance.ts`, mesma conta em centavos inteiros) — sem isso o usuário só descobriria o arredondamento depois de salvar. É cálculo espelhado, não uma chamada ao banco: atualiza a cada tecla, sem round-trip.
- **`RegistryFormModal` ganhou um prop `validate?: (values) => string[]`** (não é o terceiro prop de ponte — é validação, categoria diferente dos props de widget; mesmo papel do `validateRow` que o motor de lote já tinha). Usado só pelo formulário de **edição** do Financeiro (que continua no motor genérico — edita uma parcela existente, não cria uma operação nova, então cabe nos campos `text`/`date` normais). O estado interno de erro deixou de ser `missingFields: string[]` (só rótulos) e virou `formErrors: string[]` (mensagens prontas), unindo "Preencha os campos obrigatórios: X." com o que `validate()` devolver, todas renderizadas com a mesma classe CSS (`registry-form-modal__error`) — é o que resolve o pedido de "mesma mensagem de erro que a validação de obrigatórios já usa".

#### Bug corrigido: valor inválido virava R$ 0,00 em silêncio

- `finance.ts` ganhou `parseAmount(value): number | null` — `null` para vazio **ou não numérico** (regex estrito), em vez do parser antigo que caía num `fallback` numérico (geralmente `0`) para qualquer entrada que não desse `Number()`. É essa troca que corrige o bug: antes, `abc` virava `0` silenciosamente porque o parser não distinguia "não digitado" de "digitado errado".
- `validateAmount(value, label)` devolve a mensagem pronta ("... precisa ser um número válido." / "... precisa ser maior que zero.") — usada tanto na validação embutida do `FinanceEntryPlanModal` quanto via `validate` do `RegistryFormModal` na edição. Constraint `total > 0` no banco (ver schema acima) é a segunda barreira, não a primeira.
- **24/08/2026**: `parseAmount`/`validateAmount` se mudaram para `src/lib/amount.ts` (o mesmo bug de vírgula apareceu em Produtos — ver "Bug corrigido: vírgula decimal" nesta seção). `finance.ts` reexporta os dois para não quebrar quem já importava de lá (`cashcontrol/*`); qualquer módulo novo deve importar direto de `src/lib/amount.ts`.

#### Bug corrigido: vírgula decimal não era aceita em Produtos e no carrinho de Realizar Venda

- Mesmo defeito do bug acima, em outros módulos: `products.ts` (`toNumber`/`toOptionalNumber`) e os `<input type="number">` de `ProdutosStep.tsx`/`FaturamentoStep.tsx` (Realizar Venda) usavam `Number(value)` direto — "14,90" virava `NaN` e caía silenciosamente em `0`/vazio. O PDV (`usePosSale.ts`/`PosPage.tsx`) já fazia certo (`type="text" inputMode="decimal"` + `.replace(",", ".")`) e serviu de referência.
- Correção: `products.ts` ganhou `validateProductFormValues` (plugada no `validate` das três `RegistryFormModal` de Produtos e na de edição rápida em `ProductPickerPanel.tsx`) e `buildProductInput` passou a usar `parseAmount` para os campos de preço (custo/atacado/venda) em vez de `toNumber`/`toOptionalNumber`. Os inputs de quantidade/preço/desconto do carrinho e de valor do pagamento em Realizar Venda trocaram `type="number"` por `type="text" inputMode="decimal"` com `.replace(",", ".")`, mesmo padrão do PDV.
- Continua **sem** um `data_type: 'number'`/`'currency'` em `module_fields` — mesma disciplina já registrada nesta seção (ver "candidato a correção real" acima): a correção fica no parser/validação, o campo de preço de Produtos continua `text`.

#### Totais, sinal/cor e vencimento

- **`RegistryTable` ganhou um slot genérico `summary?: RegistrySummaryItem[]`** (`{label, value, tone}`), renderizado como uma fileira de chips acima da lista. O componente não sabe o que é "a pagar" ou "saldo" — só recebe rótulo/valor/tom prontos. Vendas, Compras e Controle de Caixa devem reaproveitar o mesmo slot quando chegar a vez deles, em vez de cada um inventar o próprio widget de total.
  - Financeiro usa: "Total a pagar/receber (aberto)" nas abas abertas; "Entrou"/"Saiu"/"Saldo" em Baixados (somando por `type`, já que ali os dois tipos convivem na mesma lista).
- **Token de cor novo**: `--positive`/`--positive-hover` em `tokens.css` (claro e escuro) — o sistema só tinha `--danger` para o lado negativo, nunca precisou de um verde antes.
- **Valor com sinal e cor**: a coluna "Valor total" do motor genérico (`total_formatted`, vem de `module_fields`) é reconstruída depois de `buildTableColumns` — o `render` original (`String(valor)`) é trocado por um que decide sinal/cor pelo `entry.type` (`−` vermelho para `a_pagar`, `+` verde para `a_receber`). Mesmo padrão de "patchear uma coluna específica depois do build genérico" já usado em Produtos para formatar preço na ficha.
- **Vencido/vence hoje**: a coluna `due_date_formatted` (que antes só aparecia na ficha, `show_in_table: false`) passou a aparecer também na tabela (`show_in_table: true`, metadado — não código) e ganhou o mesmo tipo de patch de `render`: comparação de string ISO (`entry.dueDate < todayIso()`), sem `Date`, sem fuso — só para lançamentos `aberto` (baixado não tem "vencido").
- **Coluna de contato renomeada para "Contato"** (era "Cliente", aparecendo até em linha de fornecedor) — mudança só de metadado (`module_fields.label`), sem tocar em código, porque o rótulo é por módulo, não por aba/tipo.
- Nenhuma dessas mudanças de cor toca a ficha (`RegistryDetails`/`RegistryField.value` só aceita `string`) — ampliar isso é escopo maior do que esta etapa pediu.

#### Edição de lançamento (voltou a existir)

- **"Editar" reapareceu na `RegistryActions`**, desabilitado quando `status !== 'aberto'` (além de `!canEdit`). A rodada anterior tinha removido o botão porque um sexto botão estourava a viewport em 720px de altura. A correção desta vez foi genérica, não local: `.registry-actions--panel { overflow-y: auto }` em `RegistryActions.css` — o painel é item de grid com altura fixa (herdada do `.registry`), então numa janela baixa ele agora rola por dentro em vez de vazar por cima do rodapé. Vale para qualquer módulo futuro com mais ações do que cabem, não só Financeiro.
- **Edita uma parcela, nunca o grupo** — `updateEntry(id, patch)` sempre mira um `id` só; não existe (nem foi cogitada) uma ação de "editar todas as parcelas do grupo 006". Campos editáveis: contato, forma de pagamento, valor, documento, vencimento, emissão. `installment_number`/`installment_total` saíram do formulário (`module_fields.show_in_form = false`) porque são estruturais agora, não digitáveis.
- **Guarda de imutabilidade no gatilho** (`financial_entries_before_write`, ramo `UPDATE`), defesa em profundidade além do que a UI já impede: `type`, `installment_group_id`, `installment_number`/`installment_total` e `origin_kind`/`origin_id` não podem mudar nunca; e um lançamento com `status = 'baixado'` que **continua** `baixado` no mesmo UPDATE não aceita mudança de contato/forma de pagamento/valor/documento/vencimento/emissão (a transição baixado → aberto, isto é, "Excluir baixa", continua permitida — é justamente o caminho para depois editar). Testado via `update` direto pelo console: edição de parcela aberta funciona e mexe só naquela linha; tentativa de editar uma `baixada` é recusada pelo banco com a mensagem "Um lançamento baixado não pode ser editado — exclua a baixa primeiro."; tentativa de RPC/insert sem `can_create`/`can_edit` recusada com `42501`.

#### Testado no navegador

Lançamento manual de compra a prazo em 3x (Distribuidora Alfa, R$100, Boleto, vencimento 01/09 + 30 dias): prévia batendo 33,34/33,33/33,33 antes de confirmar, 3 linhas gravadas com o mesmo `installment_group_id`, soma exata. Lançamento manual marcando "já foi recebido" (Stefani, R$89,90, PIX): nasceu direto em "Baixados", `settled_at` preenchido. Totais conferidos nas três abas (100,00 a pagar; 89,90/0,00/89,90 em Entrou/Saiu/Saldo). Venda à vista via `create_sale` (dinheiro, R$30): gerou 1 lançamento `a_receber` já `baixado`, `origin_kind = 'venda'`, documento "Venda 0005". Venda a crédito 3x via `create_sale` (R$100): gerou 3 parcelas em aberto, mesmo grupo, mesma venda, vencimento a 30 dias. Baixa de uma parcela do grupo de 3: só ela saiu de "A receber" (as outras duas permaneceram, com o total da aba caindo de 100,00 para 66,66). `abc` e `0` no campo de valor: os dois recusados, com mensagens distintas ("número válido" / "maior que zero"). Edição de parcela aberta: funcionou, mudou só aquela linha. Edição de parcela baixada via console: recusada pelo gatilho. Sem `can_create`/`can_edit`: os seis botões desabilitados na UI e a RPC de criação recusada no banco (`42501`) — testado desligando/religando as permissões do papel Administrador direto no banco. Produtos, Clientes e Fornecedores e Ajuste de estoque conferidos sem regressão (o patch de CSS em `RegistryActions` e a mudança de `missingFields` para `formErrors` no `RegistryFormModal` são compartilhados por todos os módulos).

#### Fora de escopo

Compras (usará o núcleo de parcelamento quando existir, não construído agora); cancelamento de venda de verdade (porta deixada aberta via `origin_kind`/`origin_id`, sem fluxo); conciliação bancária, DRE, gráfico de fluxo de caixa projetado, régua de cobrança; motor de lote — as parcelas de uma operação compartilham origem/grupo, não são "N registros independentes", então `RegistryBatchFormModal`/Ajuste de estoque não foram tocados, de propósito.

### Decisão arquitetural: módulo Compras (18/08/2026)

Quarto módulo transacional (cabeçalho + itens), mesmo formato estrutural de Realizar Venda e Pedidos de venda — não o motor genérico simples (Produtos, Financeiro) nem o motor de lote (Ajuste de estoque). Uma compra é um registro (fornecedor, forma de pagamento, parcelas) com uma lista de itens aninhada. Antes desta rodada `PurchasesPage.tsx`/`purchases.ts` eram mock (`PURCHASES` hardcoded, um item de exemplo, nenhuma ação com `onClick`).

- **Não usa o motor genérico**, mesmo motivo de Realizar Venda/Pedidos de venda: a tela (`src/features/purchases/PurchaseFormPage.tsx`) é feita à mão, espelhando `SaleOrderFormPage.tsx`/`useSaleOrderDraft.ts` (mirror mais recente e confiável no momento — `/realizar-venda` estava em reescrita paralela como wizard). Precisa da linha em `modules` (`compras`) para aparecer em `/permissoes`; **depois da migration foi preciso marcar manualmente** `can_view`/`can_create` para Administrador (Operador segue sem acesso, mesma pendência já registrada nos módulos anteriores).
- **Tabelas**: `purchases` (cabeçalho, `branch_id` — dado operacional) e `purchase_items` (sem `branch_id` próprio, herda via `purchase_id`; RLS de leitura usa `exists (select 1 from purchases where ...)` — mesmo padrão de `sales`/`sale_items`). `purchases.status` (`confirmed`/`cancelled`, espelhando `sales.status`) existe mas nada ainda escreve `cancelled` — porta deixada aberta para a etapa 9 (Devolução), mesma convenção de `sale_orders.status = 'cancelado'`.
- **Fornecedor é obrigatório e não tem child table de pagamento**: diferente de `sales`/`sale_payments` (split de N formas de pagamento), uma compra tem uma forma de pagamento só (decisão do pedido original — não implementar split sem o mock sugerir), então `payment_method`/`installment_total` vivem direto no cabeçalho de `purchases`, no mesmo padrão de `sale_orders.payment_method`/`installments` (não de `sale_payments`).
- **Validação de fornecedor: dentro da RPC, não em gatilho.** `financial_entries` usa um gatilho (`financial_entries_before_write`) porque o financeiro tem duas portas de escrita (a RPC de parcelamento *e* edição direta de uma parcela avulsa pelo `RegistryFormModal`). Compras tem uma porta só (`create_purchase`) — não existe edição/exclusão nesta rodada —, então validar `contacts.kind = 'fornecedores'` inline na função é suficiente e mais simples; não há necessidade de duplicar a defesa num gatilho que nenhum outro caminho de escrita atravessaria.
- **`create_purchase(payload jsonb)`, `security definer`**: mesmo esqueleto de `create_sale`/`create_sale_order` — valida `has_permission('compras', 'create')` + `has_branch_access` antes de qualquer escrita, `pg_advisory_xact_lock` por filial para o código sequencial, grava cabeçalho + itens numa transação. Diferente de `create_sale`: **estoque sobe, não desce** (`stock = stock + quantidade`, sem checagem de "estoque insuficiente" — comprar sempre é permitido); trava a linha do produto (`for update`) só por segurança de concorrência, não para validar saldo.
  - **Chama `financial_entries_create_installments` (o núcleo), não a porta pública `create_financial_entry_installments`** — mesma razão documentada para `create_sale`: quem já validou `has_permission('compras', 'create')` não deveria também precisar de permissão de Financeiro. Compras é o quarto consumidor do núcleo (depois de `create_sale`, os dois métodos de pagamento dentro dela, e o formulário manual do Financeiro), exatamente o consumidor que a etapa de parcelamento do Financeiro já havia deixado a porta pronta para receber.
  - **Regra de forma de pagamento, espelhada de `create_sale` em sentido oposto** (lá o dinheiro entra, aqui sai): `dinheiro`/`pix`/`debito` → já foi pago no ato, nasce **baixado**, parcela única, vencimento = data de emissão. `credito`/`boleto`/`outro` → paga depois, `N` parcelas conforme o formulário.
  - **Sem 30 dias fixos.** A venda automática (`create_sale`) usa 30 dias de convenção porque não há UI para o operador escolher — mas Compras é lançada manualmente a partir de uma nota real que já chegou com prazo definido pelo fornecedor. O formulário pede vencimento da 1ª parcela (pré-preenchido em +30 dias, editável) e intervalo entre parcelas (pré-preenchido em 30, editável); os dois vão direto para a RPC, nunca hardcoded nela. `first_due_date` é obrigatório no payload quando a forma não é à vista — a RPC recusa se vier nulo.
  - **`update_cost_price` (boolean, no payload) — decisão do usuário**: registrar uma compra pode ou não atualizar `products.cost_price` pelo custo pago em cada item, e isso é escolha do operador **por compra**, não uma regra fixa do sistema — o formulário tem um checkbox ("Atualizar o preço de custo dos produtos comprados no cadastro"), marcado por padrão. Quando marcado, o `update products` da RPC grava `cost_price = unit_cost` junto com a alta de estoque, no mesmo comando; quando desmarcado, `cost_price` não é tocado (o cadastro de Produtos continua sendo a fonte da verdade, editado à parte).
- **Forma de pagamento reaproveita o enum `sale_payment_method`** (não um `purchase_payment_method` novo) — os valores (`dinheiro`/`debito`/`credito`/`pix`/`boleto`/`outro`) servem igualmente para compra e venda, e duplicar a declaração do tipo só pra ter um nome mais correto no contexto não pagava o custo de manter dois enums idênticos em sincronia. `financial_entry_origin_kind` ganhou o valor `compra` (`alter type ... add value`, migration separada da que já usa o valor nela mesma — regra do Postgres de não usar um valor de enum recém-adicionado na mesma transação).
- **Tela**: `ProductPickerPanel` é reaproveitado sem nenhuma alteração — ele nunca soube exibir preço, só lista/busca/arrasta/clique; quem decide "preço de venda" vs. "custo" é sempre o carrinho de quem o usa (`draft.addProduct` inicializa `unitCost` com `product.costPrice ?? 0`, em vez de `product.salePrice` como em Realizar Venda/Pedidos de venda). `LookupModal` + `fetchContactsByKind('fornecedores', query)` para o fornecedor, mesmo componente/repositório de Financeiro/Pedidos de venda. `DndContext` com `activationConstraint: { distance: 6 }` (objeto de opções fora do componente) — mesma pegadinha documentada em Realizar Venda/Ajuste de estoque. Carrinho tem uma variante de grid CSS (`.sale__cart-line--purchase`, em `SalePage.css` — arquivo já compartilhado pelas três telas) com 5 colunas em vez de 6, porque não há desconto por item em Compras.
- **Testado no navegador**: compra à vista de 2 produtos (Doritos + Arroz, dinheiro, R$37,50) — estoque dos dois subiu na quantidade certa, `cost_price` dos dois atualizado para o custo pago, 1 lançamento gerado direto em Financeiro → Baixados, `origin_kind = 'compra'`, `origin_id` = id da compra, documento "Compra 0001". Compra a prazo de 1 produto em 3x (Café Torrado, boleto, R$14,00, vencimento 05/09 informado manualmente) — 3 parcelas em Financeiro → A pagar, mesmo `installment_group_id`, vencimentos 05/09, 05/10, 04/11 (intervalo de 30 dias informado, não hardcoded), soma exata em centavos (4,68+4,66+4,66). Sem `can_create`: botão "Nova Compra" desabilitado na tela e a RPC recusada direto pelo console (`42501`, "Sem permissão para criar compras."). Financeiro e Produtos conferidos sem regressão (parcelas da compra aparecendo ao lado das manuais; saldo/custo dos produtos batendo na ficha).
- **Fora de escopo** (mesmo texto do pedido original): "Importar XML" (integração fiscal, etapas adiante); "Devolver Compra" (etapa 9, Devolução — ainda não existe); split de pagamento (uma compra, uma forma de pagamento); edição/exclusão de compra confirmada (nenhuma RPC/UI faz isso, mesma situação de `sales`/`sale_orders`).

### Decisão arquitetural: módulo Controle de Caixa (18/08/2026)

Quinto módulo transacional, e o primeiro sem precedente estrutural direto: não é CRUD simples sobre o motor genérico (Produtos, Financeiro), não é cabeçalho+itens (Realizar Venda, Pedidos de venda, Compras) e não é lote (Ajuste de estoque). É uma **sessão** (abrir → movimentar → fechar) que **lê** `financial_entries` sem nunca escrever nela — vender em dinheiro continua sendo responsabilidade de `create_sale`, este módulo só sabe consultar. Antes desta rodada `CashControlPage.tsx`/`cashControl.ts` eram mock (`OPERATIONAL_CASH_REGISTERS` vazio, um `ManagerialCashEntry` de exemplo, nenhuma ação com `onClick`).

- **Escopo desta etapa**: sessão de caixa (abrir/fechar) e movimentação manual real (sangria/suprimento). **Vincular uma venda a uma sessão de caixa não é desta etapa** — é o que a etapa 6 (Ponto de Venda) faz de propósito, e é o que a torna um "ponto de venda" de verdade em vez de uma segunda Realizar Venda. `create_sale` não foi alterada; não existe FK de venda/pagamento para sessão.

#### Schema

- **`cash_registers`** (`branch_id`, `name`, `active`) — catálogo de caixas físicos/lógicos de uma filial. Sem UI de administração nesta etapa (mesmo padrão de `branches`); um registro "Caixa 1" foi semeado por filial já existente na própria migration. O campo existe para não fechar a porta de mais de um caixa por filial, mesmo que hoje só exista um.
- **`cash_sessions`** (`register_id`, `branch_id`, `code` sequencial por filial, `status` enum `aberto`/`fechado`, `opened_at`, `opened_by`, `opening_amount`, `closed_at`, `closed_by`, `counted_amount`, `expected_amount`, `difference`). `expected_amount`/`difference` só existem depois do fechamento — nunca calculados ou gravados pelo cliente, só pela RPC `close_cash_session`. Constraint `(status = 'fechado') = (closed_at is not null)`, mesmo padrão de `financial_entries`.
- **`cash_movements`** (`session_id`, `type` enum `sangria`/`suprimento`, `amount`, `description`, `created_by`, `created_at`) — sem `branch_id` próprio, herda via `session_id` (mesmo padrão de `sale_items`/`purchase_items`).
- **Decisão de produto: uma sessão `aberto` por filial por vez, não por caixa.** Imposta por índice único parcial (`cash_sessions_one_open_per_branch on (branch_id) where status = 'aberto'`), não só por checagem na RPC — é a segunda barreira contra corrida, mesmo espírito da unicidade de código em `financial_entries`. Motivo de ser por filial e não por caixa: `cash_registers` já suporta múltiplos caixas, mas controlar concorrência entre sessões abertas simultaneamente na mesma filial exigiria saber a qual caixa cada venda em dinheiro pertence — informação que só existe a partir do Ponto de Venda (etapa 6). Reavaliar então, não antes.
- Nenhuma policy de `insert`/`update`/`delete` para o cliente direto em nenhuma das três tabelas — só as RPCs (`security definer`) escrevem, mesmo padrão de `stock_adjustments`/`purchases`. RLS de `select` usa `has_permission('controle-caixa', 'view')` (+ `has_branch_access(branch_id)` direto em `cash_registers`/`cash_sessions`; via `exists (select 1 from cash_sessions ...)` em `cash_movements`, que não tem `branch_id` próprio).

#### RPCs

- **`open_cash_session(p_register_id, p_opening_amount)`**: valida `has_permission('controle-caixa', 'create')` + `has_branch_access` da filial do caixa, recusa se já existir sessão `aberto` na filial (mensagem amigável antes do índice único servir de segunda barreira), gera `code` sequencial por filial via `pg_advisory_xact_lock` (mesmo padrão de `create_sale`/`create_purchase`).
- **`register_cash_movement(p_session_id, p_type, p_amount, p_description)`**: recusa se a sessão não existir, não pertencer à filial do usuário, ou não estiver `aberto`.
- **`close_cash_session(p_session_id, p_counted_amount)`**: recusa se a sessão não estiver `aberto`. Calcula `expected_amount = opening_amount + suprimentos − sangrias + vendas em dinheiro da sessão` (janela `opened_at` até `now()`), grava `expected_amount`, `difference = counted_amount - expected_amount`, `status = 'fechado'`. Esse cálculo é o motivo de o módulo existir — sem ele "fechar caixa" só mudaria um status.
- **`financial_entries_cash_sales_in_window(p_branch_id, p_from, p_to)`** — núcleo de leitura, sem gate de permissão próprio (mesmo espírito do núcleo `financial_entries_create_installments`: só `has_branch_access`, quem chama já validou a própria permissão). É a consulta central do módulo: junta `financial_entries` (`origin_kind = 'venda'`) → `sales` (por `origin_id`) → `sale_payments` (por `sale_id`), filtrando pelo **enum** `sale_payments.method = 'dinheiro'`, não pelo texto `financial_entries.payment_method` — o texto é só um rótulo de exibição (`'Dinheiro'`, `'PIX'`...) gravado por `create_sale`, frágil para filtrar (comparação de string) e não é a fonte de verdade de forma de pagamento.
  - **Detalhe que evita contagem dupla em venda com split**: o `EXISTS` que junta `sale_payments` casa também o valor (`sp.amount = fe.total`), não só `sale_id` + `method`. Sem isso, uma venda dividida (ex.: metade dinheiro, metade PIX) geraria 2 linhas em `financial_entries` (uma por forma de pagamento) e um join ingênuo por `sale_id` contaria a parte em PIX também, porque cada linha de `financial_entries` seria pareada com *todas* as linhas de `sale_payments` daquela venda, não só a sua. Como `dinheiro`/`pix`/`débito` sempre nascem em parcela única (regra de `create_sale`), casar o valor identifica a linha certa sem ambiguidade no caso comum; o único cenário não coberto — duas formas de pagamento diferentes na mesma venda com o *mesmo* valor exato — é uma coincidência rara, documentada aqui em vez de escondida.
- **`list_cash_session_cash_sales(p_session_id)`** — porta pública (`security definer`, `view`-gated + `has_branch_access`), usada pelo cliente. Resolve a janela da sessão (`opened_at` até `closed_at`, ou até `now()` se ainda aberta) e delega ao núcleo acima. **A mesma consulta alimenta o cálculo de fechamento (`close_cash_session`, que chama o núcleo direto) e o extrato da aba "Caixa gerencial"** — os dois nunca divergem, de propósito.
- Todas as funções novas com `revoke execute ... from public, anon` (e `authenticated` também no núcleo, que não é para ser chamado direto pelo cliente).

#### Tela

- **Não usa o motor genérico** (`module_fields`/`module_tabs`) — mesmo motivo de Realizar Venda/Pedidos de venda/Compras: o formato (duas abas com ações muito diferentes, sessão com movimentações aninhadas) não é lista+ficha simples. Precisa da linha em `modules` (`controle-caixa`, `layout_variant: 'table-controls'`, `data_table: cash_sessions`) só para `/permissoes` funcionar.
- **Mapeamento de permissões**: abrir sessão e registrar movimento (sangria/suprimento) são `create`; fechar sessão é escrita sobre um registro existente, então `edit` — mesmo mapeamento que Financeiro usa para baixar uma parcela. Sem `can_delete`: não há ação de excluir neste módulo. `role_permissions` para Administrador inserido direto por SQL na migration (`can_view`/`can_create`/`can_edit`); Operador segue sem acesso, mesma pendência de todos os módulos anteriores.
- **Aba "Caixas operacionais"**: `RegistryTable` real sobre `cash_sessions` (Código, Caixa, Situação, Data de abertura, Data de fechamento, Operador). "Abrir caixa" abre um modal feito à mão (`OpenCashSessionModal` — caixa + valor de abertura; reaproveita a classe `.form-field` para o `<select>` de caixa, sem CSS novo), mesmo recorte de `FinanceEntryPlanModal`. "Fechar caixa" abre `CloseCashSessionModal`, um modal em **duas fases**: pede o valor contado, chama a RPC, e então mostra o resultado ("Bateu certinho." / "Sobrou R$ X." / "Faltou R$ X.") antes de fechar — só depois disso o usuário confirma. "Transferir" e "Manutenção" ficam desabilitados (sem especificação, fora de escopo).
- **Aba "Caixa gerencial"**: mostra a sessão selecionada em "Caixas operacionais", ou a sessão aberta atual se nada foi selecionado (estado de seleção persiste entre as abas de propósito — só assim "sessão selecionada" tem sentido ao trocar de aba). Extrato = sangrias + suprimentos (leitura direta de `cash_movements`, RLS cuida do acesso) + vendas em dinheiro (`list_cash_session_cash_sales`), unificados em `CashLedgerEntry[]` e ordenados por data no cliente. "Suprimentos"/"Sangria" abrem `CashMovementModal` (mesmo componente para os dois, só troca o rótulo pelo `type`), chamando `register_cash_movement`.
- **Painel de totais reaproveita o slot genérico `RegistryTable.summary`** (já usado pelo Financeiro) — "Valor total entradas"/"Valor total saídas"/"Total sangrias"/"Suprimentos"/"Valor do saldo atual", somados no cliente a partir do extrato já carregado, sem round-trip extra (mesmo cálculo que `close_cash_session` faz no banco, então o extrato nunca diverge do que o fechamento vai calcular). "Operador" saiu do painel de totais e foi para os `fields` do `RegistryActions` (ficha da sessão-alvo), separando "total agregado" de "detalhe de um registro" — mesmo critério já usado no Financeiro (`summary` vs. `fields`).
- **Coluna "Moeda" removida** (era decorativa no mock) — decisão documentada: o sistema não tem multi-moeda em lugar nenhum, então a coluna nunca teria um segundo valor possível. Os totais mostram "R$" no próprio valor (`formatCashTotal`), como Compras/Pedidos de venda já fazem.
- **`useCashControlData`** carrega caixas + sessões da filial (ações: `openSession`/`closeSession`/`addMovement`); **`useCashSessionLedger`** é um hook à parte, por sessão (recarregado manualmente depois de um fechamento ou movimentação) — separado porque o extrato muda de alvo (sessão selecionada) independente de quando a lista de sessões muda.

#### Testado no navegador

Abertura de sessão (Caixa 1, R$100) gerando código `0001`; sangria (R$20, "Troco para o motoboy") e suprimento (R$50, "Reforço de troco") refletidos no extrato e nos totais (saldo atual R$130). Venda em dinheiro (R$30, via `create_sale` direto por `fetch` autenticado, mesmo caminho de teste da etapa de parcelamento do Financeiro) aparecendo no extrato como "Venda 0008"; venda em PIX (R$45) criada em seguida **não** aparecendo — confirma o filtro por `sale_payments.method`. Fechamento com valor contado igual ao esperado (R$160) → "Bateu certinho.", diferença R$0,00. Segunda sessão aberta (R$200) e fechada com contagem a mais (R$210) → "Sobrou R$10,00." (sinal positivo). Terceira sessão (R$50) fechada com contagem a menos (R$35) → "Faltou R$15,00." (sinal negativo). Tentativa de abrir uma segunda sessão com uma já aberta na filial, direto pela RPC (bypassando a UI, que já desabilita o botão) → recusada com "Já existe uma sessão de caixa aberta nesta filial. Feche-a antes de abrir outra." Sem `can_create`/`can_edit` (desligado/religado direto no banco para o papel Administrador): os cinco botões de escrita desabilitados nas duas abas, e as três RPCs (`open_cash_session`/`register_cash_movement`/`close_cash_session`) recusadas com `403`/`42501` chamadas direto, bypassando a UI. Financeiro e Produtos conferidos sem regressão.

#### Fora de escopo

Vincular venda a sessão de caixa (etapa 6, Ponto de Venda — não altera `create_sale`, não cria FK de venda/pagamento para sessão); "Transferir" e "Manutenção" (sem especificação); múltiplas sessões abertas simultaneamente na mesma filial (reavaliar quando/se a etapa 6 precisar de verdade); relatório de fechamento em PDF e impressão de comprovante de sangria/suprimento (nenhum módulo do sistema tem isso ainda); UI de administração de `cash_registers` (criar/editar caixa é SQL-only, mesma situação de `branches`).

### Decisão arquitetural: módulo Ponto de Venda (18/08/2026, noite)

Sexto módulo transacional. `PosPage.tsx` já era uma tela completa de kiosk (grade de produtos, carrinho, atalhos F2/F4/Esc) desde antes, mas 100% mockada (`POS_PRODUCTS`, "Confirmar Venda" só limpava o carrinho). Esta etapa é o que torna a tela um Ponto de Venda de verdade em vez de uma segunda Realizar Venda: **exigir sessão de caixa aberta para vender**. Sem essa exigência, PDV seria só um catálogo mais bonito na frente de `create_sale`.

#### Vínculo venda ↔ sessão

- **`sales.cash_session_id uuid null references cash_sessions(id)`** — nulo para Realizar Venda/Pedidos convertidos (não mudou), preenchido só para vendas nascidas no PDV. `sales.contact_id` **deixou de ser `NOT NULL`** nesta etapa — o PDV precisa suportar venda sem cliente identificado; `financial_entries.contact_id` já era nulável de propósito, então nada corrente abaixo precisou mudar. Realizar Venda/Pedidos de venda continuam exigindo cliente **na UI** (`headerValid`), não no banco — a coluna só ficou menos restritiva, o front não regrediu.
- **RPC `create_pos_sale(payload jsonb)`, `security definer`**: valida `has_permission('ponto-de-venda', 'create')` + `has_branch_access`, busca a sessão `aberto` da filial (índice único da etapa 5 garante no máximo uma), recusa com `'Abra uma sessão de caixa antes de vender.'` se não houver nenhuma, chama **`create_sale(payload)` sem alterá-la** e depois faz um `update sales set cash_session_id = ...` na venda recém-criada, na mesma função (mesma transação implícita) — mesmo espírito de `create_purchase` chamando o núcleo de parcelamento em vez de duplicar lógica, aqui reaproveitando a RPC inteira em vez de só um núcleo interno.
  - **Pegadinha real, documentada para não surpreender de novo** (mesma categoria já registrada em `convert_sale_order_to_sale`): `create_sale` roda com `SECURITY DEFINER`, mas isso não muda `auth.uid()` — ela **também** exige `has_permission('realizar-venda', 'create')` de quem chamou. `create_pos_sale` não contorna isso (não deveria: seria reimplementar a validação em vez de reaproveitar a função). Na prática, **qualquer papel que vá operar o PDV precisa das duas permissões marcadas em `/permissoes`**: `ponto-de-venda`/`create` **e** `realizar-venda`/`create`. Administrador já tinha a segunda; outros papéis (ex.: um futuro "Operador de caixa") vão precisar das duas.
- **Refinamento em `financial_entries_cash_sales_in_window`**: ganhou um 4º parâmetro opcional `p_session_id uuid default null`. Para vendas com `cash_session_id` preenchido (toda venda nascida no PDV), o casamento venda↔sessão agora é exato (`s.cash_session_id = p_session_id`), sem a ambiguidade de janela+valor documentada na etapa 5; para vendas sem sessão (fora do PDV), continua a heurística por janela de tempo. **O filtro por `sale_payments.method = 'dinheiro'` continua obrigatório nos dois casos** — `close_cash_session` e `list_cash_session_cash_sales` foram atualizadas para passar o `p_session_id` que já tinham em mãos.
  - **Bug pego no teste manual, não só no código**: a primeira versão deste refinamento trocou o filtro por método pela checagem de sessão (em vez de somar as duas condições) — uma venda do PDV em PIX, e as parcelas de crédito de uma venda dividida, passaram a aparecer no extrato de caixa como se fossem dinheiro, só por pertencerem à sessão. Corrigido mantendo o `exists (... sp.method = 'dinheiro' ...)` sempre presente e usando `cash_session_id` só para decidir *de qual sessão* uma venda é (substituindo a heurística de janela), nunca para decidir *se* o pagamento foi em dinheiro. Reproduzido e confirmado no navegador antes e depois da correção (ver "Testado no navegador").

#### Tela: exigir sessão aberta antes de montar o carrinho

`PosPage.tsx` consulta a sessão aberta da filial ao carregar (`useOpenCashSession`, mesma consulta que Controle de Caixa usa) e, se não houver nenhuma, mostra um aviso fixo no rodapé do carrinho com link para `/controle-caixa` e desabilita "Confirmar Venda" — sem impedir a navegação/exploração do catálogo. A RPC é a barreira real (testada recusando uma chamada direta, bypassando a UI); o aviso na tela só evita o operador montar o carrinho inteiro pra descobrir o bloqueio no F4.

#### Catálogo real, sem taxonomia inventada

`POS_PRODUCTS` foi substituído por `useProductsData(branchId)` filtrado por `active = true` (mesmo hook de Produtos). As abas de categoria (`vegetais`/`automóveis`/`outros`) do mock foram **removidas**, não substituídas por outra taxonomia: `products.type` é campo de texto livre e, no banco real, hoje está `null` nas três linhas cadastradas — não existe dado estruturado pra filtrar. Só resta "Todos" (implícito, sem aba). Se um dia `products.type` passar a guardar algo estruturado (ou o motor genérico ganhar um `data_type` com opções), reintroduzir abas é trabalho de UI, não de schema. O bloco colorido com iniciais (`productPlaceholder` em `src/features/pos/pos.ts`) continua decorativo, gerado no cliente a partir de nome/código — `products` não tem coluna de imagem.

#### Pagamento

- `dinheiro`: campo "Recebido" + troco calculado no cliente (like antes).
- `debito`/`pix`: sem "Recebido"/troco — uma parcela, valor cheio naquela forma.
- `credito`: idem, mas com campo de parcelas (`sale_payments.installments`, mesmo campo que Realizar Venda usa).
- `dividir`: UI real de múltiplas linhas (forma + valor, parcelas quando a linha é crédito), nascendo com 2 linhas (dinheiro + crédito) para não esconder o botão "+ adicionar forma" na primeira vez. A soma precisa bater com o total (tolerância de 1 centavo) antes de habilitar "Confirmar Venda" — a validação de soma da própria `create_sale` (`raise exception` se não bater) continua existindo como segunda barreira, a UI só evita chegar nela.
- `src/features/pos/usePosSale.ts` centraliza carrinho/pagamento/cliente/confirmação (espelha `useSaleDraft.ts` de Realizar Venda, mas sem cabeçalho — PDV não tem endereço/tipo de operação/departamento).

#### Cliente e vendedor

- Cliente: campo de texto livre trocado pelo `LookupModal` já usado em Realizar Venda/Pedidos/Financeiro (`fetchContactsByKind('clientes', query)`), mesmo componente e repositório. Continua opcional — `contact_id` nulo é venda sem cliente identificado (ver seção de schema acima).
- Vendedor: **sem seletor** — `seller_id = auth.uid()` direto (via `profile.id`/`user.id` do `useAuth()`). Decisão deliberada, diferente de Realizar Venda/Pedidos (que pré-selecionam o vendedor logado mas permitem trocar): o PDV é operado por quem está no caixa, não por alguém escolhido numa lista — trocar de operador é trocar de sessão de caixa, não um campo da venda.

#### Gancho de emissão fiscal

`src/features/pos/fiscalDocument.ts` exporta `emitFiscalDocumentForSale(saleId)`, chamada depois de toda venda do PDV confirmada com sucesso. Hoje é um no-op documentado — a etapa 8.5 (NFC-e) só precisa implementar o corpo desta função, sem tocar de novo no fluxo de confirmação do PDV.

#### Módulo e permissões

Linha em `modules` (`ponto-de-venda`, `layout_variant: 'three'`, `data_table: 'sales'` — reaproveita a tabela de Realizar Venda, não é dado próprio) inserida por migration; `can_view`/`can_create` marcados direto por SQL para Administrador (mesmo padrão dos módulos anteriores) — **lembre-se da pegadinha de permissão dupla** descrita acima ao configurar outros papéis.

#### Testado no navegador

Sem sessão aberta: `/ponto-de-venda` carregou com o catálogo navegável e "Confirmar Venda" desabilitado com o aviso certo; `create_pos_sale` chamada direta via `fetch` autenticado (bypassando a UI) recusada com `"Abra uma sessão de caixa antes de vender."`. Sessão aberta (R$100): venda em dinheiro de 2 produtos (R$43,90) com recebido R$50 → troco R$6,10 calculado certo, `cash_session_id` preenchido, estoque baixado (166→165, 50→49), lançamento nascendo `baixado` em Financeiro. Venda em PIX (R$19,90): sem campo de troco, uma parcela, `cash_session_id` preenchido. Venda dividida (R$15 dinheiro + R$19,90 crédito 2x): dois grupos de parcela em Financeiro (1 baixada + 2 em aberto de R$9,95), como já documentado para venda dividida. Fechamento da sessão: extrato do Caixa gerencial mostrando só as duas parcelas em dinheiro (R$43,90 + R$15,00 = R$58,90) — a venda em PIX e as duas parcelas de crédito ficaram de fora, confirmando a correção do bug do refinamento acima —, fechamento batendo exato (`difference = 0`). Sem `can_create` em `ponto-de-venda` (Administrador ainda com `realizar-venda`/`create`, testando o módulo isoladamente): botão desabilitado com a mensagem certa e RPC recusada com `42501` chamada direto. Produtos, Financeiro e Realizar Venda conferidos sem regressão (`sales.contactId` ficou opcional no tipo do front, nenhum call site dependia dele ser obrigatório).

#### Fora de escopo

Pausar/Retomar venda (botões desabilitados de propósito — seria uma feature real de "venda em espera", não pedida nesta etapa); scanner de código de barras/câmera/captura de foto (toolbar decorativa, hardware/integração futura); edição/cancelamento de venda de PDV já confirmada (mesma situação de `sales`/`sale_orders` em geral); emissão fiscal de verdade (só o gancho, ver acima).

### Decisão arquitetural: catálogo de módulos no banco + roteador dirigido por metadados (18/08/2026, noite)

Extensão do motor genérico no mesmo peso da decisão original dele — e a fundação de M3 ("Faça você mesmo": usuário final cria os próprios módulos). Até aqui o motor sabia montar o **conteúdo** de uma tela a partir de metadados, mas a existência de cada módulo continuava escrita à mão em três lugares que ninguém garantia estarem de acordo:

1. `src/App.tsx` — 19 `<Route>` com um `lazy(() => import(...))` cada;
2. `src/features/home/modules.ts` — `HOME_MODULES`, 15 itens (rótulo/ícone/rota), consumido pela tela inicial e pelo dock;
3. a tabela `modules` — 9 linhas, só os módulos que passaram pelo RBAC, sem rota, sem ícone, sem ordem.

Os três divergiam de fato: 6 módulos da tela inicial nunca chegaram ao banco, e `realizar-venda` se chamava "Realizar uma venda" no tile e "Realizar Venda" na grade de `/permissoes`.

#### A divisão que é o núcleo da etapa: catálogo no banco, registro no código

O erro que tornaria isto inútil seria mover a lista do `App.tsx` para uma tabela e continuar precisando de um `case` em código para cada módulo novo — só o hardcode mudando de lugar, com passos a mais. Um componente React não cabe no Postgres, então a pergunta não era "como guardar a rota no banco", era **"como um módulo que não tem componente próprio ainda assim vira uma tela"**.

- **O banco guarda o catálogo** (`modules`): quais módulos existem, rótulo, rota, ordem, chave de ícone, portão de acesso, se é do sistema ou do usuário.
- **O código guarda dois registros**, com o que não cabe no Postgres:
  - `src/features/modules/moduleComponents.ts` — `Record<string, LazyExoticComponent>`, id do módulo → tela própria, com os `lazy()` que moravam soltos no `App.tsx` (o code splitting não mudou: cada página continua um chunk).
  - `src/features/modules/moduleIcons.ts` — chave de ícone → asset. `import x from "...webp"` é resolvido pelo Vite no build (hash no nome, placeholder inline); uma string no banco nunca viraria um asset. O banco guarda a *chave*, o bundle guarda a *imagem*.
- **O roteador percorre o catálogo** e resolve cada módulo pelo registro; **quando não acha, cai na `GenericModulePage`**.

**"Tem componente próprio" NÃO é coluna no banco** — é "o id está no registro do código", e ponto. O banco não teria como validar que o componente existe, e as duas fontes divergiriam no primeiro rename de arquivo. Uma regra, uma fonte.

#### `GenericModulePage` — o fallback, que é a etapa toda

`src/features/modules/GenericModulePage.tsx` recebe a entrada de catálogo e se monta inteira a partir de `useModuleDefinition(moduleId)` + `module_fields` (`buildTableColumns`/`buildDetailFields`/`buildFormFields`, os mesmos de Produtos e Clientes) sobre `src/lib/repositories/genericModuleRepository.ts`, que lê e grava na tabela que `modules.data_table` aponta. Lista, ficha, formulário de criação/edição e exclusão, sem um arquivo por módulo.

- **É isto que faz M3 ser possível**: um módulo criado pelo usuário nunca vai ter entrada em `MODULE_COMPONENTS`, e precisa funcionar mesmo assim. Sem o caminho genérico funcionando ponta a ponta, M3 teria que refazer esta etapa.
- **O repositório genérico é o único lugar do projeto que abre mão da tipagem** (`supabase as unknown as SupabaseClient`): o nome da tabela só existe em tempo de execução, e os tipos gerados só aceitam nomes conhecidos em tempo de compilação. É o preço de um módulo poder existir sem código escrito para ele, e está confinado a um arquivo. Quem garante a forma dos dados é `module_fields`; quem garante o acesso é a RLS.
- **Módulos oficiais continuam com repositório tipado próprio** (`productsRepository`, `contactsRepository`): eles têm regra de negócio de verdade (sequencial de código, conversão de preço, joins). O genérico é o caminho de quem não tem nenhuma — não é para substituir os existentes.
- Campo opcional vazio vira `null` (não string vazia); obrigatório vazio já é barrado pelo `RegistryFormModal` lendo o próprio `module_fields`. A ordenação da lista sai do primeiro campo com `show_in_table`, não de um `created_at` que nem toda tabela tem.

#### Schema novo de `modules`

Antes: `id`, `label`, `data_table`, `layout_variant`, `is_locked`, `created_at`. Colunas novas:

| Coluna | Para quê |
| --- | --- |
| `path` | Rota. **Nulo** = item de catálogo sem tela (Relatórios: o tile existe e não leva a lugar nenhum, exatamente como antes). Índice único parcial impede duas linhas reivindicarem a mesma rota. |
| `icon_key` | Chave no registro de ícones do código. Nula ou sem entrada → ícone genérico de reserva. |
| `sort_order` | Ordem padrão na tela inicial (10..150, reproduzindo a ordem de `HOME_MODULES`). |
| `show_on_home` | Se ganha tile. Falso em Configurações (alcançada pela engrenagem) e Permissões (alcançada de dentro de Usuários) — as duas nunca tiveram tile. |
| `access_gate` | Qual portão decide o acesso — ver abaixo. |
| `branch_scoped` | Se a tabela é isolada por filial; o motor genérico filtra/grava com a filial ativa. |

- **`data_table` virou nulável**: um módulo de navegação pode não ter tabela (tela mock, tela administrativa). Só o motor genérico precisa dela. `ModuleDefinition.dataTable` acompanhou (`string | null`).
- **`is_locked` foi reaproveitado, não duplicado.** A coluna já existia e **não tinha nenhum leitor** — nem em código, nem em função SQL, e valia `true` nas 9 linhas. Passa a significar o que o nome já sugeria: `true` = módulo de sistema, `false` = módulo criado pelo usuário (M3). Nenhuma coluna `is_system` nova.
- **`access_gate` tem CHECK constraint**, diferente de `layout_variant` (que é só convenção + tipo TS). O motivo é o modo de falha: um valor errado em `layout_variant` erra um layout; um valor errado aqui **tranca gente para fora de uma tela**. No TS, valor desconhecido cai em `permission` (o mais restritivo) — falha fechado de propósito.

#### Telas administrativas: a armadilha que o catálogo tinha que tratar explicitamente

`/usuarios-operadores`, `/permissoes` e `/configuracoes` **não são gated por `has_permission`** — são controladas pelas flags globais do papel (`can_manage_users`, `can_manage_permissions`, `can_manage_branches`) ou por nada além de estar logado. Inseri-las em `modules` como módulo comum criaria um **segundo portão** (`has_permission('usuarios-operadores', 'view')`) que ninguém tem marcado, trancando todo mundo para fora de `/permissoes` — inclusive o Administrador, **inclusive a própria tela que se usa para consertar permissões**.

Decisão: **elas ficam no catálogo** (senão a tela inicial voltaria a ter uma segunda fonte para o tile de Usuários), **mas o catálogo diz qual portão se aplica a cada uma** via `access_gate`. Cinco valores: `permission` (o normal), `manage_users`, `manage_permissions`, `manage_branches`, `authenticated`.

- `canAccessModule()` (`src/features/modules/moduleAccess.ts`) é **uma função só com dois consumidores** — a tela inicial (quais tiles aparecem) e o roteador (quais rotas abrem). Se cada um decidisse por conta própria, um tile visível poderia levar a uma rota bloqueada, ou pior: uma rota aberta ficaria sem tile e ninguém notaria o furo.
- **A grade de `/permissoes` passou a filtrar `access_gate = 'permission'`**. Sem isso ela mostraria quatro checkboxes para "Permissões" e "Configurações" que não decidem nada, sugerindo que desmarcar "Ver" tranca a tela — o que não é verdade e faria alguém tentar.
- Isto é imposição de **UI**. Quem impõe de verdade continua sendo a RLS de cada tabela (`has_permission` nas policies); esconder o tile só evita o usuário descobrir a porta trancada depois de bater nela.

#### O estado de carregamento do roteador (o F5 que caía no login)

`<Route path="*">` redireciona rota desconhecida para `/` (login). Isso era seguro com a lista de rotas estática. Com o catálogo vindo do banco existe uma janela em que ele ainda não chegou — e nessa janela **toda** rota é desconhecida: um F5 em `/produtos` mandaria o usuário para o login em vez da tela dele.

`ModuleCatalogProvider` (`src/features/modules/ModuleCatalogContext.tsx`) expõe `status`, e `App.tsx` **só renderiza `<Routes>` — incluindo o `*` — depois de `status !== "loading"`**. Três estados, todos deliberados:

- `loading` enquanto a sessão não resolveu ou a consulta não voltou → tela de carregamento, nenhuma decisão de rota;
- `ready` com catálogo vazio quando **não há sessão** — aí o catálogo é vazio de direito, não "ainda carregando", e o `*` pode decidir na hora (a policy de leitura de `modules` é só para `authenticated`);
- `error` → mensagem com o erro, em vez de um app sem rota nenhuma redirecionando para o login em silêncio.

**Testado com F5 de verdade** (não só navegação por dentro do app) em `/produtos` e `/financeiro`.

#### Tela inicial, dock e sub-rotas

- **`HOME_MODULES` deixou de existir.** `src/features/home/modules.ts` só exporta o tipo `HomeModule` agora — que virou uma *forma de apresentação*, não um cadastro. `useModuleOrder` junta catálogo + registro de ícones e devolve esses objetos.
- **`reconcileOrder` adaptou limpo, como esperado** — ele já lidava com ids desconhecidos/faltando; a única mudança é de onde saem os ids. Como o catálogo chega depois do primeiro render, a reconciliação virou um efeito, com dois cuidados: não gravar no `localStorage` antes do catálogo chegar (apagaria a ordem do usuário) e devolver o mesmo array quando nada muda (evita render à toa).
- **Tiles sem `can_view` somem**, não ficam desabilitados. A tela inicial é um lançador: um tile que não abre nada só ocupa espaço e ensina o usuário a ignorar tiles. Antes os 15 tiles apareciam para todo mundo e a recusa só chegava no clique.
  - Consequência tratada: os 6 módulos que só existiam na tela inicial nunca tiveram permissão marcada. **Sem isso o Administrador perderia 5 tiles** — a migration insere `can_view` para eles.
- **`openWindows.tsx` não conhece mais `HOME_MODULES`**: pega `icon_key` no catálogo e o asset no registro de ícones — a mesma dupla que a tela inicial usa, então dock e tile nunca divergem. Módulo sem asset cai no ícone genérico, nunca em nada.
- **Rotas que não são módulo continuam declaradas à mão**: `/` (login) e `/inicio` (é o lugar de onde se abre os módulos, não um módulo).
- **Sub-rotas** (`/pedidos-venda/novo`, `/compras/nova`) ficam em `MODULE_SUBROUTES`, ao lado do registro de componentes: não são entradas de catálogo (ninguém navega até elas pela tela inicial, não têm ícone, não fazem sentido sozinhas), são um segundo cômodo do mesmo módulo — e **herdam o portão de acesso dele**.
- O portão passou a ser aplicado **no roteador**, não dentro de cada tela. Efeito colateral bom: as telas mock (que nunca checaram permissão nenhuma) passaram a ser barradas junto com as reais.

#### Prova do caminho genérico (feita de verdade, e desfeita no fim)

Criado **só por SQL** um módulo `teste-generico` (linha em `modules` + 6 linhas em `module_fields` apontando para `contacts`), **sem escrever nenhum componente para ele**, com `is_locked = false` (primeira linha marcada como "módulo do usuário") e `icon_key` nulo de propósito, para exercitar também o ícone de reserva. Confirmado no navegador:

- apareceu na tela inicial como 16º tile, com o ícone genérico;
- `/teste-generico` abriu (inclusive por navegação direta, sem passar pela tela inicial);
- lista com as 5 colunas de `show_in_table` (E-mail, que é `false`, ficou de fora); ficha com os 6 campos de `show_in_details` (E-mail incluído); formulário com os 6 campos e asterisco só nos 4 `is_required`;
- **CRUD completo**: criado um registro pelo formulário (gravado em `contacts`, com o campo opcional vazio virando `null`, não `''`), editado, e excluído com o `ConfirmDialog`;
- entrou no dock com o ícone genérico, ao lado dos módulos com webp próprio.

**O módulo de teste foi removido no fim** (as três tabelas + o registro criado), e a tela inicial voltou aos 15 tiles originais na ordem original — o que é, de quebra, mais uma prova de que o catálogo dirige tudo.

- **Achado que vale registrar para M3**: a RLS de `contacts` é `has_permission('clientes-fornecedores', ...)`, então o módulo de teste **pegou carona nas policies de outro módulo**. Um módulo criado pelo usuário não terá esse luxo: ou o M3 gera policies junto com a tabela, ou (mais provável, e já previsto na decisão original do motor) o armazenamento genérico JSONB nasce com uma policy genérica que resolve o módulo pelo id da própria linha. Esta etapa não decide isso — só deixa claro que é a próxima pergunta, não um detalhe.

#### Testado no navegador

Os 15 módulos existentes abrindo pela tela inicial e pelo dock, com os ícones certos, na ordem certa e com o selo "+" de Clientes e Fornecedores preservado; as 19 rotas (17 do catálogo + 2 sub-rotas) resolvendo cada uma na sua tela, nenhuma em branco, nenhuma redirecionada. F5 direto em `/produtos` e `/financeiro` sem cair no login. Reordenação por arraste (eventos de mouse reais, exercitando o `MouseSensor`) persistindo depois do reload. `/permissoes`, `/usuarios-operadores` e `/configuracoes` acessíveis pelas flags globais, e a grade de `/permissoes` mostrando só os 15 módulos gated por permissão. Com `can_view` de Financeiro desligado no papel Administrador: o tile sumiu (16 → 15), a rota passou a mostrar a recusa, e o `select` direto pelo cliente voltou **0 linhas** — religando, voltou 5, confirmando que quem barra é a RLS e não a UI. `tsc`, `oxlint` e `vite build` limpos, com o code splitting por página preservado. Nenhum erro no console em nenhum momento.

#### Fora de escopo

Criar módulo pela interface (é M3 — esta etapa só prova que um módulo sem componente próprio funciona quando inserido por SQL); armazenamento genérico JSONB (M3); editor visual de campos, permissões por campo, workflow. Nenhum módulo existente teve comportamento interno alterado — a única mudança de dado foi o rótulo de `realizar-venda`, unificado em "Realizar uma venda" (o que o tile já dizia) porque agora há um rótulo só para as duas telas.

### Decisão arquitetural: camada de emissão fiscal — interface + provedor simulado (18/08/2026, noite)

Fundação para NF-e/NFC-e. **Esta etapa não emite nota nenhuma** e não constrói Notas Emitidas, NFC-e nem Tributações: constrói só a interface, uma implementação simulada e o ponto único de troca entre as duas. Mesmo papel que `ModuleDataRepository<T>` cumpre para dado de módulo, só que para emissão fiscal.

**Por que agora, antes dos módulos que vão consumir isto**: o usuário quer validar o produto antes de assumir CNPJ, certificado digital A1 e mensalidade de provedor — ele ainda não sabe se o sistema vinga comercialmente. Isso só é possível se a emissão nascer isolada atrás de uma interface própria, com uma implementação que não depende de nada externo.

#### O payload foi modelado contra a documentação de um provedor real, não inventado

Este é o ponto central. A diferença entre o simulado e o real tem que ser **transporte** (gerar localmente vs. um `POST` numa API), não **estrutura**. Se o payload fosse inventado agora e o formato do provedor divergisse, a troca depois viraria reescrita — exatamente o que esta etapa existe para evitar.

- **Referência usada**: API da Focus NFe v2 — [`emitir_nfe`](https://doc.focusnfe.com.br/reference/emitir_nfe), [`consultar_nfe`](https://doc.focusnfe.com.br/reference/consultar_nfe), [`cancelar_nfe`](https://doc.focusnfe.com.br/reference/cancelar_nfe) e a tabela completa de campos em [campos.focusnfe.com.br](https://campos.focusnfe.com.br/nfe/NotaFiscalXML.html) (a página de referência do endpoint só documenta o núcleo dos campos de item; os campos de **valor** de imposto — `icms_base_calculo`, `icms_aliquota`, `icms_valor`, `pis_aliquota_porcentual`, `cofins_aliquota_porcentual` etc. — só aparecem na tabela completa, que foi consultada para não inventar grafia).
- `NfePayload` (`src/lib/fiscal/types.ts`) usa **snake_case em português, literalmente os nomes da Focus** — quebra a convenção camelCase do resto do projeto de propósito. Com isso, o `emit` do provedor real é um `JSON.stringify(payload)`.
- Os nomes não são invenção da Focus: são a tradução 1:1 do schema oficial da SEFAZ (`ide`, `emit`, `dest`, `det`/`prod`/`imposto`, `total`), o denominador comum de qualquer provedor sério. PlugNotas/Nuvem Fiscal/NFe.io expõem os mesmos conceitos com grafias próprias — migrar seria um mapa de nomes, não uma remodelagem.
- **O retorno, ao contrário, é camelCase nosso** (`FiscalDocument`), com o campo da Focus anotado em cada linha. O resultado é pequeno (uma dúzia de campos) e é o que os nossos módulos guardam e exibem; normalizá-lo custa uma função de adaptação dentro do provedor real e é o que permite um segundo provedor entrar sem tocar em Notas Emitidas.

#### Três desvios do desenho de partida do plano, todos por causa da documentação real

1. **`cancel`/`query` recebem `ref`, não `chave`.** No provedor real a chave de acesso não serve como identificador: ela só existe **depois** da autorização. Uma emissão que ainda está processando (ou que falhou) não tem chave nenhuma e precisa ser consultada do mesmo jeito. A Focus identifica tudo por `ref` — um identificador **gerado por nós**, usado na query string do `POST` e como chave do `GET`/`DELETE`. Manter `chave` obrigaria o provedor real a manter um mapa chave→ref e deixaria a consulta de nota em processamento sem resposta possível.
2. **Status usam o vocabulário da Focus**, que é o da SEFAZ: `autorizado` (não "autorizada"), `cancelado`, `erro_autorizacao`, `denegado`, `nao_encontrado` — e `processando_autorizacao`, que **o simulado nunca devolve** mas está no tipo porque a emissão real é assíncrona por padrão (a API responde 202 e a autorização sai depois, por consulta ou webhook). Deixar o estado de fora faria os módulos nascerem sem tratar o caso mais comum do provedor real.
3. **`xml`/`pdf` são `FiscalArtifact`, não string.** O simulado **gera o conteúdo localmente** (`content` preenchido, `path` nulo); a Focus **guarda o arquivo no servidor dela** e devolve o caminho (`caminho_xml_nota_fiscal`/`caminho_danfe` → `path` preenchido, `content` nulo até alguém baixar). Os dois campos nomeiam exatamente a diferença de transporte, em vez de escondê-la.

Além disso: **rejeição não é exceção**. Nota recusada pela SEFAZ volta como `status: "erro_autorizacao"` com `mensagemSefaz` — é resultado de negócio que a tela mostra, não falha de programa. As implementações só lançam quando o transporte falha.

#### `SimulatedFiscalProvider`

`src/lib/fiscal/simulatedFiscalProvider.ts` — sem I/O externo, sem custo, roda em script, teste ou navegador sem configurar nada.

- **Chave de acesso estruturalmente real** (`src/lib/fiscal/accessKey.ts`): 44 dígitos no layout do MOC — cUF/AAMM/CNPJ/modelo/série/número/tpEmis/cNF/cDV — com o **dígito verificador calculado pelo módulo 11 de verdade** (pesos 2..9 ciclando da direita, resto 0 ou 1 → DV 0). Um `substring` ou uma validação de DV feita por um módulo futuro se comporta como se comportaria com uma chave autorizada. O que ela não é, e não precisa ser, é uma chave *emitida*.
- `xml` é um XML na árvore do schema da SEFAZ (`infNFe` com `ide`/`emit`/`dest`/`det`/`total`, mais `protNFe`), com aviso de documento simulado no cabeçalho; `pdf` é um "DANFE" em HTML (não PDF: gerar PDF de verdade exigiria uma biblioteca para um arquivo descartável, e o provedor real devolve o PDF pronto).
- **Validação estrutural, não tributária**: falta de CFOP, NCM, CST, descrição ou quantidade positiva vira `erro_autorizacao` com a lista de problemas. Isso deixa os módulos consumidores exercitarem o caminho de recusa sem API real — justamente o caminho que ninguém testa. Alíquota e CFOP continuam fora de escopo (são Tributações, etapa 7).
- **Coerência de estado**: não dá para cancelar `ref` inexistente (`nao_encontrado`); justificativa fora de 15–255 caracteres é recusada antes de "sair" (regra da SEFAZ); cancelar duas vezes dá `erro_cancelamento` com SEFAZ 573 (duplicidade de evento); `query` de nota cancelada devolve `cancelado` preservando chave, protocolo e XML original, mais o XML do evento.
- **`emit` é idempotente por `ref`**: reemitir a mesma referência devolve o documento existente em vez de gerar uma segunda nota — proteção contra duplo clique/retry. **O provedor real precisa preservar isso** (a Focus recusa `ref` repetida; o adaptador mapeia essa recusa para uma consulta do `ref` existente).
- **Estado em memória, e nenhuma tabela nova nesta etapa.** Recarregar a página zera o registro, de propósito: quem persiste documento emitido é Notas Emitidas (etapa 8), que terá tabela própria — duplicar essa persistência aqui criaria duas fontes para o mesmo dado antes de a primeira existir. O provedor real também não guarda nada localmente; quem guarda é a API dele.
- `now` e `randomInt` são injetáveis, para um teste poder fixar chave e protocolo.

#### O ponto único de configuração

`src/lib/fiscal/provider.ts`, função `getFiscalProvider()`. **Nenhum módulo que emite nota pode ter um `if` de provedor** — todos chamam essa função. Trocar de provedor é mudar `VITE_FISCAL_PROVIDER` e acrescentar uma linha em `PROVIDER_FACTORIES`; nenhum arquivo de Notas Emitidas/NFC-e/Devolução é tocado.

**Por que variável de ambiente** (e não linha no banco nem constante): constante exigiria editar e rebuildar para alternar, e o mesmo bundle não serviria dois ambientes; linha no banco partiria a configuração em dois lugares, porque o provedor real precisa de **token** e de ambiente (homologação/produção), que são segredo e já moram no `.env.local` junto das credenciais do Supabase — guardar o token numa tabela seria pior, e guardar só o nome no banco deixaria as duas metades podendo divergir. Env var é o padrão que o projeto já usa para "com qual back-end eu falo".

**Falha fechado**: valor ausente ou desconhecido cai no simulado, com aviso no console. Mesmo raciocínio do `access_gate` — o modo de falha é que decide: erro de digitação no máximo deixa de emitir de verdade; o contrário emitiria nota fiscal real sem querer. `getFiscalProvider()` devolve **instância única** por sessão (o simulado guarda estado em memória; instância nova a cada chamada faria a consulta não achar o que a emissão acabou de emitir).

#### Prova do ciclo emit → query → cancel → query

`scripts/fiscal-cycle-check.mjs`, rodado com `node scripts/fiscal-cycle-check.mjs`: **23/23 verificações passaram**. Não é teste de navegador porque esta etapa não tem UI nenhuma.

O script carrega os módulos pelo `ssrLoadModule` do Vite em vez de rodar direto no Node — o Node 24 executa TS, mas exige extensão explícita nos imports e o projeto todo importa sem extensão; pelo Vite, o que é exercitado é **o mesmo grafo de módulos que o navegador carrega**, e `import.meta.env` fica populado a partir do `.env.local` (é assim que o ponto único de configuração é lido de verdade no teste). Ele **loga com a conta de testes** e monta o payload a partir de uma **venda real do banco** (venda `0009`, com filial, cliente, item e produto reais).

O que ficou provado:

- payload montado com os dados **como estão hoje** no banco → `erro_autorizacao` listando `item 1: CFOP ausente; item 1: NCM ausente`, **sem lançar exceção** (o caminho de recusa funciona);
- com as lacunas preenchidas → `autorizado`, chave `35260800000000000191550010000000011707425342` (44 dígitos, **DV conferido por implementação independente**: soma 438, resto 9, DV 2), com o CNPJ da filial nas posições 7-20; protocolo de 15 dígitos; XML de 2306 caracteres contendo `<chNFe>` e a descrição do item da venda real; DANFE HTML de 1589 caracteres;
- `query` devolve a nota autorizada; `query` de ref inexistente devolve `nao_encontrado`;
- `cancel` recusa justificativa curta e ref inexistente; cancela a nota autorizada devolvendo o XML do evento (`<tpEvento>110111</tpEvento>`) com a justificativa dentro; recancelar dá `erro_cancelamento` 573;
- `query` depois do cancelamento devolve `cancelado` preservando chave, protocolo e XML original;
- reemitir a mesma `ref` devolve o documento existente, não uma segunda nota.

`tsc -b`, `oxlint` e `vite build` limpos (só os 4 avisos `only-export-components` que já existiam), com o code splitting por página preservado.

#### Achados sobre o dado que já existe (etapa 0)

O teste com dado real expôs lacunas que as etapas seguintes precisam fechar — nenhuma é problema desta camada:

- **`contacts.indicador_ie` é texto livre** ("Não Contribuinte"), mas o payload quer o código da SEFAZ (1/2/9). Precisa virar código, ou ganhar mapeamento em Notas Emitidas. Mesma situação de `branches.regime_tributario`, que guarda o CRT como texto (esse pelo menos já é o próprio código).
- **`branches` só tem `address` como texto livre**, mas o payload quer logradouro/número/bairro/município/UF/CEP separados, e a UF é obrigatória para formar o `cUF` da chave. Hoje o simulado cai num `fallbackUfCode` (`35`). Endereço de filial vai precisar ser quebrado em colunas.
- **`products.ncm` e `sale_items.cfop` estão nulos** nos dados de teste — esperado (etapa 0 criou as colunas; quem preenche é Tributações), e é exatamente o que a validação estrutural do simulado apontou.
- O mapeamento venda → payload mora **no script**, de propósito, e não deve virar código de produção: ele é responsabilidade de Notas Emitidas (etapa 8), com os valores de imposto que Tributações (etapa 7) calcula.

`src/features/pos/fiscalDocument.ts` (o no-op deixado pela etapa do PDV) **continua intocado** — ele é o gancho da etapa de NFC-e, que passará a chamar `getFiscalProvider()`.

#### Fora de escopo

`FocusNfeProvider` (nenhuma chamada de rede foi implementada — a entrada existe em `PROVIDER_FACTORIES` valendo `null`, e entra quando o gatilho de ativação disparar: primeiro cliente real, ou etapas 0–9 concluídas em modo simulado, o que vier primeiro); Notas Emitidas, NFC-e e Devolução (as três consomem esta interface, nenhuma foi construída); cálculo de imposto e CFOP (é Tributações, etapa 7, que alimenta o payload com valores já calculados — esta camada não sabe nada sobre alíquota); certificado digital, assinatura de XML e DANFE de verdade (só existem no provedor real). Nenhuma tabela nova, nenhuma migration, nenhum módulo existente alterado.

### Decisão arquitetural: módulo Tributações — regras de CFOP/CST/alíquota (19/08/2026)

> ⚠️ **Esta decisão foi corrigida pela metade no mesmo dia** — ver "Correção: CFOP é da operação, CST/alíquota são do produto (grupos tributários)" mais abaixo. O que continua valendo: `tax_rules`, as cinco dimensões de entrada, a constraint de unicidade, o critério de desempate e a `GenericModulePage`. O que **não** vale mais: `tax_rules` guardar CST/CSOSN e alíquota, e `resolveTaxRule` devolver a regra inteira. Leia as duas seções juntas.

Etapa 7 do plano fiscal. Substitui o mock de duas linhas (`TAXATIONS`, "Simples nacional - ICMS"/"Lucro real" — que nomeava o conceito errado: regime tributário da empresa, já coberto por `branches.regime_tributario`) por um cadastro real de **regras de decisão fiscal**: para uma combinação de natureza da operação × UF origem/destino × tipo de cliente × regime de quem emite, qual CFOP/CST/alíquota se aplica. `src/features/taxations/` (página e mock antigos) foi removido por inteiro, não adaptado.

#### Schema: `tax_rules`

- **Não é isolada por filial** — `branch_scoped = false` em `modules`, sem coluna `branch_id`. UF de origem já é uma dimensão da própria regra: uma empresa com filiais em dois estados tem regras diferentes por UF, não duas cópias da mesma regra sob `branch_id`s diferentes — mesmo raciocínio já aplicado a Clientes e Fornecedores.
- Dimensões de entrada, todas `text` (mesma convenção de `branches.regime_tributario`: sem enum/constraint, o motor genérico não tem campo de seleção): `regime` (código CRT — '1'/'2'/'3', mesmo vocabulário de `branches.regime_tributario`, porque CST e CSOSN não coexistem na mesma operação), `natureza_operacao` ('venda'/'devolucao' por ora), `uf_origem`, `uf_destino` (aceita `'*'` como coringa para "qualquer UF destino" — é o único eixo de coringa que a tabela permite), `tipo_cliente` ('contribuinte'/'nao_contribuinte'/'consumidor_final').
- ~~Saída: `cfop` (obrigatório), `cst_icms`/`csosn` (os dois convivem, opcionais — mesma decisão já tomada em `products`, porque a regra escolhida depende do `regime` da própria linha), `aliquota_icms`/`aliquota_pis`/`aliquota_cofins` (`numeric(7,4)`, únicos campos numéricos do módulo — ver achado abaixo), `cst_pis`, `cst_cofins`, `cst_ibs_cbs`/`cclasstrib`.~~ — **corrigido no mesmo dia**: a saída é **só `cfop`**. As nove colunas de CST/alíquota foram removidas de `tax_rules` e viraram `tax_groups`, atrelado ao produto (ver a correção abaixo). O achado sobre campo numérico no motor genérico continua válido — só mudou de tabela (as alíquotas `numeric(7,4)` agora estão em `tax_groups`).
- **Constraint `tax_rules_dimensions_unique`** — `unique (regime, natureza_operacao, uf_origem, uf_destino, tipo_cliente)`: impede duas linhas idênticas nas cinco dimensões de entrada. Efeito colateral que simplifica a resolução: para uma operação qualquer, existe no máximo uma regra exata (`uf_destino` = a UF pedida) e no máximo uma regra coringa (`uf_destino = '*'`) — nunca duas do mesmo tipo brigando pelo mesmo lugar.
- RLS: quatro policies separadas (`select`/`insert`/`update`/`delete`, nunca `for all`) usando só `has_permission('tributacoes', ...)`, sem `has_branch_access` (a tabela não tem `branch_id`).

#### `GenericModulePage` bastou — sem componente próprio

Primeiro módulo de verdade desde M2 a nascer só com metadados (`modules`/`module_fields`), sem arquivo próprio: `modules.tributacoes` passou a apontar `data_table = 'tax_rules'`, o registro `tributacoes` saiu de `MODULE_COMPONENTS`, e o roteador caiu na `GenericModulePage` sozinho. 15 `module_fields` (as 5 dimensões + `cfop` com `show_in_table = true`; os 9 campos de saída restantes só em ficha/formulário, por não caberem na lista sem virar uma tabela ilegível).

- **Achado que valia a pena confirmar, não só assumir**: o motor genérico só declara `data_type: 'text'`/`'date'`/`'boolean'`/`'phone'`/`'email'` — não existe `'number'`. `aliquota_icms`/`aliquota_pis`/`aliquota_cofins` são colunas `numeric(7,4)` de verdade (não `text`, ao contrário do resto da tabela), e o caminho de escrita do motor genérico (`genericModuleRepository.ts`, `toColumns`) manda o valor do campo de texto direto para a coluna, sem conversão. Testado no navegador: `"12"`, `"1.65"`, `"7.6"` digitados nos campos de texto gravaram como `12.0000`/`1.6500`/`7.6000` em `tax_rules` sem erro — o PostgREST casta a string recebida no JSON para o tipo real da coluna na hora do insert/update. Não é um comportamento documentado em lugar nenhum do projeto até agora; registrado aqui porque o próximo módulo que precisar de um campo numérico de verdade sobre o motor genérico (não uma tela própria com conversão manual, como `ProductsPage.tsx`) pode contar com isso em vez de reinventar.
- **`role_permissions` de Tributações já existia** (criada com o RBAC original, só `can_view`), sobrou de quando a tela era mock e nunca tinha `can_create`/`can_edit`/`can_delete`. Passaram a `true` para Administrador, mesmo padrão de Produtos/Clientes e Fornecedores (CRUD completo — é cadastro de apoio, não registro de auditoria). Operador segue sem acesso, mesma pendência de todo módulo novo.

#### `resolveTaxRule` — a função pura que a etapa 8 vai chamar

`src/lib/fiscal/taxRules.ts`. Recebe as cinco dimensões de uma operação e as regras carregadas (`TaxRuleRow[]`) e devolve ~~`{ found: true, rule, matchedWildcard }`~~ (**corrigido**: `{ found: true, cfop, ruleId, matchedWildcard }` — só o CFOP) ou `{ found: false, reason, ambiguousRuleIds? }` — **nunca lança exceção**, mesmo espírito do `FiscalProvider`: quem chama consegue mostrar "cadastre uma regra para esta operação" em vez de quebrar a emissão. Não lê o banco — quem chama já buscou as regras (a função não sabe o que é Supabase).

- **Critério de desempate: mais específica vence.** Uma regra com `uf_destino` exato bate uma regra coringa (`uf_destino = '*'`) para a mesma combinação de regime/natureza/UF origem/tipo de cliente. É o único eixo de coringa que `tax_rules` permite, e a constraint `tax_rules_dimensions_unique` garante que não existem duas regras exatas nem duas coringas competindo pelo mesmo lugar — não foi preciso inventar uma prioridade arbitrária além dessa.
- **Empate defensivo devolve `found: false`, não escolhe uma regra sozinho** — `ambiguousRuleIds` lista as regras empatadas. Não deveria acontecer com dados vindos do banco (a constraint impede), mas a função não assume que quem chama sempre respeita isso (ex.: dado de teste montado à mão), e o pedido foi explícito: não decidir prioridade arbitrária sem avisar.
- Normaliza caixa e espaço nas cinco dimensões da consulta e das regras antes de comparar (`"Venda"` bate `"venda"`).

**Testado isoladamente** (`scripts/tax-rule-resolution-check.mjs`, rodado com `node scripts/tax-rule-resolution-check.mjs` — mesmo espírito de `scripts/fiscal-cycle-check.mjs` da etapa F1, sem banco/rede porque a função é pura, dados de regra fixos no próprio script): **11/11 verificações passaram** — regra exata bate mesmo com uma coringa também elegível (SP→RJ contribuinte); só a coringa bate quando não há regra específica (SP→MG contribuinte, cai na SP→* cadastrada); natureza sem nenhuma regra cadastrada (`devolucao`) devolve `found: false` com mensagem acionável, sem lançar exceção; normalização de caixa/espaço nas dimensões de entrada; `tipo_cliente` diferente troca a regra escolhida mesmo com a mesma UF origem/destino (SP→SP contribuinte cai na coringa, SP→SP consumidor_final bate uma regra interna específica); empate defensivo entre duas regras "exatas" idênticas devolve `found: false` com as duas sinalizadas em vez de escolher uma.

#### Testado no navegador

Logado com a conta de testes: criada uma regra (regime 3, venda, SP→RJ, contribuinte, CFOP 6102, CST ICMS 00, alíquota ICMS 12, PIS 01/1.65, COFINS 01/7.6, IBS/CBS 000/000001) — apareceu na lista e na ficha com os 15 campos; editada (CFOP 6102 → 6108, confirmado só 1 linha no banco, não duplicou); excluída com `ConfirmDialog`, banco voltou a 0 linhas. `can_view` desligado para Administrador direto no banco → `/tributacoes` mostrou "Você não tem permissão para acessar este módulo." (religado depois). Produtos e a tela inicial (15 tiles, "Tributações" na posição original) conferidos sem regressão. `tsc -b`, `oxlint` (só os 4 avisos `only-export-components` pré-existentes) e `vite build` limpos.

#### Fora de escopo

Aplicar a regra numa venda de verdade (preencher `sale_items.cfop`, montar o `payload` do `FiscalProvider` chamando `resolveTaxRule`) — **isso é a etapa 8 (Notas Emitidas)**, que consome esta função, não a reimplementa; `sale_items.cfop` continua nulo. NFS-e/CT-e/MDF-e (fora do escopo do plano). Cálculo de verdade de IBS/CBS (a tabela só guarda os códigos que uma regra carrega). Validação cruzada com a SEFAZ de alíquota vigente (as alíquotas cadastradas aqui são responsabilidade de quem opera o sistema manter corretas). Tela de administração de mais de uma UF/natureza/tipo de cliente por regra (cada linha é uma combinação — "matriz" fica para quem cadastra criar N linhas, não para o motor).

### Decisão arquitetural: módulo Notas Emitidas — emissão fiscal de verdade (19/08/2026)

Etapa 8 do plano fiscal, a que liga tudo que as etapas anteriores construíram separado: uma venda vira `NfePayload` (com CFOP/CST/alíquota de `resolveTaxRule`), passa por `getFiscalProvider()` (hoje sempre o `SimulatedFiscalProvider`) e o resultado é persistido e listado. `InvoicesPage.tsx`/`invoices.ts` eram mock (uma linha hardcoded, seis ações sem `onClick`) — viraram reais.

#### Lacunas de dado fechadas antes de mapear (as que a etapa F1 tinha exposto)

- **`branches.address` e `contacts.address` (texto livre) viraram seis colunas cada**: `logradouro`, `numero`, `bairro`, `municipio`, `uf`, `cep`. `branches` não tem UI (administração continua só por SQL); `contacts` é o módulo piloto do motor genérico, então a mudança também tocou `module_fields` (a linha `address` saiu, seis entraram no lugar, mesmo tratamento show_in_details/show_in_form) e o código feito à mão que já falava de `address` (`contactsRepository.ts`, `contactLookups.ts`, `CustomersPage.tsx`, `useSaleDraft.ts` — que ganhou `formatContactAddress()` em `contacts.ts` para montar o endereço de uma venda a partir das partes). Migração destrutiva: o `address` antigo (só uma linha tinha texto de verdade, "Rua Florianopolis") foi copiado inteiro para `logradouro` — não dá pra decompor texto livre em partes sem inventar dado, e essa é a única linha que sobrevive do formato anterior.
- **`contacts.indicador_ie` foi normalizado de texto livre para o código da SEFAZ** (`1` = contribuinte, `2` = isento, `9` = não contribuinte) — `update` com heurística de texto (`ilike '%isento%'` etc.) nos dados existentes, seguido de `CHECK (indicador_ie is null or indicador_ie in ('1','2','9'))`. `module_fields.label` ganhou a legenda dos códigos ("Indicador IE (1=Contribuinte, 2=Isento, 9=Não contribuinte)") porque o motor genérico não tem campo de seleção — mesma convenção já usada em `regime_tributario`/CRT.
- **NCM ausente não é inventado.** `resolveTaxRule`/a validação da emissão continuam exigindo que o cadastro do produto tenha `ncm` preenchido; sem ele, a emissão para com erro acionável citando o item, nunca grava nota parcial.

#### O mapeamento venda → payload (`src/features/sales/invoiceMapping.ts`)

Isto é o que morava em `scripts/fiscal-cycle-check.mjs` "de propósito, e não deveria virar código de produção" (decisão da etapa F1) — agora é `buildNfePayloadFromSale(sale, rules)`, pura (não fala com o Supabase, recebe os dados já buscados), nunca lança exceção — devolve `{ ok: false, errors }` (mesmo espírito de `resolveTaxRule`/`FiscalProvider`).

- ~~**Uma regra fiscal só por venda, não por item.** ... todo item da mesma venda usa o mesmo CFOP/CST/alíquota que a regra resolvida devolve. **CST/CSOSN do ICMS vêm da regra (Tributações), não mais do produto.**~~ — **corrigido no mesmo dia, e este era o bug**: só o **CFOP** é da venda inteira (é da operação). CST/CSOSN e alíquota passaram a ser **por item**, vindos do grupo tributário do produto — ver a correção logo abaixo. Na primeira versão, dois produtos de tributação diferente na mesma venda saíam com CST/alíquota idênticos. O que continua verdade: NCM/CEST/origem da mercadoria/unidade vêm do cadastro do produto.
- **`tipo_cliente` é derivado de CPF/CNPJ + indicador de IE, não só do indicador**: CPF (11 dígitos) é sempre `consumidor_final` — pessoa física não é contribuinte de ICMS, independente do que estiver em `indicador_ie`; CNPJ com indicador `1` é `contribuinte`; CNPJ com indicador `2`/`9`/ausente é `nao_contribuinte`. Documentado aqui porque a instrução original só citava "derivar do indicador normalizado" — o documento entrou na conta porque sem isso um cliente pessoa física com `indicador_ie` nulo (comum, já que a maioria dos cadastros não preenche isso pra CPF) cairia em `nao_contribuinte` por padrão, o que é semanticamente errado.
- **Validações que bloqueiam a emissão** (todas com mensagem acionável, nunca exceção): venda sem cliente identificado (NF-e exige destinatário — diferente do PDV/NFC-e, que é outra etapa); filial sem CNPJ/UF/regime tributário; cliente sem UF; item sem NCM; e o próprio `resolveTaxRule` devolvendo `found: false` (nenhuma regra cadastrada, ou empate — mesma mensagem que a função já produz).
- **Valores de imposto são calculados quando a regra tem alíquota** (base = valor bruto do item, `valor = base × alíquota / 100`, arredondado a centavos) para ICMS/PIS/COFINS — multiplicação simples, não a "conta de verdade" que a decisão de Tributações deixou de fora (essa ressalva era especificamente sobre IBS/CBS da Reforma Tributária, que nem tem campo em `NfePayloadItem`). Sem alíquota cadastrada na regra, os campos de valor ficam de fora do payload, não viram zero.
- **`local_destino`/`modalidade_frete` são calculados**, não fixos como no script de teste da F1 (`local_destino`: 1 se UF origem = UF destino, senão 2; `modalidade_frete`: 9 sem frete, 0 com frete). `informacoes_adicionais_contribuinte` **não** carrega mais o aviso "documento simulado" que o script tinha — isso é responsabilidade do próprio `SimulatedFiscalProvider` (que já anota isso no XML/DANFE que gera), não do payload que também vai para o provedor real.

#### Persistência (`src/lib/repositories/fiscalDocumentsRepository.ts`, tabela `fiscal_documents`)

- **Tabela nova, isolada por filial** (dado operacional): `branch_id`, `sale_id`, `model` (`nfe`/`nfce`), `ref` (única), `status` (mesmo vocabulário de `FiscalStatus`, exceto `nao_encontrado` — esse é resultado de consulta, nunca um estado persistido), `chave`/`numero`/`serie`/`protocolo`/`status_sefaz`/`mensagem_sefaz`, `xml_content`/`xml_path`/`pdf_content`/`pdf_path`/`cancel_xml_content`/`cancel_xml_path` (par completo por artefato, espelhando `FiscalArtifact`), `cancel_justificativa`, datas. `unique (sale_id, model)` — uma venda tem no máximo um documento por modelo.
- **`ref` é `venda-<sale.id>`** (`saleFiscalRef()`) — estável entre tentativas da mesma venda, é o que faz `emit()` ser idempotente por venda de verdade (proteção contra duplo clique/retry, testada no navegador: reemitir a mesma venda atualiza a mesma linha, `fiscal_documents` não ganha uma segunda).
- **Escrita é direta (insert/update client-side sob RLS), não RPC** — não há lógica atômica multi-tabela aqui (é um upsert de um registro só), mesmo critério já usado em Compras/Financeiro para escrita de registro único. RLS: quatro policies (`select`/`insert`/`update`, sem `delete` — não há ação de excluir) usando `has_permission('notas-emitidas', ...)` + `has_branch_access(branch_id)`. **`update` está mapeado para `can_edit`** (cancelar/reconsultar é escrita sobre um documento existente — mesmo precedente do Financeiro/Controle de Caixa).
- **Cancelamento recusado não grava nada.** `persistCancelResult` só escreve quando `result.status === "cancelado"`; `erro_cancelamento`/`nao_encontrado` viram uma exceção com a mensagem da SEFAZ, que a tela mostra — o documento continua `autorizado` no banco, porque a recusa é do evento de cancelamento, não uma mudança de status do documento em si.
- **`sale_items.cfop` é gravado depois de uma emissão autorizada** (`updateSaleItemsCfop`) — precisou de uma policy de `update` nova em `sale_items` (só tinha `select` até aqui; toda escrita anterior passava por `create_sale`, que roda com privilégio elevado). A policy nova é gated por `has_permission('notas-emitidas', 'create')` + `has_branch_access` via join em `sales`.
- **Limitação conhecida do provedor simulado, documentada e aceita**: o estado do `SimulatedFiscalProvider` mora em memória (decisão da etapa F1). Um F5 na página entre emitir e cancelar faz o provedor "esquecer" a emissão — `cancel()` devolveria `nao_encontrado` mesmo com o documento `autorizado` no banco. Não existe contorno sem furar a interface (seria escrever direto no banco sem passar pelo `FiscalProvider`, o que a etapa F1 proíbe). O provedor real não tem esse problema (a API dele persiste do lado de lá). Reemitir dentro da mesma sessão (sem F5) é idempotente de verdade, testado no navegador.

#### Tela (`InvoicesPage.tsx`) — as seis ações do mock, resolvidas, mais uma nova

A lista mostra **as vendas confirmadas da filial**, não só as que já têm nota — é daqui que a emissão é disparada: selecionar uma venda sem nota e clicar "Emitir Nota" (ação nova, adicionada porque nenhum dos seis botões do mock cobria "emitir"; decisão explícita pedida pela etapa). Coluna "Status fiscal" mostra "Sem nota"/"Autorizado"/"Processando"/"Erro na emissão"/"Denegado"/"Cancelado", com cor.

- **"Visualizar"/"Gerar XML"**: `openFiscalArtifact()` (`invoices.ts`) abre o artefato numa aba nova — serve tanto `content` (simulado, `Blob`/`createObjectURL`) quanto `path` (provedor real, `window.open` direto), exatamente o helper único que a decisão da F1 já antecipava; sem ele a troca de provedor quebraria a tela. "Visualizar" abre o DANFE (`pdf`), "Gerar XML" abre o XML.
- **"Cancelar"**: `CancelInvoiceModal.tsx` pede a justificativa (15–255 caracteres, regra da SEFAZ que o simulado já valida) e mostra a recusa sem mascarar. Habilitado só quando o documento está `autorizado` e o usuário tem `can_edit`. Cancelar **não mexe em estoque nem em `financial_entries`** — testado no navegador (mesmos valores antes/depois).
- **"Financeiro"**: só navega para `/financeiro` — a venda já gera o lançamento na confirmação (`create_sale`, etapa de parcelamento), emitir nota não deve gerar lançamento nenhum (duplicaria). **Não há deep-link/filtro por venda** (Financeiro não tem campo de busca hoje); quem for conferir localiza pelo campo "Documento" ("Venda 000X"). Ficou documentado como decisão consciente, não esquecimento — filtrar por origem é uma melhoria de Financeiro, não desta etapa.
- **"Carta de correção" e "Trocar"**: desabilitados. CC-e é evento que `FiscalProvider` (etapa F1) não cobre — cobrir seria redesenhar a interface, e a instrução desta etapa foi parar e documentar em vez de mexer nela. "Trocar" não tem especificação, mesma situação já registrada em Pedidos de venda/Compras.
- **De onde se emite**: decisão tomada — **daqui** (Notas Emitidas), não da tela de Realizar Venda. `src/features/pos/fiscalDocument.ts` (gancho do PDV) continua intocado/no-op — é NFC-e, modelo 65, etapa 8.5.

#### Permissões

`role_permissions` de `notas-emitidas` já tinha `can_view` (sobrou de quando a tela era mock). Ganhou `can_create` (emitir) e `can_edit` (cancelar/reconsultar — mesmo mapeamento do Financeiro/Controle de Caixa: escrita sobre registro existente é `edit`). Sem `can_delete` — não há ação de excluir. `modules.data_table` passou de `null` para `fiscal_documents`, `branch_scoped = true`.

#### Testado no navegador

Cadastrada uma regra em Tributações (regime 3, venda, SP→SP, consumidor_final, CFOP 5102, CST ICMS 00, alíquota 18/1,65/7,6) e um NCM em Produtos (Doritos). Venda 0009 (Bruno, PIX, R$45): emissão autorizada, chave de 44 dígitos com cUF real (35, de `branches.uf = 'SP'`, não o fallback), protocolo, XML (2492 caracteres, com `<chNFe>` e a descrição do item) e DANFE abrindo; `sale_items.cfop` gravado como `5102`. Reemissão da mesma venda: mesma chave, `fiscal_documents` continuou com 1 linha (idempotência confirmada por contagem no banco). Venda 0004 (Doritos + Arroz sem NCM): erro acionável citando o item 2, nenhuma linha gravada em `fiscal_documents`. Venda com cliente fora de qualquer regra cadastrada (UF destino sem regra): mensagem de `resolveTaxRule` mostrada na tela, sem exceção. Cancelamento: justificativa curta recusada com a mensagem da SEFAZ; justificativa válida cancelou de verdade (status `cancelado` na lista, XML do evento gravado); estoque do produto e `financial_entries` da venda conferidos idênticos antes/depois. Sem `can_create`/`can_edit`: "Emitir Nota" e "Cancelar" desabilitados na tela (checado via atributo `disabled` dos botões). Clientes e Fornecedores (novos campos de endereço aparecendo na ficha, indicador IE normalizado exibido com a legenda) e Financeiro conferidos sem regressão. `tsc -b`, `oxlint` (só os 4 avisos `only-export-components` pré-existentes) e `vite build` limpos.

#### Fora de escopo

NFC-e (modelo 65, etapa 8.5 — reaproveita a maior parte disto; `src/features/pos/fiscalDocument.ts` continua no-op); Devolução (etapa 9 — cancelar nota não é devolver venda); `FocusNfeProvider` (nenhuma chamada de rede); carta de correção, inutilização de numeração, manifestação do destinatário (eventos que `FiscalProvider` não cobre); deep-link do botão "Financeiro" para os lançamentos exatos da venda (Financeiro não tem esse filtro hoje).

### Correção: CFOP é da operação, CST/alíquota são do produto (grupos tributários) — 19/08/2026

**Isto é uma correção da decisão da etapa 7 (Tributações), não uma etapa nova.** Leia as duas juntas: a seção da etapa 7 acima descreve o que continua valendo, esta descreve o que mudou e por quê.

#### O erro

A etapa 7 modelou `tax_rules` como se CFOP, CST e alíquota dependessem **todos** só da forma da operação (regime × natureza × UF origem/destino × tipo de cliente) — uma regra por combinação, valendo para qualquer produto. Está certo pela metade:

- **CFOP realmente é da operação.** Uma venda interna e uma interestadual têm CFOPs diferentes independente do produto vendido.
- **CST/CSOSN e alíquota não são.** Dois produtos na *mesma* operação (mesma UF origem/destino, mesmo tipo de cliente, mesmo regime) podem ter tributação diferente: um com substituição tributária, outro isento, outro monofásico, outro com alíquota diferente. Uma regra por combinação de operação **não tem como representar isso** — todos os produtos daquela operação recebem a mesma tributação.

O usuário apontou o erro citando o padrão dos ERPs brasileiros de referência (Bling e afins): **grupo tributário** — um perfil nomeado e reutilizável (CST/CSOSN e alíquotas já definidos), criado uma vez e atrelado ao produto. A operação decide o CFOP; o produto, via seu grupo, decide CST e alíquota. Tributação é assunto sensível o bastante para não inventar desenho próprio quando existe padrão de mercado testado — foi esse que se seguiu, não um terceiro caminho.

#### O sintoma já estava em produção-de-desenvolvimento

A etapa 8 (Notas Emitidas) já tinha sido aplicada quando a correção começou, e `invoiceMapping.ts` já era um consumidor real de `resolveTaxRule` — lendo `rule.cstIcms`/`rule.aliquotaIcms`/etc. **uma vez, fora do laço de itens**, e aplicando igual a todos. Era pior do que "modelagem imprecisa": nem por item a nota diferenciava. A correção ajustou `invoiceMapping.ts` junto, não depois — deixar para depois significaria uma nota estruturalmente errada emitível no intervalo.

#### Schema

- **`tax_groups`** (tabela nova): `code` (único) + `name` (ex.: "Tributado 18%", "Isento") + a saída de tributação que estava em `tax_rules` — `cst_icms`/`csosn`, `aliquota_icms`, `cst_pis`/`aliquota_pis`, `cst_cofins`/`aliquota_cofins`, `cst_ibs_cbs`, `cclasstrib`. **Não isolada por filial** (cadastro de apoio compartilhado, mesmo raciocínio de `tax_rules` e `contacts`). Quatro policies separadas com `has_permission('grupos-tributarios', ...)`, sem `has_branch_access`.
  - `cst_icms` e `csosn` **convivem no grupo**, pelo mesmo motivo que já convivem em `products`: quem escolhe é o **regime de quem emite** (CRT 1/2 → CSOSN, CRT 3 → CST), não o cadastro do produto — e o mesmo produto pode ser vendido por filiais em regimes diferentes. `resolveIcmsSituacaoTributaria(group, regime)` (`src/lib/fiscal/taxGroups.ts`) resolve isso num lugar só, e **cai no outro código quando o esperado está vazio**: um grupo cadastrado só com CSOSN ainda descreve a tributação, e emitir com o código que existe é melhor do que recusar a nota por causa da coluna vazia. Devolve `null` só quando o grupo não tem nenhum dos dois — aí a emissão recusa com mensagem própria.
- **`tax_rules` perdeu nove colunas** (`cst_icms`, `csosn`, `aliquota_icms`, `cst_pis`, `aliquota_pis`, `cst_cofins`, `aliquota_cofins`, `cst_ibs_cbs`, `cclasstrib`). Sobrou `cfop` como única saída. **As cinco dimensões de entrada e a constraint `tax_rules_dimensions_unique` não mudaram** — essa parte da modelagem estava certa e não foi tocada. Migração destrutiva (projeto em desenvolvimento): a única linha existente era dado de teste e manteve o CFOP.
- **`products.tax_group_id`** (FK nulável para `tax_groups`, com índice). Os seis CSTs que a etapa 0 tinha posto direto em `products` (`cst_icms`, `csosn`, `cst_pis`, `cst_cofins`, `cst_ibs_cbs`, `cclasstrib`) **foram removidos**, não mantidos como override: dois lugares guardando a mesma decisão tributária divergem cedo ou tarde, e o padrão de mercado é "produto pertence a um grupo", não "produto com exceções campo a campo".
  - **Assimetria conhecida e deliberada: `products.cst_ipi` ficou.** `tax_groups` não tem campo de IPI, então `cst_ipi` **não era redundante** — removê-lo apagaria dado sem destino novo, e adicionar IPI ao grupo seria inventar além do que a correção pediu. `invoiceMapping.ts` continua lendo `product.cstIpi`. Se IPI virar assunto de verdade, o lugar dele é no grupo, junto do resto — este parágrafo existe para essa sessão futura não achar que foi descuido.
  - NCM/CEST/origem da mercadoria/unidade comercial/unidade tributável **também ficaram em `products`**: são propriedades do que o produto fisicamente é, não decisão de tributação.

#### `resolveTaxRule` mudou de forma

`{ found: true, rule, matchedWildcard }` virou **`{ found: true, cfop, ruleId, matchedWildcard }`**. Devolver `cfop` direto (em vez de manter `rule` com a tabela já enxuta) é deliberado: quem chama **não consegue mais** ler CST de lá nem por engano — o contrato passou a dizer sozinho de onde vem cada metade. `ruleId` fica para rastrear/depurar qual linha decidiu. A assinatura de entrada (as cinco dimensões) não mudou, nem o critério de desempate, nem o empate defensivo, nem a normalização de caixa/espaço.

#### `invoiceMapping.ts`: a decisão de CST desceu para dentro do laço

- O bloco que resolvia CSOSN-vs-CST **uma vez para a venda inteira** virou uma chamada de `resolveIcmsSituacaoTributaria(item.product.taxGroup, regime)` **por item**. Alíquotas de ICMS/PIS/COFINS idem: saem de `item.product.taxGroup`, não mais de `rule`.
- **Produto sem grupo bloqueia a emissão**, com o item identificado, no mesmo array de erros que a checagem de NCM ausente já usava. **Não existe grupo padrão de fallback** — decisão explícita: um fallback silencioso é exatamente o "nota emitida com dado errado sem avisar" que esta correção existe para evitar.
- Erro novo irmão desse: grupo atrelado mas **sem CST nem CSOSN** cadastrado recusa citando o nome do grupo ("complete o cadastro em Grupos tributários").
- `SaleForInvoiceProduct` ganhou `taxGroup: TaxGroup | null`, e `fetchSaleForInvoice` (`fiscalDocumentsRepository.ts`) traz o grupo por join aninhado (`products` → `tax_groups`).

#### Tela

- **`tax_groups` roda na `GenericModulePage`, sem componente próprio** — segundo módulo a nascer só de metadados depois de Tributações, e pelo mesmo motivo (CRUD simples de cadastro de apoio). 11 `module_fields`; os 5 primeiros (código, nome, CST ICMS, CSOSN, alíquota ICMS) na lista, o resto só em ficha/formulário. `icon_key` **nulo de propósito** — não existe asset e criar imagem é fora de escopo; o ícone genérico de reserva é caminho suportado e documentado.
  - **Confirmado de novo o achado da etapa 7**: alíquotas são `numeric(7,4)` de verdade e o motor genérico manda o texto do formulário direto para a coluna — `"18"`, `"1.65"`, `"7.6"` gravaram como `18.0000`/`1.6500`/`7.6000` sem conversão no cliente.
- **Produtos ganhou o campo "Grupo tributário" via `lookupField`** do `RegistryFormModal` — o mesmo prop de ponte que o Financeiro usa para o contato, agora buscando em `tax_groups` (`taxGroupLookups.ts`). **`module_fields` continua sem um `data_type: 'lookup'`**: criar um generalizaria o motor inteiro por causa de um campo, mesma disciplina já registrada no Financeiro. O nome do grupo aparece na ficha como acessor de leitura (`tax_group_name`, vem de join), nunca gravado pelo formulário.
- **Pegadinha tratada: o atalho de edição do `ProductPickerPanel`** (o lápis, usado por Realizar Venda/Compras/Ajuste de estoque) mostra só os campos básicos e **não** tem o lookup de grupo. Ele repassa `editingProduct.taxGroupId` explicitamente — sem isso, editar o preço de um produto por ali desatrelaria o grupo dele em silêncio, e a próxima nota daquele produto seria recusada sem ninguém entender por quê.

#### Permissões

Linha nova em `modules` (`grupos-tributarios`, `path: /grupos-tributarios`, `data_table: tax_groups`, `access_gate: permission`, `branch_scoped: false`, `sort_order` 85 — logo depois de Tributações, sem renumerar nada) + `role_permissions` com CRUD completo para Administrador (cadastro de apoio, mesmo padrão de Tributações/Produtos). Operador segue sem acesso.

- **Detalhe de UX que não é bug**: para quem já tem uma ordem de tiles salva no `localStorage`, o tile novo aparece **no fim** da tela inicial, não na posição 9 — `reconcileOrder` acrescenta ids desconhecidos no fim de propósito (comportamento já documentado na decisão do catálogo). `sort_order = 85` é a posição para quem ainda não reordenou nada.

#### Testado

**Isoladamente** (`node scripts/tax-rule-resolution-check.mjs`, adaptado ao novo retorno): **12/12** — as 11 verificações da etapa 7 continuam passando (regra exata × coringa, sem regra, normalização, tipo de cliente, empate defensivo) e uma 12ª nova confere que o resultado **só** expõe `cfop`/`ruleId`/`matchedWildcard`, nenhum CST ou alíquota.

**No navegador**, logado com a conta de testes:

- Criados dois grupos pela `GenericModulePage`: `TRIB18` "Tributado 18%" (CST ICMS 00, alíquota 18, PIS 01/1,65, COFINS 01/7,6) e `ISENTO` "Isento" (CST ICMS 40, sem alíquota, PIS 07, COFINS 07). Conferidos na lista, na ficha e no banco.
- Atrelados a produtos diferentes pelo formulário de Produtos, via a lupa: Doritos → TRIB18, Arroz → ISENTO.
- **Bloqueio de produto sem grupo**: emitir a venda 0004 antes de atrelar o Doritos parou com `"Item 1 (001 — Doritos 120g pizza): sem grupo tributário..."` — e o Arroz, que já tinha grupo, **não** foi sinalizado (a mensagem aponta o item certo, não a venda inteira). Nenhuma linha gravada em `fiscal_documents`.
- **A prova da correção**: com os dois atrelados, a venda 0004 (Doritos + Arroz) foi autorizada e o XML saiu com **CFOP igual e tributação diferente por item** — item 1 `<CFOP>5102</CFOP>` + `<CST>00</CST>` + `<vICMS>2.70</vICMS>` (15,00 × 18%) + PIS/COFINS 01; item 2 `<CFOP>5102</CFOP>` + `<CST>40</CST>` + **sem** `vICMS` + PIS/COFINS 07. Totais coerentes: `vBC` 15,00 (só a base do item tributado), `vICMS` 2,70, `vProd` 43,90 (os dois itens), `vPIS` 0,25, `vCOFINS` 1,14 — o item isento entra no total de produtos e fica fora dos impostos. `sale_items.cfop` gravado `5102` nos dois.
- **RLS**: com `can_view` de `grupos-tributarios` desligado, `/grupos-tributarios` mostrou a recusa **e** a ficha de Produtos passou a exibir "Grupo tributário" vazio para um produto que tem `tax_group_id` no banco — o join embutido voltou nulo porque a RLS de `tax_groups` bloqueou, sem nenhuma mudança de código. Religado, o nome voltou. É prova de banco, não de UI.
- Tela inicial com 16 tiles, o novo com o ícone genérico; nenhum erro de console no carregamento. `tsc -b`, `oxlint` (só os 4 avisos `only-export-components` pré-existentes) e `vite build` limpos.

#### Fora de escopo

Categoria de produto / grupo herdado por tipo de produto (não pedido); substituição tributária com MVA e pauta fiscal de verdade (o grupo guarda o CST que sinaliza ST, não calcula base de ST); IPI no grupo (ver a assimetria acima); backfill de grupo nos produtos existentes (dois foram atrelados no teste, o terceiro segue sem grupo de propósito, como caso de recusa).

### Decisão arquitetural: módulo NFC-e — gancho do PDV (19/08/2026)

Etapa 8.5. Implementa `emitFiscalDocumentForSale` (`src/features/pos/fiscalDocument.ts`), até aqui um no-op documentado, chamado depois de toda venda do PDV confirmada. Reaproveita a maior parte da estrutura de Notas Emitidas (mesmo provedor, mesmo `fiscal_documents`, mesma resolução de CFOP/CST/alíquota) — mas **não** a exigência de cliente, que é o ponto onde uma cópia ingênua de `invoiceMapping.ts` teria quebrado.

#### Por que cliente é opcional em NFC-e e obrigatório em NF-e, sem duplicar a lógica de CFOP/CST

NFC-e é o oposto de NF-e neste ponto: a imensa maioria das vendas de balcão não tem CPF do cliente, e isso é normal, não erro de cadastro. Reaproveitar a validação "sem cliente, sem nota" da NF-e bloquearia toda venda anônima do PDV — a maioria.

`src/features/sales/invoiceMapping.ts` foi fatorado para isso sem duplicar a parte que é genuinamente comum: `resolveItemsForSale` (função interna) resolve o CFOP via `resolveTaxRule` e, por item, CST/CSOSN e alíquota via `resolveIcmsSituacaoTributaria(item.product.taxGroup, regime)` — idêntico ao caminho que a correção de CST/grupos tributários já deixou pronto para NF-e, chamado pelas duas funções exportadas. O que diverge fica em cada função:

- **`buildNfePayloadFromSale`** (inalterada) continua exigindo `sale.contact` e a UF do cliente.
- **`buildNfcePayloadFromSale`** (nova) só exige filial com CNPJ/UF/regime — cliente é parâmetro opcional de verdade, não um valor vazio forçado. Decisões específicas do modelo, todas deliberadas, não derivadas de nada:
  - `consumidor_final` sempre `1` e `presenca_comprador` sempre `1` — NFC-e é sempre venda presencial a consumidor final, mesmo quando o cliente identificado tem CNPJ.
  - `uf_destino` da consulta a `resolveTaxRule` é **sempre a UF da própria filial**, identificado ou não o cliente: a operação é interna e presencial por natureza (quem compra está fisicamente na loja), então a UF cadastrada do cliente (que pode morar em outro estado) não deveria mudar CFOP/`local_destino`. `local_destino` é sempre `1` pelo mesmo motivo.
  - Sem cliente, o grupo inteiro de campos de destinatário sai do payload — não força nenhum vazio. Confirmado contra a documentação pública da Focus NFe (`doc.focusnfe.com.br/reference/emitir_nfce`) que não existe indicador de "operação sem destinatário": a ausência do grupo já significa isso.
  - Com cliente, manda só nome + CPF/CNPJ (+ telefone se tiver, + IE só se CNPJ) — sem endereço completo, que não se pede num balcão (`buildNfceDestinatarioFields`, mais enxuto que o bloco de destinatário da NF-e de propósito).
  - `formas_pagamento` (grupo `pag`, documentado como obrigatório na NFC-e desde a etapa F1) é preenchido a partir de `sale_payments` — a NF-e desta etapa não preenche isso (fora do escopo original dela), então `SaleForInvoice` ganhou `payments: SaleForInvoicePayment[]` (de `fetchSaleForInvoice`) só para quem precisa.

#### CSC e QR Code

Pesquisado contra a documentação pública da Focus NFe (`doc.focusnfe.com.br/reference/emitir_nfce`) antes de desenhar, mesmo procedimento já registrado na decisão da F1:

- **O CSC (Código de Segurança do Contribuinte) não é campo de payload nem de resposta.** No provedor real ele é configuração de conta, por CNPJ+UF, direto no painel da Focus — por isso **não** entrou em `NfePayload` nem em nenhuma tabela nova. `FiscalDocument.qrCodeUrl`/`types.ts` documenta isso explicitamente para a próxima sessão não reinventar um campo de CSC por engano.
- **QR Code é o campo `qrcode_url` da resposta da Focus.** Virou `FiscalDocument.qrCodeUrl` (`string | null`, só preenchido para `model === "nfce"`) e a coluna nova `fiscal_documents.qr_code_url` (nullable — não muda a superfície de RLS, mesma convenção já registrada no roteiro de novo módulo).
- **`SimulatedFiscalProvider`** ganhou `src/lib/fiscal/nfceQrCode.ts`: monta uma URL no formato do MOC (`?p=<chave>|<versão>|<tpAmb>|<idCSC>|<hash>`) apontando para um host fictício (`*.invalid`, reservado por RFC para domínios que nunca resolvem) — o hash é só estruturalmente plausível (hex de 40 caracteres, determinístico), não SHA-1 de verdade, porque não há CSC nenhum no simulado para assinar de verdade. Mesmo espírito da chave de acesso estruturalmente real da F1: a forma importa, o conteúdo não precisa ser válido. O XML simulado ganhou `<infNFeSupl>` com o QR Code quando o modelo é NFC-e; o "DANFCE" HTML ganhou um link.

#### O que acontece quando a emissão falha depois da venda já confirmada

A venda do PDV já está confirmada e o estoque já baixou **antes** deste gancho rodar (por desenho — decisão do Ponto de Venda). Não existe "desfazer a venda" por causa de uma nota que não saiu. Critério adotado:

- `emitFiscalDocumentForSale` **nunca lança exceção** — devolve `{ ok: true } | { ok: false; errors }`. `usePosSale.ts` guarda isso num estado novo, `fiscalWarning`, **separado de `submitError`** de propósito: `submitError` continua significando "a venda em si falhou"; `fiscalWarning` é "a venda foi, a nota não saiu" — misturar os dois faria uma falha de nota parecer que a venda não aconteceu, quando aconteceu. `PosPage.tsx` mostra os dois como avisos visualmente distintos (vermelho para erro de venda, âmbar não bloqueante para aviso fiscal) — não bloqueia "Confirmar Venda" nem esconde o problema.
- **Se a validação do payload falhar antes de chamar o provedor** (produto sem grupo tributário, sem NCM, nenhuma regra de CFOP para a operação), **nenhuma linha é gravada em `fiscal_documents`** — não existe "documento" para persistir, só um resultado de validação. Não há tela de "falhas de emissão" pendentes hoje; o aviso que aparece na hora é a única superfície.
- **Se o provedor recusa** (a SEFAZ, no caminho real), `persistEmitResult` grava a linha com `status: "erro_autorizacao"` — mesma leitura que Notas Emitidas já dá a uma NF-e recusada.
- **Pegadinha de permissão, mesma categoria já registrada em `create_pos_sale`/PDV**: persistir o documento exige `has_permission('notas-emitidas', 'create')` de quem está logado no caixa (a mesma permissão que Notas Emitidas usa para emitir manualmente) — **além** de `ponto-de-venda`/`create` e `realizar-venda`/`create` que o PDV já exigia. Um papel de operador de caixa vai precisar das três.

#### Tela (Notas Emitidas)

`InvoicesPage.tsx`/`fiscalDocumentsRepository.ts` **não eram agnósticos de modelo** — `fetchInvoiceSales` filtrava `fiscal_documents` por `model = "nfe"` explicitamente, e a coluna "Modelo" da tabela mostrava `"NF-e"` fixo. Os dois foram corrigidos: a busca trouxe os dois modelos juntos (ordenados por `updated_at desc`, o mais recente por venda vence se por acaso a mesma venda tiver documento dos dois modelos — não deveria ser o caminho comum, mas o schema permite via `unique(sale_id, model)`), e a coluna mostra "NFC-e"/"NF-e" a partir do documento de verdade. Não virou tela nova nem filtro por modelo (não pedido — "se fizer sentido", e a lista já é pequena o bastante para não precisar).

#### Testado

Não foi possível testar clicando na tela nesta sessão — o Browser pane não conseguiu alcançar nenhum servidor de dev local neste ambiente (falha consistente em `navigate` mesmo para portas livres recém-abertas, com ou sem a porta fixa de `.claude/launch.json`; `--port 5188` foi removido do `runtimeArgs` e `autoPort: true` foi ligado porque outra sessão já ocupava 5188, mas isso não foi o que bloqueou a navegação — sites externos como `example.com` carregaram normalmente na mesma aba). Em vez disso, `scripts/nfce-emission-check.mjs` (mesmo padrão de `fiscal-cycle-check.mjs`: `ssrLoadModule` do Vite, login com a conta de testes, dados reais do banco) exercitou o caminho de produção ponta a ponta — **23/23 verificações passaram**:

- Venda do PDV sem cliente (Doritos, com grupo tributário) → NFC-e autorizada, chave de 44 dígitos válida, QR Code presente, numeração começando em 1, CFOP gravado nos itens.
- Venda do PDV com cliente identificado (Arroz, Bruno via `LookupModal`) → payload confirmado com nome/CPF do destinatário, `consumidor_final`/`presenca_comprador` continuam 1, `formas_pagamento` presente com o PIX da venda; segunda NFC-e incrementa a numeração para 2 (mesma série da filial, contador em memória do processo).
- Venda com produto sem grupo tributário nem NCM (Café) → venda confirmada normalmente (não trava), emissão recusada citando o item, **nenhuma linha gravada em `fiscal_documents`**.
- NF-e emitida logo depois para a venda que já tinha NFC-e (a de Bruno) → autorizada com numeração própria em 1, **não** contando a partir de 2 (prova de séries independentes por `model`, mesma chave `cnpj:model:serie` que a F1 já implementava — não foi preciso mexer no `SimulatedFiscalProvider` para isto funcionar).
- `fetchInvoiceSales` (o que alimenta Notas Emitidas) devolve a venda com NFC-e sem escondê-la, e a venda com emissão recusada sem documento nenhum.

`tsc -b`, `oxlint` (só os 4 avisos `only-export-components` pré-existentes) e `vite build` limpos. Migration (`fiscal_documents.qr_code_url`) aplicada e `get_advisors` conferido — nenhum aviso novo (coluna nova nulável, mesma convenção já documentada). **Fica pendente**: confirmar visualmente no navegador (aviso âmbar no PDV, coluna "Modelo" em Notas Emitidas, DANFCE com o link do QR Code) assim que o Browser pane conseguir alcançar um servidor local nesta máquina — o script comprova a lógica de produção, não o CSS/layout.

#### Fora de escopo

Impressão térmica do cupom fiscal (formato de impressora fiscal/não fiscal — nenhum módulo do sistema faz isso hoje); contingência offline do PDV (venda sem internet, emissão depois — não pedido, decisão própria se vier a ser necessário); `FocusNfeProvider` real (continua só o simulado); filtro por modelo na tela de Notas Emitidas (lista já mostra os dois sem esconder nenhum; filtro fica para quando a lista crescer o bastante para precisar).

### Correção: o wizard de Realizar Venda não emitia nota nenhuma (21/08/2026)

**Bug de risco fiscal real, não só tela desatualizada.** O wizard (`SaleWizard.tsx` → `ConfirmacaoStep.tsx`) sempre teve dois botões, "Salvar Venda" e "Gerar Nota Fiscal" — desde antes da etapa 8 (Notas Emitidas) existir, quando o comentário "não existe emissão fiscal real no sistema ainda" era verdade. Deixou de ser verdade quando a etapa 8 nasceu, mas ninguém religou os dois lados: os dois botões continuaram gravando exatamente a mesma coisa, e "Gerar Nota Fiscal" só trocava a mensagem da tela de sucesso para "Nota fiscal da venda X gerada!" sem nenhuma linha nova em `fiscal_documents`. Confirmado no navegador antes da correção: "Ver nota" levava para Notas Emitidas, que mostrava a mesma venda como "Sem nota" — a contradição entre as duas telas era a prova de que a mensagem de sucesso mentia.

**A decisão foi religar de verdade, não remover o botão.** O wizard foi desenhado para um fluxo de clique único (venda + nota juntas); a alternativa de centralizar emissão só em Notas Emitidas removeria uma conveniência que o produto já oferecia sem resolver o risco por um caminho mais simples. O que importava era não duplicar a lógica de "montar payload + emitir + persistir" — foi exatamente uma segunda implementação divergindo da primeira que teria causado (ou effectivamente já causava, na forma de "não faz nada") este bug.

#### `emitInvoiceForSale`: o núcleo extraído

`useInvoicesData.ts`'s `emitInvoice(saleId)` fazia tudo num só lugar: buscava a venda + as regras fiscais, montava o payload (`buildNfePayloadFromSale`), chamava `getFiscalProvider().emit()`, persistia (`persistEmitResult`), gravava o CFOP dos itens (`updateSaleItemsCfop`) e só então recarregava a lista de notas. **Tudo menos o `reload()`** virou `emitInvoiceForSale(branchId, saleId)` em `fiscalDocumentsRepository.ts` — mesmo arquivo de onde já vinham `fetchSaleForInvoice`/`persistEmitResult`/`saleFiscalRef`/`updateSaleItemsCfop`, então não é uma dependência nova entre `features/sales` e o repositório (o repositório já importava `SaleForInvoice` de `invoiceMapping.ts` antes desta correção). `useInvoicesData.emitInvoice` virou um wrapper fino: chama a função extraída, depois `await reload()` — mesmo padrão de núcleo reutilizável + porta específica de quem consome já registrado em `financial_entries_create_installments`.

`emitInvoiceForSale` **nunca lança exceção** — devolve `{ ok: true } | { ok: false; errors }`, mesmo contrato de `emitFiscalDocumentForSale` (`src/features/pos/fiscalDocument.ts`, NFC-e do PDV) e do `EmitOutcome` que já existia em `useInvoicesData.ts` (movido para o repositório, reexportado de lá para não quebrar quem já importava).

#### `useSaleDraft.confirmSale`: a venda nunca falha por causa da nota

`confirmSale()` ganhou um parâmetro opcional (`confirmSale({ emitirNota: true })`, default sem emitir). A ordem importa: a venda grava primeiro (`createSale`, `setConfirmedSale`) e **só depois de gravada com sucesso** — nunca antes, nunca condicionando a gravação — `emitInvoiceForSale` é chamado se `emitirNota` foi pedido. O resultado vai para um estado novo, `fiscalOutcome`, separado de `submitError` de propósito: mesma filosofia já registrada no gancho de NFC-e do PDV (`fiscalWarning` separado de `submitError` em `usePosSale.ts`) — `submitError` continua significando "a venda em si falhou"; uma falha de emissão aqui é aviso, não erro de venda, porque a venda de fato aconteceu (estoque baixou, financeiro gerou) independente de a nota sair.

#### Tela: o resultado real decide o título, não a intenção

Em `SalePage.tsx`, a tela de sucesso passou a olhar `draft.fiscalOutcome`, não só `lastIntent === "nota"`:

- Nota não pedida → "Venda X confirmada!" (como já era).
- Pedida e `fiscalOutcome.ok === true` → "Nota fiscal da venda X gerada!" — agora é verdade. "Ver nota" continua indo para `/notas-emitidas`.
- Pedida e `fiscalOutcome.ok === false` → título continua "Venda X confirmada!" (é sempre verdade) com um aviso âmbar não bloqueante abaixo (`.sale__fiscal-warning`, mesmo padrão visual de `.pos__fiscal-warning` do PDV — nem vermelho, que sinalizaria falha da venda, nem verde, que seria sucesso pleno) listando `fiscalOutcome.errors`. O botão "Ver nota" some (não existe nota); vira "Tentar emitir depois", levando para `/notas-emitidas`, onde "Emitir Nota" já funciona para aquela venda — não foi construído deep-link para a nota específica, mesmo escopo já limitado nas etapas 8/8.5.

`ConfirmacaoStep.tsx` e `SaleWizard.tsx` perderam os comentários desatualizados ("não existe emissão fiscal real no sistema ainda" / "'nota' não gera nenhuma nota fiscal de verdade") — `SaleIntent` como tipo não mudou, só passou a significar o que diz.

#### Testado

`scripts/wizard-invoice-check.mjs` (mesmo padrão de `fiscal-cycle-check.mjs`/`nfce-emission-check.mjs`: `ssrLoadModule` do Vite, login com a conta de testes, dados reais do banco) exercitou o caminho de produção que o wizard chama por baixo — **11/11 verificações passaram**: venda com produto com NCM+grupo tributário → `emitInvoiceForSale` autoriza e `fiscal_documents` ganha uma linha real (`model=nfe`, `status=autorizado`) para aquela venda especificamente, provando o fim da divergência; venda com produto sem grupo tributário (Café) → venda confirmada normalmente, emissão recusada citando o item, nenhuma linha gravada; Notas Emitidas (`fetchInvoiceSales`) mostra as duas vendas com o status real, nunca divergente; reemissão da mesma venda continua idempotente (upsert por `ref`, 1 linha só). **Não testado no navegador nesta sessão** — mesma limitação de ambiente já documentada na etapa 8.5 (o Browser pane não conseguiu alcançar o servidor de dev local, `navigate` falhou consistentemente mesmo em porta livre recém-aberta); `tsc -b`, `oxlint` (só os 4 avisos `only-export-components` pré-existentes) e `vite build` limpos. **Fica pendente**: confirmar visualmente o aviso âmbar na tela de sucesso e o botão "Tentar emitir depois" assim que o Browser pane conseguir alcançar um servidor local nesta máquina.

#### Fora de escopo

Qualquer mudança em Notas Emitidas além da extração (`InvoicesPage.tsx` continua chamando `emitInvoiceForSale` por baixo de `useInvoicesData.emitInvoice`, sem diferença de comportamento); NFC-e/PDV (não mexido, já emitia de verdade desde a etapa 8.5); deep-link direto para a nota específica em vez da lista de Notas Emitidas.

### Decisão arquitetural: módulo Devolução de venda (19/08/2026)

Etapa 9, e a primeira que precisa desfazer **proporcionalmente** três coisas que não sabem nada umas das outras: estoque (o item volta), financeiro (o dinheiro daquele item precisa voltar) e nota fiscal (a operação foi documentada para a SEFAZ, a devolução também precisa ser). `SaleReturnPage.tsx`/`saleReturns.ts` eram mock (`SALE_RETURNS` com um item de exemplo, "Devolver venda" sem `onClick`, e o rótulo de busca ainda dizia "Buscar Compra", copiado do mock de Compras — corrigido para "Buscar devolução").

Esta etapa **não constrói quase nada do zero**: orquestra o que quatro etapas anteriores já deixaram pronto — `create_sale`/`sale_items` (a venda original), `resolveTaxRule` com `natureza_operacao` como dimensão, `FiscalProvider.cancel`/`CancelInvoiceModal`/`invoiceMapping.ts`, e `financial_entries_create_installments` com `origin_kind`/`origin_id`.

#### Schema

- **`sale_returns`** (cabeçalho, `branch_id` — dado operacional): `sale_id` (a venda original), `code` sequencial por filial (`unique (branch_id, code)`), `status` (enum `sale_return_status`: `confirmed`/`cancelled`, espelhando `sales`/`purchases` — nada escreve `cancelled` ainda, mesma porta aberta de sempre), `reason` (texto, `default ''` — motivo não é obrigatório, mesma decisão já tomada em Ajuste de estoque), `subtotal_amount`/`total_amount`, `issue_date`, `created_by`.
- **`sale_return_items`**: referencia **`sale_item_id`, não só `product_id`** — a trava de "não devolver mais do que foi comprado" é por **linha da venda original**, e o mesmo produto pode aparecer em duas linhas da mesma venda com preços diferentes. `product_id` fica junto porque é ele que a reposição de estoque usa, e é **derivado do `sale_item` dentro da RPC**, nunca informado pelo cliente — se viesse do payload, as duas colunas poderiam divergir. Mais `quantity`, `unit_price` (herdado do item original, não digitado de novo), `discount_amount` e `total_amount`.
- Sem `branch_id` próprio em `sale_return_items` (herda via `sale_return_id`; RLS de leitura usa `exists (select 1 from sale_returns ...)`) — mesmo padrão de `sale_items`/`purchase_items`.
- **Só policies de `select`** nas duas tabelas (`has_permission('devolucao-venda', 'view')` + `has_branch_access`). Nenhuma de `insert`/`update`/`delete`: só a RPC escreve, mesmo padrão de `sales`/`purchases`/`stock_adjustments`.
- **`created_by` referencia `profiles(id)`, não `auth.users(id)`** — a primeira migration desta etapa saiu com `auth.users` e o join `profiles(name)` do PostgREST não resolveu (o TypeScript acusou `Property 'name' does not exist on type '{ name: string }[]'`, porque sem FK para `profiles` o PostgREST trata a relação como to-many). Corrigido por migration. **Convenção do projeto**: toda tabela operacional aponta `created_by` para `profiles`.

#### A trava contra devolver mais do que foi vendido

Mora **na RPC, não numa constraint**, e isso é deliberado: a regra é uma soma **entre linhas de outras devoluções** (`sum(quantity)` de todas as devoluções não canceladas daquele `sale_item`), que nenhuma `CHECK` de tabela alcança. O que fecha a corrida é o `select ... from sale_items ... for update` antes de somar — sem ele, duas devoluções simultâneas da mesma linha leriam o mesmo "já devolvido" e as duas passariam. Como existe **uma porta só de escrita** (não há policy de `insert`), validar inline basta; mesmo critério já usado em Compras para a checagem de fornecedor, em vez de duplicar a defesa num gatilho que nenhum outro caminho atravessaria.

**Uma venda pode ser devolvida em mais de uma vez** — devolver 2 de 5 hoje e 3 na semana que vem é o caso normal, não a exceção.

#### RPC `create_sale_return(payload jsonb)`, `security definer`

`has_permission('devolucao-venda', 'create')` + `has_branch_access` antes de qualquer escrita, `pg_advisory_xact_lock` por filial para o código sequencial, tudo numa transação:

- **Estoque**: `update products set stock = stock + quantidade` por item, com `for update`, **sem checagem de saldo** — devolver sempre é permitido, mesma lógica da entrada de estoque em Compras.
- **Valor de cada linha**: `unit_price` herdado do item original × quantidade devolvida, menos a fatia proporcional do desconto **daquele item** e a fatia proporcional do desconto do **cabeçalho** da venda (`sale.discount_amount × valor_da_linha / sale.subtotal_amount`). **Frete não é devolvido** — o transporte já foi consumido. Ratear o desconto de cabeçalho é o que evita devolver mais do que o cliente pagou de fato; não ratear seria dinheiro a mais saindo em toda venda com desconto no total.
- **Financeiro** — a decisão central desta etapa, abaixo.

#### A decisão de modelagem: sempre um `a_pagar` novo, nunca editar/dividir o lançamento da venda

Os lançamentos da venda original (`origin_kind = 'venda'`, `origin_id = sale.id`) **não são editados nem divididos**. Em vez disso, a devolução **sempre** cria um lançamento novo pelo núcleo `financial_entries_create_installments` (o mesmo que `create_sale`/`create_purchase` chamam — sexto consumidor): `type = 'a_pagar'`, `contact_id` = o cliente da venda original, `origin_kind = 'devolucao'`, `origin_id` = a devolução, **parcela única, em aberto**, valor = soma dos itens devolvidos.

**Por quê** (é uma decisão de modelagem, não a única possível):

1. **Um lançamento já `baixado` não pode ser editado** — o gatilho `financial_entries_before_write` recusa ("Um lançamento baixado não pode ser editado — exclua a baixa primeiro."). Numa venda à vista, o `a_receber` nasce baixado; não existe "descontar o valor devolvido" dele sem furar a própria regra de imutabilidade que o Financeiro impõe.
2. **Dividir proporcionalmente entre parcelas numa devolução parcial** (devolveu 1 de 3 itens de uma venda em 4x — qual parcela encolhe?) é complexidade que não paga o preço, e produziria um histórico em que a parcela 2/4 mudou de valor depois de emitida.
3. Isso vale **independente de o lançamento original estar aberto ou já baixado**, e essa uniformidade é metade do valor: é sempre uma dívida nova, nunca uma edição de histórico. Quem quiser auditar vê a venda e a devolução como dois fatos, não um fato reescrito.

**Custo aceito**: o "quanto essa venda rendeu" não sai de um lançamento só — é a soma do `a_receber` da venda com o `a_pagar` da devolução. Em troca, nenhum lançamento muda depois de criado.

- **Este `a_pagar` se baixa pelo fluxo normal do Financeiro** (botão "Baixar"), no momento em que a loja de fato devolve o dinheiro. **Não existe botão de "estornar"** — o Financeiro já sabe fazer isso, e inventar um segundo caminho para a mesma operação criaria duas verdades sobre quando o dinheiro saiu.
- **Forma de pagamento**: copiada da venda **só quando ela teve uma forma só**. Com split não há resposta certa, e inventar uma seria pior que deixar em branco.

#### Exceção no gatilho de `financial_entries` (e por que ela é estreita)

`financial_entries_before_write` recusava, desde a etapa do Financeiro, um `a_pagar` cujo contato não fosse `contacts.kind = 'fornecedores'`. A devolução é **o único caso do domínio em que a loja deve dinheiro a um cliente**, então o gatilho ganhou uma exceção nomeada, não um afrouxamento: a regra antiga continua valendo para todo o resto, e a exceção só vale quando `origin_kind = 'devolucao'` — valor que só a RPC `create_sale_return` consegue gravar. E ela é **simétrica**: um `a_pagar` de devolução com contato do tipo `fornecedores` é recusado com mensagem própria.

#### A parte fiscal — as duas opções, oferecidas, não decididas por decreto

**Pesquisado na documentação da Focus NFe antes de desenhar o payload**, mesmo procedimento das etapas F1/8/8.5.

- **Cancelar a nota original não é a mesma coisa que devolver.** Cancelamento de NF-e/NFC-e tem janela legal curta (perto de 24h na maioria dos casos, mas a regra varia por UF e por modelo). Fora dela, a devolução exige **nota fiscal de devolução própria**.
- **A nota de devolução é uma NF-e de entrada** (`tipo_documento: 0`) com **`finalidade_emissao: 4`** (devolução) e CFOP de entrada (1202/2202 e afins), **referenciando a nota original**.
- **Campo de nota referenciada — a grafia exata**: `notas_referenciadas`, uma coleção de objetos com **`chave_nfe`** dentro (tag XML `refNFe`, grupo `NFref` do `ide`). Fonte: a **tabela completa de campos** da Focus (<https://campos.focusnfe.com.br/nfe/NotaFiscalXML.html>) — a página de referência do endpoint (`doc.focusnfe.com.br/reference/emitir_nfe`) **não documenta este grupo**, exatamente a mesma divisão de documentação já registrada na etapa F1 para os campos de valor de imposto. Virou `NfePayloadNotaReferenciada` em `src/lib/fiscal/types.ts` e `<NFref><refNFe>` no XML do provedor simulado.
- **Pendência registrada, não escondida**: fontes públicas indicam que, **a partir de 01/09/2026**, a SEFAZ passa a exigir que a nota de devolução referencie a original **por item** (grupo `DFeReferenciado`), e não só a chave no cabeçalho. A Focus tem um campo `chaves_acesso_dfe_anteriores` (tag `refDFeAnt`), mas ele está documentado no bloco de **Reforma Tributária** e no nível da nota, não do item — não dá para afirmar que é o mesmo campo. Como o desenho por item não está documentado de forma confiável hoje, esta etapa implementa o que **está**: `notas_referenciadas` no cabeçalho. Quem retomar isto depois de setembro precisa reconferir na documentação, não assumir que o payload atual basta.
- **As duas opções ficam na tela, lado a lado**: "Cancelar nota da venda" (reaproveita `FiscalProvider.cancel` e o **mesmo** `CancelInvoiceModal.tsx`, sem variação — a justificativa de 15–255 caracteres é a mesma regra da SEFAZ) e "Emitir nota de devolução". A primeira só fica habilitada quando a nota original está `autorizado`; a segunda, enquanto não houver nota de devolução autorizada.
- **Não existe prazo automático de "ainda dá para cancelar".** A regra varia por UF e por modelo, e uma data errada aqui é risco fiscal real nos dois sentidos: errar para o "ainda dá" faz o sistema sugerir um cancelamento que a SEFAZ vai recusar; errar para o outro lado esconde o caminho certo do operador. **A decisão é do operador** — o sistema oferece os dois botões enquanto fizerem sentido tecnicamente e não opina sobre o calendário.
- **Falha fiscal não bloqueia nem fica silenciosa**, mesma filosofia de `usePosSale.ts`: estoque e financeiro já foram gravados atomicamente **antes** de qualquer chamada ao `FiscalProvider`. Uma falha na emissão/cancelamento não desfaz a devolução (não existe "voltar atrás" de estoque já reposto), mas aparece como mensagem acionável na tela. `emitReturnInvoice`/`cancelOriginalInvoice` (`useSaleReturnsData.ts`) nunca lançam — devolvem `{ ok } | { ok: false, errors }`.

##### `buildReturnNfePayload` reaproveita `resolveItemsForSale` inteiro

Em `invoiceMapping.ts`, ao lado de `buildNfePayloadFromSale`/`buildNfcePayloadFromSale`. A única mudança na resolução tributária é a dimensão `natureza_operacao: 'devolucao'` na consulta a `resolveTaxRule` — é isso que troca o CFOP de saída (5102) pelo de entrada (1202). **CST/CSOSN e alíquota continuam vindo do grupo tributário de cada produto, por item**, exatamente como a correção de 19/08/2026 deixou pronto: uma devolução com dois produtos de tributação diferente sai com CSTs diferentes, sem uma linha de lógica nova.

- Divergências de cabeçalho: `tipo_documento: 0`, `finalidade_emissao: 4`, `presenca_comprador: 0` ("não se aplica" — quem emite é a loja, o comprador não está comprando nada), `natureza_operacao: "Devolução de venda"`, `modalidade_frete: 9`, `notas_referenciadas` quando a venda tem nota autorizada.
- **Cliente é obrigatório**, como na NF-e (a mensagem de erro diz explicitamente que, para uma venda de balcão sem cliente, o caminho é cancelar a nota original dentro do prazo).
- **`originalChave` nula é caso legítimo** — uma venda que nunca teve nota pode ser devolvida do mesmo jeito; o que a ausência impede é *referenciar* a original, então o grupo simplesmente não vai no payload. Não se inventa uma chave.

#### `fiscal_documents` ganhou uma segunda origem

`sale_id` virou nulável e entrou `sale_return_id` (FK real), com `CHECK ((sale_id is not null) <> (sale_return_id is not null))` — exatamente uma das duas. A `unique (sale_id, model)` virou **dois índices únicos parciais**, um por origem.

- **Por que duas colunas com FK, e não o par polimórfico `origin_kind`/`origin_id` de `financial_entries`**: lá a lista de origens "só cresce" (venda, compra, devolução, nota emitida...), e perder a FK foi um custo aceito conscientemente. Aqui são **duas, fechadas** — um documento fiscal ou é de uma venda ou é de uma devolução —, e uma FK de verdade é barata. Critérios diferentes porque as situações são diferentes, não por inconsistência.
- `FiscalDocumentOrigin` (`{ saleId } | { saleReturnId }`) é união, não dois parâmetros opcionais: "nenhuma das duas" nem é representável no TypeScript.
- `ref` da devolução é `devolucao-<sale_return.id>` (`saleReturnFiscalRef`), espelhando `venda-<sale.id>` — é o que faz `emit()` ser idempotente por devolução.
- **`fetchInvoiceSales` (Notas Emitidas) pula linhas com `sale_id` nulo** — o documento de uma devolução não pertence a nenhuma venda daquela lista. Sem isso a tela quebraria no `Map` por `sale_id`.

#### Tela

`SaleReturnPage.tsx` lista as devoluções reais da filial. "Devolver venda" abre `SaleReturnModal.tsx` (bespoke): venda de origem pelo `LookupModal` já existente (busca por código **ou** nome do cliente) → linhas da venda com "vendido / já devolvido / devolver / valor", com teto por linha → motivo → confirmar.

- **Modal feito à mão, não o motor genérico nem o de lote.** Não é "um registro com campos" (seria `RegistryFormModal`, e exigiria um terceiro prop de ponte só para este módulo — o sinal de alerta já documentado no Financeiro), e não é "N lançamentos independentes que o operador acumula" (seria `RegistryBatchFormModal`): as linhas **vêm da venda escolhida**, o operador não escolhe *o que* entra na lista, só *quanto* de cada uma volta. Reaproveita o CSS de `RegistryFormModal` e o `LookupModal`.
- **Prévia de valor ao vivo** (`computeReturnLineTotal` em `saleReturns.ts`) **replica a matemática da RPC** — mesma ordem, mesmo arredondamento —, pelo mesmo motivo de `computeInstallmentPreview` no Financeiro: sem ela o operador só descobriria o rateio de desconto depois de confirmar. As duas funções estão documentadas uma na outra; se divergirem, a tela mente.
- **Linha já esgotada aparece desabilitada** com placeholder "—"; linha com saldo mostra "até N". A UI é conveniência: quem barra de verdade é a RPC (testado bypassando a tela).
- **`LookupModal` é renderizado dentro do `Dialog.Content`**, não como irmão do `Dialog.Root` — é assim que o Radix empilha um modal sobre outro sem o de baixo interpretar o clique como "clicou fora". Mesma nota já registrada no `lookupField` do `RegistryFormModal`.
- **Bug de UI pego no teste**: o campo "Venda de origem" nasceu com `disabled` (para não ser digitável) e isso desabilitou **junto o botão da lupa** — que é o único caminho para escolher a venda. `FormField` aplica `disabled` ao `<input>` **e** ao botão de lookup. A forma correta, que o `RegistryFormModal` já usava, é `onChange={() => {}}` sem `disabled`.
- **Depois de confirmada a devolução**, a mensagem de sucesso diz o que já aconteceu (estoque + financeiro) e que a parte fiscal é o passo seguinte — o registro já fica selecionado, com os dois botões fiscais à mão.
- `invoiceStatusLabel`/`invoiceStatusColor` (`invoices.ts`) passaram a receber `{ status }` (`FiscalStatusHolder`) em vez do `InvoiceDocument` inteiro, porque esta tela mostra o status da nota da venda a partir de uma leitura enxuta. Notas Emitidas não mudou.

#### Permissões

`modules.devolucao-venda` (que já existia no catálogo) ganhou `data_table = 'sale_returns'`, `branch_scoped = true` e `layout_variant = 'table-controls'`. `role_permissions` do Administrador passou de só `can_view` para `can_view` + `can_create`. **Sem `can_edit`/`can_delete`**: uma devolução não é editada nem excluída — apagar o registro não desfaz o estoque já reposto (mesmo raciocínio de Ajuste de estoque).

- **Pegadinha de permissão dupla, mesma categoria já registrada no PDV**: a parte fiscal grava em `fiscal_documents`, cuja RLS é gated por **`notas-emitidas`** (emitir = `create`, cancelar = `edit`), não por este módulo. Um papel que vá fazer devolução **com nota** precisa de `devolucao-venda`/`create` **e** de `notas-emitidas`/`create`+`edit`. A tela desabilita os botões fiscais conforme isso.

#### Tributações: a regra de `devolucao` não vem semeada

`natureza_operacao = 'devolucao'` já era valor válido desde a etapa 7, mas **a tabela só tinha regras de `venda`** — esta é a primeira etapa a precisar delas, e **nenhuma migration semeia regra fiscal** (alíquota e CFOP são responsabilidade de quem opera o sistema, decisão já registrada na etapa 7). Cadastrada no teste, pela própria tela de Tributações: regime 3, `devolucao`, SP→SP, `consumidor_final`, CFOP **1202**. Cada combinação de operação precisa da sua linha; sem regra, `resolveTaxRule` devolve `found: false` e a emissão para com mensagem acionável — comportamento esperado, exercitado no teste (ver abaixo).

#### Testado no navegador

Logado com a conta de testes, com o servidor de dev de verdade (ver a pegadinha da porta na seção "Como abrir o sistema e testar no navegador" — foi ela que bloqueou o teste de navegador da etapa 8.5).

- **Regra de devolução cadastrada pela tela de Tributações** (regime 3, devolucao, SP→SP, consumidor_final, CFOP 1202), conferida no banco.
- **Devolução parcial de venda com mais de um item**: venda 0004 (Doritos + Arroz, R$43,90), devolvido só o Doritos. Prévia mostrou R$15,00 antes de confirmar; devolução 0001 gravada; **estoque do Doritos 162 → 163 e o do Arroz intocado (48)**; `financial_entries` 026 `a_pagar` R$15,00 **em aberto**, `origin_kind = 'devolucao'`, contato **Bruno (kind `clientes`)** — a exceção do gatilho funcionando —, documento "Devolução 0001".
- **Segunda devolução do mesmo item**: venda 0001 (Doritos ×5). Devolvidos 2 (devolução 0002, R$30,00) e, ao reabrir, **a tela recalculou "já devolvido 2" e o teto "até 3"**; devolvidos os 3 restantes (devolução 0003, R$45,00). Estoque 163 → 165 → 168.
- **Devolver mais do que resta**: recusado na UI com a mensagem certa ("só restam 1 para devolver (vendidos 1, já devolvidos 0)"), a linha esgotada nasce desabilitada, e — **bypassando a tela**, chamando `create_sale_return` pelo cliente supabase autenticado no console — o **banco** recusou com `23514`: "Devolução maior que a quantidade vendida: já devolvidos 1.000 de 1.000, tentando devolver mais 1.000."
- **As duas opções fiscais, numa venda com NF-e autorizada**:
  - **Nota de devolução** (devolução 0001): autorizada, chave de 44 dígitos, e o XML com `<tpNF>0</tpNF>`, `<finNFe>4</finNFe>`, `<CFOP>1202</CFOP>`, `<natOp>Devolução de venda</natOp>`, `<indPres>0</indPres>` e **`<NFref><refNFe>35260800000000000191550010000000011933040332</refNFe></NFref>` — exatamente a chave da NF-e da venda 0004**. `fiscal_documents` com `sale_id` nulo e `sale_return_id` preenchido.
  - **Tributação por item preservada na devolução**: devolução 0005 (Arroz, grupo ISENTO) saiu com `<CST>40</CST>` e sem ICMS, contra `<CST>00</CST>` + `<vICMS>2.70</vICMS>` da devolução 0001 (Doritos, TRIB18) — mesmo CFOP nas duas.
  - **Cancelamento da nota da venda** (devolução 0002): justificativa curta recusada **dentro do modal** com a mensagem da SEFAZ ("Justificativa deve ter de 15 a 255 caracteres"), sem fechar; justificativa válida cancelou de verdade e a ficha passou a mostrar "Nota da venda: NF-e — Cancelado". (A NF-e da venda 0001 foi emitida **na mesma sessão do navegador** antes disso — o provedor simulado guarda estado em memória, limitação já documentada na etapa 8.)
- **Sem regra de `devolucao` cadastrada**: apagada a regra, a emissão parou com "Nenhuma regra cadastrada para regime 3, natureza "devolucao", SP → SP, cliente consumidor_final. Cadastre uma regra em Tributações." — sem exceção e **sem gravar linha nenhuma** em `fiscal_documents`. Regra recolocada, emissão autorizada em seguida.
- **Produto sem grupo tributário nem NCM** (Café Torrado, venda 0007): **a devolução em si passou normalmente** (devolução 0004, R$19,90; estoque 29 → 30; `a_pagar` 029 criado) e **só a parte fiscal falhou**, com os dois erros citando o item — e nenhuma linha gravada em `fiscal_documents`.
- **Baixa pelo fluxo normal do Financeiro**: o lançamento 026 aparece na aba "A pagar" com o cliente como contato e valor negativo em vermelho; "Baixar" moveu-o para Baixados e o total da aba caiu de R$296,06 para R$281,06. Nenhum botão de "estornar" foi criado.
- **Sem `can_create`** (desligado direto no banco para o Administrador): botão "Devolver venda" desabilitado **e** a RPC recusada com `42501` ("Sem permissão para criar devoluções de venda.") chamada direto, bypassando a UI. Permissão religada.
- **Sem regressão**: Notas Emitidas lista as 16 vendas normalmente, com a venda 0001 agora "Cancelado" e a 0004 "Autorizado", e **sem** a nota de devolução vazando para a lista de vendas; Produtos com os saldos e o grupo tributário certos; tela inicial com os 16 tiles; F5 direto em `/devolucao-venda` sem cair no login.
- `tsc -b`, `oxlint` (só os 4 avisos `only-export-components` pré-existentes) e `vite build` limpos, com o code splitting por página preservado. `get_advisors` rodado depois das migrations: o único aviso novo era FK sem índice de cobertura em `sale_returns.created_by`, corrigido na hora; o resto é o conjunto pré-existente (`authenticated_security_definer_function_executable` para toda RPC que o cliente chama de propósito, e o "Leaked Password Protection" que só existe no plano Pro).
- **Não foi possível tirar screenshot** — o Browser pane não estava sendo exibido nesta sessão, então a verificação foi feita por `read_page`/`get_page_text`/`read_network_requests` (estrutura, texto e estado `disabled` dos botões reais), mais conferência no banco. O que não foi conferido visualmente é CSS/layout, não comportamento.

#### Fora de escopo

Devolução de compra (a fornecedores — natureza de operação diferente, não pedida); **troca de produto** (devolver um item e levar outro no lugar — é o botão "Trocar", que segue desabilitado em Pedidos de venda/Notas Emitidas, etapa própria se vier a existir); cálculo automático do prazo legal de cancelamento por UF (ver acima — deixado para o operador de propósito); cancelar/editar uma devolução já registrada (`sale_return_status.cancelled` existe no enum e nada escreve nele — o conserto de uma devolução errada não foi especificado); rateio do frete (não volta); referência por item na nota de devolução (`DFeReferenciado`, ver a pendência de 01/09/2026 acima); `FocusNfeProvider` real (continua só o simulado).

### Decisão arquitetural: construtor de módulos (M3) + armazenamento genérico `module_records` (19/08/2026)

A etapa que responde a pergunta que a M2 deixou explicitamente em aberto — *"ou o M3 gera policies junto com a tabela, ou o armazenamento genérico JSONB nasce com uma policy genérica que resolve o módulo pelo id da própria linha"* — e que absorve a **M1 ("Campos personalizados")**, que nunca chegou a ser construída. As duas precisavam essencialmente da mesma peça (um editor de campos): M1 editaria campos de um módulo existente, M3 cria um módulo novo.

Até aqui um módulo sem componente próprio já abria pela `GenericModulePage` (M2), mas **só se alguém inserisse as linhas por SQL e só se ele pegasse carona na tabela — e na RLS — de outro módulo**. Agora um usuário autorizado cria o módulo pela tela, com rota, tile, campos e CRUD completo, **sem deploy e sem migration**.

#### A resposta: policy genérica, não policy por módulo

`module_records` é **uma tabela só**, compartilhada por todos os módulos criados pelo usuário — não uma tabela nova por módulo. Não existe `CREATE TABLE` disparado por input de usuário: DDL dinâmica a partir de texto que alguém digita numa tela é uma superfície de risco que este projeto não abre.

| Coluna | Papel |
| --- | --- |
| `id` | uuid, PK |
| `module_id` | FK para `modules.id` — é o que a policy resolve |
| `branch_id` | FK para `branches.id`, **nulável**; só preenchido quando o módulo é `branch_scoped` |
| `data` | `jsonb not null default '{}'` — o corpo do registro, com as chaves que `module_fields` descreve |
| `created_at` / `updated_at` | `updated_at` mantido por trigger (`touch_module_records_updated_at`) |
| `created_by` | `default auth.uid()` — o repositório genérico não sabe (nem deve saber) quem está logado; quem sabe é o banco. Mesmo padrão de `financial_entries`/`fiscal_documents`/`purchases`. |

As quatro policies (`select`/`insert`/`update`/`delete`, nunca `for all`) referenciam **as colunas da própria linha**, não um id fixo:

```sql
using (
  has_permission(module_id, 'view')            -- 'create'/'edit'/'delete' nas outras três
  and (branch_id is null or has_branch_access(branch_id))
)
```

É isso que faz um módulo novo **não precisar de policy nova**: `has_permission`/`has_branch_access` são reaproveitadas exatamente como já existiam, nenhuma função nova para isto. **Provado no navegador** (ver "Testado" abaixo): com dois módulos do usuário e `can_view` revogado em um só, um `select` sem filtro nenhum sobre a tabela compartilhada devolveu **apenas as linhas do módulo permitido** — a policy isola por `module_id`, não é tudo-ou-nada.

#### `storage_kind` é coluna — e por que isso não contradiz a M2

`modules.storage_kind` (`'table' | 'generic'`, CHECK) diz onde o dado físico do módulo mora: `'table'` = a tabela real apontada por `data_table` (**todos os módulos que existiam, sem exceção**), `'generic'` = linhas em `module_records`.

A M2 decidiu deliberadamente que **"tem componente próprio" NÃO vira coluna** — e isso continua valendo. As duas decisões não brigam porque as perguntas são diferentes:

- *"qual componente React renderiza este módulo?"* → o banco não teria como validar que o componente existe, e as duas fontes divergiriam no primeiro rename de arquivo. Uma regra, uma fonte: **está em `MODULE_COMPONENTS`, tem tela própria**.
- *"onde o dado deste módulo está gravado?"* → é um fato sobre o banco, não sobre o bundle. Nenhuma linha de código consegue adivinhar isso olhando para si mesma, e `data_table is null` não serve de sinal (Relatórios, Permissões e Configurações também têm `data_table` nulo e não são genéricos).

Uma segunda constraint impede a combinação incoerente: `storage_kind = 'generic'` exige `data_table is null`.

#### `genericModuleRepository.ts`: dois caminhos por dentro, um contrato por fora

O repositório continua exportando **um** `createGenericModuleRepository` que devolve um `ModuleDataRepository<GenericRow>`; quem consome (`useGenericModuleData`, `GenericModulePage`) não sabe qual caminho está ativo. A escolha é feita por `storage_kind`.

O que é **compartilhado** entre os dois: a normalização de valor (campo opcional vazio vira `null`, não `''`), o filtro por filial, a coluna de ordenação vinda do primeiro campo com `show_in_table`, e a forma externa de `list`/`create`/`update`/`remove`. O que **muda** é só a tradução `accessorKey` ↔ armazenamento físico:

- caminho `table`: `toColumns` / `toGenericRow` (como antes, `from(data_table)`);
- caminho `generic`: `toDataObject` / `toGenericRowFromRecord` — tudo entra num objeto só que vira o `data`, e a leitura espalha `data` sobre `{ id }`.

Duas decisões concretas nesse caminho:

- **`update` mescla, não sobrescreve.** `data` é uma coluna só: gravar o patch direto apagaria toda chave que não veio no formulário — inclusive as de campos removidos de `module_fields`, que continuam guardadas de propósito. Por isso o update lê o `data` atual e faz merge. Testado: um registro manteve a chave `observacoes` depois de o campo ser removido **e** o registro ser editado.
- **A ordenação é feita no cliente.** A coluna de ordenação é uma chave dentro do jsonb; depender da sintaxe de ordenação por caminho JSON amarraria o motor a um detalhe da versão do PostgREST. A lista de um módulo desses é um cadastro simples, então ordenar em JS é barato e previsível.

Chaves reservadas (`id`, `module_id`, `branch_id`, `data`, `created_at`, `updated_at`, `created_by`) são recusadas na criação do campo: como a leitura espalha `data` sobre `{ id }`, uma chave `id` dentro do jsonb sobrescreveria o id da linha.

#### O limite explícito: módulo sem tela própria funciona, com tela própria recusa

**É aqui que mora a parte da M1 que não dá para entregar de graça**, e a tela diz isso em voz alta em vez de aceitar em silêncio. `fieldEditingCapabilityFor()` (`src/features/module-builder/moduleBuilder.ts`) devolve três casos:

| Situação | O que o construtor faz |
| --- | --- |
| `storage_kind = 'generic'` (módulo do usuário) | **Tudo**: adicionar, editar e remover campo. |
| `storage_kind = 'table'` **sem** tela própria (Tributações, Grupos tributários) | **Só editar os campos que já existem** (rótulo, tipo, obrigatoriedade, onde aparece). |
| Tem tela própria (`MODULE_COMPONENTS[id]`) — Produtos, Financeiro, Compras, PDV… | **Recusa**, com a mensagem: *"Este módulo tem tela própria; campos personalizados só funcionam em módulos sem tela própria."* Nenhum botão de campo aparece. |

- **Por que a tela própria recusa**: `ProductsPage.tsx` lê `product.ncm`, não um campo dinâmico — ela não olha para `module_fields`. Uma linha nova ali não apareceria em lugar nenhum. Fazer funcionar de verdade exigiria tocar em cada tela escrita à mão do sistema, escopo muito maior do que M1 ou M3 pediram.
- **Por que o caso do meio não aceita campo novo** (desvio consciente do plano desta etapa, que dizia "adicionar/editar campo neles funciona de verdade"): editar funciona mesmo — a `GenericModulePage` lê tudo de `module_fields`, e isso foi **verificado no navegador** renomeando um campo de Tributações e vendo a tabela e a ficha acompanharem. Mas **adicionar** um campo a um módulo `table` gravaria uma `field_key` que não existe como coluna em `tax_rules`, e o primeiro `insert` quebraria com erro de coluna inexistente. Criar a coluna seria DDL a partir da tela — exatamente o que `module_records` existe para evitar. Aceitar e quebrar depois seria pior que recusar agora, então a tela explica: *"…criar ou remover campo exigiria mudar a tabela — só módulos de armazenamento genérico aceitam campo novo."*

#### Remover um campo não apaga o dado

Remover uma linha de `module_fields` para de mostrar e de editar o campo; o valor daquela chave **continua** dentro de `module_records.data` nos registros existentes. É deliberado: apagar dado de verdade a partir de "parei de mostrar este campo" seria destrutivo demais para uma ação de dois cliques, e assim a decisão é reversível (recriar o campo com o mesmo rótulo devolve a mesma chave, e o dado antigo reaparece). O `ConfirmDialog` diz isso com todas as letras.

O simétrico também vale: **adicionar** um campo depois de já existirem registros é seguro a qualquer momento — jsonb tolera chave ausente, e os registros antigos aparecem com a célula vazia, não com erro.

`field_key` é derivada do rótulo (slugificada) e **imutável depois de criada** — mesmo raciocínio de nunca renomear uma coluna de banco em produção: mudar a chave depois que já existem registros orfanaria o dado antigo debaixo da chave velha. O rótulo continua editável; a chave aparece como texto, não como campo.

#### `can_manage_modules`: por que uma flag global, e não `has_permission`

No momento de criar um módulo **ainda não existe `module_id`**, então `has_permission('algum-id', ...)` não tem o que resolver. A permissão é uma flag global no papel — `roles.can_manage_modules` —, mesma categoria de `can_manage_users`/`can_manage_permissions`/`can_manage_branches`, com a função `can_manage_modules()` no mesmo padrão das outras três.

- `modules.access_gate` ganhou um **sexto valor**, `manage_modules` (o `CHECK` existente foi estendido — nenhuma segunda forma de portão foi criada), e a própria tela `/modulos` usa esse gate. `ModuleAccessContext`/`canAccessModule` ganharam o caso, no mesmo padrão dos outros.
- **A grade de `/permissoes` não precisou mudar**: o filtro `access_gate = 'permission'` que a M2 já aplicava cobre o sexto valor sozinho. Confirmado no navegador — "Módulos" não aparece na grade, e os módulos criados pelo usuário aparecem (é assim que outros papéis ganham acesso a eles).
- **Bootstrap**: `can_manage_modules` foi ligada para quem já tinha `can_manage_permissions` (na prática, Administrador). Como `can_manage_branches`, ela ainda **não tem coluna na grade de `/permissoes`** — conceder a outro papel é `update` em `roles` por SQL. Mesma pendência, mesmo precedente.

#### Bootstrapping da permissão do criador — o motivo de a criação ser RPC

Sem isso quem acabou de criar um módulo ficaria trancado para fora da própria criação: a RLS de `module_records` exige `has_permission(module_id, ...)`, e nada concede isso automaticamente. Por isso `create_user_module(p_label, p_branch_scoped, p_sort_order, p_fields)` (`security definer`) faz tudo numa transação só: cria a linha de `modules`, os `module_fields`, **e concede `can_view`/`can_create`/`can_edit`/`can_delete` ao papel de quem chamou**.

Abrir `role_permissions` para quem tem `can_manage_modules` resolveria o sintoma e criaria uma escalação de privilégio (daria para conceder qualquer permissão de qualquer módulo a qualquer papel). Dentro da RPC a concessão é estreita: só este módulo, só o papel de quem chamou. Outros papéis continuam sem acesso até alguém marcar em `/permissoes` — mesma pendência de todo módulo novo neste projeto, só que agora o dono não fica de fora junto.

A RPC também **fixa no banco** os valores que o construtor não oferece: `access_gate = 'permission'` (os outros cinco são de telas administrativas do sistema), `is_locked = false` (a M2 já reaproveitou esta coluna com este significado exato), `storage_kind = 'generic'`, `data_table = null`, `icon_key = null` (ícone genérico de reserva). Nem um cliente adulterado cria um módulo com portão administrativo.

Para as edições posteriores (rótulo/ordem do módulo, e os campos) as policies existentes foram **alteradas, não duplicadas** (uma policy nova a mais por comando dispararia "multiple permissive policies" no advisor): `modules update` aceita `can_manage_modules()` só em módulos com `is_locked = false`, e o `with check` impede transformar um deles em tela administrativa; `module_fields` aceita `can_manage_modules()` de forma ampla — é o que faz a parte M1 existir para Tributações e Grupos tributários, e é a mesma categoria de poder que `can_manage_permissions` já tinha sobre essas linhas.

#### `delete_user_module`: destrutivo de verdade, e com atrito à altura

Exclui `module_records`, `module_fields`, `module_tabs`, `role_permissions` e a linha de `modules`, e **só** de módulos com `is_locked = false`. As FKs já têm `on delete cascade`, mas as exclusões estão escritas uma a uma de propósito: o que a função apaga precisa estar visível na própria função, não escondido no schema.

Na tela não é o `ConfirmDialog` genérico de "excluir registro": é um diálogo próprio que lista o que vai embora (**com a contagem real de registros**, consultada na hora), mostra a rota que deixa de existir, e **exige digitar o nome do módulo** para habilitar o botão. O atrito é a funcionalidade.

#### O bug de segurança que o teste expôs: `IF NOT <flag>` falha aberto

Ao chamar `create_user_module` sem sessão, esperando a recusa, a função **passou direto pelo portão** e só parou num teste posterior. Causa: `can_manage_modules()` (como as três irmãs) é um `select ... from profiles join roles where p.id = auth.uid()` — sem linha correspondente a consulta devolve **zero linhas**, e o resultado da função é `NULL`; o `coalesce` de dentro do corpo nunca chega a rodar.

Em policy de RLS isso é seguro (`using NULL` nega). Em plpgsql, **não**: `not NULL` = `NULL`, o `IF` não executa, e a checagem de permissão é pulada em silêncio. `delete_user_module` não tinha nenhuma checagem posterior, então lá o furo era completo — um usuário autenticado sem linha em `profiles` apagaria um módulo inteiro.

**Regra que vale para qualquer função nova**: numa checagem imperativa de permissão, escreva `if not coalesce(minha_flag(), false) then raise ...`, nunca `if not minha_flag() then`. O `coalesce` precisa estar do lado de fora da chamada, onde ele de fato fecha o caso.

#### Tela `/modulos` (`src/features/module-builder/`)

Fora do catálogo de módulos comuns, mesma categoria de `/permissoes` e `/usuarios-operadores`; tem tile (gated pela flag, então só quem pode gerenciar módulos o enxerga) e componente próprio registrado em `MODULE_COMPONENTS`. Lista todos os módulos à esquerda (com selo "Sistema"/"Do usuário" e onde o dado mora), campos do selecionado à direita.

O construtor de campos escolhe **só entre os `data_type` que o motor já conhece** (`text`/`date`/`boolean`/`phone`/`email`), num `<select>` feito à mão — esta etapa não inventa tipo novo. Nota honesta sobre o que eles fazem hoje: só `date` muda o `<input>`; `boolean`, `phone` e `email` são texto na tela, como já eram em Clientes e Produtos. Mudar isso seria mexer no motor, não no construtor.

Dois ganchos novos, ambos por um motivo concreto: `ModuleCatalogContext` ganhou `reload()` e `AuthContext` ganhou `refreshPermissions()`. Sem eles, criar um módulo funcionaria no banco mas o tile e a rota só apareceriam depois de um F5 — e o tile ficaria escondido por uma permissão que **já existe no banco** e não no cache da sessão.

#### Testado no navegador

Com a conta de testes (Administrador, `can_manage_modules`): módulo "Fornecedores de frete" criado do zero pela tela (isolado por filial, 4 campos de tipos diferentes, um deles fora da tabela), aparecendo na tela inicial como 18º tile com o ícone de reserva, com rota própria e CRUD completo pela `GenericModulePage` — criar, editar e excluir registro, gravando em `module_records` com o `module_id` certo e `branch_id` preenchido, campo opcional vazio virando `null`. Campo "Observações" adicionado **depois** de já existir registro: o registro antigo apareceu com a célula vazia, sem erro no console. Campo removido: a linha de `module_fields` sumiu, o dado (`"Coleta somente às terças"`) continuou no jsonb, e **sobreviveu inclusive a uma edição posterior do registro** (prova do merge). Produtos recusou o construtor com a mensagem explícita e sem nenhum botão; Tributações ofereceu só "Editar", e uma renomeação real de campo apareceu na tabela e na ficha do módulo (revertida depois). RLS de `module_records` exercitada pelo console com o JWT do usuário: sem `can_view` num módulo o `select` voltou 0 linhas e o `insert` foi recusado com 403, enquanto o outro módulo do mesmo usuário continuou lendo e gravando normalmente. Com `can_manage_modules` desligada: o tile sumiu, `/modulos` recusou, e as duas RPCs recusaram pelo banco (400), não só pela UI. Os dois módulos de teste foram excluídos no fim — `modules`, `module_fields`, `module_records` e `role_permissions` zerados, sem órfãos, e a tela inicial de volta aos 17 tiles. `tsc`, `oxlint` e `vite build` limpos, com o code splitting por página preservado.

#### Fora de escopo

Campos personalizados em módulos com tela própria (recusa explícita, ver acima); upload de ícone próprio para módulo do usuário (usa o genérico de reserva); `data_type` novo no motor (select com opções, número, arquivo); módulo transacional criado pelo usuário (cabeçalho+itens ou lote — o motor genérico simples, um registro por vez, é o único padrão que M3 constrói, e um usuário final não cria o próprio "Realizar Venda"); workflow configurável (situações, transições, ações automáticas), que é M4 e depende de M3 existir; coluna de `can_manage_modules` na grade de `/permissoes` (concedida por SQL, como `can_manage_branches`).

### Decisão arquitetural: módulo Condicionais (20/08/2026)

Etapa 10. Reaproveita dois padrões já estabelecidos, sem reinventar nenhum: a trava contra devolver/converter mais do que existe de Devolução de venda (soma de movimentos anteriores, `for update`, checada na RPC), e o padrão de cabeçalho+itens sem motor genérico nem de lote de Realizar Venda/Pedidos de venda. O ponto que **não** podia copiar de Pedidos de venda: lá o estoque só sai na conversão (`convert_sale_order_to_sale` chama `create_sale`, que baixa estoque); numa condicional o estoque já saiu na criação (a peça saiu fisicamente da loja), então a conversão em venda **não pode** chamar `create_sale` — baixaria o estoque uma segunda vez. `ConditionalsPage.tsx`/`conditionals.ts` eram mock (`CONDITIONALS` com um registro de exemplo, ações sem `onClick`, `ConditionalStatus` com só quatro valores).

#### Schema

- **`conditionals`** (cabeçalho, `branch_id` — dado operacional, o estoque se move): `contact_id` (validado `kind = 'clientes'` dentro da própria RPC de criação — uma porta só de escrita, mesmo critério já usado em Compras para não duplicar a defesa num gatilho que nenhum outro caminho atravessaria), `code` sequencial por filial, `issue_date`/`due_date`, `status` só `confirmed`/`cancelled` (mesmo enum simples de `sales`/`purchases`/`sale_returns`). **Sem `seller_id`**: quem converte é quem vende — a venda criada na conversão grava `seller_id = auth.uid()` direto, mesma decisão já tomada no PDV ("quem está operando é quem vende"), sem pedir isso na criação da condicional (a peça pode nem ter vendedor definido ainda quando sai da loja).
- **`conditional_items`**: `product_id`, `quantity`, `unit_price` (herdado do preço de venda do produto no momento do envio — o carrinho da tela pré-preenche com `product.salePrice`, igual a um item de venda, mas a RPC grava o que o payload mandar, mesmo padrão de `create_sale`).
- **Sem cabeçalho próprio para devolução/conversão, diferente de `sale_returns`**: `conditional_item_returns` (linhas de auditoria simples — `conditional_item_id`, `quantity`, `reason`) e `conditional_item_conversions` (ponte `conditional_item_id` → `sale_id`/`sale_item_id`, já que a venda criada na conversão **é** o cabeçalho daquela operação). A diferença para Devolução de venda é deliberada: lá o cabeçalho existe porque a devolução emite nota fiscal própria e precisa de um código para isso; aqui não há emissão fiscal nenhuma (ver "Fora de escopo"), então uma linha por devolução/conversão de item já basta — inventar um cabeçalho só para "ter code" seria estrutura sem uso.
- **Só policies de `select`** nas quatro tabelas — nenhuma de `insert`/`update`/`delete` para o cliente direto, só as quatro RPCs (`security definer`) escrevem, mesmo padrão de `sales`/`purchases`/`sale_returns`.

#### Status é sempre calculado, nunca gravado — e o quinto (e sexto) rótulo

Mesmo raciocínio já usado para "vencido" em Financeiro: um status gravado poderia divergir do que os movimentos realmente dizem — aqui isso seria pior, porque devolução parcial cria estados que os quatro rótulos do mock (`"Em aberto" | "Vencida" | "Devolvida" | "Convertida em venda"`) não cobriam sozinhos. Caso real, não extremo: 3 itens devolvidos e 2 convertidos da mesma condicional. `computeConditionalStatus` (`src/lib/repositories/conditionalsRepository.ts`) resolve a partir de `totalSent`/`totalReturned`/`totalConverted` (somados dos itens) e `due_date`:

- Tudo resolvido (`remaining = 0`): `"Convertida em venda"` se 100% convertido, `"Devolvida"` se 100% devolvido, **`"Parcialmente resolvida"`** (o quinto rótulo, novo) se foi uma mistura das duas — é o caso do exemplo acima.
- Ainda falta resolver algo: `"Em aberto"` (nada resolvido ainda) ou `"Parcialmente resolvida"` (mistura, mas ainda sobra saldo), e qualquer um dos dois vira `"Vencida"` se `due_date` já passou — mesmo espírito de "vencido" em Financeiro, **só um alerta visual**, nunca uma condicional totalmente resolvida (mesma lógica de "baixado" nunca ser "vencido").
- `"Cancelada"` (sexto rótulo, também novo) quando `conditionals.status = 'cancelled'` — o mock não tinha esse caso porque não existia cancelamento nenhum.

Consequência prática: como `"Cancelar"` só é permitido quando nada foi resolvido, o botão da tela habilita/desabilita direto pelo `status` computado da linha selecionada (`"Em aberto"` ou `"Vencida"`) — nenhuma consulta extra precisa rodar só para saber se pode cancelar.

#### `convert_conditional_to_sale` é irmã de `create_sale`, não consumidora dela

O motivo, por extenso: `convert_sale_order_to_sale` funciona chamando `create_sale` porque em Pedidos de venda o estoque **nunca** saiu antes — sai uma vez só, na conversão. Numa condicional o estoque **já saiu** na criação (`create_conditional` baixa estoque na hora, com o mesmo `for update`/checagem de saldo de `create_sale`). Se a conversão chamasse `create_sale` sem mais nada, o estoque desceria uma segunda vez.

A opção descartada foi dar a `create_sale` um parâmetro para "pular a baixa de estoque". Não foi feita: `create_sale` é chamada por Realizar Venda, pelo PDV (via `create_pos_sale`) e pela conversão de Pedidos de venda, e os três precisam continuar baixando estoque normalmente — um parâmetro para desligar isso é superfície de bug esperando para acontecer num desses três caminhos (bastaria um `payload` mal montado num deles). Em vez disso, `convert_conditional_to_sale` grava `sales`/`sale_items`/`sale_payments` com a mesma forma que `create_sale` já usa, e chama `financial_entries_create_installments` (o núcleo, não a porta pública — mesma razão já documentada em `create_sale`/`create_purchase`/`create_sale_return`: quem já validou `has_permission('condicionais', 'create')` não deveria também precisar de permissão de Financeiro) do mesmo jeito, **mas nunca toca em `products.stock`**. Isso duplica um pedaço da lógica de `create_sale` (a regra por forma de pagamento: dinheiro/pix/débito nasce baixado à vista; crédito/boleto parcela com vencimento a 30 dias; outro é tratado como a prazo, conservador) — é o preço de o estoque já ter saído num momento diferente; mais seguro do que arriscar o contrato de uma função usada por três caminhos que funcionam hoje.

`convert_conditional_to_sale` pede forma de pagamento no próprio payload (a condicional não tinha isso — nada tinha sido cobrado ainda), reaproveita o enum `sale_payment_method` e o `origin_kind = 'venda'`/`origin_id = <sale.id>` de sempre: **não existe** um `origin_kind = 'condicional'` — o lançamento financeiro nasce indistinguível de uma venda comum, exatamente o que "reaproveitando o caminho normal de venda" pede.

#### Trava contra devolver/converter mais do que existe

Mora **na RPC, não numa constraint** (mesmo motivo já documentado em Devolução de venda: a regra soma linhas de fora da tabela). `register_conditional_return` e `convert_conditional_to_sale` fazem a mesma checagem: `select ... from conditional_items ... for update`, soma `conditional_item_returns` + `conditional_item_conversions` daquele item, e recusa (`23514`) se ultrapassar `quantity`. `cancel_conditional` faz o inverso — recusa (mensagem própria, não `23514`) se **qualquer** item já tiver soma > 0, com a mesma trava de `for update` nos itens para serializar contra uma devolução/conversão concorrente.

#### Tela

Cabeçalho+itens feito à mão, mesmo critério de Realizar Venda/Pedidos de venda/Devolução — não motor genérico, não motor de lote. `NewConditionalPage.tsx` (rota `/condicionais/nova`, `MODULE_SUBROUTES`) espelha `SaleOrderFormPage.tsx`: `LookupModal` de cliente (`fetchContactsByKind('clientes', ...)`) + `ProductPickerPanel` + prazo de devolução, sem forma de pagamento (nada foi vendido ainda) nem vendedor (ver acima). `ConditionalResolveModal.tsx` é um componente só para as duas ações "Registrar devolução"/"Converter em venda" (`mode: "return" | "convert"`) — a UX das duas é idêntica (por item: enviado/resolvido/quanto resolver agora, com teto por linha, mesmo padrão de `SaleReturnModal`), só o que acontece ao confirmar muda (RPC diferente, e "converter" também pede forma de pagamento); não precisa de `LookupModal` para escolher a condicional porque ela já é a selecionada na lista.

#### Permissões

`modules.condicionais` já existia no catálogo (criado numa etapa anterior, só com `can_view` para Administrador) — esta etapa preencheu `data_table = 'conditionals'`, `branch_scoped = true`, `layout_variant = 'table-controls'`, e marcou `can_create` para Administrador. **As quatro RPCs de escrita (criar, devolver, converter, cancelar) usam todas `has_permission('condicionais', 'create')`** — não há `can_edit`/`can_delete` mapeado nesta rodada (mesma simplificação que o pedido já antecipava).

#### Testado no navegador

Condicional 0001 criada com 2 itens (Doritos + Arroz, R$43,90) — estoque dos dois baixou na hora (168→167, 49→48), nenhum lançamento em Financeiro, nenhum documento fiscal. Devolvido o Doritos (1 de 1): estoque voltou a 168, status calculado passou para "Parcialmente resolvida". Convertido o Arroz (1 de 1) em venda à vista (dinheiro): venda 0017 criada, lançamento financeiro 031 gerado (`a_receber`, já `baixado`, `origin_kind = 'venda'`, documento "Venda 0017") — e **o estoque do Arroz não mudou de novo** (permaneceu 48), confirmando que a conversão não duplica a baixa. Tentativa de devolver mais do que resta (bypass da RPC, itens já 100% resolvidos): recusada com `23514` e a mensagem exata ("já resolvidos 1.000 de 1.000, tentando devolver mais 1.000"). Condicional 0002 criada com 1 item (Café Torrado) e cancelada sem nada resolvido: estoque voltou (29→30), status "Cancelada". Tentativa de cancelar a condicional 0001 (já com itens resolvidos), tanto pelo botão desabilitado quanto por bypass direto da RPC: recusada com a mensagem "Esta condicional já tem itens devolvidos ou convertidos — não pode ser cancelada por inteiro." Sem `can_create` (desligado direto no banco para Administrador): botão "Nova condicional" desabilitado e a RPC `create_conditional` recusada com `42501` chamada direto, bypassando a UI; permissão religada depois. Produtos, tela inicial (17 tiles) e navegação conferidos sem regressão. `tsc -b`, `oxlint` (só os 4 avisos pré-existentes) e `vite build` limpos, code splitting preservado.

#### Fora de escopo

Emissão fiscal de remessa em condicional (Nota Fiscal de Remessa, CFOP 5908/6908) — é uma obrigação legal real no Brasil, mas não foi pedida nesta etapa: **a condicional hoje não emite nenhum documento fiscal, nem de remessa nem de retorno.** Conversão/devolução automática ao vencer o prazo — "Vencida" é só um alerta visual, ninguém age sozinho. Cancelamento parcial de uma condicional já em andamento — recusa, não solução (mesma decisão que Devolução de venda já tomou para "cancelar/editar uma devolução já registrada"). Edição/exclusão de condicional confirmada. `can_edit`/`can_delete` do módulo (não mapeados nesta rodada).

### Decisão arquitetural: estoque negativo configurável (20/08/2026)

Até aqui `create_sale`, `create_conditional` e `adjust_stock_batch` recusavam incondicionalmente qualquer operação que deixasse `products.stock` negativo. Pedido do usuário: dar controle sobre isso, em dois níveis — a filial define o padrão, um produto específico pode sobrescrevê-lo nos dois sentidos (permitir mesmo com a filial bloqueando, ou bloquear mesmo com a filial permitindo).

#### Schema

- `branches.allow_negative_stock boolean not null default false` — padrão da filial, nasce desligado.
- `products.allow_negative_stock boolean` (nulável, **sem** default) — três estados: `null` = usa o padrão da filial (caso comum, a maioria dos produtos nunca mexe nisso); `true`/`false` sobrescreve a filial nos dois sentidos. A precedência é do produto: só cai para o padrão da filial quando é `null`.

#### `stock_allows_negative`: um núcleo só, chamado dos três lugares

Mesmo raciocínio já registrado para `financial_entries_create_installments` (núcleo chamado por `create_sale`/`create_purchase`/`create_sale_return`): a lógica de precedência produto-sobrescreve-filial não podia ser repetida três vezes, e uma divergência entre as três seria o tipo de bug que só aparece muito depois. `stock_allows_negative(p_branch_id uuid, p_product_id uuid) returns boolean` lê `products.allow_negative_stock`; se não for nulo, devolve ele; senão devolve `branches.allow_negative_stock`. É função **interna, não porta pública** — `revoke execute` de `public`, `anon` **e** `authenticated` (mesmo padrão de `financial_entries_create_installments`, diferente das RPCs públicas como `create_sale`, que mantêm `authenticated`), porque só é chamada de dentro de outras `SECURITY DEFINER`, nunca direto pelo cliente.

Nas três funções (`create_sale`, `create_conditional`, `adjust_stock_batch`) a checagem virou: calcular o saldo resultante (`v_new_stock`) e só recusar se ele for negativo **e** a permissão não cobrir — `if v_new_stock < 0 and not coalesce(stock_allows_negative(v_branch_id, v_product.id), false) then raise exception ...`. O `coalesce` fica do lado de fora da chamada de propósito, mesma regra já documentada no roteiro deste arquivo para checagem imperativa de permissão em plpgsql: se `stock_allows_negative` alguma vez devolver `NULL` (não deveria, mas o produto pode não existir em algum caminho futuro), um `if not stock_allows_negative(...)` sem `coalesce` deixaria a checagem passar em silêncio — `not NULL` é `NULL`, e o `IF` não executa.

#### UI — Filial: primeiro parâmetro real de Configurações

`Filiais` continua sem tela de administração própria (SQL-only, mesma situação de `cash_registers`) — não foi criada uma só por causa deste campo. Em vez disso, o toggle foi para Configurações (`SettingsPanel.tsx`, novo componente `StockPolicySection.tsx`), escopado pela filial ativa (`useAuth().currentBranchId`). É o primeiro parâmetro de verdade na tela — as duas ações "Parâmetros"/"Configurações do sistema" que já existiam continuam decorativas, sem `onClick`. Gated por `can_manage_branches` (a mesma flag que já protege `branches update` na RLS): sem ela o interruptor aparece desabilitado, não escondido — o parâmetro existe, só não pode ser mudado dali. Leitura/escrita via `src/lib/repositories/branchesRepository.ts` (`fetchBranchAllowsNegativeStock`/`updateBranchAllowsNegativeStock`), reaproveitado também por Produtos para mostrar o valor herdado.

#### UI — Produto: `selectField`, a mesma ponte de `lookupField`

`ProductsPage.tsx` ganhou um `<select>` de três opções ("Usar padrão da filial" / "Sempre permitir" / "Sempre bloquear") no formulário. `module_fields` continua sem um `data_type: 'select'` — criar um generalizaria o motor inteiro por causa de um campo (mesma disciplina já registrada para `lookupField`/`mediaField`). Em vez disso, `RegistryFormModal` ganhou `selectField`, uma ponte com a mesma forma de `lookupField`, e `FormField` (`src/components/form/FormField.tsx`) ganhou `type: "select"` com `options` — extensão aditiva, os consumidores existentes (`text`/`date`/`email`/`password`) não mudaram. O atalho de edição rápida do `ProductPickerPanel` (o lápis na lista de produtos de Realizar Venda/Ajuste de estoque/Condicionais) não mostra o campo, mas repassa o valor atual do produto ao salvar — mesmo cuidado já tomado ali com `taxGroupId`, para a edição rápida não resetar um campo que ela não expõe.

A ficha do produto mostra o **valor efetivo**, não só o gravado: quando o produto está em `null`, a linha "Estoque negativo" busca o padrão da filial ativa (mesmo repositório do item acima) e mostra "Bloqueado (padrão da filial)"/"Permitido (padrão da filial)" — sem isso, "usar padrão da filial" ficaria abstrato demais para quem está cadastrando. Com valor explícito, mostra "(sempre permitido neste produto)"/"(sempre bloqueado neste produto)".

#### Aviso não bloqueante: avaliado, não construído nesta rodada

O padrão já existe no PDV para falha de emissão fiscal (`fiscalWarning`, separado do erro que bloqueia a operação — ver a decisão de NFC-e). A ideia foi considerada para "venda aceita porque o produto/filial permite negativo → aviso âmbar não bloqueante", mas **não foi construída**: exigiria mudar a forma de retorno de três RPCs com contratos diferentes hoje (`create_sale`/`create_conditional` devolvem a linha criada, `adjust_stock_batch` devolve `void`) e tocar três telas diferentes (`SalePage.tsx`, `NewConditionalPage.tsx`, `StockAdjustPage.tsx`) — desproporcional a este passo, que era sobre a regra de negócio, não sobre a superfície de aviso. Candidato real para uma rodada futura, não descartado por não fazer sentido.

#### Testado

Como o Browser pane desta sessão não alcança o servidor de outra sessão em paralelo (mesma pegadinha de porta já documentada — `preview_logs` apontou a URL real, `http://localhost:5175`, diferente da porta que a ferramenta reservou), a matriz de precedência (filial ligada/desligada × produto `null`/`true`/`false`, 4 cenários) foi testada direto contra o banco, simulando a sessão do usuário de testes via `request.jwt.claims` (mesmo efeito de `auth.uid()` que uma chamada real via PostgREST teria) — **12/12 cenários corretos** nas três RPCs (`create_sale`, `create_conditional`, `adjust_stock_batch`): filial desligada + produto `null` recusa; filial ligada + produto `null` aceita e o saldo fica negativo; filial ligada + produto `false` recusa (precedência do produto sobre a filial permitindo); filial desligada + produto `true` aceita (precedência do produto sobre a filial bloqueando). Os registros de teste (vendas, condicional, ajustes de estoque) foram apagados depois, e produtos/filial voltaram ao estado anterior. No navegador (login real com a conta de testes): o toggle de Configurações liga/desliga e persiste em `branches` após reload; o `<select>` de Produtos salva e recarrega o valor certo; a ficha mostra "Bloqueado (padrão da filial)" com o produto em `null` e muda para "Permitido (sempre permitido neste produto)" ao trocar para "Sempre permitir", confirmando o valor efetivo. `tsc -b`, `oxlint` (só os 4 avisos `only-export-components` pré-existentes) e `vite build` limpos.

#### Fora de escopo

Tela de administração de Filiais (continua SQL-only). Alerta/notificação centralizada de "produtos com estoque negativo" — candidato a um bloco em Relatórios (etapa 11), não desta etapa. Reverter automaticamente para positivo ou bloquear novas saídas enquanto já está negativo até alguém repor — não pedido; a regra é só permitir ou não permitir ficar negativo.

### Decisão arquitetural: módulo Relatórios (etapa 11) (20/08/2026)

Etapa 11 do plano, e a primeira que não escreve nada em lugar nenhum — os 12 blocos só leem dado que já existe em Vendas, Compras, Financeiro, Notas Emitidas e Produtos. Antes desta etapa `modules.relatorios` era só um tile decorativo (`path: null`, decisão registrada na M2: "o tile existe e não leva a lugar nenhum") — não havia mock, não havia tela, não havia nada para adaptar.

#### Os dois blocos que ficaram de fora, e por quê

O usuário desenhou 14 blocos; dois não entraram nesta rodada por decisão explícita, porque não têm fonte de dado nenhuma no sistema hoje:

- **"Saldo bancário"** — não existe conceito de conta bancária em lugar nenhum do schema. `cash_registers`/`cash_sessions` são caixa físico/PDV, não conta corrente.
- **"Créditos tributários"** — apuração de crédito/débito de ICMS-PIS-COFINS não existe. `tax_rules`/`tax_groups` só guardam o código que vai para a nota (CFOP/CST/alíquota de saída), não escrituração fiscal (entrada × saída, apuração por período). Construir isso seria inventar um módulo de apuração fiscal inteiro, não um relatório sobre dado existente.

Nenhum dos dois virou dado fake para "preencher a grade" — a grade tem 12 blocos, não 14, e é isso mesmo.

#### Views SQL — e a correção que a instrução original tinha errada

Para os relatórios que agregam de verdade (soma/agrupamento), a leitura é uma **view Postgres**, não uma consulta crua somada no cliente. O motivo declarado desde o início é permissão, não performance: uma view deveria herdar a RLS das tabelas de origem, para que a segunda camada de permissão (ver abaixo) funcionasse sem duplicar `has_permission` em SQL fora de lugar nenhum.

**Isso só é verdade com `security_invoker = true` explícito em cada view — sem essa opção, é o contrário do que se pretende.** Confirmado direto no banco antes de escrever a primeira view:

```sql
select rolname, rolbypassrls from pg_roles where rolname in ('postgres','anon','authenticated');
-- postgres | true   (BYPASSRLS)
-- anon     | false
-- authenticated | false
```

`postgres` (dono de toda tabela e de toda view criada por migration) tem `rolbypassrls = true`. No Postgres, uma view sem `security_invoker` roda a checagem de RLS das tabelas de origem com os privilégios do **dono da view**, não de quem consulta — é o mesmo raciocínio de uma função `security definer`, mesmo sem a palavra "definer" em lugar nenhum da sintaxe. Uma view comum aqui devolveria **todas as linhas de todas as filiais para qualquer usuário autenticado**, ignorando `has_permission`/`has_branch_access` por completo — o oposto do que a etapa pede, e um buraco de segurança pior do que nenhuma view existir. `security_invoker = true` (sintaxe de Postgres 15+; o projeto roda Postgres 17) faz a view rodar com os privilégios de quem consulta, herdando a RLS de verdade. Nenhuma view desta etapa usa `security definer` — a instrução original ("view sem security definer herda a RLS automaticamente") estava descrevendo o comportamento certo pelo motivo errado; documentado aqui para a próxima sessão que for criar uma view não repetir o mesmo engano.

Verificado depois de criar: `select relname, reloptions from pg_class where relname like 'report_%'` devolve `security_invoker=true` nas cinco.

#### As cinco views, grão por dia (não só por entidade)

`src/lib/repositories/reportsRepository.ts` / migration `create_reports_views`:

| View | Cobre | Grão |
| --- | --- | --- |
| `report_sales_by_day` | Vendas (Total Faturado) **e** Vendas por período | `branch_id, sale_date` |
| `report_sales_by_contact_day` | Vendas por cliente | `branch_id, contact_id, sale_date` |
| `report_sale_items_by_product_day` | Vendas por produto **e** Produtos mais vendidos | `branch_id, product_id, sale_date` |
| `report_purchases_by_contact_day` | Compras por fornecedor | `branch_id, contact_id, purchase_date` |
| `report_purchase_items_by_product_day` | Produtos comprados **e** Custo médio de compras | `branch_id, product_id, purchase_date` |

Três pares de blocos reaproveitam a mesma view (mesma fonte, ordenação/ênfase diferente no cliente) — não são seis views, são cinco. `sales`/`purchases` filtram `status = 'confirmed'` (venda/compra cancelada não é faturamento).

**Por que o grão é por dia, e não só por entidade final**: uma view não aceita parâmetro (isso seria uma função, e uma função traria de volta a pergunta de que privilégio ela roda). Os relatórios precisam de filtro de intervalo de data arbitrário, escolhido na tela — sem uma coluna de data na própria view, não haveria como aplicar `.gte()/.lte()` antes de agregar por cliente/produto. A solução foi agregar em dois passos: a view agrupa por entidade **e dia** no banco (poucas linhas — um dia inteiro de vendas de um produto vira uma linha, não uma por item), o repositório aplica `.gte()/.lte()` na data e faz o agrupamento final por entidade **em JavaScript, sobre o resultado já agregado e já filtrado pela RLS** — não é "trazer cru e somar", é uma segunda rodada de soma sobre um resultado pequeno que o banco já reduziu. `fetchPurchaseItemsByProduct` calcula o custo médio ponderado (`Σ(unit_cost×quantity) / Σquantity` sobre as linhas do intervalo) em vez de uma média de médias diárias, que seria matematicamente errada.

**Dois relatórios não usam view nenhuma, de propósito**: "Notas fiscais emitidas" (filtro por modelo/status + ordenação, sem soma/agrupamento) e "Estoque abaixo do mínimo" (filtro simples) leem direto de `fiscal_documents`/`products` — a mesma RLS de sempre já basta, e criar uma view sem agregação nenhuma só para "todo relatório tem view" seria a etapa se distorcendo por simetria em vez de por necessidade. Os dois relatórios de Financeiro (ver abaixo) também não usam view — reaproveitam o cálculo client-side que o Financeiro já faz.

#### A permissão em duas camadas, com exemplo concreto de cada uma

**Camada 1 — `has_permission('relatorios', 'view')`**: decide se a pessoa abre `/relatorios` (mesmo portão de sempre, `access_gate = 'permission'`, aplicado pelo `ModuleRoute` — ver a decisão do catálogo). Sem isso, nem o tile aparece na tela inicial nem a rota abre.

**Camada 2 — a permissão do módulo de **origem** de cada bloco**, imposta pela RLS das tabelas por trás da view (herdada de verdade graças ao `security_invoker`, ver acima), não por nenhuma checagem escrita nesta etapa:

- Um Operador com `relatorios/view` mas **sem** `financeiro/view` abre a tela normalmente, todos os 12 blocos aparecem na grade, os blocos de Vendas/Compras/Estoque funcionam — mas "Financeiro (fluxo de caixa)" e "Contas a pagar/receber" vêm **vazios**, porque `useFinancialEntriesData` (a mesma consulta que `/financeiro` já usa) devolve zero linhas sob a RLS de `financial_entries`. `ReportsPage.tsx` checa `hasPermission(sourceModuleId, 'view')` só para mostrar um aviso amigável ("Você não tem permissão de visualização em 'financeiro'...") — quem barra de verdade é a RLS, o aviso é conforto de UX por cima de uma restrição que já existia sem ele.
- O mesmo vale para os outros módulos de origem: "Vendas por produto"/"Vendas por cliente"/"Vendas (Total Faturado)"/"Vendas por período"/"Produtos mais vendidos" dependem de `realizar-venda/view` (é essa policy que governa `sales`/`sale_items`, não uma permissão "vendas" genérica — nem PDV nem Pedidos de venda são o portão aqui); "Compras por fornecedor"/"Produtos comprados"/"Custo médio de compras" dependem de `compras/view`; "Notas fiscais emitidas" depende de `notas-emitidas/view`; "Estoque abaixo do mínimo" depende de `produtos/view`.
- **Camada 2 tem uma segunda dobra, mais sutil, dentro de "Vendas por cliente"/"Vendas por produto"**: a linha da venda (de `sales`) é governada por `realizar-venda/view`, mas o **nome** do cliente/produto vem de um `left join` para `contacts`/`products`, cada um com a própria RLS (`clientes-fornecedores/view`, `produtos/view`). Um usuário com `realizar-venda/view` mas sem `clientes-fornecedores/view` vê a linha da venda (ela não desaparece — `left join` para uma tabela sem permissão devolve `null`, não filtra a linha), só que com "Cliente sem permissão de leitura" no lugar do nome. Documentado aqui porque não é óbvio de só olhar a tela: **duas permissões diferentes** decidem o que aparece na mesma linha.
- **Testado invertendo `financeiro/can_view` do Administrador direto no banco**: com a permissão desligada, "Financeiro (fluxo de caixa)" voltou zerado (Entrou/Saiu/Saldo em R$ 0,00, tabela vazia) com o aviso na tela; "Vendas por produto" continuou respondendo normal (315,00/215,60/79,60, mesmos números de antes) — prova de que as duas camadas são independentes: perder o acesso a um módulo de origem não derruba os outros blocos. Religado depois.
- **Testado desligando `relatorios/can_view`**: o tile "Relatórios" sumiu da tela inicial (16 → 15 tiles) e `/relatorios` direto na URL devolveu "Você não tem permissão para acessar este módulo." — camada 1 funcionando antes mesmo de chegar em qualquer bloco. Religado depois.

#### Financeiro: reaproveitado, não reinventado

`computeCashFlowTotals` (`src/features/finance/finance.ts`) foi **extraída** do cálculo que já existia inline em `FinancePage.tsx` (aba "Baixados": Entrou/Saiu/Saldo por `type`) — as duas telas chamam a mesma função agora, `FinancePage.tsx` sobre a aba Baixados, `ReportsPage.tsx` sobre o intervalo de data escolhido. "Contas a pagar/receber" reaproveita o mesmo padrão de `.filter().reduce()` que a aba "A pagar"/"A receber" do Financeiro já fazia, sobre os mesmos dados de `useFinancialEntriesData` (a página de Relatórios não reconsulta `financial_entries` por conta própria — usa o hook que o Financeiro já usa). Testado que os dois números batem: "Baixados" no Financeiro e "Financeiro (fluxo de caixa)" em Relatórios mostraram exatamente 449,64 / 52,50 / 397,14 (Entrou/Saiu/Saldo) para o mês corrente.

#### Coluna nova: `products.minimum_stock`

`numeric`, nulável — **produto sem mínimo definido nunca aparece** em "Estoque abaixo do mínimo" (ausência não vira `0`, que dispararia todo produto sem esse campo preenchido). Campo novo em `module_fields` (`field_key: 'minimum_stock'`, `data_type: 'text'`, mesma convenção de todo campo numérico no motor genérico — conversão manual no submit, ver `toOptionalNumber` em `products.ts`) — aparece no formulário de criação/edição de Produtos e na ficha, sem tela nova nem código de formulário novo (o motor genérico já sabia fazer isso; só faltava a coluna e a linha de metadado). `ProductsPage.tsx` precisou de um ajuste manual nos dois blocos de `initialValues` (editar/clonar) — o mesmo padrão já documentado no roteiro item 1, campo numérico não é automático em lugar nenhum dessa tela.

Testado: Café Torrado 500g (saldo 30) recebeu `minimum_stock = 50` pela tela → apareceu em "Estoque abaixo do mínimo" (30/50); os outros dois produtos, sem o campo preenchido, não apareceram.

#### Tela: grade + detalhe, sem motor genérico nem de lote

`src/features/reports/` — `ReportsPage.tsx` (bespoke, como Realizar Venda/Financeiro/Controle de Caixa: não é CRUD de uma tabela, é apresentação com filtro e drill-down), `reports.ts` (`ReportDefinition[]` — id/rótulo/ícone/`filterKind`/`sourceModuleId`, os 12 blocos descritos como dado, não como 12 componentes quase idênticos), `reportIcons.tsx` (4 ícones novos que não existiam em `home/icons.tsx`), `ReportsPage.css`.

- **Nível 1** (grade): reaproveita `ModuleTile`/`ModuleTile.css` de `src/features/home/components/` **sem** passar pelo `HomeModule`/`useModuleOrder`/catálogo — os 12 blocos não são módulos do catálogo (sem linha em `modules`, sem rota própria, sem reordenação por arraste), são estado local da página (`activeId`). O grid CSS (`.reports-grid`) foi **copiado**, não importado, de `OriginalLayout.css` — importar traria regras da tela inicial que não se aplicam aqui.
- **Nível 2** (detalhe): `RegistryLayout variant="single"` + `RegistryTable` com o slot `summary` já existente (mesmo usado por Financeiro/Controle de Caixa) — nenhum componente novo no motor de registro, só reaproveitamento.
- **Intervalo padrão de data, por `filterKind`** (`defaultRangeFor` em `reports.ts`):
  - `"period"` (Vendas Total Faturado, Vendas por período, Financeiro fluxo de caixa): **mês corrente até hoje** — histórico inteiro sem filtro ficaria pesado e ilegível, e "este mês" é a pergunta mais comum para um relatório de período.
  - `"entity"` (por cliente/produto/fornecedor: Vendas por cliente/produto, Compras por fornecedor, Produtos comprados, Custo médio de compras, Produtos mais vendidos): **últimos 90 dias** — mais largo que "period" de propósito (ranking de clientes/produtos costuma querer uma janela maior que um mês), mas ainda um intervalo real, não "todo o histórico" só porque o ambiente de teste tem poucas linhas hoje.
  - `"status"` (Notas fiscais emitidas): sem filtro de data — filtra por modelo/status, não por período.
  - `"none"` (Contas a pagar/receber, Estoque abaixo do mínimo): sem filtro nenhum — são fotografias do estado atual (o que está em aberto agora, o que está abaixo do mínimo agora), não uma série no tempo.
- Ícones novos (`reportIcons.tsx`): `CalendarIcon` (Vendas por período), `AverageCostIcon` (Custo médio de compras), `TopSellerIcon` (Produtos mais vendidos), `LowStockIcon` (Estoque abaixo do mínimo) — os outros 8 blocos reaproveitam ícones já existentes em `home/icons.tsx` (`SaleHandIcon`, `ClientsIcon`, `ProductsIcon`, `PurchasesIcon`, `FinanceIcon`, `InvoicesIcon`), do mesmo jeito que módulos oficiais já compartilham ícone quando o conceito é próximo.

#### Testado no navegador

Logado com a conta de testes: os 12 blocos abrindo, cada um com filtro (data ou modelo/status, ou nenhum, conforme `filterKind`) + tabela + resumo. **Oito dos doze conferidos contra consulta manual no banco** (mais que os 3 mínimos pedidos, porque as views novas eram o risco real da etapa): Vendas por produto (610,20 em 27 itens — Doritos 315,00/18, Arroz 215,60/5, Café 79,60/4, `SUM(sale_items.total_amount) GROUP BY product_id` batendo linha a linha), Vendas por cliente (331,60 + 148,60 + 130,00 = 610,20, mesma soma da venda por produto, provando que as duas views nunca divergem no total), Vendas Total Faturado (610,20 em 17 vendas do mês corrente, batendo `SELECT SUM(total_amount) FROM sales WHERE issue_date >= date_trunc('month', ...)`), Produtos mais vendidos (mesma fonte de Vendas por produto, ordenação por quantidade confirmada: 18 > 5 > 4), Compras por fornecedor (117,00 em 3 compras da Distribuidora Alfa), Custo médio de compras (14,00/15,00/22,50 — média ponderada por produto batendo `SUM(unit_cost*quantity)/SUM(quantity)`, não a média ingênua das linhas), Financeiro fluxo de caixa (449,64/52,50/397,14, batendo `SUM` direto em `financial_entries` por tipo/status), Contas a pagar/receber (309,96/86,56, idem), Notas fiscais emitidas (8 notas, 6 autorizadas, batendo `COUNT(*) GROUP BY status`). Estoque abaixo do mínimo testado ponta a ponta (ver seção da coluna nova). Prova da camada 2 e da camada 1 descritas acima, cada uma revertida depois do teste. Regressão: Financeiro (aba Baixados) e Produtos (lista, ficha, formulário de edição) conferidos sem mudança de comportamento — só o número de "Estoque mínimo" novo na ficha/formulário de Produtos, que antes não existia. `tsc -b`, `oxlint` (só os 4 avisos `only-export-components` pré-existentes) e `vite build` limpos.

#### Fora de escopo

"Saldo bancário" e "Créditos tributários" (decisão explícita do usuário, sem fonte de dado — ver acima); exportar relatório em PDF/Excel/CSV (não pedido, nenhum módulo do sistema faz isso hoje); gráficos/visualização (a referência do usuário mostrava só os blocos de entrada, tabela é suficiente para esta etapa); alerta/notificação centralizada e proativa de estoque abaixo do mínimo (o relatório é sob consulta, não um aviso que aparece sozinho — diferente do candidato "alerta de estoque negativo" já citado na etapa de estoque negativo configurável, que é sobre `allow_negative_stock`, um conceito diferente de `minimum_stock`); drill-down de um bloco para dentro de outro módulo (clicar numa linha de "Vendas por cliente" e cair na ficha do cliente, por exemplo — nenhum bloco faz isso, cada um é uma tabela autocontida); filtro de filial (todo relatório usa a filial ativa do usuário, mesmo padrão de todo módulo `branch_scoped`, sem seletor de "ver todas as filiais").

### Decisão arquitetural: workflow de módulos (M4) — duas camadas e `is_facilite_developer` (20/08/2026)

A etapa que M3 deixou nomeada no "fora de escopo": *workflow configurável (situações, transições, ações automáticas), que é M4 e depende de M3 existir*. Um módulo criado pelo usuário passa a ter **estado**, não só campos: cada registro carrega uma situação, e muda de situação por botões que a própria configuração cria na ficha.

#### Por que a atomicidade aqui é mais simples que Devolução/Condicionais

Todo módulo criado pelo usuário guarda os registros na **mesma tabela física** (`module_records`, distinguida por `module_id`). Então "escrever num módulo diferente" não é escrita entre tabelas diferentes: é um `update` em outra linha da mesma tabela, filtrada por outro `module_id`. Isso **não** elimina o risco de negócio (dado errado indo para o lugar errado — é justamente o que a Camada 2 protege), mas elimina o risco de atomicidade multi-tabela que tornou Devolução de venda e Condicionais difíceis. Aqui a transação sempre mexe numa tabela só.

#### As duas camadas — capacidade e permissão são eixos diferentes

| | Camada 1 | Camada 2 |
| --- | --- | --- |
| O que é | Situações, transições, e ação que escreve **no próprio registro** | Ação que **lê de** ou **escreve em** um registro de outro módulo genérico |
| Quem configura | Qualquer `can_manage_modules` (a mesma flag de M3) | Só `profiles.is_facilite_developer` |
| Onde vale | Só `storage_kind = 'generic'` (mesma fronteira que M3 traçou para campos) | idem |

O pedido do usuário foi explícito sobre o risco: alguém que sabe montar um módulo **não** deveria conseguir configurar uma transição que lê ou escreve noutro módulo — é fácil quebrar o sistema de um jeito irreversível (escrever no registro errado, apontar para o módulo errado) sem entender o alcance. Camada 1 continua completa para essa pessoa; Camada 2 **nem aparece como opção** na tela, não aparece desabilitada com um cadeado (não se anuncia uma capacidade que a pessoa nunca vai poder usar).

#### O modelo de confiança: configurar ≠ executar

**A permissão que importa em tempo de execução é a de quem configurou a automação, não a de quem aciona a transição.** Um usuário comum, sem nenhum acesso ao módulo B, pode disparar uma transição no módulo A que escreve no módulo B — porque foi um desenvolvedor do Facilite, com o julgamento e o contexto para isso, quem decidiu que essa automação deveria existir.

Mesmo princípio já usado em `create_pos_sale` chamando o núcleo de `create_sale` sem exigir a permissão de quem só opera o caixa: a confiança foi depositada uma vez, na configuração, não repetida a cada disparo. Por isso `transition_module_record` valida `has_permission(módulo A, 'edit')` + `has_branch_access` de quem chama, e **não** checa `has_facilite_developer_access()` — essa checagem mora só nas RPCs/triggers que gravam a configuração.

**Provado no navegador**: a automação foi configurada com a flag ligada, a flag foi desligada, e a transição continuou funcionando — mudando os registros dos dois módulos com o **mesmo `updated_at` ao microssegundo** (prova da transação única).

#### `is_facilite_developer` não é RBAC do cliente

`profiles.is_facilite_developer boolean not null default false` — **não** `roles`. É característica da **pessoa**, não do papel que ela ocupa numa empresa cliente: um papel é, por natureza, algo que o Administrador do cliente configura, e isto não deveria estar ao alcance dele. Mesmo espírito de atrito deliberado já usado em Filiais e `cash_registers`: **SQL-only, sem UI, de propósito**.

- `has_facilite_developer_access()` — mesmo formato de `can_manage_modules()` (e a mesma armadilha: devolve `NULL` sem perfil, então toda checagem imperativa usa `coalesce(..., false)` **por fora**).
- **A trava contra auto-promoção**: a policy de `update` de `profiles` já permitia editar a própria linha, então sem trava qualquer um ligaria a flag em si mesmo. O trigger `prevent_role_escalation` foi estendido: se `is_facilite_developer` muda **e `auth.role()` não é nulo**, recusa. `auth.role()` só é nulo numa conexão SQL direta ao banco — nem o Administrador, nem a Edge Function com `service_role`, passam. Testado pelo console: `is_facilite_developer só pode ser alterado por SQL direto no banco.`

#### Schema

- **`module_records.status text null`** — guarda o **`code`** da situação, não o id (o code é estável; o rótulo muda livremente). Atribuído pelo trigger `module_records_set_initial_status` **incondicionalmente** na criação: o cliente não escolhe em que situação um registro nasce. Módulo sem workflow fica com `status` nulo e nada muda para ele.
  - **Sem FK composta** `(module_id, status) → module_situations(module_id, code)`, de propósito: ela teria que ser `NO ACTION` (um cascade apagaria o registro inteiro por causa de uma situação removida), e aí excluir um módulo quebraria — o cascade de `modules` atinge `module_records` e `module_situations` sem ordem garantida. A trava real está na RPC de excluir situação, com mensagem clara, mesmo padrão de `delete_user_module`.
- **`module_situations`** (`module_id`, `code` imutável, `label`, `sort_order`, `is_initial`) — `unique (module_id, code)` e um índice único parcial garantindo **uma só inicial por módulo**. A primeira situação criada vira a inicial automaticamente (workflow sem ponto de partida não conseguiria carimbar um registro novo), e a inicial não pode ser desmarcada — só substituída.
- **`module_transitions`** (`module_id`, `from_situation_id`, `to_situation_id`, `label`, `sort_order`) — `unique (from, to)` e `check (from <> to)`. Depois de criada, só `label`/`sort_order` mudam: trocar o par viraria o sentido das ações penduradas nela sem que elas soubessem.
- **`module_transition_actions`** — **uma tabela com colunas nulas conforme o tipo**, não uma satélite por forma de ação (a escolha era livre; esta é a justificativa). As três formas compartilham quase tudo, e o que uma satélite compraria — tornar a combinação ilegal irrepresentável — os CHECK compram sem custar três joins na RPC de execução nem três conjuntos de policies:

  | Forma | `target_kind` | `value_kind` | Camada |
  | --- | --- | --- | --- |
  | Escreve no próprio registro | `self` | `literal`/`now`/`current_user` | 1 |
  | Lê do relacionado, grava no próprio | `self` | `related_field` | 2 |
  | Escreve no relacionado | `related_record` | `literal`/`now`/`current_user` | 2 |

  Os CHECK são declarativos e simétricos: `via_reference_field_key` existe **exatamente quando** a ação atravessa uma referência; `source_field_key` **exatamente quando** `value_kind = 'related_field'`; `value` **exatamente quando** `literal`. Mais um: **`related_record` + `related_field` na mesma linha é proibido** — exigiria duas colunas `via` (o campo de leitura e o de escrita podem ser diferentes) e é vizinho de referência multi-hop, que está fora de escopo. Uma coluna `via` só pode significar uma coisa.

- **`module_fields.reference_module_id`** — quando preenchido, o valor do campo (dentro de `data`) é um `module_records.id` de outro módulo genérico.
  - **É `text`, não `uuid`** como o pedido dizia: `modules.id` é o slug do módulo (`'produtos'`, `'chamados'`), então a coluna acompanha o tipo da chave que referencia.
  - **A checagem mora num trigger (`module_fields_guard_reference`), não numa RPC nova.** Motivo: a policy de `module_fields` já aceita `can_manage_modules()` gravando direto pelo PostgREST desde M3, e é esse o caminho que o construtor usa. Uma RPC protegeria só o caminho novo e deixaria o antigo aberto — o trigger cobre os dois, que é o ponto de a checagem não ser "só uma sugestão de UI". O trigger também valida que os dois módulos são genéricos e que o campo não referencia o próprio módulo.
  - **Ponto em que o pedido se contradizia, e como foi resolvido**: o item 2 dizia que definir um campo de referência é Camada 1 ("é só uma relação de apontamento, não executa nada sozinha"), mas os itens 4 e 5 diziam que `reference_module_id` é gated por `has_facilite_developer_access()` e que o controle de apontar um campo para outro módulo só aparece para desenvolvedor. Foi implementada a **leitura de maioria (itens 4 e 5): gravar `reference_module_id` exige desenvolvedor**, porque é a única que mantém UI e banco coerentes. Se a intenção for a outra, é uma linha: tirar a checagem do trigger e passar `referenceChoices` no `ModuleBuilderPage` sem depender da flag.

- **RLS**: só policy de `select` nas três tabelas de workflow (`has_permission(module_id, 'view')`; a de ações resolve o módulo via `module_transitions`). **Nenhuma policy de escrita** — quem grava é sempre uma RPC `security definer`, que é onde moram as checagens que uma policy não expressa. Consequência aceita e documentada: quem tem `can_manage_modules` mas não `view` no módulo não consegue configurar o workflow dele (na prática não acontece — `create_user_module` concede as quatro permissões a quem cria).

#### `transition_module_record(p_record_id, p_to_situation_id)`

`security definer`. Valida permissão de quem aciona (só no módulo da transição), confirma que a transição é permitida **a partir da situação atual**, atualiza `status`, e roda as ações em ordem. Detalhes que valem lembrar:

- **`status` nulo = situação inicial.** Registro criado antes de o módulo ganhar workflow é tratado como estando na inicial — e a mesma regra vale no front (`useModuleWorkflow.resolveCode`), senão o botão apareceria na tela e o banco recusaria.
- **A escrita é merge não-destrutivo** (`data = data || jsonb_build_object(...)`), o mesmo que `genericModuleRepository.ts` já fazia: nunca sobrescreve `data` inteiro, para não apagar chaves de campos removidos que continuam guardadas de propósito.
- **`for update` só quando vai escrever** no registro relacionado; leitura não segura a linha do outro módulo.
- **Uma ação que falha derruba a transição inteira** — decisão tomada e confirmada no navegador. "Meio migrado" é pior que "não migrado", mesmo raciocínio de toda RPC atômica deste projeto. Testado: com o registro relacionado excluído, a transição falhou com *"A referência de "cliente" aponta para um registro que não existe mais em "clientes-teste-m4"."* e **nem as ações de Camada 1 que rodariam antes dela persistiram** — o registro continuou em "Aberto", com `resolvido_em` e `resolvido_por` vazios.
- **`now` respeita o fuso de quem usa o sistema**: o banco roda em UTC, e uma transição às 22h em São Paulo carimbaria o dia seguinte. Usa `timezone('America/Sao_Paulo', now())`, e formata `YYYY-MM-DD` quando o campo de destino é `date` (o motor usa `<input type="date">`, que só entende esse formato) ou carimbo completo nos demais.
- **`current_user` grava o nome, não o uuid**: o campo é texto e aparece na ficha; um uuid a deixaria ilegível. Se um dia existir `data_type` de referência a usuário, isto passa a gravar o id.
- **Campo de referência não é destino de escrita** — gravar por cima dele quebraria o apontamento que outras ações usam. Recusado na RPC de configuração e escondido da lista de destinos na tela.

#### A trava que faz a máquina de estados ser real

Sem ela, a policy de `update` de `module_records` (que permite qualquer coluna a quem tem `edit`) deixaria um cliente adulterado escrever `status` direto, e a checagem de "essa transição é permitida a partir da situação atual" viraria decoração. O trigger `module_records_guard_status` recusa qualquer mudança de `status` que não venha com o sinal `facilite.workflow_transition` ligado — e `transition_module_record` liga esse sinal pelo tempo exato do seu próprio `update`. Testado pelo console: `A situação do registro só muda por uma transição do módulo.`

#### Tela

- **`/modulos`**: seção "Situações e transições" abaixo da tabela de campos, só quando `fieldEditingCapabilityFor()` devolve `full` (ou seja, só módulo genérico — mesma fronteira de M3, e a mesma que `assert_module_workflow_editable` impõe no banco). Cada ação aparece **descrita em português** ("Preenche "Cidade do cliente" com "Cidade" de Clientes teste M4 (via "Cliente")"), com selo `OUTRO MÓDULO` nas de Camada 2: um `target_kind` e um `value_kind` lado a lado numa tabela não dizem nada a quem vai conferir se a automação está certa — e conferir é justamente o que a Camada 2 exige.
- **Camada 2 escondida, não desabilitada**: sem a flag, `referenceChoices`/`references` chegam vazios aos formulários e as opções simplesmente não existem. Confirmado no navegador: sem a flag, "O que a ação faz" tem **uma** opção e "Valor" tem **três**; com a flag, duas e quatro.
- **Remover uma ação exige só `can_manage_modules`**, inclusive as de Camada 2. Remover uma automação nunca escreve dado em lugar nenhum — o risco que a flag protege é configurar uma escrita cruzada, não desfazê-la —, e `delete_module_transition` já leva as ações junto de qualquer forma; exigir desenvolvedor só ali criaria assimetria sem ganho.
- **`GenericModulePage`**: a ficha ganha "Situação" como primeiro item, e os botões de transição disponíveis a partir dela entram entre "Editar" e "Excluir". **A existência de ação de Camada 2 por trás de uma transição é invisível para quem apenas usa o módulo** — ela vê "Marcar como resolvido", não sabe nem precisa saber que aquilo também mexeu no módulo B.
- **Campo de referência vira `<select>` de registros do módulo apontado** (`useModuleReferences`), e a tabela/ficha mostram o rótulo do registro no lugar do uuid. Sem isso o formulário estaria pedindo que alguém colasse um uuid à mão. O rótulo de cada opção é o primeiro campo com `show_in_table` do módulo referenciado — tudo sai de metadados. Quem decide o que entra na lista continua sendo a RLS: quem não pode ver o módulo referenciado recebe lista vazia.
- **`STATUS_KEY = "__status"`** no repositório genérico: o prefixo de dois underscores não é enfeite — `module_field_key` nunca deixa underscore na ponta, então nenhum campo do usuário (nem um chamado "Status") consegue gerar essa chave e disputar o lugar dela.

#### `delete_user_module` mudou junto

Passa a apagar `module_transition_actions`, `module_transitions` e `module_situations` (escritas uma a uma, mesmo motivo de sempre: o que a função apaga precisa estar visível na função), e **recusa** excluir um módulo que ainda é destino de um campo de referência, dizendo **qual** módulo aponta para ele — em vez de deixar vazar o erro cru da FK `restrict`. Testado: `Não dá para excluir: o módulo Chamados teste M4 tem campo(s) apontando para este. Remova a referência antes.`

#### Testado no navegador

Dois módulos de teste relacionados ("Clientes teste M4" e "Chamados teste M4", com campo de referência de um para o outro). **Camada 1 isolada, sem tocar na flag**: situações "Aberto" (inicial automática) e "Resolvido", transição "Marcar como resolvido", ações de `now` e `current_user` — registro nasceu em "Aberto", o botão apareceu na ficha, e a transição gravou `2026-08-20` e `Claude Testes`. **Sem a flag**, o controle de referência não aparecia na edição de campo e o formulário de ação não oferecia nenhuma opção de Camada 2; pelo console, o banco recusou tanto apontar o campo (`Só um desenvolvedor do Facilite pode apontar um campo para outro módulo.`) quanto a auto-promoção. **Com a flag ligada por SQL**, o controle apareceu e as duas ações de Camada 2 foram configuradas. **Com a flag desligada de novo**, um chamado passou de Aberto para Resolvido e os dois módulos mudaram juntos — `cidade_do_cliente` = "Campinas" lido do cliente, e `ultimo_chamado` = "Resolvido pelo suporte" gravado no cliente, com `updated_at` idêntico nas duas linhas. Referência quebrada: rollback completo. Produtos recusou o construtor com a mensagem de M3 e **sem** seção de workflow; Tributações ofereceu só "Editar" campo, coluna Referência em "—" e **sem** seção de workflow; Financeiro e PDV idem. Os dois módulos de teste foram excluídos no fim, sem órfãos em nenhuma das sete tabelas, e `is_facilite_developer` voltou a `false` para todo mundo. `tsc`, `oxlint` e `vite build` limpos, com o code splitting por página preservado.

#### Fora de escopo

Ações que mexem em tabelas que não são `module_records` (criar lançamento financeiro de verdade, ajustar estoque de produto) — mesmo com `is_facilite_developer`, esta etapa é só sobre módulos genéricos escrevendo em módulos genéricos; automação envolvendo módulos oficiais é uma etapa própria. Referência multi-hop (seguir uma referência que leva a outra, em cadeia) — só um salto. Condição além de "de qual situação para qual" nas transições. Histórico/auditoria de transições. **UI para o cliente final habilitar `is_facilite_developer`** em si mesmo ou em qualquer papel — não existe de propósito, e não deveria ser criada "para facilitar" sem essa decisão voltar a ser conversada.

### Redesenho do construtor de módulos: canvas de campos e diagrama de workflow (21/08/2026)

Etapa de **superfície**, não de capacidade. A auditoria de 20/08/2026 testou `/modulos` de ponta a ponta e achou o motor certo e a experiência errada: criar módulo, adicionar campo e criar situação gravavam tudo direito, mas construir um módulo era indistinguível de preencher um formulário de administração — um modal, um `<select>` de tipo, uma tabela técnica de campos (Rótulo/Chave/Tipo/Obrig./Tabela/Ficha/Formulário) e uma lista de "situações e transições" **sem nenhum diagrama**, apesar de "transição entre situações" ser literalmente um conceito de fluxo.

**Nenhuma regra de M3 ou M4 mudou.** Vale reafirmar item a item, porque é fácil supor o contrário ao ver a tela nova:

- `fieldEditingCapabilityFor()` continua com os mesmos três casos e as mesmas mensagens: `generic` = CRUD completo de campo; `table` sem tela própria (Tributações, Grupos tributários) = só editar o que já existe; tela própria (Produtos, Financeiro, PDV…) = recusa. A fronteira agora vira duas props do canvas (`canAdd`/`canEdit`), e o caso de recusa não renderiza canvas nenhum.
- Camada 2 de M4 (ler/escrever em módulo relacionado) continua **só** para `is_facilite_developer`, continua **escondida e não desabilitada**, e o portão continua sendo o banco: `referenceChoices`/`references` chegam vazios aos controles novos exatamente como chegavam aos antigos. `is_facilite_developer` não mudou de significado nem ganhou UI para ser ligada.
- Situação inicial continua não podendo ser desmarcada, só substituída; `code` e `field_key` continuam imutáveis; o par de uma transição continua travado depois de criada; `module_records`, `module_transitions`, `module_transition_actions` e `has_facilite_developer_access()` não foram tocados.
- Nenhuma ação cruzada nova entre módulos nasceu aqui.

#### `canvas_x`/`canvas_y`, e por que nulo não é erro

Única mudança de schema: `module_situations` ganhou `canvas_x numeric null` e `canvas_y numeric null`. **Nulável de propósito** — toda situação criada antes desta etapa tem nulo, e um diagrama que recusasse desenhar por causa disso ficaria vazio justamente para quem já tem workflow montado.

Quando é nulo, `positionOf()` (`WorkflowCanvas.tsx`) calcula uma posição em linha pela ordem de `sort_order`, quebrando a cada quatro nós para não sair da tela — que é exatamente a leitura que a lista antiga dava. O primeiro arraste substitui o cálculo por um valor gravado, e os dois convivem na mesma tela sem transição de estado: **verificado no navegador** com três situações, uma arrastada e duas em nulo.

#### `save_module_situation_position` — a única RPC de escrita nova, e por que ela existe

`save_module_situation` **não aceita patch parcial** (confirmado lendo o corpo da função antes de decidir): ela exige rótulo, ordem e `is_initial`, revalida o rótulo e mexe em qual situação é a inicial. Arrastar uma caixa não deveria poder tocar em nada disso — um arraste que reescreve `is_initial` seria um efeito colateral invisível, e o gesto mais barato da tela seria o mais perigoso.

Então nasceu `save_module_situation_position(p_id, p_canvas_x, p_canvas_y)`, `security definer`, que resolve o `module_id` pela própria linha e chama **a mesma** `assert_module_workflow_editable` das outras RPCs de workflow. Nenhuma fronteira nova: mesmo portão (`can_manage_modules` + módulo genérico), mesmo padrão de `revoke execute ... from public, anon` + `grant to authenticated`, e o `coalesce` por fora da flag continua morando dentro de `assert_module_workflow_editable`, onde já estava.

**Reordenar campo não precisou de RPC nenhuma**: `module_fields` já aceita `update` direto pelo PostgREST de quem tem `can_manage_modules` (policy de M3), e `sort_order` é coluna comum dessa tabela. `reorderModuleFields` reescreve a escala do zero (10, 20, 30…) e grava **só as linhas que mudaram** de posição.

#### A decisão de interação: clicar em um nó e depois no outro, não arrastar de um até o outro

Não havia precedente no projeto para copiar — os nove usos de `@dnd-kit` são todos "mover um item", nenhum é "ligar dois itens" —, então é julgamento de UI, e fica registrado com o porquê. Criar uma transição é: apertar **"Ligar situações"**, clicar na origem, clicar no destino; aí abre o formulário só para o texto do botão, com o par já travado.

- **O arraste do nó já está ocupado**: é como se move a caixa, e é o gesto que esta etapa acabou de gravar no banco. Um segundo modo de arraste no mesmo elemento precisaria de uma alça pequena dedicada — e alça pequena com dnd-kit é exatamente o caso que obrigou a trocar `rectIntersection` por `pointerWithin` em Ajuste de estoque (colisão imprecisa perto de alvo pequeno). Trocar um risco conhecido por outro conhecido não é progresso.
- **O modo armado deixa o estado visível** ("Clique na situação de origem." → "Agora clique na situação de destino."), o que um arraste não deixa; e é cancelável com `Esc`, clicando no fundo, ou clicando de novo no mesmo nó.
- **Funciona igual no toque**, sem depender de precisão de arraste.

O preço é um clique a mais para armar o modo — preço certo para uma ação que cria uma linha no banco. Se um dia isso incomodar, o caminho é adicionar o arraste **por cima** deste, não no lugar dele.

#### Detalhes de implementação que valem lembrar

- **`FieldCanvas` espelha `ModuleGrid`** (`@dnd-kit/sortable` + `rectSortingStrategy`) — é o mesmo problema, blocos numa grade que se reorganizam ao arrastar. Duas diferenças deliberadas: a ordem nova vai **para o banco** (`sort_order` é o que a tabela, a ficha e o formulário do módulo leem, não uma preferência de navegador como em `ModuleGrid`), e **não há `DragOverlay`**. O cartão segue o cursor pelo `transform` do próprio `useSortable`; `.module-builder__detail` tem `backdrop-filter`, que cria *containing block* para `position: fixed`, então um overlay ali precisaria do `createPortal` explícito documentado em Ajuste de estoque. Não usar overlay resolve o mesmo problema sem a peça extra.
- **Só a alça carrega os listeners do dnd-kit**, nunca o cartão inteiro. É o que deixa o cartão ser cartão e formulário ao mesmo tempo: sem isso o sensor engoliria o clique de cada chip e de cada ícone de tipo.
- **O clique depois do arraste, no diagrama**: o `click` nativo dispara depois do `mouseup` mesmo quando houve arraste, e o dnd-kit **não** o cancela. Sem uma janela de guarda, largar um nó o selecionaria — ou, no modo "ligar", criaria uma transição que ninguém pediu. O `onDragEnd` do contexto carimba a hora (roda no `mouseup`, antes do `click`) e o nó ignora cliques dentro de 200 ms. **Vale para qualquer elemento que seja arrastável e clicável ao mesmo tempo.**
- **Objetos de opção dos sensores fora do componente**, como sempre (pegadinha de Realizar Venda).
- **Ícone por tipo, desenhado em código** (`FieldTypeIcon.tsx`, cinco traços no padrão de `src/components/icons.tsx`) — mesma lição do ícone de Grupos tributários: um componente de traço resolve, sem asset externo. O nome do tipo **continua legível** (`title`/`aria-label`, e escrito por extenso no tamanho normal do `FieldTypePicker`): trocar "formulário burocrático" por "adivinhação" não seria ganho. `FIELD_TYPES` continua a única fonte de quais tipos existem — nenhum `data_type` novo nasceu aqui.
- **A prévia ao vivo é o que faz o canvas ser canvas.** Abaixo dos cartões, o cabeçalho da lista do módulo com os rótulos marcados como "Tabela", na ordem atual. Sem ela seriam cartões no lugar de linhas, cosmético; com ela, arrastar um cartão muda a coisa que se está montando na hora.
- **As quatro flags viraram chips no cartão**, gravando na hora, e a regra "o campo precisa aparecer em pelo menos um lugar" desceu do submit do modal para o clique do chip — desligar o terceiro é recusado com a mesma mensagem, em vez de deixar gravar um campo invisível.
- **`FieldFormModal` virou só "campo novo"**: depois de criado, o campo é editado no próprio cartão. O controle de referência (Camada 2) mora nos dois lugares, e some nos dois quando `referenceChoices` chega vazio; quando o campo já aponta para outro módulo, o apontamento continua **legível** para todo mundo (é informação, não controle).
- **As ações de uma transição ficam no painel lateral, não no desenho.** Uma aresta com três frases penduradas viraria emaranhado, e conferir a automação — que é o que a Camada 2 exige — pede texto corrido. `describeAction` e o selo `OUTRO MÓDULO` continuam iguais.
- **Arestas são curvas, não retas**, com a barriga sempre para o mesmo lado da direção: assim A→B e B→A (que o banco permite, o `unique` é por par ordenado) não se sobrepõem. A ponta da seta é recortada na borda do nó, senão o sentido — a única informação que uma transição carrega — ficaria escondido debaixo da caixa.

#### Testado no navegador

Módulo "Canvas teste" criado do zero. **Campos**: três de tipos diferentes (texto, data, e-mail) adicionados pelo canvas; "Contato" arrastado da terceira para a primeira posição por eventos de ponteiro reais, gravando `sort_order` 10/20/30 no banco e **sobrevivendo ao F5** (cartões, prévia e ícone de tipo de cada cartão). Prévia acompanhou tudo ao vivo: desligar "Tabela" em "Prazo" tirou a coluna, religar devolveu; tentar desligar a terceira flag de visibilidade foi recusado com *"O campo precisa aparecer em pelo menos um lugar…"*. Rótulo renomeado no cartão e tipo trocado de E-mail para Telefone pelo ícone, ambos gravados. **Workflow**: três situações ("Aberto" virou inicial sozinha), um nó arrastado gravou `canvas_x/canvas_y` = 158/186 enquanto os outros dois continuaram em nulo e caíram no cálculo em linha — tudo intacto depois do F5. Duas transições criadas pelo modo "Ligar situações", com as dicas mudando a cada passo e o par chegando travado no formulário; no banco, `aberto → em_andamento` e `em_andamento → resolvido`, direções certas. Nenhum arraste virou seleção acidental. **Camada 1 de ponta a ponta**: ação `now` em "Prazo" configurada pelo painel da seta; registro criado nasceu em "Aberto", passou por "Em andamento" e chegou em "Resolvido" com `Prazo` = `2026-08-21` preenchido sozinho. **Camada 2 sem a flag**: "O que a ação faz" com **uma** opção e "Valor" com **três** (igual a M4), e o banco recusou pelo console as duas formas cruzadas — *"Ação que lê ou escreve em outro módulo só pode ser configurada por um desenvolvedor do Facilite."* — provando que a recusa não é CSS. **Tributações e Grupos tributários**: canvas presente só no modo "editar existente" (6 e 11 cartões, sem "Novo campo", sem botão de remover, chips ativos), aviso da tabela dedicada intacto, sem seção de workflow. **Produtos e Financeiro**: recusa com a mensagem de M3, sem canvas e sem workflow, nenhum botão. Módulo de teste excluído no fim pelo diálogo de atrito (digitando o nome): zero linhas restantes em `modules`, `module_fields`, `module_records`, `module_situations`, `module_transitions`, `module_transition_actions` e `role_permissions`. `tsc`, `oxlint` e `vite build` limpos, com o code splitting por página preservado. `get_advisors` (security e performance) sem nenhum aviso novo — a RPC nova aparece na mesma categoria informativa de todas as outras deste projeto, e a migration não criou índice.

**Não exercitado**: a recusa de `save_module_situation_position` para quem não tem `can_manage_modules`. Ela usa a mesma `assert_module_workflow_editable` que M4 já provou recusar, e o `proacl` da função é idêntico ao das irmãs (sem `anon`/`public`), mas o teste com a flag desligada não foi feito nesta rodada.

#### Fora de escopo

Modo avançado com sintaxe própria (Direção C do relatório) — se vier, apoia-se neste canvas, não o substitui. Rolagem horizontal da grade de Permissões. Redesenho dos módulos com tela própria. Múltiplas conexões entre o mesmo par de nós ou transição condicional além de "de qual situação para qual" (o `unique(from, to)` já impede duplicata). Zoom/pan no diagrama e auto-arranjo de nós.

### Decisão arquitetural: estado por janela no `OpenWindowsProvider` (25/08/2026)

Extensão do sistema de janelas, no mesmo peso das decisões de motor de módulos — **vale para qualquer módulo, não só para Realizar Venda**. O provider já antecipava isso num comentário ("estado interno de cada tela entra aqui quando existir"); esta etapa cumpriu.

**O problema**: trocar de janela pelo dock chama `navigate(window.path)` — uma navegação de verdade do React Router, que **desmonta a tela anterior por completo**. Não existe keep-alive. Como o rascunho de Realizar Venda vivia só em `useState` local (`useSaleDraft.ts` para cabeçalho/carrinho/pagamentos/frete/desconto, `SaleWizard.tsx` para a etapa atual), montar um carrinho, dar uma olhada em Produtos e voltar recomeçava tudo do zero. Isso quebra a premissa central do dock: *"a intenção de um sistema multitarefas é realmente poder mexer em várias coisas ao mesmo tempo"* (palavras do usuário, no teste).

**A peça** (`src/components/openWindows.tsx`): o contexto ganhou `getWindowState`/`setWindowState`/`clearWindowState`, num `useRef<Map<string, Map<string, unknown>>>`.

- **`useRef`, não `useState`**: o provider está acima de todas as rotas — gravar o rascunho a cada tecla digitada re-renderizaria o app inteiro. Quem lê só precisa do valor uma vez, na montagem, e nessa hora o ref já está preenchido.
- **Duas chaves (`windowId` × `slot`), não uma**: uma janela costuma ter mais de um dono de estado (aqui, o rascunho e a etapa do wizard são componentes diferentes). Com uma chave só, o segundo a gravar apagaria o primeiro. Já `clearWindowState` é **por janela inteira**, porque o ciclo de vida que importa é o da janela.
- **Nada é serializado** — o `Map` guarda os objetos como estão. Por isso o `Product` inteiro dentro de cada `CartLine` e o `Set<StepId>` de `visitedSteps` sobrevivem sem conversão. Um caminho por `JSON` custaria isso.
- **O DOM continua sendo descartado.** Manter `SalePage` montada e escondida por CSS reescreveria o sistema de rotas do app — o pedido era o dado sobreviver, não a tela.

**Por que aqui e não em `sessionStorage`/`localStorage`**: o rascunho tem que morrer junto com a janela, e o storage do navegador não sabe quando alguém clicou no "X" do dock. Este provider sabe, porque é ele quem fecha a janela. Storage também não distingue "esta janela" de "este navegador".

**Os dois fins de vida do rascunho** — sem os dois, uma venda nova nasceria com os dados da anterior:

1. **Venda confirmada**: `confirmedSale` não zera o rascunho (a tela de sucesso ainda mostra o que foi vendido), então o efeito de gravação em `useSaleDraft` **limpa em vez de gravar** quando ela existe.
2. **Fechar pelo "X"**: mora dentro do próprio `closeWindow`, não em cada página — vale para qualquer módulo, e a página que foi fechada nem está montada para se limpar sozinha.

**Só o que o operador digitou é guardado.** `submitting`, `submitError`, `confirmedSale`, `fiscalOutcome` e `lastRemoved` ficam de fora de propósito: devolver um "enviando…" ou um erro de rede de dez minutos atrás descreveria um estado que não existe mais.

**Como um módulo futuro usa**: passe o mesmo id que já vai para `openWindow` (em `SalePage.tsx` ele virou a constante `SALE_WINDOW_ID`, para as três coisas — dock, rascunho e etapa — não divergirem), leia uma vez na montagem com `getWindowState` para inicializar o `useState`, e grave com `setWindowState` num efeito com as dependências do que precisa sobreviver.

#### Testado no navegador

Cliente + 3 itens + "Tipo de operação" preenchido, parando na etapa "Detalhes"; ida a Produtos pelo dock e volta pelo dock: **tudo intacto, na etapa "Detalhes"** — a Revisão depois mostrou os 3 itens, o cliente e o tipo de operação certos. Venda 0028 confirmada (`Salvar Venda`, sem emissão fiscal): reabrir Realizar Venda pelo tile veio **em branco, na etapa 1**. Venda nova com um produto, fechada pelo "X" do dock (redirecionou para `/inicio` e sumiu do dock): reabrir também veio **em branco**. Ciclo repetido depois das duas limpezas: cliente escolhido, ida e volta a Produtos pelo dock, cliente preservado — a limpeza não deixa a janela "morta". Nenhum erro no console em momento nenhum. `tsc`, `oxlint` e `vite build` limpos, com o code splitting por página preservado.

**Limitação do ambiente, não do código**: o "X" do dock só aparece por transição CSS em `:hover`/`:focus-within`, e o painel de navegador headless não avança animações (fica em `visibility: hidden`, fora do hit-test e da ordem de tabulação). Para clicar nele de verdade foi preciso neutralizar só a transição durante o teste. Numa tela real o comportamento é o de sempre — esse CSS não foi tocado.

#### Fora de escopo

Keep-alive de verdade (manter a árvore React viva entre janelas). Persistir rascunho entre sessões/F5 — de propósito: o `Map` morre com o provider, e ressuscitar uma venda depois de um reload é decisão de produto, não consequência técnica. PDV: hoje nem registra janela no `OpenWindowsProvider` (não aparece no WindowDock), então o mesmo mecanismo não se aplica sem antes decidir se o PDV deveria virar multitarefa ou é intencionalmente tela cheia — decisão de produto pendente, não técnica.

#### Extensão (25/08/2026): Pedidos de venda, Condicionais e Compras

Os três seguiam a mesma receita de `useXDraft` (cabeçalho + carrinho + `submitting`/`submitError`/confirmado/`lastRemoved`) sem persistência — o mesmo bug de Realizar Venda (perder o rascunho ao trocar de janela pelo dock e voltar) se repetia neles. Aplicado o mesmo padrão, sem mudar `openWindows.tsx:106-135`: `useSaleOrderDraft.ts`, `useConditionalDraft.ts` e `usePurchaseDraft.ts` ganharam `windowId` opcional, leem `getWindowState` uma vez na montagem, gravam num `useEffect` (`header`+`cart`, mais `freight`/`discount` em Pedidos de venda) e limpam com `clearWindowState` quando a operação é confirmada (`confirmedOrder`/`confirmed`/`confirmedPurchase`) em vez de continuar gravando. Ids de janela: `"pedidos-venda"`, `"condicionais"`, `"compras"` — os mesmos que a lista de cada módulo já usava.

**Bug relacionado, mesma causa raiz**: o formulário "novo" de cada um desses três módulos registrava a janela com o `path` da **lista** (`/pedidos-venda`, `/condicionais`, `/compras`), não o da própria sub-rota (`/pedidos-venda/novo` etc.) — porque `openWindow` ignora chamadas repetidas para um id que já existe (linha 88-89), o `path` ficava travado em quem registrou primeiro, então voltar pelo dock sempre pousava na lista mesmo com o rascunho salvo. Corrigido com `updateWindowPath(id, path)`, nova função do contexto (`openWindows.tsx`) que atualiza a rota de uma janela já aberta; lista e formulário chamam com o próprio path no mount, então `window.path` sempre reflete onde o usuário está de fato — sem isso o WindowDock navegaria para o lugar errado ao voltar.

**Testado no navegador**, os três módulos, ciclo completo: cliente/fornecedor + 1-2 itens no formulário → dock para Produtos → dock de volta → formulário intacto (não a lista) com os dados preservados; confirmar a operação → fechar a janela → reabrir do zero → formulário em branco; novo rascunho → fechar pelo "X" sem confirmar → reabrir → em branco. `tsc` e `oxlint` limpos (só os avisos `only-export-components` pré-existentes, sem relação). Nenhum erro no console.

### Decisão arquitetural: `SearchCombobox` — busca com sugestão ao digitar (fase 1) (25/08/2026)

Até aqui **todo** campo que consulta outro cadastro (Cliente, Fornecedor, Vendedor, Venda de origem, Grupo tributário — 9 lugares) era o mesmo par: um `FormField` com lupa + um `LookupModal` separado, aberto pelo botão. Pedido do usuário: digitar direto no campo e ver a sugestão ao vivo, com atalho de cadastro quando a busca não acha ninguém. **Esta é a fase 1**: o componente nasce e só os campos Cliente e Vendedor da etapa 1 de Realizar Venda (`ClienteStep.tsx`) foram convertidos. Os outros 8 call sites (`SaleOrderFormPage`, `PurchaseFormPage`, `NewConditionalPage`, `SaleReturnModal`, `PosPage`, `FinanceEntryPlanModal`, `ProductsPage`) continuam no padrão antigo de propósito, para a conversão em massa só acontecer depois deste piloto ser validado no uso.

- **`src/components/form/SearchCombobox.tsx`** (+ `.css`): rótulo + cápsula digitável + lista ancorada logo abaixo. **A busca não mudou** — recebe a mesma `fetchItems(query)` que o `LookupModal` já recebia, com o mesmo debounce de 250 ms e o mesmo cancelamento da resposta atrasada. O que mudou é só exibição e interação.
- **Reaproveita `FormField.css` em vez de reescrever a moldura**: o componente importa o CSS do campo comum e usa as mesmas classes `form-field__*` para rótulo/cápsula/dica. Duplicar essa moldura garantiria que as duas versões saíssem do lugar na primeira mudança de tema ou de altura. `FormField.tsx` continuou sendo o input de texto/data/select do motor genérico. (Na fase 2 a lupa opcional dele foi removida, junto com o último call site que a usava — ver abaixo.)
- **Teclado e acessibilidade**: `role="combobox"` + `aria-expanded`/`aria-controls`/`aria-activedescendant` no input, `role="listbox"`/`role="option"` na lista. Setas percorrem, Enter escolhe o destacado, Escape fecha só a lista, clique fora fecha sem escolher. O Escape fecha só a lista, nunca o que está em volta — na fase 2 isso precisou virar um listener em captura no `window`, ver abaixo.
- **O destaque começa em -1**, e só as setas o movem: com o primeiro item já destacado, um Enter distraído escolheria alguém sozinho.
- **`onCreateNew` é opcional, e essa é a decisão**: sem a prop, a linha "Nenhum resultado para X — Cadastrar novo" simplesmente não existe. Vendedor é um usuário do sistema (`profiles`, gerido em `/usuarios-operadores`), não um cadastro de negócio — criar um dali não faria sentido, então o campo recebeu o componente novo **sem** o atalho.
- **`QuickContactFormModal`** (`src/features/customers/`): o cadastro rápido é o **mesmo `RegistryFormModal`** de Clientes e Fornecedores, com os mesmos campos vindos de `module_fields` — não um formulário paralelo. O nome já digitado no combobox chega preenchido; ao salvar, o contato criado volta para quem chamou e é selecionado no campo na hora. A foto fica de fora (quem está no meio de uma venda não para para tirar retrato). É o **primeiro atalho de cadastro fora da tela do próprio módulo** no sistema.
- **O mapeamento `values` → contato virou `contactForm.ts`**, usado por `CustomersPage` e pelo cadastro rápido: duas cópias sairiam do lugar na primeira coluna nova.
- **`RegistryFormModal` ganhou `submitError`** (prop opcional, aditiva): sem ela, um `onSubmit` assíncrono que rejeita deixa o formulário aberto sem dizer nada ao operador — o que já acontecia em `CustomersPage`. Nenhum consumidor existente mudou.
- **O atalho respeita a permissão**: `ClienteStep` só passa `onCreateNew` se `hasPermission('clientes-fornecedores', 'create')`. Oferecer um cadastro que a RLS vai recusar só produziria erro.
- **Correção de comportamento que a conversão tornou necessária**: digitar por cima de um cliente/vendedor já escolhido agora **limpa o id**. Antes o campo também era digitável, mas a via principal era o modal; com a digitação virando a via principal, ficar com o id antigo e o nome novo na tela (gravando uma venda para outra pessoa) deixou de ser hipótese remota. É por isso que "Próximo" volta a ficar desabilitado quando o operador mexe no texto sem escolher de novo.

#### Testado no navegador

Realizar Venda, etapa 1: "Ana" mostra a sugestão ao digitar, sem lupa nenhuma; escolha por seta+Enter e por clique, as duas preenchem o campo e liberam o "Próximo". "Zzzznaoexiste" mostra a linha de cadastro rápido → formulário de Clientes com o nome já preenchido → salvar seleciona o cliente novo no campo e fecha o modal. Vendedor: mesma digitação e seleção, sem a linha de cadastro. Escape fecha a lista sem escolher e sem sair da tela; clique fora idem. Padrão antigo conferido intacto em Compras (lupa de Fornecedor), Financeiro (`lookupField` do plano de parcelas) e Produtos (`lookupField` de grupo tributário, o caminho que passa pelo `RegistryFormModal` alterado) — os três continuam empilhando o `LookupModal` sobre o formulário sem fechá-lo. Nenhum erro no console. `oxlint` limpo e `vite build` com o code splitting preservado.

#### Fora de escopo

Os 8 call sites restantes (fase 2). Cadastro rápido de fornecedor — `QuickContactFormModal` já aceita `kind: 'fornecedores'`, mas nenhuma tela usa ainda. Foto no cadastro rápido. Rolagem virtualizada da lista (o `fetchItems` de contatos já vem limitado pela RPC).

### `SearchCombobox` fase 2: os 8 call sites restantes (25/08/2026)

Conversão do resto do sistema para o campo digitável, validado o piloto de Realizar Venda. Os 8 lugares: Cliente e Vendedor de **Pedidos de venda**, Cliente de **Condicionais**, Fornecedor de **Compras**, contato do **Financeiro** (modal de lançamento) e o `lookupField` do **modal de edição** do Financeiro, Cliente do **PDV**, Venda de origem da **Devolução de venda**, Grupo tributário de **Produtos** (via `lookupField` do `RegistryFormModal`). Decisão do usuário nesta rodada: os **5 campos de contato** (os quatro de cliente/fornecedor mais o do Financeiro) ganham o mesmo atalho "Cadastrar novo" que Realizar Venda já tinha — sem isso, o mesmo campo Cliente ofereceria cadastro numa tela e não na outra. Vendedor, Venda de origem e Grupo tributário seguem **sem** o atalho: não são cadastro de negócio que faça sentido criar no meio de outra operação.

#### A lista precisou sair do campo e ir para o `body`

Três dos oito campos moram **dentro** de um modal Radix (`RegistryFormModal`, `FinanceEntryPlanModal`, `SaleReturnModal`), e ali uma lista `position: absolute` dentro do campo não funciona por dois motivos somados: o corpo do modal rola (`overflow-y: auto`, recorta a lista) e tem `backdrop-filter`, que cria um *containing block* novo — o mesmo detalhe já documentado no `DragOverlay` do dnd-kit. Então a lista passou a ser `createPortal(..., document.body)` com `position: fixed` e coordenadas medidas do campo (`getBoundingClientRect`), reposicionadas em `scroll` (em **captura**, porque quem rola é um contêiner interno) e `resize`. Abre para cima quando sobram menos de 180px embaixo.

Isso trouxe três consequências que só aparecem em modal, e cada uma precisou de uma linha específica:

- **`pointer-events: auto` na lista.** Enquanto um modal Radix está aberto, o `DismissableLayer` põe `pointer-events: none` no `body` e devolve `auto` só à sua própria camada. Sem essa regra a lista apareceria e seria **inclicável** exatamente nas telas que a portalização veio atender. Confirmado no navegador: com o modal de Produtos aberto, `getComputedStyle(document.body).pointerEvents === "none"`.
- **`stopPropagation` no `pointerdown` da lista.** A lista está fora do `Dialog.Content` no DOM, então o Radix leria o clique nela como "clicou fora" e fecharia o formulário. (O `LookupModal` antigo não tinha esse problema porque era ele mesmo um `Dialog`, empilhado pelo Radix.)
- **Escape em captura no `window`.** Esta é a que custou uma tentativa errada: `stopPropagation()` no `onKeyDown` do React **não** basta, porque o Radix escuta o Escape em captura no `document` — que roda antes de o evento sequer chegar ao input. O `window` é o primeiro alvo do caminho de captura, então é o único ponto que chega antes dele. Com isso o primeiro Escape fecha a sugestão e o segundo fecha o modal, que é o comportamento em camadas esperado.

#### Receber foco deixou de abrir a lista

Na fase 1 o campo abria a sugestão ao ganhar foco. Dentro de um modal isso vira defeito: o Radix dá foco automático ao primeiro campo, e em Produtos o primeiro campo é justamente o Grupo tributário — o formulário nascia com a lista aberta por cima dos outros campos. Agora abrem a lista o **clique no campo**, a **digitação** e a **seta para baixo**; o foco sozinho não abre.

#### `fetchItems` foi para um `ref` — e isso corrigiu um laço que já existia

Vários call sites passam uma seta inline (`(q) => fetchContactsByKind("clientes", q)`), cuja identidade muda a cada render. Com ela nas dependências do efeito de busca, **cada resposta dispara a busca seguinte** — um laço que o debounce de 250ms só disfarça. O `LookupModal` tinha esse problema em quatro call sites; o `SearchCombobox` guarda `fetchItems` num `ref` e depende só de `[open, value]`. Quem manda buscar de novo é o termo digitado, não a identidade da função. Efeito colateral bem-vindo: nenhum call site precisa lembrar de `useCallback`.

#### `lookupField` do `RegistryFormModal` mudou de forma

Perdeu `modalTitle` (não há mais modal) e ganhou `onClear?: () => void`. O texto digitado passou a ser estado **do formulário**, não de quem consome: `lookupField.value` continua descrevendo o item *escolhido*, e os dois só coincidem enquanto ninguém está buscando outro. `onClear` é o que impede o formulário de gravar o item antigo mostrando um texto novo — mesma correção já feita à mão em Realizar Venda na fase 1, agora aplicada em Produtos (grupo tributário), Financeiro (contato), Devolução (a venda escolhida, que ao ser desfeita também **limpa as linhas de item** — devolver itens de uma venda que não é a exibida seria pior que o texto errado) e nos quatro campos de cliente/fornecedor.

#### O PDV precisou de duas props novas, não de um componente novo

O rodapé do carrinho do PDV é claro, e a cápsula azul do `FormField` não serve ali. Em vez de um segundo componente, o `SearchCombobox` ganhou `className` (classe extra na raiz) e `hideLabel` (rótulo só para leitor de tela, já que o placeholder do PDV diz o que o campo é). `PosPage.css` devolve ao controle a mesma caixa branca discreta que o botão antigo tinha; a lista continua com o visual padrão. O "×" ao lado agora limpa o contato **e** o texto.

#### O que morreu junto

`LookupModal.tsx`/`.css` foram **removidos** — zero importadores depois da conversão, e deixar o componente vivo convidaria a reintroduzir o padrão antigo. Junto foram a prop `lookup`/`onLookup` do `FormField` e o CSS `.form-field__lookup`: não havia mais nenhum uso. `FormField` agora é só rótulo + cápsula (texto/data/select); campo que consulta outro cadastro é sempre `SearchCombobox`.

#### Testado no navegador

Os oito, um a um. **Produtos** (o caso mais arriscado, campo dentro de modal com `overflow` + `backdrop-filter` + dismissal do Radix): lista portalizada no `body`, alinhada ao campo (mesmo `left` e mesma largura), clicável com o `body` em `pointer-events: none`, escolha aplicada **sem** fechar o formulário; primeiro Escape fecha só a lista, segundo fecha o modal; abrir o formulário não abre mais a lista sozinha. **Pedidos de venda**: cliente por seta+Enter, "Cadastrar novo cliente" na busca vazia, Vendedor sem o atalho. **Condicionais**: cliente por seta+Enter. **Compras**: ciclo completo do cadastro rápido — "Fornecedor Teste Fase2" → linha de cadastro → formulário com o nome preenchido → salvar → fornecedor selecionado no campo, e confirmado depois na lista de Clientes e Fornecedores (registro de teste excluído no fim). **PDV**: caixa branca com a mesma borda/raio/altura do botão antigo, seleção por teclado, "×" limpando contato e texto. **Financeiro**: seleção dentro do modal de lançamento sem fechá-lo, e o cadastro rápido empilhando "Novo fornecedor" sobre "Nova conta a pagar" com o nome preenchido. **Devolução de venda**: escolher a venda por teclado carrega as 3 linhas de item; digitar por cima limpa as linhas. **Realizar Venda** (regressão da fase 1) intacta. Nenhum erro no console em nenhuma tela. `tsc`, `oxlint` e `vite build` limpos, code splitting preservado.

#### Fora de escopo

Foto no cadastro rápido. Rolagem virtualizada da lista. Cadastro rápido em Grupo tributário (o `lookupField` não expõe `onCreateNew`; quando algum módulo precisar, é uma passagem de duas props). Reposicionar a lista quando o campo se move sem `scroll`/`resize` (animação, mudança de layout) — hoje ela só remede nesses dois eventos.

## Roteiro para criar um novo módulo

Clientes e Fornecedores e Produtos já passaram por esse caminho — qualquer módulo novo (Vendas, Compras, Financeiro etc.) deve seguir o mesmo, para não divergir do motor genérico nem do RBAC.

1. **Metadados primeiro**: inserir em `modules`/`module_fields` (e `module_tabs` se tiver abas) antes de qualquer código. **Se o módulo for um cadastro simples sem regra de negócio, considere primeiro criá-lo por `/modulos`** — a tela faz os passos 1 a 3 sozinha (inclusive a permissão de quem criou), e o dado vai para `module_records`; o roteiro abaixo continua valendo para módulos oficiais, que precisam de tabela tipada — `layout_variant`, `data_table`, quais campos aparecem em tabela/ficha/formulário. **A linha de `modules` também é o que cria a rota e o tile**: preencha `path`, `icon_key`, `sort_order`, `show_on_home`, `access_gate` e `branch_scoped` (ver a decisão do catálogo abaixo). Um módulo sobre o motor genérico simples pode parar aqui — sem componente no registro, ele já abre pela `GenericModulePage`; os passos 4 e 5 só são necessários quando a tela precisa de regra própria. Campos numéricos usam `data_type: 'text'` mesmo assim (a engine não converte tipos ainda); a conversão pra número é manual no handler de submit da página, como em `ProductsPage.tsx`.
2. **Tabela de dados dedicada e tipada** (não JSONB), com `storage_kind = 'table'` — com FKs reais, `unique`, índices. O caminho JSONB (`storage_kind = 'generic'`, dado em `module_records`) é **só** para módulos criados pelo usuário pela tela `/modulos`; um módulo oficial nasce com tabela própria, como sempre. Decidir **branch_id ou não**: dado operacional (estoque, preço, movimentação) é isolado por filial; dado cadastral compartilhado (como contatos) não é. Confirme com o usuário se não for óbvio.
3. **RLS desde o início, já correta**:
   - Policies de `select`/`insert`/`update`/`delete` **separadas** (nunca `for all`) — `for all` duplica a cobertura do `select` e dispara o aviso "multiple permissive policies" no advisor.
   - `using (has_permission('modulo-id', 'view') and has_branch_access(branch_id))` — só inclua `has_branch_access` se o módulo tiver `branch_id`.
   - Qualquer função SQL nova precisa de `revoke execute ... from public, anon` — os **dois**: o Supabase regrante EXECUTE a `anon`/`authenticated`/`service_role` por padrão ao criar a função, e nenhum dos dois `revoke` sozinho tira o grant do outro (o advisor `anon_security_definer_function_executable` acusa se faltar).
   - **Checagem imperativa de permissão dentro de plpgsql precisa de `coalesce` por fora**: `if not coalesce(can_manage_x(), false) then raise ...`. As funções de flag devolvem `NULL` (não `false`) quando não existe perfil correspondente, e `not NULL` faz o `IF` não executar — a permissão passa em silêncio. Em policy de RLS o `NULL` nega e o risco não aparece; em plpgsql ele **falha aberto**. Ver a decisão de M3 abaixo, onde isso foi descoberto num teste.
4. **Repositório**: implementar `ModuleDataRepository<T>` (`src/lib/repositories/types.ts`), no padrão de `productsRepository.ts` (fábrica recebe `branchId` se o módulo for isolado por filial) ou `contactsRepository.ts` (sem filial). **Se o módulo for de lançamento em lote** (vários itens confirmados juntos, sem editar/excluir depois), use o contrato irmão `ModuleBatchRepository` e o padrão de `stockAdjustmentsRepository.ts` — ver a decisão do motor de lote acima.
5. **Hook + página** — **só se a tela precisar de regra própria**; sem isso o módulo já funciona pela `GenericModulePage`. Espelhar `useProductsData.ts`/`ProductsPage.tsx` — `useModuleDefinition(moduleId)`, `useAuth().hasPermission`, `RegistryFormModal` para criar/editar, `ConfirmDialog` para excluir. Módulo de lote troca o `RegistryFormModal` pelo `RegistryBatchFormModal` (`layout_variant: 'batch'`), espelhando `StockAdjustPage.tsx`. Depois **registre o componente em `MODULE_COMPONENTS`** (`src/features/modules/moduleComponents.ts`) — é isso, e só isso, que faz o roteador preferir a tela própria ao motor genérico; não há coluna no banco dizendo isso. Registrar a janela com `openWindow({ id, label, path })` — **não precisa passar `icon`**: `openWindow` resolve `modules.icon_key` no registro de ícones sozinho, então o dock fica sincronizado com o tile da tela inicial automaticamente (ver `src/components/openWindows.tsx`). Para o módulo ter ícone próprio, adicione o asset em `src/assets/icons/modules/` e uma entrada em `MODULE_ICONS` (`src/features/modules/moduleIcons.ts`) com a mesma chave de `modules.icon_key` — sem isso ele cai no ícone genérico de reserva, que funciona mas é neutro. **Se a tela tiver estado que o usuário perderia ao alternar de janela** (rascunho, carrinho, etapa de wizard), guarde-o com `getWindowState`/`setWindowState` do mesmo provider, usando esse mesmo id — ver a decisão "estado por janela no `OpenWindowsProvider`" acima; sem isso, trocar de janela e voltar recomeça a tela do zero.
6. **Se o módulo precisar de imagem** (produto, item etc.), reaproveite `PhotoDropzone` (`src/features/registry-engine/PhotoDropzone.tsx`) — já é genérico, só falta: criar bucket próprio no Storage (não reaproveite `contact-photos`), coluna `*_url` na tabela, policies de `storage.objects` no mesmo padrão de `has_permission`, e ligar via prop `media`/`mediaField`. Sem redimensionamento/limite de tamanho client-side ainda — replicar esse débito técnico é aceitável, mas documente se mudar.
7. **Depois de aplicar as migrations**: rodar `get_advisors` (security e performance) e corrigir avisos novos na hora — não deixar acumular para o fim.
8. **Gerar tipos**: `generate_typescript_types` e atualizar `src/types/supabase.ts` manualmente (o projeto não usa geração automática no build).
9. **Testar de verdade no navegador** (não só `tsc`/lint): logar com o usuário de teste (ver memória `reference_test_account`), criar/editar/excluir um registro, e testar RLS tentando ler dado de outra filial/sem permissão pelo console — confirmar que o banco bloqueia, não só a UI.

## Pontos de atenção

- A tela inicial usa o layout `original` como padrão em `src/features/home/HomePage.tsx`.
- O repositório contém `legacy-static/` somente como referência do protótipo anterior; a aplicação ativa está em `src/`.
- Há um `.claude/launch.json` legado que apenas define o comando de inicialização do projeto. Ele não é uma fonte de preferências nem de contexto.
- O construtor de módulos (`/modulos`) usa canvas de campos e diagrama de workflow desde 21/08/2026; as regras de M3/M4 (quem edita o quê, Camada 2 só para `is_facilite_developer`) continuam idênticas — mudou só a superfície.
- Mantenha mudanças focadas e não altere arquivos não relacionados sem necessidade.
- `products.taxation` foi removido (21/08/2026, campo do protótipo original que nenhuma lógica fiscal lia); `MODULE_ICONS['grupos-tributarios']` agora tem ícone próprio (`TaxGroupIcon`) para não colidir com `modulos`, que segue com o ícone genérico de propósito.

### Decisão arquitetural: upload de foto do produto (25/08/2026)

Fecha a pendência deixada aberta na decisão de "upload de foto do contato" (13/08/2026, acima) — Produtos era o único módulo com `PhotoDropzone` já disponível na engine, mas sem coluna, bucket nem ligação nenhuma; o campo "Imagem" era só o placeholder estático (`RegistryDetails` sem `imageUrl`/`onFileSelected`). Réplica exata do padrão de Clientes, sem inventar formato novo — segue o roteiro do item 6 em "Roteiro para criar um novo módulo" acima (escrito quando essa pendência ainda existia).

- **Storage**: bucket `product-photos` (público para leitura, mesmo raciocínio de `contact-photos` — URL de foto não é dado sensível). Caminho `{product_id}/{timestamp}.{ext}`. RLS em `storage.objects` no mesmo molde: `has_permission('produtos', 'create')` ou `'edit'` para inserir, `'edit'` para atualizar/excluir.
- **Coluna nova**: `products.photo_url` (text, nullable). `src/lib/repositories/productPhotos.ts` (`uploadProductPhoto`) espelha `contactPhotos.ts` linha a linha, só trocando o bucket.
- **`ProductsPage.tsx`** ganhou os mesmos 4 estados e as mesmas 3 funções de `CustomersPage.tsx` (`pendingPhotoFile`/`pendingPhotoPreview`/`photoUploading`/`photoError`, `clearPendingPhoto`/`handleNewPhotoSelected`/`handleExistingPhotoSelected`). `useProductsData.createProduct` passou a devolver o produto criado (como `useContactsData.createContact` já fazia) — sem isso não dava para saber o `id` para subir a foto pendente depois do "Salvar".
- **Diferença real em relação a Clientes: o modal de clonar.** Produtos tem um terceiro modal (`RegistryFormModal` reaproveitado com `initialValues` do produto de origem) que Clientes não tem. Clone **não herda a foto do produto de origem** — um clone ainda não tem imagem própria, é um registro novo. Por isso `openModal()` chama `clearPendingPhoto()` ao abrir tanto "new" quanto "clone" (limpa qualquer preview pendente de uma tentativa anterior), e o `mediaField` do modal de clonar usa `pendingPhotoPreview`/`handleNewPhotoSelected`, igual ao de criar — nunca `selected.photoUrl`. "new" e "clone" compartilham `handleCreateSubmit` (como já compartilhavam antes desta mudança), que sobe a foto pendente só depois do `createProduct` devolver o `id` novo.
- **Testado no navegador**: criado produto novo com foto antes de salvar (upload disparado só depois do `id` existir, foto aparece na ficha depois); trocada a foto de um produto existente direto pela ficha (upload imediato, sem precisar reabrir o formulário); clonado um produto com foto — modal de clone abriu sem imagem, nova foto adicionada e salva com o `id` do clone (URL de storage distinta da do produto original, confirmando que não houve reaproveitamento do arquivo). `get_advisors` (security) rodado depois da migration — nenhum aviso novo ligado a `product-photos`/RLS, só os avisos pré-existentes de `SECURITY DEFINER` já conhecidos (não relacionados a esta mudança). Registros e fotos de teste foram apagados do banco depois (os arquivos de teste no Storage ficaram órfãos de propósito — excluir produto não limpa a foto associada, mesmo comportamento que já existia em Clientes; não é regressão desta mudança).

### Decisão arquitetural: `hint` de campo + `onFieldChange` no motor de lote (26/08/2026)

Pedido do usuário sobre Ajuste de estoque: os campos "Alteração" e "Saldo contado" deveriam se explicar melhor, e digitar um deveria invalidar/limpar o outro (ou altera, ou conta — nunca os dois). As duas capacidades foram generalizadas no motor (`RegistryBatchFormModal`), não hardcoded para este módulo — mesma disciplina já registrada na decisão do motor de lote (17/08/2026, acima): quem sabe que "Alteração"/"Saldo contado" são mutuamente exclusivos é `StockAdjustPage.tsx`, não o componente genérico.

- **`module_fields.hint`** (text, nullable) — coluna nova, mapeada em `ModuleFieldDefinition.hint?: string | null` (`types.ts`) e passada por `useModuleDefinition.ts`. `buildFormFields` já devolvia o `ModuleFieldDefinition` inteiro, então não precisou mudar — o campo passou a existir "de graça" assim que apareceu no tipo. `RegistryBatchFormModal.tsx` passa `field.hint` para o `FormField`, que **já aceitava** esse prop (usado por outras telas feitas à mão) — só não estava sendo repassado aqui. Aditivo: campo sem hint continua sem mostrar nada, nenhum módulo existente muda de comportamento.
- **`RegistryBatchFormModal` ganhou prop opcional `onFieldChange?: (rowId, accessorKey, value, currentRowValues) => Record<string, string> | void`**, chamada de dentro de `setRowValue` depois de aplicar o valor digitado — se devolver um objeto, as chaves voltam mescladas por cima dos valores da linha. Mesmo raciocínio de `validateRow`/`resolveDraggedItem`: o motor oferece o gancho, o módulo decide o que fazer com ele. Sem a prop, comportamento idêntico a antes.
- **`StockAdjustPage.tsx`** passa `clearOppositeQuantityField` como `onFieldChange`: ao digitar em `change` (não vazio) devolve `{ countedBalance: "" }`, ao digitar em `counted_balance`/`countedBalance` devolve `{ change: "" }`; campo apagado não limpa nada. `"change"`/`"countedBalance"` só aparecem aqui, nunca dentro do motor. **`validateAdjustmentRow` (validação de submit) não mudou** — continua a rede de segurança; a limpeza automática é só conveniência de digitação, não substitui a validação.
- **Hints novos só em `ajuste-estoque`** (via SQL direto em `module_fields`, sem migration de dado — é conteúdo, não schema): "Alteração" ganhou "Some ou subtraia do saldo atual (negativo para saída). Preencha isto ou "Saldo contado", nunca os dois."; "Saldo contado" ganhou o espelho. Nenhum outro módulo tem hint ainda — o mecanismo é genérico, o conteúdo é por módulo.
- **Testado no navegador**: aberto o lote, produto adicionado, digitado "12" em Alteração — "Saldo contado" limpou sozinho (confirmado lendo `value` dos dois inputs via DOM, não só visualmente); os dois hints apareceram embaixo dos campos certos. Confirmado envio nos dois modos numa sessão só: um item por delta (+12, estoque 167→179) e outro por saldo contado (60 contado sobre 50 do sistema, gravou `change = 11`, listagem bateu com o cálculo).

### Decisão arquitetural: unidades de medida + quantidade inteira (26/08/2026)

Pedido do usuário: `unidadeComercial`/`unidadeTributavel` (`products.ts`) eram texto livre, sem lista nem validação — "qualquer produto pode ser fracionado sendo que os que são por UN normalmente são números inteiros". Duas partes: um cadastro editável de unidades (UN, KG, PC...) e, a partir dele, travar quantidade fracionada onde a unidade do produto não permite.

#### Cadastro — `units_of_measure` na `GenericModulePage`, não tela própria

Tabela nova `units_of_measure` (`code` único, `label`, `allows_fraction boolean`, `created_at`), seed inicial de 12 linhas (UN/PC/CX/PAR/DZ = `false`; KG/G/L/ML/M/M²/M³ = `true`) — comentado na migration como ponto de partida editável, não lista fiscal oficial. Módulo `unidades-medida` cadastrado em `modules`/`module_fields` sem entrada em `MODULE_COMPONENTS`: cai na `GenericModulePage`, mesmo caminho de Grupos tributários — nada de tela própria só para 3 campos. `allows_fraction` é `data_type: 'boolean'`, com o mesmo comportamento (texto livre "true"/"false", não checkbox) que `boolean` já tem em todo o motor genérico desde o construtor de módulos: criar um controle novo para um campo só teria contrariado a disciplina já registrada várias vezes neste arquivo ("não generalizar o motor por causa de um campo"). `hint` explica o que digitar.

**Permissão desviada de propósito do padrão de `grupos-tributarios`**: lá, Operador não tem `can_view` nenhum (classificação fiscal é assunto de Administrador). Aqui, Operador **recebe `can_view`** (sem create/edit/delete) — unidade de medida é dado operacional básico que qualquer papel que lança venda/compra/ajuste precisa enxergar; sem isso a validação de fração abaixo simplesmente não funcionaria para Operador (a lista viria vazia da RLS, e produto "sem unidade encontrada" cai no fracionável por padrão — ver abaixo).

#### Produtos — `unidadeComercial`/`unidadeTributavel` viram `<select>`

`module_fields.show_in_form` dos dois campos foi desligado (a lista some do `fields.map` genérico do `RegistryFormModal`); `show_in_details` continua ligado, a ficha não muda. Em vez de `data_type: 'lookup'`/`'select'` novo em `module_fields` (mesma disciplina de `taxGroupId`/`allowNegativeStock`), `RegistryFormModal` ganhou **`selectFields` (array)** no lugar do antigo `selectField` (singular) — Produtos agora empilha três: estoque negativo, unidade comercial, unidade tributável. Cada item ganhou uma `key` própria (vira parte do `id` do `<select>` no DOM). Único consumidor do prop antigo era `ProductsPage.tsx`; migrado direto, sem shim de compatibilidade.

`buildProductInput` (`products.ts`) ganhou dois parâmetros novos (`unidadeComercial`, `unidadeTributavel`) em vez de ler `values.unidadeComercial` — como esses campos saíram do formulário genérico, não chegam mais dentro de `values`. `ProductPickerPanel.tsx` (o atalho de edição rápida no lápis, que não expõe nenhum dos dois `<select>`) passou a repassar `editingProduct.unidadeComercial`/`unidadeTributavel` explicitamente, mesmo cuidado já tomado ali para `taxGroupId`/`allowNegativeStock` — sem isso a edição rápida apagaria a unidade do produto sem ninguém pedir.

`src/lib/repositories/unitsOfMeasureLookups.ts` (novo) busca a lista inteira de uma vez (`fetchUnitsOfMeasure`, sem termo de busca — lista curta, dezena de linhas) e expõe `unitAllowsFraction(unidadeComercial, units)`: produto sem unidade definida, ou código que não bate com nenhuma linha do cadastro, continua fracionável — ausência de informação nunca vira trava.

#### Validação de quantidade inteira — arredondar ao digitar, não recusar no envio

Nos quatro lugares que digitam quantidade, cada tela busca a lista de unidades uma vez (`useEffect` próprio, mesmo padrão non-hook de `fetchBranchAllowsNegativeStock` em Produtos — sem hook compartilhado entre features, cada tela já fazia esse fetch-once sozinha) e arredonda no `onChange`, em vez de travar o formulário no submit com mensagem de erro — mais amigável, e produto sem unidade continua aceitando decimal livre exatamente como antes:

- **Realizar Venda** (`ProdutosStep.tsx`): campo é `type="text" inputMode="decimal"`; `Math.round` aplicado ao valor parseado antes de `draft.updateLine`.
- **Compras** (`PurchaseFormPage.tsx`) e **Pedidos de venda** (`SaleOrderFormPage.tsx`): campo é `type="number"`; além do `Math.round` no `onChange`, `min`/`step` do `<input>` também mudam (`1`/`"1"` em vez de `0.001`/`"0.001"`) quando a unidade não permite fração — o próprio spinner do navegador passa a andar de 1 em 1.
- **Ajuste de estoque** (`StockAdjustPage.tsx`): o único caso que passa pelo motor de lote, não por um `<input>` direto. `clearOppositeQuantityField` (decisão de 26/08/2026, acima) virou `makeQuantityFieldChange(products, units)` — uma fábrica, porque `onFieldChange` do `RegistryBatchFormModal` só recebe `(rowId, accessorKey, value)`, sem acesso a `products`/`units` de fora; `rowId` **é** `item.id` (confirmado lendo `setRowValue` do motor), então dá para achar o produto da linha com `products.find(p => p.id === rowId)` sem mudar `BatchItem` nem o motor genérico. A função devolve os dois efeitos num objeto só: limpa o campo oposto (comportamento já existente) e, se a unidade não permitir fração, arredonda o campo que acabou de ser digitado.

**Fora de escopo, de propósito**: PDV não foi tocado — quantidade lá é incremento por botão (+/-), nunca campo digitável, então a regra de fração não se aplica. Nenhuma "lista fiscal oficial" foi codificada como autoritativa — o seed é só ponto de partida, editável por qualquer Administrador (e visível, não editável, por Operador) pela tela em `/unidades-medida`.

- **Testado no navegador**: `/unidades-medida` lista as 12 unidades seedadas via `GenericModulePage`, edição abre com os três campos de texto (`allows_fraction` como "true"/"false", comportamento esperado do motor). Em Produtos, editado "Doritos" (001) para `unidadeComercial = UN` — ficha e formulário mostraram o `<select>` com a opção certa marcada; revertido depois (era só teste). Em Realizar Venda, carrinho com Doritos (UN) e Peito de Frango Congelado (já cadastrado como `kg`/KG): digitado "2,5" no primeiro — arredondou para `3`; digitado "2,5" no segundo — manteve `2.5`. Mesmo par testado em Compras (`type="number"`, `min`/`step` viraram `1` para o produto UN) com o mesmo resultado. Em Ajuste de estoque, Doritos no lote: "3,7" em Alteração arredondou para `4` e limpou Saldo contado; "12,4" em Saldo contado arredondou para `12` e limpou Alteração; Peito de Frango (KG) no mesmo lote manteve "3,7" sem arredondar. `tsc -b` e `oxlint` limpos (só os avisos pré-existentes já catalogados neste arquivo); nenhum erro novo no console do navegador em nenhuma das quatro telas.

### Decisão arquitetural: livro de movimentações de estoque em Ajuste de estoque (26/08/2026)

Pedido do usuário: *"O sistema deve ter uma nova tabela em 'Ajuste de estoque' que exiba todas as movimentações, seja troca, venda, compra, tudo."*

**View, não tabela nova com trigger.** O sistema não tem um livro-razão de estoque: cada operação mexe em `products.stock` direto, dentro da própria RPC. Criar uma tabela de eventos exigiria um gatilho em cinco RPCs já testadas e em produção, com risco de dessincronizar se alguma escrita escapasse. Uma view sobre o que já está gravado não pode divergir por construção, e nenhuma RPC foi tocada nesta etapa. Se um dia o histórico precisar de dado que a view não tem (motivo customizado por tipo, por exemplo), aí sim vale reabrir a discussão de tabela de eventos.

#### As três fontes que não estão na lista óbvia — e por que o livro estaria errado sem elas

A intuição de "somar `sale_items` + `purchase_items` + `conditional_items` + `sale_return_items` + `stock_adjustments`" **dá o número errado**. As cinco tabelas de itens não são o mapa das escritas em `products.stock`; a lista real foi levantada função por função (`pg_get_functiondef` de cada RPC), e tem três casos a mais:

1. **`convert_conditional_to_sale` grava em `sale_items` sem baixar estoque** — a peça já saiu quando a condicional foi criada. Somar `sale_items` cru conta a mesma saída duas vezes. A view exclui com `not exists` contra `conditional_item_conversions.sale_item_id`.
2. **`register_conditional_return` devolve estoque gravando em `conditional_item_returns`** — entrada real, sem linha em nenhuma das cinco tabelas "principais".
3. **`cancel_conditional` devolve o estoque de todos os itens de uma vez** e marca a condicional como `cancelled`. Outra entrada real; o único carimbo de tempo disponível é `conditionals.updated_at`.

**Não é hipótese**: o banco já tinha 2 conversões, 1 devolução de condicional e 1 condicional cancelada quando a view foi escrita. Conferência: `products.stock − Σ(movimentos)` deve dar o estoque inicial semeado, um número redondo. Pelo livro correto os quatro produtos que passaram por condicional deram 150 / 60 / 35 / 48; pelo livro ingênuo de cinco fontes deram 151 / 61 / 36 / 49 — errado por exatamente 1 em cada um. Nos 49 produtos, todo `diferenca` saiu inteiro e redondo.

São sete `movement_type`, não cinco: `venda`, `compra`, `condicional`, `devolucao-condicional`, `condicional-cancelada`, `devolucao`, `ajuste`.

**Venda/compra/devolução de venda não filtram `status`** (diferente das views de Relatórios, que filtram `confirmed`). Nenhuma RPC cancela essas três, e nenhuma devolve estoque em caso de cancelamento — filtrar aqui faria o livro divergir de `products.stock`. Lá a pergunta é faturamento; aqui é saldo físico.

#### A exceção ao `security_invoker = true` — e por que ela é deliberada

Esta é a **única view do projeto sem `security_invoker`**, contrariando de propósito o padrão fixado nas views de Relatórios (ver a decisão da etapa 11). O motivo: o portão aqui é o módulo que **exibe** a lista (`ajuste-estoque`), não o módulo de origem de cada linha. Com `security_invoker = true`, quem tem Ajuste de estoque mas não tem Compras veria um livro silenciosamente incompleto — pior do que não ver nada, porque o saldo não fecharia e ninguém saberia por quê.

Então a view roda com o privilégio do dono (`postgres`, `BYPASSRLS`) e o `where` no fim é o **único** portão:

```sql
where public.has_permission('ajuste-estoque', 'view')
  and public.has_branch_access(m.branch_id)
```

`security_barrier = true` impede que uma função barata do usuário seja empurrada para baixo desse `where`. `anon` teve o `SELECT` revogado explicitamente; só `authenticated` lê.

**A exposição é deliberadamente estreita**: quantidade, tipo, código do documento, data e nome/código do produto. Nenhum valor monetário, nenhum cliente, nenhum fornecedor — quem tem `ajuste-estoque/view` já enxerga saldo e histórico de ajuste de todo produto da filial.

**Isto acende um lint ERROR no advisor de segurança do Supabase (`security_definer_view`), e é esperado** — o linter não sabe que a view carrega o próprio portão de permissão. Testado desligando `ajuste-estoque/can_view` do Administrador (dentro de uma transação com `rollback`): a view devolveu **0 linhas**; religada, 97. `has_table_privilege('anon', ...)` devolve `false`. Se uma sessão futura "consertar" esse lint pondo `security_invoker = true`, o livro passa a mostrar só os módulos que o usuário já tem — leia esta seção antes de mexer.

#### Repositório e tela

`src/lib/repositories/stockMovementsRepository.ts` (`fetchStockMovements`, rótulos em português por tipo) + `src/features/products/useStockMovementsData.ts`. Paginado em `STOCK_MOVEMENTS_PAGE_SIZE = 200` com "Carregar mais" no rodapé da tabela — o livro cresce a cada venda da filial e trazer tudo sem teto envelhece mal. A ordenação desempata por `id` depois de `occurred_at`: uma venda com vários itens grava várias linhas no mesmo instante, e sem o segundo critério a paginação repetiria ou pularia linhas.

Na tela (`StockAdjustPage.tsx`), **aba** ao lado de "Ajustes lançados" — não uma seção abaixo. A tela já ocupa a altura toda em três colunas (ações | tabela | ficha), e empilhar uma segunda tabela na coluna do meio deixaria as duas com metade da altura; as duas listas respondem à mesma pergunta em dois recortes, que é o caso de aba que Controle de caixa já usa. Colunas e ficha da aba nova são fixas, não vindas de `module_fields`: a fonte é uma view que soma cinco módulos, não uma tabela do motor genérico.

Quantidade com sinal e cor **na mesma convenção do Financeiro** (`var(--positive)` verde com `+` para entrada, `var(--danger)` vermelho com `−` para saída). Erro e carregamento do livro aparecem na ficha da direita, não no lugar da página inteira — a aba "Ajustes lançados" continua utilizável se a view falhar.

#### Testado

No navegador com a conta de testes: a aba mostra os **sete** tipos, cada um com o sinal certo, incluindo o par condicional `0002` (saída −1 às 10:05:57, cancelada +1 às 10:06:56) e a devolução parcial da condicional `0001` (+1). Cores conferidas por `getComputedStyle`: `rgb(30,142,62)` nas entradas, `rgb(214,40,28)` nas saídas. Venda nova de ponta a ponta pelo wizard (`/realizar-venda`, Café Torrado 500g, R$ 19,90, venda `0033`): ao recarregar `/ajuste-estoque`, a linha apareceu no topo da aba — `26/08/2026 10:48:23 · 003 · Café Torrado 500g · Venda · 0033 · − 1`. Vendas `0017` e `0023` (as duas convertidas de condicional) **não** aparecem como Venda, como esperado. `oxlint` e `vite build` limpos; `tsc` sem nenhum erro novo (os 6 erros em `src/features/modules/moduleWorkflow.ts` são anteriores a esta etapa e não têm relação com ela).

#### Fora de escopo

Filtro por tipo de movimento, por produto ou por intervalo de data na aba nova (a busca por produto/origem que a tela já tinha foi reaproveitada, e nada mais foi pedido). Saldo acumulado por linha ("estoque após o movimento") — `stock_adjustments.balance_after` existe só para o ajuste; reconstruir isso para as outras seis fontes exigiria uma janela ordenada sobre o livro inteiro, caro e fora do pedido. Exportar. Drill-down da linha para a venda/compra de origem. Índices novos nas tabelas de origem — a filial de testes tem 97 movimentos; se a lista ficar lenta em produção, o candidato é um índice em `(branch_id, created_at)` nas tabelas de cabeçalho, não uma materialização da view.

### Decisão arquitetural: Indicador IE em `<select>`, "Consumidor final" e favoritar contatos (26/08/2026)

Três pedidos pequenos e independentes no mesmo domínio de cadastro (Clientes e Fornecedores), sem mexer em regra fiscal ou de venda.

#### Indicador IE vira `<select>`

Mesmo padrão de `unidadeComercial`/`unidadeTributavel` em Produtos: `module_fields.show_in_form` de `indicador_ie` (`clientes-fornecedores`) foi desligado (migration; `show_in_details` continua ligado, a ficha não muda) e o label simplificado de "Indicador IE (1=Contribuinte, 2=Isento, 9=Não contribuinte)" para só "Indicador IE" — a explicação dos códigos morava no label porque o campo era texto livre; virando `<select>`, as opções já explicam. `CustomersPage.tsx` ganhou um `selectFields={[indicadorIeSelect]}` (prop já existente em `RegistryFormModal`, usada por Produtos) com as três opções padrão do `indIEDest` da NF-e (1/2/9) mais uma opção vazia ("Não informado", campo continua opcional). Estado do select vive fora de `values` (`formIndicadorIe`), preenchido ao abrir "Editar" e lido direto em `handleCreateSubmit`/`handleEditSubmit` — mesmo cuidado que Produtos já tomou com `allowNegativeStock`/unidades, para não duplicar o campo no loop de texto genérico. `QuickContactFormModal` (cadastro rápido de cliente em Realizar Venda) usa o mesmo `module_fields`, então também parou de mostrar o campo como texto — sem select próprio ali (não pedido; dá para preencher depois editando o contato).

#### "Sem cliente" vira "Consumidor final"

Troca de texto pura nos sete pontos que mostravam venda sem contato identificado: `saleReturnsRepository.ts` (dois), `fiscalDocumentsRepository.ts`, `conditionalsRepository.ts` (dois), `PosPage.tsx` (lista de vendas pausadas) e `reportsRepository.ts` (que usava "Sem cliente identificado", texto diferente dos outros seis). `reportsRepository.ts` tem um segundo texto parecido, "Cliente sem permissão de leitura" — significa outra coisa (RLS de `contacts` bloqueou a leitura do nome, contato existe) e não foi tocado.

#### Favoritar clientes e fornecedores

- **`contacts.is_favorite`** (boolean, not null, default false) — coluna nova, mapeada em `Contact`/`contactsRepository.ts`/`contactLookups.ts` no mesmo padrão de `active`.
- **Um clique, não formulário**: ação "Favoritar"/"Desfavoritar" (rótulo muda com o estado) ao lado de Editar/Excluir em `RegistryActions` — prop `actions` já é genérico (label/onClick), zero mudança no componente compartilhado. Cogitado um botão de estrela dentro da linha da tabela, descartado porque `RegistryTable` renderiza cada linha como `<button>`; aninhar outro `<button>` dentro (o clique de favoritar) é HTML inválido e some com o clique de seleção da linha.
- **Indicador visual na lista**: a coluna "Nome" (`buildTableColumns`) é patcheada depois do build genérico para prefixar "★ " quando `isFavorite` — mesmo padrão já usado em Produtos/Financeiro para formatar preço/valor com sinal, não uma generalização do motor.
- **Ordenação**: favoritos primeiro em`CustomersPage.tsx` (repositório: `.order("is_favorite", {ascending:false})` antes do `.order("code")` já existente) e na RPC `search_contacts_by_kind` (usada por todo combobox de Cliente/Fornecedor do sistema — `order by is_favorite desc, name`, critério de nome mantido). Vendedor/Venda/Grupo tributário não usam essa RPC — não tocados.
- **Testado no navegador**: editar contato existente, indicador IE mostrou "9" (valor gravado), trocado para "1" no select e salvo — ficha passou a mostrar "Indicador IE: 1" (revertido depois, era só teste). Favoritado "017 Carlos Eduardo Mendes" pela ação — subiu para o topo da lista de Clientes e Fornecedores com "★" no nome, e apareceu primeiro no combobox de Cliente de Realizar Venda buscando "a" (que batia com vários contatos). Desfavoritado depois. Relatório "Vendas por cliente" já mostrava "Consumidor final" com 10 vendas (dado existente, sem contato). `tsc -b` e `oxlint` sem erros novos (os 6 erros pré-existentes em `moduleWorkflow.ts`, já catalogados na etapa do livro de movimentações acima, continuam os únicos).

### Decisão arquitetural: vencimento e intervalo das parcelas em Realizar Venda (26/08/2026)

Pedido do usuário: "formas de pagamento que tenham possibilidade de parcelar na tela de faturamento devem sempre ter uma opção de dividir o valor em parcelas, se possível configurar até vencimento, juros". O número de parcelas já existia em `FaturamentoStep.tsx`, mas **só para crédito**, e vencimento/intervalo não existiam em lugar nenhum da venda: a RPC `create_sale` usava `v_sale.issue_date + 30` e intervalo de `30` fixos para todo pagamento a prazo, sem ler nada do front. Compras (etapa 4) já tinha resolvido exatamente isso — esta rodada replica aquele padrão em Realizar Venda, em vez de inventar um segundo.

- **A convenção dos 30 dias virou padrão, não regra.** `create_sale` passa a ler `first_due_date`/`interval_days` do payload e usá-los na chamada de `financial_entries_create_installments` para `credito`/`boleto`. Quando não vêm — PDV, venda à vista, qualquer chamador antigo — `coalesce` devolve o comportamento anterior (`issue_date + 30` / 30 dias). É o que mantém `create_pos_sale` e `convert_sale_order_to_sale` funcionando sem alteração nenhuma: **as duas repassam o `payload` inteiro para `create_sale`**, então bastava não exigir os campos novos. `dinheiro`/`pix`/`debito` (parcela única, nasce baixada) e `outro` (parcela única em aberto, +30) continuam idênticos, de propósito.
- **O núcleo de parcelamento não foi tocado**: `financial_entries_create_installments` já recebia `p_first_due_date`/`p_interval_days` como parâmetros desde a etapa do Financeiro — quem estava hardcoded era o chamador, não o núcleo. Foi a porta que aquela etapa deixou aberta, agora usada pela venda do mesmo jeito que Compras já usava.
- **Os dois campos só aparecem quando há parcelamento de verdade** (algum pagamento em `credito`/`boleto` com mais de uma parcela) — venda 100% à vista nasce baixada na hora e não tem o que agendar. Compras usa `!isPaidOnTheSpot` porque lá a forma de pagamento é uma só e mora no cabeçalho; a venda tem split de N pagamentos, então a condição precisou olhar a lista inteira (`hasInstallmentPayment`, em `useSaleDraft.ts`).
- **Boleto ganhou o campo de nº de parcelas**, que só crédito tinha. Não era decisão de produto — era omissão da tela: o banco sempre parcelou boleto igual a crédito (`elsif v_method in ('credito', 'boleto')`), a UI é que não deixava passar de 1. É a parte mais literal do pedido ("formas que tenham possibilidade de parcelar devem sempre ter a opção").
- **Campo de data vazio bloqueia a confirmação em vez de cair no padrão.** `canConfirm` exige `firstDueDate` preenchido quando há parcelamento — um `<input type="date">` pode ser limpo, e deixar a RPC voltar silenciosamente para 30 dias esconderia do operador o que foi gravado. Mesma filosofia do `headerValid` de `usePurchaseDraft.ts`.
- **Juros ficou de fora, explicitamente.** Não existe cálculo de juros em lugar nenhum do sistema (nem no Financeiro, nem no núcleo de parcelas) — não é uma lacuna pontual desta tela, é capacidade nova, e "juros de parcelamento" tem mais de uma fórmula defensável (simples/composto, sobre o total ou parcela a parcela). Vira pedido separado, depois de uma decisão de fórmula; não é esquecimento.
- **PDV fora de escopo**: `usePosSale.ts`/`PosPage.tsx` não foram tocados. O PDV é a tela pensada para ser rápida, e pedir vencimento/intervalo no fluxo de caixa é decisão de produto à parte. Ele continua caindo no padrão de 30/30 pelo `coalesce` da RPC. Detalhe: o PDV compartilha o `toPayload` de `salesRepository.ts`, então o payload dele agora carrega `first_due_date: null`/`interval_days: null` — chaves a mais num `jsonb` que `create_pos_sale` simplesmente não lê.
- **Testado no navegador, todos os modos de pagamento** (a RPC é crítica e já testada; mudar só o ramo de crédito/boleto não dispensava conferir o resto). Venda 0034: crédito 3x, R$15,00, vencimento escolhido 05/10 e intervalo 15 → parcelas em 05/10, 20/10 e 04/11, R$5,00 cada, mesmo `installment_group_id`, em "A receber". Venda 0035: PIX R$15,00 → nenhum campo de vencimento/intervalo apareceu na tela e o lançamento nasceu direto em "Baixados" com `settled_at` preenchido. Venda 0036 (split das quatro formas restantes, R$60,00, vencimento 01/12 e intervalo 10): dinheiro R$10 e débito R$10 → baixados com vencimento na emissão; `outro` R$10 → aberto em 25/09 (emissão + 30, **ignorando** os campos novos, como especificado); boleto R$30 em 2x → 01/12 e 11/12, R$15,00 cada. Campo de data apagado com parcelamento ativo → "Salvar Venda" desabilitado. Console sem erros; `proacl` de `create_sale` conferido antes e depois do `create or replace` (segue sem `public`/`anon`).

### Decisão arquitetural: vendas em dinheiro sem sessão de caixa aparecem na aba "Caixa gerencial" (26/08/2026)

Pedido do usuário: vincular venda a sessão de caixa continua fora de escopo para Realizar Venda (decisão da etapa 5, não revertida — `create_sale` não foi tocada, nenhuma exigência de caixa aberto foi adicionada fora do PDV). O problema resolvido aqui é só **visibilidade**: uma venda em dinheiro feita fora do PDV (Realizar Venda, sem nenhuma sessão de caixa aberta na filial) nunca aparecia em lugar nenhum do Controle de Caixa — `gerencialSession = selectedSession ?? openSessionInBranch` (`CashControlPage.tsx`) cai em `null` quando nada está selecionado e não há sessão aberta, e `useCashSessionLedger(null)` sempre devolve `entries: []` sem consultar nada.

- **RPC nova, `list_orphan_cash_sales(p_branch_id)`** — o complemento de `financial_entries_cash_sales_in_window`: mesmo filtro por `sale_payments.method = 'dinheiro'` casando o valor (`sp.amount = fe.total`, mesma proteção contra contagem dupla em venda com split documentada na etapa 5), mas em vez de casar com a janela de **uma** sessão, exclui qualquer venda cujo `created_at` caia dentro da janela de **qualquer** sessão da filial (`opened_at` até `coalesce(closed_at, now())`) — aberta ou fechada. Vendas nascidas no PDV (`cash_session_id` preenchido) nunca são órfãs por definição, então a query já as exclui de cara (`s.cash_session_id is null`), sem precisar repetir a lógica de `p_session_id` do refinamento da etapa 6. Mesmo padrão de segurança das RPCs do módulo: `security definer`, `has_permission('controle-caixa', 'view')` + `has_branch_access`, `revoke ... from public, anon` (fica exposta para `authenticated`, mesmo formato de porta pública que `list_cash_session_cash_sales`).
- **`CashControlPage.tsx`**: quando `gerencialSession` é `null`, a aba busca `list_orphan_cash_sales` (hook novo `useOrphanCashSales`, mesmo formato de `useCashSessionLedger` — reload automático, `null` quando há sessão pra não fazer round-trip à toa) em vez de mostrar a tabela vazia. As linhas usam o mesmo `CashLedgerEntry`/`LEDGER_COLUMNS` do extrato normal (Venda, valor, data) — não é um componente novo, só uma fonte de dados diferente pro mesmo formato de linha.
- **Aviso do modo em dois lugares, não um só**: o título da tabela (`RegistryTable title`, `titleVariant="plain"`) vira "Sem sessão de caixa aberta" (curto, mesmo padrão de título das outras tabelas do sistema — nenhuma usa frase longa ali) e o `fieldsTitle` do painel "Informações" (`RegistryActions`) carrega a frase completa ("vendas em dinheiro registradas fora de uma sessão de caixa aparecem aqui"), com os campos Caixa/Situação/Operador (que não fazem sentido sem sessão) escondidos nesse modo. O resumo (`RegistryTable.summary`) também troca: em vez dos cinco totais de sessão (entradas/saídas/sangrias/suprimentos/saldo), mostra um único "Total vendas sem sessão" — não existe abertura/saldo pra calcular sem sessão de verdade.
- **Não é uma sessão de caixa.** Nenhuma linha nova em `cash_sessions`, nenhuma FK, nenhuma forma de lançar sangria/suprimento contra a lista — "Suprimentos"/"Sangria"/"Fechar caixa" continuam desabilitados nesse modo pela mesma condição que já existia (`!gerencialSession`), sem precisar de nenhuma mudança nova nesses botões. É só uma lista de conferência.
- **Testado no navegador**: sem nenhuma sessão aberta na filial, venda em dinheiro de R$15,00 pela Realizar Venda (0037) → apareceu na aba "Caixa gerencial" com o título "Sem sessão de caixa aberta" e a frase completa no painel "Informações", "Fechar caixa"/"Suprimentos"/"Sangria" desabilitados. Sessão aberta em seguida (Caixa 0010, R$100) → a mesma aba voltou instantaneamente ao extrato normal da sessão nova (vazio, saldo R$100), sem nenhum resquício do modo órfão. Fechamento da sessão (contado R$100, bateu certinho) → a aba voltou ao modo "sem sessão", mostrando de novo a mesma lista de vendas órfãs (a sessão que acabou de fechar não tinha nenhuma venda dentro da janela, então não mudou o conjunto).


### Decisão de produto: construtor de módulos é ferramenta interna, não self-service (28/08/2026)

Reverte a **premissa** de M3 (não o código dela): "um usuário autorizado cria o próprio módulo, sem deploy" deixa de valer para o cliente final. O construtor continua existindo, inteiro, e a engine genérica continua sendo a base de módulos reais (Tributações, Grupos tributários, Unidades de medida, Condicionais e os que vierem). O que mudou é **quem opera a ferramenta**: a Facilite, montando o módulo sob encomenda; nunca o cliente.

**Por quê.** Quem consegue usar uma ferramenta que pede campos, tipos de dado, regras de visibilidade e workflow de situações/transições já tem capacidade técnica elevada — está programando com outro nome. O cliente comum tipicamente nem sabe *descrever* o módulo que quer, quanto mais modelá-lo; nenhuma quantidade de polimento de UX resolve isso, porque o obstáculo não é a interface, é a modelagem. Sai mais barato e sai melhor a Facilite construir o módulo com a mesma engine.

**Consequência de escopo**: o redesenho visual do construtor ("tipo Canva", pensado para qualquer um bater o olho e entender) está **cancelado** — não faz sentido investir em UX de leigo numa ferramenta de público técnico interno. Não é escopo de nada, a menos que o usuário peça de novo, explicitamente.

#### O novo portão

| | Antes (M3/M4) | Depois (28/08/2026) |
| --- | --- | --- |
| Abre `/modulos` e mostra o tile | `roles.can_manage_modules` | `profiles.is_facilite_developer` |
| Quem consegue conceder | o Administrador **do cliente**, por SQL em `roles` (nunca houve coluna na grade de `/permissoes`) | só a Facilite, por SQL em `profiles` — não existe UI nenhuma, por decisão de M4 |
| Categoria da flag | papel (cargo dentro da empresa cliente) | pessoa |

Era exatamente esse o furo: `can_manage_modules` mora em `roles`, e o Administrador do cliente é dono dos próprios papéis. A flag "certa" já existia desde M4 — só estava sendo consultada num lugar pequeno demais (habilitar campos de referência entre módulos genéricos, a Camada 2 do workflow). Esta mudança só **amplia onde ela é lida**; como ela é ligada e a RLS que já depende dela não foram tocadas.

**Um lugar decide, três consumidores obedecem**: `canAccessModule` (`src/features/modules/moduleAccess.ts`) trocou `canManageModules` por `isFaciliteDeveloper` no caso `manage_modules`, e com isso o tile da tela inicial (`useModuleOrder.ts`), a rota (`ModuleRoute.tsx`) e as sub-rotas (`ModuleSubrouteGuard`) mudaram juntos — que é a razão de `canAccessModule` existir. `ModuleBuilderPage.tsx` repete a checagem porque a tela também é alcançável direto pelo componente registrado em `MODULE_COMPONENTS`, e portão que só existe num dos caminhos não é portão.

**`modules.access_gate` continua `'manage_modules'`** — nenhuma migração, nenhum valor novo no `CHECK`. O nome do portão diz **o que** ele protege ("gerenciar módulos"), não qual flag ele lê; a pergunta continua a mesma, a resposta é que mudou. Inventar um sexto valor `facilite_developer` só para renomear a mesma porta custaria DDL e um `CHECK` a mais sem responder nada que o valor atual já não responda.

#### `can_manage_modules`: mantida no banco, obsoleta como portão de UI

Escolhida a opção **(b)**, não a (a): a coluna fica. Motivo verificado antes de decidir — ela **não** ficou sem consumidor. Continua sendo o portão do **banco** em tudo que M3 e M4 construíram: as policies de `modules` (update de módulo destravado) e de `module_fields`, e as RPCs `create_user_module`, `delete_user_module`, `assert_module_workflow_editable` (logo, toda a Camada 1 de workflow) e `save_module_situation_position`. Removê-la seria reescrever essa camada inteira, escopo de outra ordem que esta decisão não pede.

Não havia toggle a remover: `can_manage_modules` **nunca teve coluna na grade de `/permissoes`** (o filtro `access_gate = 'permission'` sempre a deixou de fora, e conceder era `update` em `roles` por SQL — está registrado assim na decisão de M3). Então a opção (b) se resumiu a documentar: o campo segue em `AuthContext` (`profile.canManageModules`), **sem consumidor no front**, com o comentário dizendo que é obsoleto como portão de UI. Fica visível de propósito, em vez de sumir, porque ele é a marca da assimetria abaixo.

#### A assimetria aceita: o front exige mais que o banco

Depois desta mudança, quem tem `can_manage_modules` e **não** é desenvolvedor da Facilite não enxerga nem abre o construtor — mas as RPCs e policies de M3/M4 continuariam aceitando essa pessoa se ela as chamasse direto pelo PostgREST, porque no banco o portão ainda é `can_manage_modules()`. **O portão novo é de UI, não de segurança.** Isso é uma regressão em relação ao que M3 tinha (lá UI e banco concordavam), e está registrado aqui em vez de escondido: fechar de verdade é trocar `can_manage_modules()` por `has_facilite_developer_access()` dentro dessas policies e RPCs — mudança de banco, com migração e reteste da Camada 1 inteira, deliberadamente fora desta etapa. Na prática o risco é baixo (exige um cliente adulterado e alguém com a flag de papel querendo mexer nisso), mas "baixo" não é "nenhum".

#### Testado no navegador

Conta de testes (`claude.testes@facilite.com`, papel Administrador, `can_manage_modules = true`). Nenhum perfil do banco tinha `is_facilite_developer = true` antes desta etapa — o teste ligou e desligou a flag só nessa conta.

- **Com `is_facilite_developer = true`** (e `can_manage_modules` também ligada): tile "Módulos" na tela inicial e `/modulos` abrindo normal, com os 21 módulos do catálogo listados à esquerda. Único erro no console é um 401 do endpoint de auth do Supabase na sondagem inicial de sessão — aparece igual nos dois estados da flag e em nada depende desta mudança (nenhum código tocado aqui faz requisição).
- **Com `is_facilite_developer = false` e `can_manage_modules = true`** (o caso que a decisão inteira existe para cobrir): o tile some da tela inicial — os outros 17 continuam lá, na mesma ordem — e `/modulos` recusa com "O construtor de módulos é uma ferramenta interna da Facilite." A flag de papel sozinha não basta mais, que era o ponto.

`tsc`, `oxlint` e `vite build` limpos, com o `ModuleBuilderPage` ainda saindo em chunk próprio.

**Operacional**: quando o portão foi ligado, **nenhum** perfil tinha `is_facilite_developer = true` — nem o do desenvolvedor —, ou seja, `/modulos` ficou fechado para todo mundo por alguns minutos. A flag foi então concedida ao perfil de `brunovenzodebacco@gmail.com`, que é hoje o único a tê-la. Conceder é `update profiles set is_facilite_developer = true where id = '<uuid>'` por SQL direto; não há (nem deve haver) UI para isso — é justamente esse o ponto da decisão.

**Limpeza junto**: o único módulo do usuário que existia (`controle-de-validade`, criado em 24/08 para teste — 3 campos, 1 situação "Situação x", **zero registros**, nenhuma referência de entrada) foi excluído na mesma passada, na mesma ordem e com o mesmo escopo (`is_locked = false`) que `delete_user_module` usa. Sobraram 20 linhas em `modules`, 18 com `show_on_home`, e nenhuma linha órfã de `module_fields`/`module_records`/`module_tabs`/`role_permissions`/`module_situations`. **De agora em diante todo módulo de `modules` é módulo de sistema**: o próximo módulo genérico a nascer sai da mão da Facilite, que é a decisão desta seção em forma de dado.

### Decisão arquitetural: visão JSON dos campos do módulo — leitura (Fase 1) e edição (Fase 2) (28/08/2026)

O construtor de campos nasceu clicável: um cartão por campo, um modal por criação. Isso é bom para ajustar uma coisa, e ruim para montar um módulo inteiro — e péssimo para uma **sessão do Claude Code**, que teria que descobrir o estado atual por screenshot/DOM e depois clicar campo por campo. A aba "Ver como JSON" (`FieldsJsonView`, dentro de `ModuleBuilderPage.tsx`) existe para o caso de configurar tudo de uma vez: **Fase 1** mostrou `fields` como JSON somente-leitura, com "Copiar"; a **Fase 2** tornou o texto editável e acrescentou "Aplicar".

O formato é `ModuleFieldDefinition` cru, sem tradução nenhuma — o mesmo objeto que o motor já usa por dentro. Não existe "formato de importação" novo para manter em sincronia com o de leitura.

#### Nada de payload novo: a lista vira as chamadas que já existiam

`fieldsJsonPlan.ts` **não fala com o banco**. Ele compara a lista colada com `fields` e devolve um plano nos termos das funções que o canvas já usava uma a uma — `updateModuleField`, `removeModuleField`, `addModuleField`, `reorderModuleFields`. Quem executa é `applyFieldsPlan` (em `useModuleBuilderData.ts`). A reconciliação é por `id`:

| No JSON | Vira |
| --- | --- |
| `id` que existe em `fields` | `updateModuleField` — **e só se algo mudou** (a lista inteira volta do "Copiar", então a maioria dos itens está intacta) |
| item sem `id` (ausente, `null` ou `""`) | `addModuleField` — campo novo; a chave sai do rótulo, pela função do banco |
| `id` de `fields` que sumiu da lista | `removeModuleField` |
| a **posição** no array | `reorderModuleFields`, no fim |

Quatro detalhes que explicam a forma do código:

- **O patch de edição vai completo, não só o que mudou.** `updateModuleField` grava todas as colunas de uma vez (é o contrato que o cartão do canvas já usava, com `toFormValues`); mandar só o campo alterado apagaria o resto — inclusive `reference_module_id`. O que o diff decide é *se* a linha é regravada, não *quais colunas* vão.
- **A ordem é gravada por último**, depois das criações, porque só aí existem ids reais. `addModuleField` passou a **devolver o `id` da linha criada** — o cliente não tem como adivinhá-lo, e sem ele a ordem final não fecha.
- **`applyFieldsPlan` chama as funções do repositório, não os wrappers do hook** (`addField`, `editField`…): cada wrapper recarrega os campos depois de escrever (uma ida ao banco por item), e `reorderFields` fecha sobre o `fields` do render — que fica velho no meio de uma sequência de escritas, fazendo a reordenação virar no-op silencioso. A lista é relida **uma vez**, no fim.
- **Remoções antes das criações**, para a chave de um campo removido nesta mesma aplicação ficar livre para um campo novo (remover não apaga o dado no jsonb — recriar com o mesmo rótulo o traz de volta, como a decisão de M3 já dizia).

#### Tudo ou nada na validação; e "parou aqui" quando o banco recusa

Toda a validação roda **antes** de qualquer escrita, e a primeira coisa errada aborta o plano inteiro com uma mensagem que diz qual item e qual problema (`Campo 3 ("Telefone"): "dataType" precisa ser um destes: …`). Isso cobre `JSON.parse` falho, item que não é objeto, `label`/`dataType` faltando, `dataType` fora dos cinco tipos do motor, booleano que veio texto, campo que não aparece em lugar nenhum (mesma regra do `FieldFormModal`), `id` que não é deste módulo, `id` repetido, e — de propósito, para não descobrir no meio da gravação — **colisão de chave**: rótulo que gera chave vazia, reservada, já usada por um campo que sobrevive, ou igual à de outro item novo.

O que a validação **não** tenta prever é a recusa do banco (RLS, trigger de referência). Se uma chamada falhar no meio, a aplicação **para ali** e a mensagem diz o que já tinha passado: *"Parou na primeira falha: … Já tinha sido aplicado antes disso: X, Y. O resto da lista não foi gravado."* Seguir em frente deixaria um estado parcial que ninguém consegue reconstruir de cabeça. A lista é sempre relida do banco depois — sucesso ou falha —, então o textarea volta a mostrar a verdade (inclusive os ids reais dos campos recém-criados).

#### A chave física de um campo existente: **recusa**, não "ignora em silêncio"

`id`, `fieldKey` e `accessorKey` de um item que já existe não mudam por esta via — mesmo motivo de M3 (mudar a chave orfanaria o dado gravado debaixo da chave velha). Das duas saídas possíveis, a escolha foi **recusar com mensagem explícita** em vez de aceitar e ignorar: ignorar deixaria quem colou o JSON acreditando que renomeou a chave, e o erro só apareceria muito depois, como valor sumido. `fieldKey` é obrigatório em item com `id` justamente porque serve de conferência; em item **novo** ele é opcional e ignorado, já que a chave é derivada do rótulo pela função do banco.

Também são ignorados (e a dica na tela diz isso): `sortOrder` — quem manda é a posição no array — e `tableWidth`/`tableAlign`, que não têm como ser gravados por aqui.

#### A mesma fronteira de M3, não uma nova

Módulo `table` sem tela própria (Tributações, Grupos tributários, Unidades de medida) aceita **editar** pelo JSON, e a aplicação **recusa** criação/remoção com o motivo e o nome da tabela — a mesma regra que `fieldEditingCapabilityFor` já impunha nos botões do canvas, agora dita também nesta via. Módulo com tela própria não mostra nem a aba.

#### Testado no navegador

Com a conta de testes (`is_facilite_developer` ligada para ela nesta sessão — antes só o perfil do desenvolvedor tinha a flag): módulo genérico "Teste JSON Fase 2" criado pela tela e configurado inteiro pelo JSON. Rótulo + `isRequired` alterados por texto → canvas e prévia da lista acompanharam (*"Aplicado: 'Nome do teste' alterado (label, isRequired)"*). Dois itens **sem `id`** aplicados de uma vez, um deles na **primeira** posição → viraram campos reais, com `sort_order` 10/20/30 na ordem do array, e o textarea recarregou já com os ids do banco. Item removido da lista **junto com** uma troca de ordem → campo removido e ordem gravada numa aplicação só. Quatro recusas seguidas (JSON truncado, `fieldKey` renomeada, `dataType: "number"`, `id` inexistente) mostraram mensagem específica e — confirmado por SQL — **não escreveram nada**: `module_fields` continuou exatamente como estava. Em Tributações, uma lista pedindo 1 campo novo e 1 removido foi recusada com o nome da tabela (`tax_rules`), e os 6 campos ficaram intactos. Módulo de teste excluído no fim, sem órfãos em `modules`/`module_fields`/`module_records`/`role_permissions`. `tsc`, `oxlint` e `vite build` limpos; console do navegador sem erros.

#### Fora de escopo

Workflow (situações, transições, ações) continua só no canvas — esta etapa é `module_fields` e nada mais. Rótulo/ordem/`branch_scoped` do próprio módulo também não entram no JSON. E o rascunho do textarea é perdido ao alternar para a outra aba ("Editor" desde a Fase 3; o componente desmonta): quem está colando uma lista grande aplica antes de trocar de aba.

### Decisão arquitetural: construtor em três painéis com a tabela real como prévia (Fase 3) (28/08/2026)

Terceira fase do construtor "para dev", depois da visão JSON (Fases 1 e 2). Etapa de **superfície**, como o redesenho de 21/08 foi — nenhuma regra de M3 ou M4 mudou —, mas resolvendo o problema que aquele redesenho deixou: a grade de cartões era boa para *um* campo e ruim para *um módulo*, e a prévia embaixo dela era um desenho de tabela, não a tabela.

O público desta tela é só a Facilite desde a decisão de 28/08 (`is_facilite_developer`), então a forma que serve é a de um editor de propriedades de IDE/engine: **lista de campos | prévia | Inspetor**, lado a lado.

| Painel | O que é |
| --- | --- |
| Esquerda — "Campos" | Lista vertical compacta: alça de arraste, rótulo, tipo em texto pequeno. Nenhum controle de edição inline. Clicar seleciona. `+` no cabeçalho abre o mesmo `FieldFormModal` de sempre. |
| Centro — "Prévia" | **`RegistryTable` de verdade**, alimentada por `buildTableColumns(fields, referenceLabels)` e pelos registros reais do módulo. Clicar num cabeçalho seleciona o campo daquela coluna. |
| Direita — "Inspetor" | Rótulo, `FieldTypePicker`, referência (Camada 2) e "Visibilidade" com quatro interruptores. Sem campo selecionado, um estado vazio no lugar. |

"Ver como JSON" continua como a segunda aba do mesmo alternador — os três painéis somem quando ela está ativa, exatamente como o canvas sumia antes.

#### A prévia é a tela publicada, não uma imitação dela

`ListPreview` (uma `<table>` à mão, com linhas fixas de `—`) foi apagada. No lugar entrou o **mesmo par** que `GenericModulePage` monta em produção: `buildTableColumns` + `RegistryTable`, com as linhas vindo do **mesmo** `useGenericModuleData` filtrando pelo módulo selecionado, e os rótulos de referência do **mesmo** `useModuleReferences`. Verificado lado a lado com `/tributacoes`: markup idêntico, `grid-template-columns` idêntico (`110px 160px 110px 160px 160px 90px`), fundo idêntico (`--blue-panel`), mesma contagem de linhas.

- **Estado vazio de graça**: módulo sem registro cai nas linhas-fantasma que `minRows` já desenha (e no "Nenhum registro encontrado." dos cards em mobile). Nada de mensagem própria.
- **Zero coluna é o único caso com texto próprio**: sem nenhum campo com `showInTable` a tabela publicada também sairia em branco, e uma caixa vazia não explica por quê. A frase (*"Nenhum campo com 'Mostrar na tabela'…"*) ocupa o lugar da tabela nesse caso, e só nele.
- **A primeira linha nasce selecionada**, como na tela publicada — sem isso a comparação lado a lado teria uma diferença que não vem de nenhuma decisão de campo.
- **A prévia refaz o `select` a cada edição**, porque `fields` é dependência do repositório. É uma ida ao banco por mexida, num cadastro pequeno, numa ferramenta interna: o preço certo por a prévia nunca mentir (a coluna de ordenação, por exemplo, é o primeiro campo com `showInTable` — muda quando a flag muda).

#### `onColumnSelect`: dois props opcionais em `RegistryTable`, e por que não um hack de DOM

Selecionar o campo clicando no cabeçalho da prévia precisava de um gancho que a tabela não tinha. As duas saídas eram delegar clique por classe CSS de fora (`.registry-table__header > span`, frágil e acoplado ao interior de um componente compartilhado) ou dois props **opcionais**:

- `onColumnSelect?: (key: string) => void` — quando informado, o clique no cabeçalho **seleciona em vez de ordenar**. Ter os dois gestos no mesmo clique seria pior que nenhum: ordenar a prévia não significa nada, e a seta de ordenação apareceria como efeito colateral de escolher um campo.
- `selectedColumnKey?: string | null` — o destaque, um sublinhado âmbar. Não é caixa nem fundo: o cabeçalho da tabela publicada não tem caixa nenhuma, e ganhar uma aqui mudaria justamente a cara que a prévia existe para reproduzir.

Sem os props **nada muda** — `aria-sort` continua saindo, `handleSort` continua sendo o `onClick`. Confirmado no navegador em `/tributacoes` e `/produtos` depois da mudança: ordenar continua ordenando, com seta, classe `--active` e as linhas na ordem certa.

#### Interruptor no lugar de chip, e por que o desligado não é vermelho

As quatro flags eram chips (pílula preenchida = ligado). Viraram `role="switch"` de verdade, no mesmo desenho do interruptor de Configurações e da ficha (trilho pílula + botão branco deslizante), menores porque são quatro empilhados. **Uma diferença deliberada**: o trilho desligado é neutro, não `--danger`. Os dois usos anteriores são de política ("permitir estoque negativo"), onde vermelho quer dizer alguma coisa; "este campo não aparece na tabela" é escolha comum de campo, e quatro trilhos vermelhos no Inspetor leriam como quatro erros.

A regra de sempre continua no clique, não no submit: desligar a terceira das três flags de visibilidade é recusado com *"O campo precisa aparecer em pelo menos um lugar…"*, agora escrita dentro do próprio Inspetor, onde a ação aconteceu.

#### Detalhes que valem lembrar

- **A seleção é derivada, não espelhada**: `fields.find(f => f.id === selectedFieldId)`. Trocar de módulo ou remover o campo selecionado esvazia o Inspetor sozinho — nenhum efeito de sincronização, nenhum estado morto apontando para um id que não existe mais. Verificado removendo o campo selecionado: o Inspetor voltou ao estado vazio na hora.
- **A lista virou `verticalListSortingStrategy`** (era `rectSortingStrategy`, para grade). O resto do arraste é igual, incluindo **só a alça carregando os listeners** e a ausência de `DragOverlay` pelo `backdrop-filter` de `.module-builder__detail`. A ordem continua indo para `sort_order` no banco.
- **A marca "fora da tabela"** na linha da lista existe porque um campo sem `showInTable` não tem cabeçalho na prévia: sem ela, a única forma de descobrir isso seria abrir o Inspetor de cada campo.
- **A aba "Canvas" virou "Editor"** — o nome descrevia uma grade que não existe mais. O arquivo continua `FieldCanvas.tsx` (renomear custaria churn em git sem responder nada).
- **`FieldCanvas` recebe o `BuilderModule` inteiro**, não só o rótulo: a prévia precisa de `storageKind`/`dataTable`/`branchScoped` para buscar o dado, mais `branchId` e `has_permission(view)` vindos da página.
- **`ModuleBuilderPage.css` é um arquivo só para vários componentes** (a página, o canvas, o modal de módulo novo, o de campo, o diagrama), todos com o mesmo prefixo `module-builder__`. Duas classes do painel novo (`field-list`, `field-glyph`) colidiram com as que `NewModuleModal` já usava e, por virem depois no arquivo, **sobrescreveram a lista de campos do modal** (gap, `flex`, tamanho do ícone). Pegado no fim da etapa; as do painel viraram `field-rows` e `field-row-glyph`. **Antes de nomear uma classe nova aqui, `grep` o prefixo no CSS inteiro** — o arquivo não avisa, e o sintoma aparece numa tela que ninguém tocou.
- **`FieldTypePicker` perdeu o prop `size`**: o `small` existia só para caber no cartão, e o cartão morreu. No Inspetor cabe o tamanho normal, com o nome do tipo escrito.

#### Testado no navegador

Conta de testes (`is_facilite_developer` ligada), viewport 1600x900.

- **Tributações** (`table` sem tela própria, dado real): três painéis lado a lado; prévia idêntica a `/tributacoes` (markup, larguras de coluna, cor do painel, 2 registros reais + 3 linhas-fantasma). Clicar em "UF de origem" na lista abriu o Inspetor com `uf_origem`; clicar no cabeçalho "CFOP" da prévia selecionou `cfop` **nos três lugares** (linha destacada na lista, sublinhado no cabeçalho, Inspetor). Desligar "Mostrar na tabela" tirou a coluna e marcou "fora da tabela" na lista; religar devolveu tudo. Sem `+` (a fronteira de M3 intacta). Confirmado por SQL no fim: os 6 campos exatamente como estavam.
- **Unidades de medida** (mesmo caso): 3 campos, sem `+`, alças ativas, prévia com os registros reais (`CX|Caixa|false`…), sem seção de workflow.
- **Produtos** (tela própria): só a mensagem de recusa de M3 — sem painéis, sem abas, sem workflow.
- **Módulo genérico "Fase 3 teste"**, criado do zero: `+` presente; prévia vazia caiu nas linhas-fantasma da própria `RegistryTable`. Registro real criado por `/fase-3-teste` apareceu na prévia com a primeira linha selecionada. **Arraste** de "Prazo" para a primeira posição (eventos de ponteiro reais, espaçados) reordenou lista, cabeçalhos **e valores das linhas** ao vivo, gravou no banco e a rota publicada voltou na mesma ordem depois do F5. Rótulo editado no Inspetor ("Prazo" → "Prazo final") propagou para lista, cabeçalho da prévia e subtítulo do painel. Recusa da terceira flag exercitada. Campo novo pelo `+` apareceu como coluna com célula vazia no registro antigo. Campo removido pelo `×` do Inspetor levou o Inspetor de volta ao estado vazio. Com um segundo módulo genérico ("Fase 3 ref") o Inspetor mostrou **Rótulo/Tipo/Referência/Visibilidade**, e a referência gravou sem erro.
- **"Ver como JSON"** continua substituindo os três painéis e mostrando o estado exato (inclusive o `referenceModuleId` recém-gravado).
- **Layout**: 1600px e 1280px mantêm os três painéis sem rolagem horizontal de página (a tabela rola por dentro, como na tela publicada); abaixo de 1180px eles empilham.
- Os dois módulos de teste foram excluídos pelo diálogo de atrito: 20 linhas em `modules`, zero órfãos em `module_fields`/`module_records`/`role_permissions`/`module_situations`/`module_tabs`. Console do navegador sem erros. `tsc`, `oxlint` e `vite build` limpos, com `ModuleBuilderPage` ainda em chunk próprio.

**Não exercitado**: a prévia de um módulo `branch_scoped` com filial trocada no meio (os módulos genéricos de teste não eram isolados por filial); e a coluna de referência renderizando o rótulo do registro apontado em vez do uuid — a referência foi gravada, mas nenhum registro chegou a apontar para outro (o caminho é o mesmo `useModuleReferences` que `GenericModulePage` já usa, sem código novo).

#### Fora de escopo

Workflow (`WorkflowCanvas.tsx`, situações e transições) segue igual — é a Fase 5. Prévia da **ficha** e do **formulário** (só a tabela ganhou prévia real). Redesenho da lista de módulos à esquerda da página. Múltipla seleção de campos no Inspetor. `data_type` novo no motor.

### Decisão arquitetural: desfazer/refazer, atalhos de teclado e seleção múltipla no construtor (Fase 4) (28/08/2026)

Quarta fase do construtor "para dev". As três primeiras deram **superfície** (JSON, três painéis, Inspetor); esta dá os gestos que separam uma tela de cadastro de uma ferramenta de trabalho: `Ctrl+Z`, setas, `Delete`, `Shift`/`Ctrl+clique`. Nenhuma regra de M3 ou M4 mudou.

#### Desfazer é a reconciliação da Fase 2, não um mecanismo novo

O achado que encolheu esta etapa: **`fieldsJsonPlan.ts` já sabe aplicar uma lista de campos desejada**. Ele compara a lista pedida com a atual e devolve os `updateModuleField`/`addModuleField`/`removeModuleField`/`reorderModuleFields` que faltam — e "voltar ao estado anterior" é literalmente isso, com a lista desejada sendo um snapshot antigo. Então não nasceu nenhum caminho de gravação novo:

| Peça | O que é |
| --- | --- |
| `useFieldsHistory.ts` | Só as duas pilhas (`past`/`future`, últimas 20) e a disciplina de quem empurra o quê. Não sabe gravar nada. |
| `snapshotToFieldsJson` (em `fieldsJsonPlan.ts`) | Serializa o snapshot no mesmo texto que a visão JSON aceita. |
| `applyFieldsSnapshot` (em `ModuleBuilderPage.tsx`) | `planFieldsJson` + `applyFieldsPlan`, exatamente como o botão "Aplicar" da aba JSON. |

Cinco consequências que valem lembrar:

- **Desfazer uma remoção recria o campo, e isso funciona por causa de M3.** O snapshot ainda carrega o `id` do campo removido, e `planFieldsJson` recusaria um id que não é mais do módulo; `snapshotToFieldsJson` tira `id`/`fieldKey`/`accessorKey` **só** dos itens que sumiram, e o item vira criação. A chave sai de novo do rótulo, e como `removeModuleField` nunca apagou o valor no jsonb, o campo volta com os dados dos registros antigos. A reversibilidade que M3 documentava como consolo virou recurso.
- **A validação e a fronteira de M3 vêm de graça.** Desfazer uma remoção num módulo `table` sem tela própria é recusado pela mesma mensagem com o nome da tabela, sem escrever nada — não foi preciso repetir a regra.
- **A pilha é do módulo selecionado** e zera ao trocar (`useEffect` em `selectedId`): os ids de um módulo não dizem nada sobre outro.
- **Nada é persistido.** F5 zera o histórico, como em qualquer editor. Persistir exigiria decidir o que fazer quando o banco mudou por outra via no meio — resposta errada para uma ferramenta interna.
- **`busy` serializa undo/redo.** Aplicar um snapshot é várias idas ao banco; um segundo `Ctrl+Z` no meio leria um `fields` velho e empurraria o snapshot errado para o futuro.

Toda ação que muda campos passa por `withHistory` — Inspetor, `+`, `×`, arraste, ações em lote e o "Aplicar" da aba JSON. Um "Aplicar" ruim se desfaz com uma tecla.

#### Atalhos: três guardas antes de qualquer coisa

O listener mora em `FieldCanvas` de propósito — o componente só existe na aba "Editor", então `Ctrl+Z` não some com o texto de quem está na aba "Ver como JSON" (confirmado no navegador: com o foco no textarea, `Ctrl+Z` não mexeu em campo nenhum).

1. **Foco fora de campo de digitação** — `isEditableTarget`, a mesma guarda dos atalhos numéricos do `WindowDock` (a função foi copiada, não extraída: cinco linhas, e um util compartilhado acoplaria o dock ao construtor).
2. **Nenhum modal aberto** — `shortcutsEnabled={modal.kind === "none"}`. O `ConfirmDialog` é Radix, com foco preso num `<button>`, que `isEditableTarget` deixaria passar. Verificado: com o diálogo de remoção aberto, as setas não mexem na seleção.
3. **Nenhum arraste em curso** — `dragging`, de `onDragStart`/`onDragEnd`/`onDragCancel`.

A terceira é a que importa: **as setas são do `KeyboardSensor` enquanto ele está no comando**. Espaço na alça ativa o arraste e a partir daí as setas movem o *campo*; fora do arraste elas movem a *seleção*. Exercitado com eventos de teclado reais: com o arraste ativo, `ArrowUp` moveu o item sobre o vizinho e a seleção continuou vazia — prova de que o handler novo não rodou, porque com âncora ausente ele teria selecionado a última linha.

`Delete`/`Backspace` **abre o diálogo de sempre**, não pula a confirmação: o atalho encurta o caminho até a pergunta.

#### Seleção múltipla, e por que o lote não tem rótulo

`selectedFieldId: string | null` virou `selectedIds: string[]` mais uma **âncora** — que não se move no `Shift`, para o intervalo poder crescer para os dois lados. A seleção continua **derivada** (`fields.filter(f => ids.includes(f.id))`), a mesma decisão da Fase 3 no plural: remover um campo o tira da seleção sozinho.

Com mais de um campo o Inspetor troca de conteúdo. Só entram as quatro flags e "Remover campos selecionados" — **rótulo, tipo e referência ficam de fora**: renomear três campos para o mesmo nome não é operação que alguém queira, e um campo de texto vazio no lugar seria um convite a fazer isso.

- O interruptor mostra ligado só quando **todos** estão ligados, e cada linha diz a contagem (*"2 de 3 ligados"*) — a informação que falta quando a seleção é mista. Clicar liga todos, ou desliga todos se já estavam todos ligados; nunca "inverte cada um".
- **A regra das três flags recusa o lote inteiro** se um só dos selecionados ficaria invisível, nomeando o culpado (*"'Alfa' ficaria sem aparecer em lugar nenhum…"*). Aplicar em alguns e pular outros deixaria a seleção em dois estados que ninguém pediu.
- As ações em lote gravam por `onApplyFields` → `applyFieldsSnapshot`: três campos ganhando a mesma flag viram **um** plano e **uma** releitura, em vez de três `editField` encadeados — e ficam desfazíveis pelo mesmo caminho, sem código extra.
- A prévia continua destacando **uma** coluna: `selectedColumnKey` de `RegistryTable` é singular, e alargá-lo para um array mexeria num componente compartilhado para um destaque de ferramenta interna.

#### Testado no navegador

Conta de testes (`is_facilite_developer`), 1600x900, módulo genérico "Fase 4 teste" (Alfa/Beta/Gama/Delta) criado e excluído na mesma sessão. Cada passo confirmado por SQL, não só por tela:

- **Rótulo** "Alfa" → "Alfa renomeado" no Inspetor → `Ctrl+Z` devolveu "Alfa" **no banco**; `Ctrl+Shift+Z` refez; `Ctrl+Z` desfez de novo.
- **Setas** andaram Alfa→Beta→Gama→Delta, pararam nas pontas e levaram o Inspetor junto. `Delete` em "Gama" abriu *"Remover o campo 'Gama'?"*; confirmado, sobraram 3 campos; `Ctrl+Z` recriou `gama` com a **mesma chave e `sort_order` 30**.
- **Shift+clique** de Alfa a Gama selecionou 3; desligar "Mostrar na tabela" mudou os três de uma vez (marca "fora da tabela" nas três linhas, prévia com só a coluna "Delta", `show_in_table = false` nas três linhas do banco). `Ctrl+clique` acrescentou Delta (4) e tirou Beta (3).
- **Recusa em lote**: com as três só no formulário, desligar "Mostrar no formulário" foi recusado nomeando "Alfa", e nada mudou. Dois `Ctrl+Z` devolveram as quatro colunas.
- **Remoção em lote** de 3 campos pelo botão → diálogo no plural listando os três → um `Ctrl+Z` devolveu os quatro campos com chaves, ordem e flags originais.
- **Arraste por teclado** (`Espaço`, `ArrowUp`, `Espaço` na alça) reordenou para Alfa/Beta/Delta/Gama, gravou, e `Ctrl+Z` devolveu a ordem — sem a seleção nunca ter se mexido durante o arraste.
- **Tributações** (`existing-only`): setas selecionam, `Delete` não faz nada, sem `+`, sem `×`, e o Inspetor em lote mostra os quatro interruptores **sem** "Remover campos selecionados". Os 6 campos confirmados intactos por SQL no fim.
- Console do navegador sem erros; `oxlint` limpo; `vite build` limpo, com `ModuleBuilderPage` ainda em chunk próprio. Depois da exclusão do módulo de teste: 20 linhas em `modules`, zero órfãos em `module_fields`/`module_records`/`role_permissions`.

**Não exercitado**: uma escrita recusada pelo banco **no meio** de um desfazer (o caminho é o mesmo `applyFieldsPlan` da Fase 2, que já para na primeira falha e diz o que passou); e o limite de 20 snapshots batendo de verdade.

#### Fora de escopo

Prévia (`RegistryTable`) não ganhou seleção múltipla nem atalhos — só a lista da esquerda. Sem botões de desfazer/refazer na tela: os atalhos estão escritos no rodapé do painel "Campos", e um par de botões seria superfície nova numa etapa de gestos. Workflow (`WorkflowCanvas.tsx`) segue igual — é a Fase 5.

### Decisão arquitetural: visão JSON do workflow, e a reconciliação compartilhada com os campos (Fase 5) (28/08/2026)

Quinta fase do construtor "para dev". É a Fase 2 (visão JSON dos campos) aplicada ao **workflow** de M4 — situações, transições e ações automáticas —, pelo mesmo motivo e sem repetir a cautela de "primeiro só leitura": o padrão dos campos já provou que funciona, então esta nasceu editável. Nenhuma regra de M3 ou M4 mudou, e o **diagrama continua existindo inteiro** (`WorkflowCanvas.tsx` não foi tocado), como o editor de campos continuou existindo ao lado do JSON deles.

O problema é o mesmo de sempre: o diagrama é bom para *conferir* a máquina de estados e péssimo para *montá-la*. Cada situação é um modal, cada seta são dois cliques, cada ação automática é outro modal — e uma sessão do Claude Code teria que descobrir o estado por screenshot/DOM e depois clicar tudo. `WorkflowSection.tsx` ganhou o mesmo alternador de duas abas ("Diagrama" | "Ver como JSON"), com o mesmo desenho e as mesmas classes CSS já existentes.

#### Dois JSONs, não um

Campos e workflow **não** se misturam na mesma visão: o JSON dos campos continua em `ModuleBuilderPage.tsx` (`FieldsJsonView`), o do workflow mora em `WorkflowSection.tsx` (`WorkflowJsonView`). Cada um no seu lugar já estabelecido, cada um com o seu "Copiar"/"Aplicar" e o seu textarea. Um documento só, com campos e workflow juntos, obrigaria a aplicar as duas coisas de uma vez para mexer numa — e são etapas de trabalho diferentes.

#### O formato: onde ele deixa de ser o dump cru, e por quê

A visão dos campos mostra `ModuleFieldDefinition` sem tradução nenhuma, e o ideal aqui seria o mesmo. Duas coisas impedem, e as duas são sobre **referências entre as listas**:

| Decisão | Por quê |
| --- | --- |
| **As ações moram dentro da transição**, não num mapa `actionsByTransition` à parte | Uma transição *nova* não tem `id`, logo não tem chave sob a qual pendurar ações num mapa. Aninhar é a única forma de criar a transição e as ações dela na mesma aplicação. |
| **A transição aponta as situações por `code`**, não por `fromSituationId`/`toSituationId` | Mesmo motivo (uma situação nova ainda não tem `id`) e mais um: um par de uuids não diz nada a quem lê o documento, enquanto o `code` é o identificador estável e legível que o banco já guarda em `module_records.status`. O `code` de uma situação nova é **previsível** — sai do rótulo pela mesma `previewFieldKey` que o formulário já mostra na dica. |

`id` continua sendo o que decide edição × criação, nos **três** níveis, exatamente como nos campos. Ficam de fora, e a dica na tela diz: `sortOrder` (quem manda é a posição na lista) e `canvasX`/`canvasY` (posição do nó, que se grava arrastando).

O ganho concreto dessa escolha, exercitado no navegador: **uma situação nova e a seta que chega nela nascem na mesma aplicação** — impossível se a transição precisasse citar um uuid que ainda não existe.

#### `jsonPlan.ts`: a extração que fazia sentido, e a que não fazia

O pedido pedia para generalizar "se ficar natural". O que **é** compartilhável de verdade é o miolo mecânico, e ele foi para `jsonPlan.ts`, usado pelos dois arquivos de plano:

- `parsePlan` — `JSON.parse` + a disciplina de tudo ou nada (`PlanError` vira `{ ok: false, error }`, e erro que não é de validação continua subindo, porque é bug).
- `createIdReconciler` — o casamento por `id`: item conhecido vira edição, item sem `id` vira criação, `id` que sumiu vira remoção, `id` inventado ou repetido é recusa. Devolve `drops()`, `survivors()` e `orderChanged()`.
- `fail`/`describe`/`readBoolean`/`readLabel`/`readOptionalText`.

O que **não** foi extraído, de propósito: a validação de conteúdo. Um campo tem `dataType` e chave física; uma situação tem código e a marca de inicial; uma ação tem seis colunas que se exigem entre si. Forçar isso num único validador genérico produziria uma abstração que ninguém consegue ler. Cada arquivo continua dono das suas regras **e das suas mensagens** — o reconciliador recebe as três mensagens de `id` como callbacks, e é por isso que as recusas de campo continuam falando "Campo 3" enquanto as de workflow falam "Situação 2".

**Um detalhe que ditou a forma**: o reconciliador é *stateful*, chamado item a item de dentro do laço de quem usa, e não uma passada própria antes dele. Assim a primeira mensagem de erro continua sendo a do primeiro item problemático da lista — uma passada separada de ids reportaria "o id do item 7" quando o item 1 já estava sem rótulo. `fieldsJsonPlan.ts` foi reescrito para usar as peças novas **sem mudar nenhuma mensagem**, e a visão dos campos foi reexercitada no navegador para confirmar.

#### Nove etapas, e por que a ordem não é arbitrária

`applyWorkflowPlan` (em `useModuleWorkflowBuilder.ts`) chama as **funções do repositório**, não os wrappers do hook — cada wrapper recarrega o workflow inteiro depois de escrever, o que daria uma ida ao banco por item. A lista é relida **uma vez**, no fim, com sucesso ou com falha (é o passo que traz os ids reais do que acabou de ser criado para o textarea). Mesma decisão de `applyFieldsPlan`, mesmo motivo.

1. **Remover antes de criar, e de dentro para fora**: ação → transição → situação. O banco recusa apagar uma situação que ainda tem transição, e recusa criar uma transição para um par `(de, para)` que já existe — remover primeiro libera o par, e libera o `code` da situação para um item novo desta mesma aplicação.
2. **A troca da situação inicial é uma chamada própria, no fim.** `save_module_situation` recusa desmarcar a inicial vigente, então o valor **atual** de `is_initial` viaja em toda edição e a troca acontece depois que todas as situações existem. Assim ela funciona igual quando a nova inicial já existia, quando acabou de ser criada, e quando substitui uma que acabou de ser removida — sem depender da ordem dos itens na lista. A própria RPC desmarca a anterior.
3. **Os ids reais sobem em cascata**: as situações novas devolvem id (a RPC já devolvia) e alimentam o mapa `code → id` que as transições usam; as transições novas devolvem id e alimentam as ações delas. O cliente não teria como adivinhar nenhum dos dois.

Se uma escrita falhar, a aplicação **para ali**, com a mesma frase da Fase 2: *"Parou na primeira falha: … Já tinha sido aplicado antes disso: X, Y. O resto do documento não foi gravado."*

#### `sortOrder`: renumera quando precisa, e fica quieto quando não

A ordem não tem RPC própria (diferente dos campos, que têm `reorderModuleFields`): ela é parâmetro do próprio `save_*`. Renumerar tudo em `(índice+1)*10` a cada aplicação faria um "Copiar → Aplicar" sem edição nenhuma escrever em todas as linhas. A regra, aplicada por nível (situações, transições, e as ações de cada transição): **renumera só quando a ordem relativa dos sobreviventes mudou ou quando há item novo** — que são exatamente os casos em que a posição precisa mesmo ser expressa. Confirmado: um "Copiar → Aplicar" intacto responde *"Nada a aplicar: o documento já é igual ao do módulo."*

#### Três recusas explícitas, herdadas da mesma filosofia

Tudo é validado **antes** de qualquer escrita, e a primeira coisa errada aborta o documento inteiro. Além das checagens óbvias (enums, campo obrigatório, item que não é objeto), três recusas existem porque a alternativa seria aceitar e ignorar em silêncio:

- **O `code` de uma situação que já existe não muda por aqui** — mesmo motivo da `fieldKey` de um campo: ele é o que está gravado em `module_records.status`, e trocá-lo orfanaria os registros que já estão nela.
- **O par `from`/`to` de uma transição que já existe não muda por aqui** — a RPC simplesmente ignora os parâmetros na edição, e ignorar em silêncio deixaria quem colou acreditando que redesenhou a seta. As ações penduradas nela mudariam de sentido sem saber.
- **Uma ação não muda de transição por aqui** — `save_module_transition_action` filtra o update por `(id, transition_id)` e responderia "ação não encontrada", mensagem verdadeira e inútil. A mensagem daqui diz de qual transição a ação é.

Mais duas que são invariantes do banco antecipadas: **exatamente uma** situação com `isInitial: true` (o índice único parcial recusaria duas, e o gatilho não conseguiria carimbar um registro novo com zero), e as regras de combinação das seis colunas de uma ação, que são os CHECK da tabela escritos em português. O **portão da Camada 2** também é conferido aqui — sem ele a lista começaria a ser gravada e pararia na primeira ação cruzada.

#### Testado no navegador

Conta de testes (`is_facilite_developer` ligada), módulo genérico "Fase 5 teste" criado e excluído na mesma sessão, com cada passo conferido por SQL:

- **Workflow inteiro montado de uma vez, a partir do zero**: duas situações, uma transição e duas ações (`now` e `current_user`) numa única aplicação — *"situação 'Aberto' criada; situação 'Resolvido' criada; transição 'Marcar como resolvido' criada; ação que preenche 'resolvido_em' … criada; ação que preenche 'resolvido_por' … criada"*. O textarea recarregou já com os ids reais do banco, e `sort_order` saiu 10/20 na ordem da lista.
- **"Copiar → Aplicar" sem editar** → *"Nada a aplicar"*, zero escritas.
- **Rótulo de situação editado no texto** → *"situação 'Resolvido' alterada (label)"*, e o **diagrama** passou a mostrar "Resolvido pelo suporte" com o `code` `resolvido` intacto.
- **Transição nova sem `id`** ("Reabrir", resolvido → aberto) → apareceu como segunda seta no diagrama.
- **Situação nova + transição que aponta para ela, na mesma aplicação** ("Cancelado" e "Cancelar", com uma ação `literal`) — o caso que o formato por `code` existe para permitir.
- **Troca da inicial junto com uma inversão de ordem**: as três situações invertidas e "Cancelado" marcada inicial → `sort_order` 10/20/30 na ordem nova, `is_initial` só em "Cancelado", numa aplicação só.
- **Remoções**: uma ação e uma transição fora da lista na mesma aplicação → as duas removidas, e o diagrama voltou com uma seta a menos.
- **Nove recusas seguidas** — JSON truncado, array no lugar do objeto, `code` renomeado, `from` apontando para código inexistente, duas iniciais, par da transição alterado, `literal` sem `value`, campo de destino inexistente, `via` que não é campo de referência — cada uma com mensagem específica, e **confirmado por SQL: nada foi escrito** (contagens e fingerprint das situações idênticos antes e depois).
- **O diagrama continua inteiro**: clicar na seta "Marcar como resolvido" abriu o painel com "Aberto → Resolvido pelo suporte" e a ação restante descrita em português.
- **A visão JSON dos campos foi reexercitada** depois da extração (dois campos criados por ela), para confirmar que `fieldsJsonPlan.ts` não regrediu.
- Console do navegador sem erros; `oxlint` limpo; `vite build` limpo, com `ModuleBuilderPage` ainda em chunk próprio. Depois da exclusão: 20 linhas em `modules`, zero órfãos em `module_fields`/`module_situations`/`module_transitions`/`module_records`/`role_permissions`.

**Não exercitado**: uma escrita recusada pelo banco **no meio** da aplicação (o caminho é o mesmo "para na primeira falha" da Fase 2); ações de **Camada 2** por esta via (o módulo de teste não tinha campo de referência — a validação de `via`/`sourceFieldKey` foi exercitada pelo lado da recusa, não pelo do sucesso); e disparar a transição na tela publicada depois de configurá-la por JSON (a RPC de execução não foi tocada).

#### Fora de escopo

`WorkflowCanvas.tsx` não mudou — nada de redesenho do diagrama, que continua sendo a alternativa visual. Desfazer/refazer no workflow (a Fase 4 deu isso aos campos; aqui a reconciliação já existe, então seria a mesma receita, mas é etapa própria). Rótulo/ordem do próprio módulo. E, como na Fase 2, o rascunho do textarea é perdido ao alternar para a aba "Diagrama" — quem está colando um documento grande aplica antes de trocar de aba. O botão "Nova situação" some na aba JSON justamente por isso: criar por modal recarregaria o workflow e levaria o rascunho junto.

### Catálogos fiscais de referência: UF, CFOP, tipo de cliente, regime tributário e NCM (28/08/2026)

Quatro novos catálogos de sistema seguindo **exatamente** o padrão já provado de `tax_groups`/`units_of_measure`: tabela própria + linha em `modules`/`module_fields` rodando na `GenericModulePage`, sem componente próprio. `ufs` (sigla, nome — 27 linhas), `cfop_codes` (codigo, descricao — 601 linhas), `tipos_cliente` (chave, rotulo — os 3 valores fechados de `resolveTipoCliente` em `invoiceMapping.ts`) e `regimes_tributarios` (chave, rotulo — o CRT 1/2/3). Mais `ncm_codes` (codigo, descricao — 10.514 linhas), que **não** virou módulo: são milhares de linhas, sem tela de cadastro, só tabela de busca (mesmo espírito de como Grupo tributário é consultado em Produtos).

#### Importação dos dados: direto do banco, não reescrita à mão

CFOP e NCM somam ~3,2MB de JSON — reescrever linha a linha estouraria o contexto à toa. A extensão `http` (disponível no Supabase, não instalada por padrão) foi ligada **temporariamente**: uma migration busca o JSON oficial direto da fonte (`extensions.http_get`), filtra e insere server-side, e a extensão foi removida (`drop extension`) depois de usada — nenhum dado passou pelo contexto do agente, e o banco não ficou com capacidade de rede de saída permanente sem necessidade real.

- **CFOP**: gist comunitário (`raw.githubusercontent.com`, commit fixado), 601 códigos. **Não bate com os 619 vigentes** (Convênio s/nº de 1970, Anexo II) — faltam 18, espalhados entre os grupos 1/2/3/5/6/7 (não é uma faixa inteira ausente). Amostra (`1101`, `5101`, `5102`, `5949`, etc.) conferida contra busca externa e correta, acentuação incluída — os 601 códigos presentes são confiáveis, só a lista não é 100% completa. Ficou registrado aqui em vez de escondido: quem for usar Tributações para um CFOP fora dessa lista de 601 vai precisar cadastrar a linha à mão em `/cfop` até alguém importar os 18 que faltam.
- **NCM**: Siscomex oficial (`portalunico.siscomex.gov.br`), 15.156 entradas na hierarquia completa (capítulo/posição/subposição/item), filtradas às 10.514 folhas de 8 dígitos com `Data_Fim = '31/12/9999'` (vigentes). `codigo` gravado sem pontuação (`01012100`, não `0101.21.00`) — é o formato que `invoiceMapping.ts` já manda para `codigo_ncm` na NF-e. `descricao` é o texto oficial tal como a tabela vem (fragmentos hierárquicos como `"-- Reprodutores de raça pura"`, com os travessões de nível — não foi concatenado com o pai porque o pedido era só espelhar a fonte oficial, não reconstruir descrição plena).

#### `reference_module_id` passou a valer entre módulos `table`, não só `generic`

Achado antes de mexer: `module_fields.reference_module_id` (M4) só resolvia módulos `storage_kind = 'generic'` — o trigger `module_fields_guard_reference` recusava explicitamente qualquer lado `table`, e `useModuleReferences.ts` tinha a query de opções **hardcoded** em `module_records`. Como Tributações e os catálogos novos são todos `table` (mesmo motivo de `tax_groups`/`units_of_measure` — tabela própria, não JSONB de usuário), o pedido original ("aponte `reference_module_id` e o motor genérico já resolve") não batia com o código como estava.

Extensão deliberada, não mecanismo novo — mesma forma que `genericModuleRepository.ts` já usa (`table` vs `generic` como dois caminhos por dentro, um contrato só por fora):

- **`module_fields_guard_reference`**: em vez de exigir os dois lados `generic`, passou a exigir **o mesmo `storage_kind`** dos dois lados (`generic`↔`generic` ou `table`↔`table`). Misturar os dois tipos continua recusado — não tem caso de uso pedido, e um terceiro formato de resolução no front seria especulação. A exigência de `has_facilite_developer_access()` não mudou; como isso sempre falha fora de uma sessão autenticada (`auth.uid()` nulo numa migration), gravar os 5 `reference_module_id` de Tributações exigiu desligar o trigger (`alter table ... disable trigger`) só para aquela escrita, revisada e deliberada, e religar em seguida — o portão continua de pé para qualquer escrita futura pelo `ModuleBuilderPage`.
- **`useModuleReferences.ts`**: passou a olhar o `storage_kind`/`data_table` do módulo referenciado (uma consulta a mais em `modules`) e resolver por dois caminhos — `module_records` (como antes) ou a tabela dedicada, com o rótulo saindo do mesmo `module_fields.show_in_table` dos dois jeitos. A tabela dinâmica exige abrir mão de tipagem (`as unknown as SupabaseClient`, mesma renúncia confinada que `genericModuleRepository.ts` já tinha) — e mais um `as any` só no `.select()`, porque o parser de tipos do PostgREST tenta validar a lista de colunas em tempo de compilação mesmo com a tabela desconhecida, e falha para qualquer string que não seja `"*"` literal.
- **`GenericModulePage.tsx`**: `useModuleReferences` deixou de ser gated por `isGeneric` — só o workflow continua sendo (só `generic` tem coluna `status`). Nenhuma outra linha do motor genérico mudou; `RegistryFormModal`/`moduleView.ts` já consumiam `referenceOptions`/`labels` como mapas opacos `{value,label}[]`, agnósticos de onde vieram.

**Ligados**: `uf_origem`→`ufs`, `regime`→`regimes-tributarios`, `tipo_cliente`→`tipos-cliente`, `cfop`→`cfop`. **`uf_destino` ficou de fora, de propósito**: aceita o coringa `'*'` (`WILDCARD_UF_DESTINO`, `taxRules.ts`) para "qualquer UF destino", e um `<select>` de referência só oferece ids reais de `ufs` — virar select apagaria silenciosamente esse coringa em qualquer regra existente na primeira edição pela tela (a ficha mostraria "— nenhum —", e salvar de novo gravaria vazio). `natureza_operacao` também ficou texto livre — não fazia parte do pedido, e são só dois valores literais (`venda`/`devolucao`) usados direto no código.

#### NCM em Produtos: `SearchCombobox`, não `<select>` nem texto livre

`ncm` (texto livre até aqui) virou o mesmo mecanismo de "Grupo tributário": `module_fields.show_in_form` desligado (o `fields.map` genérico não renderiza mais um `<input>` para ele) e uma busca via RPC nova `search_tax_groups`-alike, `search_ncm_codes(p_term)`, alimentando um `SearchCombobox` na `ProductsPage`. Um `<select>` simples (como os 4 catálogos pequenos acima) não serviria — são 10,5 mil opções.

`RegistryFormModal` só tinha **um** slot de busca (`lookupField`, singular) — o suficiente enquanto só existia Grupo tributário. Como Produtos passou a precisar de dois ao mesmo tempo, o prop virou lista: **`lookupFields`** (cada item com `key`, mesmo salto que `selectFields` já tinha dado antes por motivo parecido). O componente perdeu o genérico `<TItem>` (não fazia mais sentido com itens de tipos diferentes na mesma lista); os dois call sites existentes (`ProductsPage`, `FinancePage`) foram convertidos para a forma em lista.

#### Campo de referência virou pesquisável, não `<select>` nativo

Com CFOP em produção (601 opções), um `<select>` nativo obrigava rolar a lista inteira — sem busca, um código de 4 dígitos no meio de 601 é achado por sorte. `RegistryFormModal` ganhou `ReferenceField`: mesmo `SearchCombobox` de `lookupFields`, mas sem busca em rede — as opções já vieram inteiras em `referenceOptions` (`useModuleReferences` carrega tudo de uma vez), então o `fetchItems` só filtra em memória (`normalizeSearchText`, mesma técnica de busca de tabela já usada em outras telas). Vale para **todo** campo de referência, não só os grandes: um heurística por tamanho ("só fica pesquisável se tiver mais de N opções") seria mais código para calibrar um número arbitrário, e um catálogo de 3 opções pesquisável não atrapalha ninguém. A opção "— nenhum —" que o `<select>` tinha para limpar a escolha saiu — limpar agora é digitar por cima sem selecionar nada, mesma regra que `lookupFields` (Grupo tributário/NCM) já usava.

**Em seguida**: "5101" sozinho não diz pra que serve o CFOP. `ReferenceOption` ganhou `secondary?: string` — o **segundo** campo `show_in_table` do módulo referenciado, quando existe (CFOP já tinha `descricao` com `show_in_table = true` desde a migration inicial, sort_order 20; não precisou de nenhuma mudança de schema). `label` continua curto (primeiro campo, o que aparece em `references.labels` — tabela/ficha de quem referencia); `secondary` só entra na busca e no dropdown do `ReferenceField` (`normalizeSearchText` passou a bater em label OU secondary — digitar "produção" acha o CFOP 5101 sem saber o código) e no texto que fica no campo depois de escolher (`"5101 — Venda de produção do estabelecimento"`, via `referenceDisplayText`). Vale para os outros catálogos também, de graça: UF mostra "SP — São Paulo", Regime mostra "1 — Simples Nacional" — nenhum dos dois pediu mudança de schema porque `ufs`/`regimes_tributarios`/`tipos_cliente` já tinham os dois campos com `show_in_table = true`.

#### Fora de escopo

Recalcular/concatenar descrição hierárquica do NCM (pai + filho). Reconciliar os 18 CFOP que faltam contra uma segunda fonte. Referência cruzada `table`↔`generic` no motor (a checagem exige o mesmo tipo dos dois lados). Verificação no navegador — bloqueada nesta sessão pelo limite de 5 servidores de preview por pasta (todos ocupados por outras sessões); `tsc -b`/`oxlint` limpos nos arquivos tocados, e o schema/dados foram conferidos por SQL (contagens, amostra de acentuação, `EXPLAIN` não rodado).

### Decisão estrutural: o backend passa a ser versionado, e o projeto ganha testes (29/08/2026)

Ponto de partida do "Mínimo pra vender" (as 33 tarefas do `Plano de Obra do
Facilite`, benchmark contra 4 ERPs). Antes de qualquer uma delas, duas lacunas
tornavam o resto irrevisável.

- **Nasce `supabase/` no repositório.** Até aqui as ~52 funções `security
  definer`, as policies de RLS e os triggers existiam **só** no projeto
  Supabase, e a única descrição deles era prosa neste arquivo. Ninguém
  conseguia revisar uma RPC num diff, e nenhum teste conseguia afirmar o que
  uma policy faz. Agora: `supabase/config.toml`, `supabase/migrations/`
  (convenções em `migrations/README.md`) e `supabase/functions/`.
  - **O código da Edge Function `admin-users` foi recuperado da Supabase e
    versionado** em `supabase/functions/admin-users/index.ts` — ele existia
    apenas implantado. É uma transcrição do que está rodando: **diferencie
    contra o deployado antes de re-implantar**.
  - **O baseline do schema ainda não existe.** Gerá-lo exige a senha do banco,
    que não deve passar por uma sessão de agente — o comando está em
    `supabase/migrations/GERAR-BASELINE.md`, para o usuário rodar.
- **Nasce `tests/` com Vitest** e `npm test`. `vitest.config.ts` é separado de
  `vite.config.ts` de propósito (o de build carrega o plugin do React e
  `manualChunks`, que não têm nada a ver com rodar teste em Node).
  `tsconfig.tests.json` entra nas referências de `tsconfig.json`, então
  `npm run build` também checa os tipos dos testes.
  - `tests/unit/taxRules.test.ts` — porte de `scripts/tax-rule-resolution-check.mjs`,
    o único dos cinco scripts que já não falava com o banco. O script foi
    **aposentado**: duas fontes de verdade para a mesma regra é pior que uma.
  - `tests/isolation/` — bateria C1 (isolamento entre filiais). Ela **falha
    alto** se as contas de fixture não estiverem configuradas, em vez de pular:
    uma bateria de segurança que se auto-desliga dá verde falso, que é pior que
    não ter bateria. Preparo em `tests/isolation/README.md` — depende de existir
    uma **segunda filial**, que hoje não existe.
- **Alias `@fiscal-core`** (em `vite.config.ts` e `vitest.config.ts`, os dois
  precisam concordar) → `supabase/functions/_shared/fiscal`. É onde o núcleo
  fiscal puro vai morar, para rodar nas duas bordas: a Edge Function
  `fiscal-emit` (Deno, que exige `.ts` explícito no import) e o front, **só
  para prévia na tela, nunca para emitir**.
- **Credenciais saíram do repositório.** `scripts/fiscal-cycle-check.mjs`,
  `nfce-emission-check.mjs` e `wizard-invoice-check.mjs` traziam
  `claude.testes@facilite.com` / `claude2026` em texto claro e versionados —
  quem clonasse o projeto levava junto uma conta real. Agora leem de
  `.env.local` via `scripts/testAccount.mjs`. **A senha que ficou exposta
  precisa ser trocada** (ela está no histórico do git).

#### O que a auditoria do banco encontrou (e corrige o relatório num ponto)

Lido direto do catálogo (`pg_get_functiondef`), antes de o baseline existir:

- **C4 (baixa de estoque atômica) já está feito.** Todas as seis funções que
  escrevem em `products.stock` — `create_sale`, `create_conditional`,
  `create_purchase`, `create_sale_return`, `adjust_stock_batch`,
  `register_conditional_return` — fazem `select ... from products where id = ...
  for update` antes de calcular o saldo. O relatório afirma que "a checagem
  acontece no cliente"; o que acontece no cliente é só a **tradução** do erro
  que volta. `create_sale_order` não trava porque não mexe em estoque (pedido
  não reserva — decisão de 17/08/2026). Falta só o teste de concorrência que
  impeça a regressão.
- **C3 (decisões que valem dinheiro) é pior que o descrito.** Nenhuma função lê
  `products.sale_price`. `create_sale` seleciona `id, stock, branch_id` do
  produto e grava o `unit_price` que veio no payload — e o `v_items_total` que
  a validação de pagamentos confere é calculado **a partir desse mesmo preço**.
  Ou seja: mandar `unit_price: 0.01` e pagar um centavo passa por toda a
  validação. Vale para as sete funções que montam item de documento
  (`create_sale`, `create_sale_order`, `update_sale_order`, `create_conditional`,
  `create_sale_return`, `convert_sale_order_to_sale`,
  `convert_conditional_to_sale`).

### Decisão arquitetural: teste de concorrência na baixa de estoque (C4) (01/09/2026)

A auditoria acima confirmou que a trava (`select ... for update`) já existia nas
seis funções que escrevem em `products.stock`; faltava o teste automatizado
que prova isso e quebra o build se alguém remover a trava no futuro.

- **`tests/concurrency/stockConcurrency.test.ts`** cobre só `create_sale`: cria
  (ou reaproveita) um produto `TESTE-CONCORRENCIA-*`, põe o estoque em
  exatamente 1 e dispara duas `create_sale` simultâneas (`Promise.all`)
  comprando 1 unidade cada. Afirma que exatamente uma resolve com venda de
  verdade, a outra rejeita com "Estoque insuficiente para o produto ..."
  (regex — o id varia), e o estoque final é 0. Roda contra o Supabase real,
  mesmo espírito de `tests/isolation`: o que está sendo testado é o
  comportamento do banco sob concorrência, não uma simulação dele. As outras
  cinco funções (`create_pos_sale`, `create_purchase`, `create_sale_return`,
  `create_conditional`, `adjust_stock_batch`) ficam sem bateria própria —
  trabalho pendente.
- **Duplo rastro permanente e inevitável.** A venda vencedora é uma venda de
  verdade — `financial_entries_before_delete` (tarefa C3, 29/08/2026) já
  impede apagar o lançamento que ela gera. O que esta tarefa descobriu: o
  **produto** de teste também não é apagável depois da primeira venda, porque
  `sale_items_product_id_fkey` não tem `ON DELETE CASCADE` nem `SET NULL` —
  sem cláusula, o Postgres cai no padrão `NO ACTION`, que bloqueia o delete
  do mesmo jeito que `RESTRICT` — apagar o produto vira violação de chave
  estrangeira.
  Por isso "criar **ou reaproveitar**": da segunda execução em diante a
  bateria acha o produto por descrição e só reseta o estoque para 1, em vez de
  acumular um produto novo por rodada. O `afterAll` tenta apagar o produto
  mesmo assim (best-effort, cobre o caso de nunca ter sido vendido), mas a
  partir da primeira execução bem-sucedida esse delete sempre falha em
  silêncio — de propósito, documentado em `tests/concurrency/README.md`.

### Decisão arquitetural: contrato fiscal de 7 métodos e núcleo compartilhado (A2) + modelo canônico do documento fiscal (A3) (01/09/2026)

Etapa 1 do "Mínimo pra vender", tarefas A2 e A3, feitas juntas porque uma
descreve o contrato e a outra o dado que esse contrato produz. **A1 (a Edge
Function `fiscal-emit` e a troca dos três pontos de emissão do front) não foi
começada** — é prompt separado, e as duas tarefas aqui foram desenhadas para
não quebrar nada no intervalo entre elas e a A1.

#### A2 — o núcleo fiscal mudou de casa, e o contrato de 3 para 7 métodos

O alias `@fiscal-core` existia desde 29/08/2026 em `vite.config.ts` e
`vitest.config.ts` apontando para uma pasta vazia. Agora ela tem código: sete
arquivos saíram de `src/lib/fiscal/` para `supabase/functions/_shared/fiscal/`
(`git mv`, o histórico segue junto), e os imports relativos ganharam `.ts`
explícito — exigência do Deno, aceita sem reclamar pelo Vite e pelo `tsc`
(`allowImportingTsExtensions` já estava ligado).

- **`tsconfig.app.json` ganhou `paths`** para o mesmo alias. Sem isso `tsc -b`
  não resolveria `@fiscal-core/*` a partir de `src/`, e o build passaria a
  depender só do Vite. São **quatro** arquivos que precisam concordar sobre esse
  alias agora (`vite.config.ts`, `vitest.config.ts`, `tsconfig.app.json`,
  `tsconfig.tests.json`) — está anotado em cada um.
- **`src/lib/fiscal/*` continua existindo como camada fina de reexport.**
  Nenhum importador precisou mudar: `invoiceMapping.ts`, `ProductsPage.tsx`,
  `CnpjLookupField.tsx`, `useInvoicesData.ts`, `useSaleReturnsData.ts`,
  `fiscalDocumentsRepository.ts`, os três `scripts/*-check.mjs` e
  `tests/unit/taxRules.test.ts` seguem importando de onde importavam.
  `types.ts` usa `export type *` (e não `export *`) porque lá não há nada em
  tempo de execução — o arquivo some inteiro na compilação, como sumia antes.
- **O contrato saiu de `types.ts` e virou
  `supabase/functions/_shared/fiscal/provider.ts`**, ao lado do erro que ele
  pode lançar. `types.ts` ficou só com dado (payload e resultados).
- **Sete métodos**: os três de sempre (`emit`, `query`, `cancel`) mais
  `correctionLetter`, `invalidateRange`, `getXml` e `getDanfe`. Com isso a ação
  "Carta de correção" de `InvoicesPage.tsx` — desabilitada desde a etapa 8
  justamente porque o contrato não a cobria — passa a ter destino.

##### Um desvio do desenho de partida do plano, pelo mesmo critério da etapa F1

`getXml`/`getDanfe` devolvem **`FiscalArtifact | null`**, não `FiscalArtifact`.
Uma nota em `processando_autorizacao` ainda não tem XML e uma em
`erro_autorizacao` nunca vai ter — os dois são estados legítimos do documento,
não erro de programa. Devolver `null` deixa a tela dizer "ainda não disponível"
sem `try/catch`, na mesma filosofia de "rejeição não é exceção" que rege o resto
da interface; lançar ficaria reservado ao transporte, e aí não haveria como
distinguir "sem artefato" de "a rede caiu".

##### `createFocusProvider()` e o fim do `"focus-nfe": null`

O registry (`@fiscal-core/registry.ts`) não tem mais entrada valendo `null`.
`createFocusProvider()` existe, satisfaz o contrato inteiro e **lança
`FiscalNotConfiguredError` nas sete operações** até a tarefa A12. Isso inverte
um modo de falha que estava errado: até aqui,
`VITE_FISCAL_PROVIDER="focus-nfe"` caía de volta no simulado com um aviso no
console — ou seja, quem configurasse o provedor real seguia emitindo documento
sem valor fiscal, e o único sinal era uma linha de log que ninguém lê. Agora
recebe um erro explícito na operação exata que tentou (e
`emitInvoiceForSale`/`emitFiscalDocumentForSale` já capturam qualquer exceção e
a transformam em mensagem acionável na tela — nada quebra visualmente).
**Valor desconhecido continua caindo no simulado com aviso**: esse fallback é o
que protege contra erro de digitação, e é diferente de um nome válido escrito de
propósito.

- **A leitura da variável de ambiente ficou no front**, não no núcleo: no
  navegador é `import.meta.env` (Vite), na Edge Function será `Deno.env`, e um
  dos dois quebraria o outro. O registry recebe o valor já lido
  (`resolveFiscalProviderId`). A decisão de a configuração ser env var, e não
  linha no banco, continua valendo (etapa F1).

##### O simulado ganhou os quatro métodos, com a mesma coerência de estado dos três antigos

- **Carta de correção**: texto de 15 a 1000 caracteres (a regra da CC-e é mais
  folgada que a do cancelamento, 15 a 255, de propósito); só para documento
  `autorizado`; numera `nSeqEvento` de 1 a 20 e recusa a vigésima primeira;
  **não muda o status do documento** — é o que a distingue do cancelamento.
- **Inutilização de faixa**: idempotente por `ref` como a emissão; recusa faixa
  invertida, faixa sobreposta a outra já inutilizada (SEFAZ 563) e faixa que
  contém número que já virou nota; e **a numeração seguinte pula a faixa
  inutilizada** — número inutilizado não volta a ser usado, que é exatamente o
  que a inutilização declara. O cUF do XML vem da opção de reserva porque o
  pedido de inutilização não carrega UF nenhuma — nem aqui nem no provedor real,
  onde a SEFAZ a deriva do cadastro do CNPJ na conta.
- **`getXml`/`getDanfe`** devolvem o artefato guardado, ou `null`.
- **Os dois métodos de evento ainda precisam de conferência de grafia contra a
  documentação da Focus.** Os campos de emissão foram checados linha a linha na
  etapa F1; `correctionLetter`/`invalidateRange` foram modelados no formato dos
  endpoints de evento (`POST /v2/nfe/<ref>/carta_correcao`,
  `POST /v2/nfe/inutilizacao`) **sem** a mesma conferência. Quem fizer A12
  reconfere, não assume — está anotado em `focusProvider.ts`.

##### Bateria nova: `tests/unit/fiscalProvider.test.ts`

19 testes, sem banco e sem login (o simulado não faz I/O), rodando em
`npm test`. Herda o papel de `scripts/fiscal-cycle-check.mjs` para a parte que é
do provedor — o script continua existindo porque exercita o mapeamento a partir
de uma venda real, que é outra coisa. Cobre o ciclo dos três métodos antigos, os
quatro novos com todos os caminhos de recusa, os sete métodos do provedor Focus
lançando, e o registry.

##### Três bugs que a revisão (`/code-review high`) pegou, todos corrigidos

1. **`invalidateRange` ignorava `request.serie`** e usava a série em que o
   provedor emite. Inutilizar a faixa 10–20 da série 2 gravava a faixa como
   sendo da série 1, gerava XML com `<serie>1</serie>` e fazia um pedido
   legítimo posterior para a série 1 ser recusado com 563. Corrigido, com teste
   de regressão que é o único caso da bateria que existe só por causa disto.
2. **`configured in PROVIDER_FACTORIES`** (a checagem que existia desde a etapa
   F1) aceitava propriedade herdada de `Object.prototype`:
   `VITE_FISCAL_PROVIDER="toString"` passava pelo `in`, resolvia para
   `Object.prototype.toString` — truthy, então nem o segundo guarda pegava — e
   `getFiscalProvider()` devolvia uma string no lugar de um provedor, quebrando
   a emissão com "provider.emit is not a function" em vez de cair no simulado.
   Virou `Object.prototype.hasOwnProperty.call(...)`.
3. **`emit`/`query` vazavam o estado interno** do simulado (`{ ...stored }`
   entregava `protocoloNumerico`, e os campos novos de A2 teriam ampliado o
   vazamento). Nasceu `toDocument()`, que lista os campos do contrato um a um —
   custa uma linha por campo e, em troca, quebra a compilação se
   `FiscalDocument` ganhar um campo novo.

#### A3 — o XML deixa de ser fonte da verdade e vira saída do modelo

`supabase/migrations/00000000000003_a3_modelo_canonico_documento_fiscal.sql`.
**A migration NÃO foi aplicada no banco remoto** — é revisada em conversa
própria antes de ir para produção, mesmo cuidado das tarefas anteriores.

Até aqui `fiscal_documents` guardava o **resultado** da emissão (chave,
protocolo, status, XML) e nada do **conteúdo**: emitente, destinatário, itens e
impostos só existiam dentro do `NfePayload` montado em memória por
`invoiceMapping.ts`, e o único lugar onde sobreviviam era dentro da string do
XML — que, no provedor simulado, é gerada no navegador. Não dava para responder
"quanto de ICMS essa nota destacou no item 2?" sem parsear XML, e reemitir
dependia de remontar o payload a partir de uma venda que pode ter mudado desde
então.

- **`fiscal_documents` ganhou o cabeçalho da nota**: `ambiente` (enum novo
  `fiscal_ambiente`, default `homologacao` — falha fechado), `data_emissao`,
  `natureza_operacao`, `tipo_documento`, `finalidade`, `consumidor_final`,
  `indicador_presenca`, `local_destino`, `modalidade_frete`,
  `chave_referenciada`, o snapshot de emitente (11 colunas) e destinatário (13),
  e 16 `total_*`. Tudo nulável: **nenhuma linha existente ganha snapshot
  retroativo**, porque não há de onde tirar o dado sem inventá-lo.
- **Snapshot, e não FK**, para emitente e destinatário — mesmo raciocínio já
  registrado para o endereço de venda (13/08/2026): a nota descreve o que foi
  declarado à SEFAZ naquele momento, e uma FK a faria mudar retroativamente
  quando o cadastro mudasse.
- **`fiscal_document_items`** (nova): uma linha por item, com o snapshot do
  produto (`product_id` é FK só como rastro, `on delete set null`) e as colunas
  por imposto que a Etapa 2 vai preencher — ICMS, ICMS-ST, FCP, PIS, COFINS,
  IPI, IBS e CBS. **Nulo aqui significa "não calculado", nunca zero.** É o lugar
  canônico do CFOP do item, que hoje é gravado em `sale_items.cfop` depois da
  autorização (quem para de escrever lá é a A1).
  - **Redução de base só existe para ICMS e ICMS-ST** (`pRedBC`/`pRedBCST`).
    PIS/COFINS/IPI/IBS/CBS não têm campo equivalente no schema da SEFAZ, então
    não ganharam coluna — seria dado sem destino no XML. É o único ponto em que
    a migration não segue ao pé da letra o "base, redução, alíquota e valor para
    todos" da instrução.
- **`fiscal_document_events`** (nova): autorização, rejeição, cancelamento,
  carta de correção e inutilização, com `request_payload`/`response_payload`
  crus e o XML do evento.
  - **É a única das duas tabelas novas com `branch_id` próprio**, e isso não é
    inconsistência: quatro dos cinco tipos pertencem a um documento e herdariam
    a filial por ele, mas **a inutilização não tem documento nenhum** — ela
    declara uma faixa de números que nunca virou nota. Sem `branch_id`, essas
    linhas ficariam sem âncora de RLS. `fiscal_document_id` é nulável, com
    `CHECK` amarrando as duas formas, e o trigger
    `fiscal_document_events_branch_matches` garante que, quando há documento, a
    filial dos dois é a mesma — a mesma disciplina de `create_sale`, que valida
    antes de confiar.
- **RLS**: uma policy só em cada tabela nova, `select`, com
  `has_permission('notas-emitidas', 'view')` + `has_branch_access`. **Nenhuma
  policy de insert/update/delete**, mais `revoke` explícito de
  INSERT/UPDATE/DELETE para `anon`/`authenticated` por cima — a proteção não
  depende de uma camada só. Quem escreve é a Edge Function (A1), com
  `service_role`, que não passa por RLS.

##### O que a migration deliberadamente NÃO faz, e por quê

As duas coisas têm o mesmo motivo: **não quebrar o sistema no intervalo entre
A3 e A1.**

- **Não remove as colunas `cancel_*` de `fiscal_documents`**, que
  `fiscal_document_events` torna redundantes. `persistCancelResult`
  (`fiscalDocumentsRepository.ts`) ainda escreve nelas; removê-las agora
  quebraria o cancelamento hoje. Ficaram marcadas como obsoletas por
  `comment on column`, e o `drop` é a última etapa da A1.
- **Não remove as policies de `insert`/`update` de `fiscal_documents`**, pelo
  mesmo motivo: hoje quem grava a nota é o cliente sob RLS. Elas saem quando a
  Edge Function assumir a escrita, e aí `fiscal_documents` fica igual às duas
  tabelas novas.

#### Testado

`npm run build`, `npm run lint` e `npm test` limpos — o lint só com os avisos
pré-existentes (quatro `only-export-components`, um `no-useless-escape`, um
`exhaustive-deps`), e o `npm test` com 28 testes passando mais as duas baterias
que dependem de credencial em `.env.local` (`tests/isolation` e
`tests/concurrency`) falhando alto por falta de configuração, como é o desenho
delas. **Nada foi testado no navegador**: A2 não tem superfície de UI (nenhuma
tela passou a chamar os quatro métodos novos — isso é A1/A4) e A3 é uma
migration não aplicada.

#### Fora de escopo

A1 inteira (Edge Function `fiscal-emit`, tirar a geração fiscal do navegador,
mudar os três pontos de emissão do front, gravar nas tabelas novas, remover as
colunas `cancel_*` e as policies de escrita de `fiscal_documents`); A12 (a
chamada HTTP de verdade da Focus); ligar as ações "Carta de correção" e
"Inutilizar numeração" em `InvoicesPage.tsx` (o contrato passou a suportar, a
tela ainda não expõe); o motor tributário que preenche as colunas por imposto de
`fiscal_document_items` (Etapa 2); FCP-ST (`vFCPST`) por item — cabe no mesmo
padrão das colunas de FCP quando virar assunto; aplicar a migration no banco.

### Decisão arquitetural: a emissão fiscal sai do navegador — Edge Function `fiscal-emit` (A1) (01/09/2026)

Etapa 1 do "Mínimo pra vender", tarefa A1 — a última das três (A2, A3, A1) e a
que dá sentido às outras duas. A2 definiu o contrato, A3 definiu o dado; A1 muda
**onde a emissão acontece**.

#### O buraco que esta tarefa fecha

Até aqui a nota fiscal era montada e "emitida" dentro do navegador:
`invoiceMapping.ts` construía o `NfePayload` a partir do estado da tela,
`getFiscalProvider()` era chamado no cliente e `fiscalDocumentsRepository.ts`
gravava `fiscal_documents` sob RLS. Três consequências, e a primeira é a que
importa:

1. **O conteúdo da nota vinha do cliente.** Preço unitário, desconto, total,
   base e alíquota atravessavam o payload. Um cliente adulterado declarava à
   SEFAZ um valor que a venda não tinha — a mesma família do achado C3
   (29/08/2026), agora no documento que tem valor legal.
2. **O token do provedor real (A12) teria de morar no bundle** para a emissão
   funcionar; ou seja, público.
3. **A policy de `insert`/`update` de `fiscal_documents` precisava existir.**
   Com ela de pé, qualquer sessão com `notas-emitidas.create` podia inserir uma
   linha de nota fiscal com chave, protocolo e status inventados, sem nunca
   falar com a SEFAZ.

#### `supabase/functions/fiscal-emit/` — três arquivos, não um

`admin-users` cabe em um arquivo; esta não caberia, e a fronteira entre leitura
e escrita é justamente o que precisa ficar legível numa revisão de segurança.

- **`index.ts`** — a borda HTTP: CORS, `Deno.serve`, validação do corpo,
  autenticação por JWT e despacho. `has_permission('notas-emitidas', …)` +
  `has_branch_access(branchId)` rodam **antes de qualquer leitura ou escrita**, e
  pelo **cliente do chamador** (anon key + o JWT dele), não pelo `service_role`:
  as duas funções decidem por `auth.uid()`, que sob `service_role` é nulo e
  devolveria `false` para todo mundo. A permissão exigida acompanha a ação —
  `emit` → `create`, `cancel` → `edit`, `query` → `view` —, que é exatamente o
  que as policies removidas exigiam.
- **`data.ts`** — a leitura. É o ponto da tarefa: venda, itens, produto, grupo
  tributário, cliente e filial saem do banco, não do corpo da requisição. São as
  mesmas consultas que estavam em `fetchSaleForInvoice` e
  `fetchSaleReturnForInvoice`; elas não foram reescritas, mudaram de lado da
  fronteira (e sumiram do front).
- **`persist.ts`** — a escrita nas três tabelas de A3: `fiscal_documents`
  (cabeçalho completo), `fiscal_document_items` (uma linha por item) e
  `fiscal_document_events` (autorização/rejeição/cancelamento).

**Do cliente vem só *o que* emitir**: `action`, `branchId`, `saleId` **ou**
`saleReturnId`, `model` e (no cancelamento) `justificativa`. Nem a `ref` viaja —
ela é derivada no servidor (`_shared/fiscal/refs.ts`), porque `fiscal_documents`
é `unique (ref)` e aceitar uma `ref` pronta deixaria o cliente escolher **em qual
linha** o resultado da emissão cairia, inclusive na linha de outra filial.

O contrato de retorno **não mudou**: `{ ok, errors }`, HTTP 200 para rejeição da
SEFAZ (é resultado de negócio, decisão de 18/08/2026) e HTTP de erro só para
transporte, permissão e `FiscalNotConfiguredError`.

#### Escopo: `emit`, `cancel`, `query` — e uma correção ao enunciado

O prompt da tarefa dizia que esses são "os três métodos que a UI realmente chama
hoje". São dois: **nenhuma tela chama `query`**. Ela foi implementada mesmo
assim porque é o caminho da autorização assíncrona do provedor real (a API
responde 202 e a nota vira `autorizado` depois), e é por ela que uma nota em
`processando_autorizacao` sai desse estado. `correctionLetter`,
`invalidateRange`, `getXml` e `getDanfe` ficaram de fora — os botões "Carta de
correção" continuam `disabled: true` em `InvoicesPage.tsx`.

#### O que saiu do front (e por que deletado, não desligado)

| Saiu | Para onde |
|---|---|
| `src/features/sales/invoiceMapping.ts` | `git mv` para `_shared/fiscal/invoiceMapping.ts` — **sem camada de reexport**: nada no front deve conseguir montar um `NfePayload` |
| `fetchSaleForInvoice`, `fetchSaleReturnForInvoice` | `fiscal-emit/data.ts` |
| `persistEmitResult`, `persistCancelResult` | `fiscal-emit/persist.ts`, agora nas três tabelas |
| `saleFiscalRef`, `saleReturnFiscalRef` | `_shared/fiscal/refs.ts` (derivadas no servidor) |
| `updateSaleItemsCfop` | ninguém — ver abaixo |
| `taxRulesRepository.ts` | `fiscal-emit/data.ts` (`readTaxRules`) |
| `toTaxGroup` | `_shared/fiscal/taxGroups.ts` (as duas bordas leem `tax_groups`) |

Deletar em vez de deixar desligado é deliberado: uma cópia da leitura fiscal
parada no front é uma divergência esperando acontecer — um campo novo em
`tax_groups` chegaria à tela sem chegar ao XML. Pelo mesmo motivo `toTaxGroup` e
a conversão de `tax_rules` viraram uma função só, no núcleo.

`src/lib/fiscal/provider.ts` **continua existindo** e agora tem um aviso no
topo: nenhuma tela o chama, ele é a borda-navegador do registry (para uma prévia
futura) e o que os scripts de verificação ainda carregam. Confirmado por
inspeção do bundle: nenhum artefato de `dist/` contém o provedor simulado.

#### Três decisões que valem registro

##### 1. `sale_items.cfop` deixa de ser escrito

A3 já dizia que o lugar canônico do CFOP do item é `fiscal_document_items.cfop`
(o CFOP é **da nota**, não da venda — a mesma venda devolvida sai com CFOP de
entrada), e que quem para de escrever em `sale_items` é A1. Feito. A coluna
continua existindo pelas notas emitidas antes desta mudança, que não têm cópia
na tabela nova (A3 não semeia nada retroativo), e ganhou `comment on column`
dizendo isso. Nenhuma tela lia essa coluna — só `nfce-emission-check.mjs`.

##### 2. O provedor simulado ganhou `seed`, porque a Edge Function não tem sessão

O `SimulatedFiscalProvider` guarda estado em memória, e isso bastava enquanto
quem emitia era o navegador: emitir e cancelar aconteciam na mesma instância.
Cada requisição da Edge Function pode cair num isolate novo — sem restaurar
nada, **todo cancelamento responderia `nao_encontrado` para uma nota que está
`autorizado` no banco**.

A saída não foi dar banco ao provedor (ele existe para não ter I/O), e sim
aceitar que a borda devolva o pouco que ele precisa lembrar:
`seed.documents` recoloca no `Map` a nota lida de `fiscal_documents`, e
`seed.lastNumbers` diz de onde a numeração continua. O provedor real não precisa
de nada disso — quem guarda o estado dele é a API dele —, e é por isso que a
opção mora em `simulatedFiscalProvider.ts` e chega por
`FiscalProviderOptions.simulatedSeed` no registry, **não** no contrato
`FiscalProvider`, que descreve operações e não construção. Quatro testes novos
em `tests/unit/fiscalProvider.test.ts` (23 no arquivo, 32 no `npm test`).

`readLastNumero` **não é reserva de numeração**: duas emissões simultâneas leem
o mesmo máximo e saem com o mesmo número. Numeração atômica por filial e série é
a tarefa A10; isto aqui só impede que A1 piore o que já existia (o contador do
navegador, que zerava a cada F5 — e que é justamente o motivo de a consulta ler
a coluna inteira em vez de "as N mais recentes", ver o `/code-review` abaixo).

##### 3. A emissão ficou idempotente de verdade, e não só dentro da sessão

`handleEmit` consulta `fiscal_documents` pela `ref` **antes** de falar com o
provedor: nota `autorizado` devolve a que existe, nota `cancelado` recusa
reemissão. Antes disso, reemitir depois de um F5 gerava uma nota nova (número e
chave novos) e o upsert por `ref` sobrescrevia a autorizada — perda silenciosa.
Como efeito colateral, o conflito entre modelos ficou visível: `ref` é a mesma
para NF-e e NFC-e da mesma venda, então pedir NF-e para uma venda que já tem
NFC-e autorizada agora recebe uma mensagem em vez de sobrescrever a nota.

#### Atomicidade: o que esta tarefa deliberadamente não resolveu

As três escritas de `persistEmission` são três statements, não uma transação —
PostgREST não oferece transação entre tabelas. A ordem é deliberada: **o
cabeçalho primeiro**, porque ele é o registro de que a nota existe. Se itens ou
evento falharem, quem chamou recebe uma mensagem dizendo que a nota **foi
autorizada** e que reemitir é seguro (idempotente por `ref`, e o upsert reescreve
tudo). Fingir que a emissão falhou seria pior: ela aconteceu, e a SEFAZ não
desfaz por causa de um insert que não passou. Tornar isso atômico exigiria uma
RPC `security definer` recebendo as três partes — candidata a tarefa própria.

#### A migration (escrita, NÃO aplicada)

`supabase/migrations/00000000000004_a1_escrita_fiscal_so_pela_edge_function.sql`.
Ela **depende da função estar implantada**: entre o `drop policy` e o deploy
nenhuma nota é emitida. Ordem: aplicar a migration de A3 → implantar
`fiscal-emit` → aplicar esta.

- Remove as 3 colunas `cancel_*` de `fiscal_documents`, marcadas OBSOLETAS por
  A3. Nenhuma tela as lia: `InvoiceDocument.xmlCancelamento` era produzido e
  nunca consumido, e o campo saiu do tipo.
- Remove as policies de `insert` e `update` de `fiscal_documents`, mais
  `revoke`/`grant select` explícitos por cima — a tabela fica igual às duas
  criadas em A3.
- **Remove também a policy `notas-emitidas update sale_items cfop`.** Ela existia
  só para o `updateSaleItemsCfop` que deixou de existir, e o detalhe que a torna
  mais que código morto: era `for update` **sem restrição de coluna**, então quem
  tivesse `notas-emitidas.create` podia reescrever `unit_price` e `total_amount`
  de qualquer item de venda da filial. É um buraco da família do C3, e só deu
  para fechá-lo agora porque só agora ninguém precisa mais da porta. Todas as
  funções que escrevem `sale_items` são `security definer` (conferido:
  `create_sale`, `convert_conditional_to_sale`, e a versão de C3), então o
  `revoke` não quebra venda nenhuma.

#### `/code-review high` — três achados, todos corrigidos

1. **`handleEmit` vazava a chave de acesso de outra filial.** O atalho de
   idempotência devolvia a `chave` do documento achado por `ref` sem conferir a
   filial dele — a checagem existia só em `buildPayload`, que roda depois.
   Usuário com acesso só à filial B pedia emissão passando `branchId: B` e o
   `saleId` de uma venda da filial A: `has_branch_access(B)` passava, e a
   resposta trazia os 44 dígitos da nota da filial A. Corrigido logo após a
   leitura do documento.
2. **`readLastNumero` pegava o máximo só das 200 notas mais recentes.** A
   premissa "a nota mais recente tem o maior número" é falsa exatamente por
   causa da história que a função existe para consertar: com o contador
   reiniciando a cada F5, o banco tem notas antigas com números **maiores** que
   as recentes (uma sessão longa foi até 50; dez sessões curtas depois ficaram em
   1–5). A janela devolveria 5 e a numeração seguinte colidiria com as notas 6 a
   50. Ordenar por `numero` no banco também não resolve — a coluna é `text`, e
   "9" ordena acima de "10". Passou a ler a coluna inteira e tirar o máximo em
   memória; só roda para o provedor simulado.
3. **Erro do gateway virava mensagem genérica.** `fiscalEmitApi` lia só
   `result.error`, campo da nossa função; o gateway da Supabase recusa antes
   (`verify_jwt = true`) com `{ code, message }`. Sessão expirada mostrava "Erro
   ao falar com o serviço de emissão fiscal." em vez de "Invalid JWT",
   escondendo que bastava entrar de novo.

#### Configuração nova

`FISCAL_PROVIDER` e `FISCAL_AMBIENTE` são **secrets do projeto Supabase**, não
entradas do `.env.local`: a Edge Function roda em Deno e não enxerga nada com
prefixo `VITE_`. `VITE_FISCAL_PROVIDER` continua existindo, mas depois de A1 ela
não decide mais emissão nenhuma — só prévia e scripts. Documentado em
`.env.example`. `supabase/config.toml` ganhou `[functions.fiscal-emit]` com
`verify_jwt = true` declarado de propósito, para a diferença em relação a
`admin-users` (que tem caso de bootstrap) ser intencional e não esquecimento.

#### Testado

`npm run build`, `npm run lint` e `npm test` limpos — o lint só com os seis
avisos pré-existentes, e o `npm test` com 32 testes passando (28 + 4 do `seed`)
mais as duas baterias que dependem de credencial em `.env.local` falhando alto,
como é o desenho delas. A Edge Function foi checada com `deno check` fora da
árvore, num diretório com `nodeModulesDir: auto` — a `d.ts` do runtime da
Supabase puxa tipos de npm que este repositório não instala, então rodar o check
dentro do projeto falha por dependência, não por erro nosso. **Nada foi testado
no navegador**: o caminho novo só funciona com a função implantada e as duas
migrations aplicadas, e as três coisas ficaram para revisão.

#### Fora de escopo

Implantar `fiscal-emit` e aplicar as migrations 3 e 4; A12 (a chamada HTTP da
Focus); ligar "Carta de correção"/"Inutilizar numeração" na UI; A10 (numeração
atômica); o motor tributário da Etapa 2 — as colunas de imposto de
`fiscal_document_items` recebem hoje **o que foi declarado** no XML (ICMS, PIS,
COFINS e os CSTs), e ficam nulas onde o mapeamento atual não calcula (ICMS-ST,
FCP, IPI, IBS, CBS, reduções de base), mantendo "nulo = não calculado"; tornar a
persistência atômica por RPC; consertar os três scripts de `scripts/`, que
dependiam da lógica local que saiu do front (documentado em `scripts/README.md`).
