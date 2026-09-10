-- D1 — Filiais ganham tela: o que o cadastro precisa do banco (09/09/2026)
--
-- **Esta migration foi escrita e NÃO foi aplicada.** A sessão que a escreveu
-- não tinha autorização para aplicar migration nem para implantar Edge
-- Function; o código do front foi construído para funcionar nos dois estados
-- do banco (com e sem a coluna daqui) — ver `branchesRepository.ts`, a
-- sondagem `colunaEmailDisponivel`.
--
-- ## O que D1 fez, e por que quase nada disso é SQL
--
-- O núcleo de D1 é uma tela: `branches` era o único cadastro central do
-- sistema sem UI nenhuma — criava-se filial por `insert` manual, e a lacuna
-- estava registrada desde a decisão de multiempresa (13/08/2026). A tela nova
-- (`/configuracoes/filiais`) não precisou de nada no banco:
--
--   * a RLS de `branches` **já estava certa** — `read accessible branches`
--     libera `has_branch_access(id) or can_manage_branches()`, e as três
--     policies de escrita exigem `can_manage_branches()`. Nada a acrescentar,
--     nada a afrouxar;
--   * a rota é **sub-rota de Configurações** (`MODULE_SUBROUTES`), e não uma
--     linha nova em `modules` — que seria um `insert`, ou seja esta migration,
--     ou seja uma tela inalcançável até alguém aplicá-la. A11 precisa
--     alcançá-la;
--   * `can_manage_branches` já existia como flag de papel e como portão de
--     catálogo (`access_gate = 'manage_branches'`, em `moduleAccess.ts`).
--
-- Sobram duas coisas, e só elas estão aqui.

-- ---------------------------------------------------------------------
-- 1. E-mail para cópia da nota fiscal
-- ---------------------------------------------------------------------
--
-- O plano lista "e-mail de envio" entre as configurações. A pesquisa de D1
-- varreu o repositório inteiro por SMTP, Resend, SendGrid, Nodemailer, Mailgun
-- e Postmark: **zero ocorrência**. Não há infraestrutura de envio de e-mail
-- neste sistema, e construí-la é tarefa própria (provedor, segredo, fila de
-- reenvio, o que exatamente se anexa — XML, DANFE, os dois).
--
-- O que cabe agora é o **cadastro**: para onde mandar, quando houver envio.
-- Repare no nome escolhido — `email_copia_nota_fiscal`, não `email_envio`:
--
--   * o destinatário natural por filial é o contador, que recebe cópia de tudo
--     que a filial emite. O e-mail do **cliente** já existe e não é aqui:
--     `contacts.email`, por nota;
--   * "e-mail de envio" no sentido de *remetente* seria conta de SMTP, ou seja
--     credencial — e credencial não pode morar em `branches`, que **todo**
--     usuário com acesso à filial consegue ler (policy `read accessible
--     branches`). Quando o envio existir, o remetente vai para os segredos da
--     Edge Function, como a chave da Focus.
--
-- Coluna anulável, sem default: filial que não quer cópia não cadastra nada.

alter table public.branches
  add column if not exists email_copia_nota_fiscal text;

comment on column public.branches.email_copia_nota_fiscal is
  'E-mail que recebe cópia do XML/DANFE das notas desta filial — o endereço do contador, na prática (D1, 09/09/2026). CADASTRO PURO: nada neste sistema envia e-mail hoje, e nenhum código lê esta coluna ainda. Não é remetente/SMTP: credencial de envio não pode morar aqui, porque qualquer usuário com acesso à filial lê esta linha. O e-mail do destinatário da nota é outro campo, em contacts.email.';

-- ---------------------------------------------------------------------
-- 2. CRT: o vocabulário passa a ser imposto pelo banco
-- ---------------------------------------------------------------------
--
-- `branches.regime_tributario` é o CRT do emitente (campo `C21` do leiaute),
-- guardado como texto. Até aqui **nada** conferia o conteúdo: a coluna aceitava
-- `"9"`, `"simples"` ou string vazia, e o erro só apareceria na emissão —
-- `payloadValidation.ts` recusa com "Regime tributário do emitente (CRT)
-- inválido", ou, pior, o `Number.parseInt` de `invoiceMapping.ts` transformaria
-- lixo em `NaN` antes disso.
--
-- Os quatro valores são os mesmos que `REGIMES_TRIBUTARIOS_VALIDOS` já valida:
-- `1` Simples Nacional, `2` Simples Nacional com excesso de sublimite,
-- `3` Regime Normal, `4` Simples Nacional MEI (NT 2024.001). Nulo continua
-- válido — é "ainda não cadastrado", e o formulário de D1 avisa que a filial
-- não emite nota sem ele, sem impedir de salvar.
--
-- Conferido antes de escrever: a única filial existente tem `'3'`, então a
-- validação do constraint não trava nada neste banco.
--
-- Nota lateral registrada aqui porque foi encontrada nesta pesquisa e **não**
-- foi mexida: o catálogo de referência `regimes_tributarios` (módulo
-- `/regimes-tributarios`) tem só as chaves 1, 2 e 3 — falta o 4. Como aquele
-- catálogo é editável pela própria tela genérica, corrigi-lo é cadastro, não
-- migration. O formulário de filial não lê aquela tabela: ele usa o vocabulário
-- do validador, que é quem recusa a emissão.

alter table public.branches
  drop constraint if exists branches_regime_tributario_check;

alter table public.branches
  add constraint branches_regime_tributario_check
  check (regime_tributario is null or regime_tributario in ('1', '2', '3', '4'));

comment on column public.branches.regime_tributario is
  'CRT do emitente (campo C21): 1 = Simples Nacional, 2 = Simples Nacional com excesso de sublimite, 3 = Regime Normal, 4 = Simples Nacional MEI. Mesmo vocabulário de REGIMES_TRIBUTARIOS_VALIDOS em payloadValidation.ts — o CHECK entrou em D1 (09/09/2026) para o banco recusar o que a emissão recusaria depois. Nulo = ainda não cadastrado; a filial não emite nota nesse estado.';

-- ---------------------------------------------------------------------
-- O que esta migration deliberadamente NÃO faz
-- ---------------------------------------------------------------------
--
--   * **Não cria coluna de série de numeração fiscal.** A série é hoje a
--     constante `SERIE_SIMULADA = 1`, lida em `fiscal-emit/index.ts`. Torná-la
--     cadastrável exige editar aquele arquivo — e a sessão de D1 não podia
--     implantar `fiscal-emit`: o repositório passaria a dizer "série da filial"
--     enquanto a função em produção continuaria emitindo na série 1. Uma
--     divergência silenciosa entre repositório e produção é pior que a lacuna
--     documentada. Some-se a isso que `serie` faz parte da chave primária de
--     `fiscal_numbering` (A10): mudar a série de uma filial começa uma sequência
--     nova em zero, o que é decisão operacional, não campo de cadastro.
--   * **Não toca em `fiscal_numbering`, `fiscal_queue` nem na reserva de
--     A5-A10.**
--   * **Não muda regra de cálculo tributário.**
--   * **Não cria linha em `modules`.** Ver o item 1 do cabeçalho.
--   * **Não mexe em `role_permissions`.** O portão de `branches` é a flag
--     `can_manage_branches`, não uma linha de permissão por módulo — ligar os
--     dois é exatamente o que a tela própria de D1 existe para não precisar
--     fazer.
