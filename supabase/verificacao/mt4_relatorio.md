# MT4 — relatório de implementação e verificação local (08/10/2026)

MT4 implementada e validada localmente pela sessão de implementação. A sessão de coordenação aplicou a migration no projeto real, implantou `admin-users`, verificou o estado remoto e corrigiu os índices compostos apontados pelo advisor antes do commit.

## 1. Arquivos da MT4

- `supabase/migrations/00000000000022_mt4_roles_por_organizacao.sql` — migration nova.
- `supabase/functions/admin-users/index.ts` — mantém `Deno.serve`, delegando ao handler testável.
- `supabase/functions/admin-users/handler.ts` — código anterior movido para função exportada; valida organização e atribuição antes de criar Auth.
- `supabase/functions/admin-users/roleAssignment.ts` — decisão pura utilizada pelo handler real.
- `supabase/functions/admin-users/handler_test.ts` — 22 testes do handler real com SDK real e transporte HTTP simulado.
- `tests/unit/roleAssignment.test.ts` — 10 testes da função pura real.
- `supabase/verificacao/mt4_roles.mjs` — runner do Postgres 17 descartável.
- `supabase/verificacao/mt4_roles.sql` — verificações executáveis de RLS, integridade, atribuição, ACLs e planos.
- `supabase/verificacao/mt4_roles_invisibilidade.sql` — a mesma asserção central aplicada antes e depois da migration.
- `supabase/verificacao/mt4_roles.resultado.txt` — saída da última execução local.
- `supabase/verificacao/mt4_relatorio.md` — este relatório.
- `AGENTS.md` — somente acréscimo da decisão MT4 ao final; conteúdo anterior preservado.

Nenhum arquivo de `src/` foi editado pela MT4. `supabase/config.toml`, `deno.lock`, migrations anteriores e planos permaneceram intactos.

## 2. Constraints, defaults, índices e policies

| Relação | Desenho final |
|---|---|
| `roles.organization_id` | UUID, FK para organizations, NOT NULL, default `private.current_organization_id()` |
| `roles` — nome | UNIQUE `(organization_id, name)` substitui `roles_name_key` |
| `roles` — chave referenciada | UNIQUE `(id, organization_id)` |
| `role_permissions.organization_id` | UUID, FK para organizations, NOT NULL, mesmo default |
| `role_permissions` — upsert | UNIQUE `(role_id, module_id)` preservada |
| `profiles` → `roles` | FK `(role_id, organization_id)` → `(id, organization_id)`, NO ACTION; papel pode ser NULL |
| `role_permissions` → `roles` | Mesma FK composta, ON DELETE CASCADE |

As duas FKs simples de papel foram removidas. Assim não há constraints redundantes nem duas relações de embed `profiles` → `roles` para o PostgREST. A exclusão de papel em uso continua bloqueada; as permissões de papel sem perfis são removidas em cascade.

Índices: `role_permissions_organization_id_idx` para o filtro direto por organização e os índices compostos `profiles_role_id_organization_id_idx` e `role_permissions_role_id_organization_id_idx` para cobrir integralmente as duas FKs compostas. Os dois últimos foram acrescentados pela revisão coordenada depois que o advisor de performance do projeto real mostrou que os índices antigos por `role_id` não cobriam a constraint inteira. A UNIQUE `(id,organization_id)` é necessária como alvo das FKs, apesar da PK global de id.

São oito policies, quatro por tabela, todas `TO authenticated`. SELECT exige a organização atual. INSERT/DELETE exigem também `can_manage_permissions()`. UPDATE verifica ambas as condições em USING e WITH CHECK. Helpers independentes da linha ficam em subselect, conforme a [documentação de RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) e as [orientações de desempenho](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv).

A primeira aplicação adiciona roles.organization_id nullable e aborta se houver zero ou mais de uma organização; só então preenche e aplica NOT NULL. Nenhuma escolha com LIMIT 1. As permissões são preenchidas pela organização do papel, com validação de ausência de NULL. A guarda de unicidade da organização só é dispensada na reexecução quando o NOT NULL de roles já foi concluído; por isso a reexecução também passa depois de criar uma segunda organização nas fixtures.

## 3. Regra exata de atribuição

| Chamador autenticado | Papel solicitado | Resultado |
|---|---|---|
| Sem `can_manage_users` | Qualquer mudança de papel | Recusada |
| Com `can_manage_users` | NULL | Permitida |
| Com users, sem permissions | Seu próprio papel | Permitida |
| Com users, sem permissions | Qualquer outro papel, mesmo sem flags | Recusada |
| Com users e permissions | Qualquer papel da própria organização | Permitida |
| Qualquer chamador | Papel de organização diferente | Recusada |

Não há comparação por quantidade de flags ou permissões. Edição que mantém o mesmo role_id não constitui nova atribuição. SQL administrativo e service_role preservam o provisionamento, mas continuam sujeitos às FKs compostas; não conseguem criar relação cruzada.

## 4. Proteção da criação e da edição

Criação: o gate original `can_manage_users_for` permanece. Antes de `auth.admin.createUser`, o handler resolve perfil ativo, organização, papel atual e flags do chamador no servidor, busca o papel solicitado na mesma organização e chama a função real `canAssignRole`. Erros de papel retornam antes de qualquer criação no Auth. A organização enviada indevidamente no payload é ignorada. O rollback de Auth por erro posterior ao inserir perfil foi preservado e testado.

Bootstrap: ignora roleId, exige exatamente uma organização e encontra o Administrador dessa organização antes do Auth. Papel ausente falha explicitamente. O comentário da ponte temporária até MT9 permanece. `reset-password` mantém o código e o isolamento da MT3; testes cobrem alvo local, estrangeiro e inexistente. `verify_jwt: false` foi preservado.

Edição: `prevent_role_escalation` impõe a regra no banco para o update direto em profiles. O uso de `coalesce(..., false)` impede que o retorno NULL de um helper autorize implicitamente um perfil sem papel ou inativo. As proteções existentes de organization_id e is_facilite_developer foram mantidas.

## 5. Controle negativo

O runner usa a mesma asserção de invisibilidade do papel de UUID reservado antes e depois da MT4. No schema pré-MT4 ela falhou com `MT4_ISOLAMENTO: papel estrangeiro visível`. Depois da MT4 passou. A falha negativa é conferida pela mensagem específica, não por qualquer erro SQL ou coluna ausente. Sua transação foi revertida.

## 6. Postgres descartável

Comando: `node supabase/verificacao/mt4_roles.mjs`.

PostgreSQL **17.11**, imagem `postgres:17`, container sem rede e sem porta publicada. O runner não recebe URL de banco, não lê `.env` e usa somente `docker exec ... psql` no container que criou. O container e seu volume foram removidos ao terminar, inclusive na execução que encontrou erro no runner durante o desenvolvimento.

O schema de teste extrai tabelas, constraints, policies e funções relevantes do baseline e o trecho real de C3; aplica as migrations reais MT1, MT2, MT3 e a MT4 integral. Usa stubs de auth.uid/auth.role/auth.users e tabelas mínimas de módulos/filiais. Não é uma restauração de todo o Supabase.

Passaram: aplicação integral; reexecução com uma e duas organizações; abortos com zero/duas organizações antes do backfill; fixtures 2 papéis, 25 permissões (22/3), 4 perfis; nomes iguais entre organizações e duplicidade local; RLS para leitura e todas as escritas estrangeiras; WITH CHECK; upsert sem organization_id nos caminhos de insert/update; cascade e NO ACTION; FKs sob service_role/SQL; todas as combinações de atribuição; perfis sem papel/inativos; proteções MT3; ACLs; EXPLAIN JSON como authenticated com helpers dentro dos InitPlans em SELECT/UPDATE/DELETE.

Também houve corrupção artificial dentro de SAVEPOINT, removendo temporariamente as FKs compostas: os sete leitores rejeitaram perfil/papel com organizações divergentes, e has_permission rejeitou permissões cuja organização não correspondia ao papel. O rollback restaurou as constraints e os dados.

## 7. Build, lint, testes e Deno

| Verificação | Resultado |
|---|---|
| `npm.cmd run build` | Passou (TypeScript e Vite) |
| `npm.cmd run lint` | Passou; 7 avisos fora da MT4 |
| `npm.cmd run test:unit` | 38 arquivos, **842 testes passaram**, incluindo os 10 novos |
| `deno check --no-config --no-lock --node-modules-dir=none supabase/functions/admin-users/index.ts` | Passou |
| `deno test --no-config --no-lock --node-modules-dir=none --allow-env=SUPABASE_URL,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY supabase/functions/admin-users/handler_test.ts` | **22 testes passaram**, sem permissão de rede em runtime |
| `git diff --check` | Passou |

A primeira execução unitária no sandbox encontrou EPERM no realpath do Vitest e terminou incompleta; a repetição fora do sandbox passou integralmente. A primeira tentativa de Deno encontrou DNS restrito; a execução com acesso ao cache/registro fora do sandbox passou. `--no-lock` preservou o deno.lock preexistente; `--no-config` evitou resolução desnecessária de dependências do front. O Docker local precisou ser iniciado fora do sandbox. Nenhuma dependência do projeto foi instalada ou atualizada.

Não executei `npm test`: as suítes de isolamento/concorrência acessam e escrevem no projeto real, o que está proibido nesta tarefa.

## 8. Revisão de risco alto

`/code-review` não existe nas ferramentas/comandos disponíveis neste ambiente. Foi feita uma etapa separada de revisão estática e adversarial, confrontando os caminhos de escrita, SQLSTATEs dos testes, ACLs, joins, exclusões e contratos do front. Não houve execução do slash command nem parecer de um segundo agente/revisor.

Achados tratados durante a implementação/revisão:

- Validação original de roleId faltava nas duas portas: corrigida no handler e no trigger, com testes de negação e sucesso.
- A guarda antiga `not can_manage_users()` deixava NULL passar no IF: corrigida com COALESCE; testes de perfil sem papel e inativo.
- Manter a FK simples junto da composta causaria redundância e ambiguidade no embed: a simples foi substituída, preservando ações de deleção.
- Bootstrap consultava Administrador somente depois do Auth e aceitava papel ausente: resolução movida para antes do Auth e limitada à organização.
- O runner inicialmente usou substituição de string JavaScript que transformava `$$` em `$`: corrigido com callback; controle negativo e suíte positiva completos passaram depois.

Nenhuma falha pendente identificada nos caminhos de roleId alterados pela MT4. Limites concretos mantidos fora do escopo: (a) `reset-password` ainda permite a quem gerencia usuários redefinir a senha de qualquer usuário da própria organização, inclusive administrador, como na MT3; MT4 não afirma impedir toda forma de tomada de conta intracliente; (b) o catálogo de módulos e suas operações continuam globais até MT7, inclusive efeitos de cascade ligados à exclusão de módulo. Não há alegação de isolamento completo do produto.

## 9. Limitações não verificadas

- Sem aplicação remota nem testes com Auth/Data API reais. Os totais remotos fornecidos no pedido foram reproduzidos como fixtures, não reconferidos.
- A exclusão de private dos schemas expostos foi verificada no config.toml local; localização, USAGE/CREATE e EXECUTE foram verificadas no Postgres. O gateway remoto não foi consultado; a evidência remota da MT3 continua sendo a referência existente.
- O embed PostgREST foi preservado estruturalmente por uma única FK composta, mas não houve teste de HTTP contra PostgREST real.
- A compensação de erro após Auth foi testada com HTTP simulado. Falhas de rede/indisponibilidade do serviço de Auth não foram exercitadas em integração.
- Sem smoke test no navegador ou deploy da função. Nenhuma mudança visual foi necessária.

## 10. Limites operacionais

Nada aplicado no banco real, nada implantado, nenhum commit, nenhum push, nenhuma segunda organização real e nenhuma chamada de leitura/escrita ao projeto Supabase. MT5–MT9 não foram implementadas. Os planos e arquivos de memória da coordenação não foram editados.

## 11. Preservação do estado sujo

Foram registrados SHA-256 dos treze arquivos sujos indicados no pedido antes das alterações. Os doze arquivos fora de AGENTS.md permaneceram byte a byte iguais, incluindo AuthContext.tsx, tsconfig.tests.json e deno.lock. AGENTS.md recebeu somente uma entrada ao final, preservando integralmente os bytes anteriores. As alterações preexistentes não são atribuídas à MT4.

## 12. Aplicação e verificação coordenadas

A migration `mt4_roles_por_organizacao` foi aplicada no projeto real. A conferência encontrou 1 organização, 2 papéis, 25 permissões e 4 perfis, sem `organization_id` nulo nem relação perfil/papel ou permissão/papel entre organizações. As oito policies, as FKs compostas, as constraints de unicidade, os helpers e suas ACLs foram conferidos no catálogo real.

`admin-users` foi implantada como versão 7, `ACTIVE`, preservando `verify_jwt: false`. O bundle publicado contém `handler.ts` e `roleAssignment.ts`; um smoke autenticado confirmou o embed `profiles -> roles`, a visibilidade de 2 papéis/25 permissões e a execução do handler novo sem produzir escrita.

O advisor de performance apontou que as duas novas FKs compostas ainda não tinham índice de cobertura integral. A correção adicionou `(role_id, organization_id)` em `profiles` e `role_permissions`, foi reaplicada ao banco como migration corretiva idempotente e passou novamente no Postgres descartável e nos advisors. Os avisos restantes são o baseline já documentado do projeto.
