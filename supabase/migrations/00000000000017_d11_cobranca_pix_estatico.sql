-- D11 — Cobrança por PIX estático: chave na filial, CHECK em
-- financial_entries.payment_method (10/09/2026)
--
-- **Esta migration foi escrita e NÃO foi aplicada.** Mesma regra de D1/A11:
-- a sessão que a escreveu não tinha autorização para aplicar migration. O
-- front foi construído para funcionar nos dois estados do banco (com e sem
-- `branches.pix_key`) — ver o grupo `pix` em `GRUPOS_OPCIONAIS`,
-- `branchesRepository.ts`, que sonda a coluna do mesmo jeito que D1/A11.

-- ---------------------------------------------------------------------
-- 1. `branches.pix_key`
-- ---------------------------------------------------------------------
--
-- Mesma categoria de metadado que `email_copia_nota_fiscal` (D1) e as
-- colunas de certificado (A11): texto simples, anulável, sem mudança de RLS
-- — a policy `read accessible branches` já libera a leitura pra quem tem
-- acesso à filial, e uma chave PIX é um dado que a própria filial divulga
-- para receber (não é segredo — é o oposto: existe pra ser mostrada num QR
-- Code pro cliente escanear).
--
-- **Sem CHECK de formato, de propósito.** Uma chave PIX é CPF, CNPJ, e-mail,
-- telefone (formato +55DDDNNNNNNNNN) ou uma chave aleatória (UUID) — quatro
-- formatos bem diferentes entre si. Um CHECK que tentasse reconhecer qual dos
-- quatro está sendo cadastrado teria a mesma armadilha que motivou D1 a não
-- travar e-mail com regex estrita: recusar uma chave válida por um regex
-- errado é pior que aceitar uma malformada, que só vai falhar quando alguém
-- tentar escanear o QR Code gerado a partir dela — nesse momento o erro é
-- visível e imediato para quem cadastrou (o pagador não escaneia sozinho, o
-- operador testa o QR na hora). A mesma decisão está documentada no
-- formulário (`branches.ts`/`BranchFormModal.tsx`).

alter table public.branches
  add column if not exists pix_key text;

comment on column public.branches.pix_key is
  'Chave PIX da filial (D11, 10/09/2026) — CPF, CNPJ, e-mail, telefone ou chave aleatória, sem validação de formato (ver a decisão no cabeçalho desta migration e em branches.ts). Usada para montar o BR Code (Pix Copia e Cola) estático em Financeiro > "Cobrar via PIX". NULL = filial ainda não cadastrou uma chave, e a ação de cobrança fica indisponível para ela.';

-- ---------------------------------------------------------------------
-- 2. `financial_entries.payment_method` deixa de ser texto solto
-- ---------------------------------------------------------------------
--
-- A coluna é `text` livre desde a linha de base. Hoje ela é escrita de dois
-- jeitos: as RPCs de venda/compra/devolução gravam um rótulo fixo
-- (`v_method_label`, calculado a partir do enum `sale_payment_method`:
-- 'Dinheiro'/'Débito'/'Crédito'/'PIX'/'Boleto'/'Outro' — ou NULL na
-- devolução quando a venda teve mais de uma forma de pagamento, caso em que
-- não há resposta única para copiar); e o lançamento manual do Financeiro
-- (`FinanceEntryPlanModal.tsx`) até aqui aceitava QUALQUER texto digitado.
--
-- **Por que um CHECK e não migrar a coluna para o tipo do enum.** Os dados já
-- gravados (e as três RPCs que os escrevem: `create_sale`, `create_purchase`,
-- `financial_entries_create_installments`/o `case` de devolução em
-- `create_sale_return`) usam os RÓTULOS capitalizados ('PIX', 'Dinheiro'...),
-- não os valores crus do enum ('pix', 'dinheiro'...). Trocar o tipo da coluna
-- para `sale_payment_method` exigiria reconciliar toda gravação existente E
-- as próprias RPCs, que teriam de parar de calcular `v_method_label` e passar
-- a gravar o enum cru — uma mudança bem maior, para o mesmo ganho prático que
-- um CHECK já entrega: impedir texto arbitrário. Conferido ao vivo antes de
-- escrever este CHECK (`select distinct payment_method from
-- financial_entries`, 10/09/2026): os 14 lançamentos existentes, incluindo os
-- 4 manuais, já usam só os 6 rótulos abaixo — a migration não precisa de
-- passo de limpeza de dados.
--
-- NULL continua permitido (devolução de venda com pagamento misto grava
-- NULL de propósito — ver `create_sale_return` na linha de base).

alter table public.financial_entries
  add constraint financial_entries_payment_method_check
  check (payment_method is null or payment_method in ('Dinheiro', 'Débito', 'Crédito', 'PIX', 'Boleto', 'Outro'));

-- ---------------------------------------------------------------------
-- O que esta migration deliberadamente NÃO faz
-- ---------------------------------------------------------------------
--
--   * Não migra `payment_method` para o tipo do enum `sale_payment_method` —
--     ver a justificativa acima.
--   * Não cria coluna de status/confirmação de pagamento PIX. "PIX estático"
--     é auto-contido: o BR Code é calculado inteiro no cliente a partir da
--     chave, sem provedor no meio. Saber se o cliente pagou continua sendo o
--     operador clicando "Baixar" manualmente — construir confirmação
--     automática exigiria uma conta de PSP de verdade (mesmo motivo de A8/A12
--     não terem conta Focus real ainda).
--   * Não mexe em `fiscal_documents`, `fiscal_document_items` nem em qualquer
--     tabela do núcleo fiscal — `payment_method` não é campo tributário, e
--     nenhum payload de nota fiscal lê `financial_entries.payment_method`
--     (conferido: `NfePayload` e o mapeamento em
--     `supabase/functions/_shared/fiscal/invoiceMapping.ts` não referenciam
--     esta tabela em nenhum ponto).
--   * Não mexe na RLS de `branches` nem de `financial_entries` — `pix_key` é
--     metadado público da filial (mesmo argumento de D1/A11), e o CHECK novo
--     não muda quem lê ou escreve, só o que pode ser escrito.
