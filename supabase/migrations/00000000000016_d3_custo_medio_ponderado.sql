-- D3 — Custo médio ponderado: nascem custo médio e custo de reposição
-- (10/09/2026)
--
-- **Esta migration foi escrita e NÃO foi aplicada**, pela mesma regra de D1 e
-- A11: a sessão que a escreveu não tinha autorização para aplicar migration.
--
-- ## O que existia antes
--
-- `products.cost_price` ("Preço custo") é a única coluna de custo hoje —
-- último custo pago, sobrescrito a cada compra quando o operador marca
-- "Atualizar o preço de custo dos produtos comprados no cadastro"
-- (`update_cost_price` no payload de `create_purchase`). Nenhuma outra RPC
-- toca `cost_price`. O único relatório de custo existente,
-- "Custo médio de compras" (`report_purchase_items_by_product_day`), é uma
-- média ponderada de `purchase_items.unit_cost` dentro de um período
-- filtrado — responde "quanto paguei em média nas compras deste período",
-- uma pergunta diferente de "qual o custo médio do que está em estoque
-- agora". Continua correto do jeito que está; esta migration não o toca.
--
-- ## Os três custos, e por que "custo de reposição" não é redundante
--
-- O plano deste sistema enumera três custos distintos:
--
--   1. `cost_price` — último custo pago (inalterado).
--   2. `average_cost` — custo médio ponderado do que está fisicamente no
--      estoque agora. É matemática sobre compras já realizadas, mantida
--      pelo próprio sistema — nunca opinião do operador.
--   3. `replacement_cost` — estimativa de quanto o operador acredita que vai
--      pagar na PRÓXIMA compra.
--
-- A leitura confirmada por pesquisa: este sistema não tem nenhuma fonte de
-- preço de fornecedor além do histórico de compras já realizadas (sem tabela
-- de preços, sem cotação, sem integração). Um "custo de reposição" que fosse
-- derivado automaticamente seria idêntico ao último custo pago — não seria um
-- terceiro conceito, seria o primeiro com outro nome. Por isso `average_cost`
-- é sempre calculado (nenhum formulário o grava — `module_fields.show_in_form
-- = false` abaixo) e `replacement_cost` é sempre digitado pelo operador: é
-- o único dos três que não tem como nascer de uma conta. Útil quando o
-- fornecedor já avisou um reajuste mas a compra ainda não aconteceu — nesse
-- momento `cost_price` ainda reflete o preço antigo, e `average_cost` reflete
-- o que já está fisicamente no estoque a preços antigos.

-- ---------------------------------------------------------------------
-- 1. As duas colunas novas
-- ---------------------------------------------------------------------
--
-- `numeric` sem precisão fixa, nullable — mesmo padrão de `cost_price` e
-- `wholesale_price` na mesma tabela.

alter table public.products
  add column if not exists average_cost numeric;

alter table public.products
  add column if not exists replacement_cost numeric;

comment on column public.products.average_cost is
  'Custo médio PONDERADO do que está fisicamente em estoque agora (D3, 10/09/2026) — um dos três custos deste sistema, junto com cost_price (último custo pago) e replacement_cost (estimativa digitada pelo operador). Recalculado por create_purchase a cada item de compra, SEMPRE, independente do checkbox update_cost_price: é fato contábil sobre o que entrou no estoque, não uma preferência de precificação. Nenhum formulário grava esta coluna (module_fields.show_in_form = false) — é somente leitura. adjust_stock_batch e as RPCs de venda/devolução/pedido/condicional NÃO tocam esta coluna (ver o corpo desta migration para o porquê de cada uma).';

comment on column public.products.replacement_cost is
  'Estimativa de custo para a PRÓXIMA compra, digitada pelo operador (D3, 10/09/2026) — não é calculada por nada neste sistema, ao contrário de average_cost. Existe porque este sistema não tem fonte de preço de fornecedor além do histórico de compras já realizadas (sem tabela de preços, sem cotação): um "custo de reposição" automático seria idêntico a cost_price, não um terceiro conceito. Útil quando o fornecedor já avisou reajuste mas a compra ainda não aconteceu.';

-- ---------------------------------------------------------------------
-- 2. Backfill dos produtos existentes
-- ---------------------------------------------------------------------
--
-- Única fonte defensável: `cost_price` no momento desta migration. Não há
-- como reconstruir retroativamente quanto de cada lote do estoque atual veio
-- de qual compra a preços diferentes — este sistema nunca teve contabilidade
-- de lote, e vendas já consumiram parte do estoque desde então. Reconstruir a
-- partir de `purchase_items` histórico teria que separar o que já foi vendido
-- do que ainda está em estoque, por produto, ao longo de toda a história de
-- compras — complexidade real para as 49 linhas de `products` que existem
-- hoje (48 delas já com `cost_price` e estoque positivo). `cost_price` é o
-- único dado de custo que sobrevive para o estoque já parado nas prateleiras,
-- e é exatamente a mesma leitura que create() do front vai aplicar daqui pra
-- frente em produto novo (ver productsRepository.ts).
--
-- `where average_cost is null` só para a migration poder rodar de novo sem
-- efeito (coluna nova, então hoje é sempre null, mas custa nada ser idempotente).

update public.products
  set average_cost = cost_price
  where average_cost is null;

-- ---------------------------------------------------------------------
-- 3. create_purchase: average_cost SEMPRE recalculado, cost_price como já era
-- ---------------------------------------------------------------------
--
-- Fórmula padrão de custo médio ponderado:
--
--   novo_medio = (estoque_antes * medio_antes + quantidade_comprada * unit_cost)
--                / (estoque_antes + quantidade_comprada)
--
-- `medio_antes` nulo (produto nunca teve média) vira 0 só dentro da conta —
-- não vira `unit_cost` por atribuição direta. A própria fórmula já resolve
-- isso sozinha quando `estoque_antes = 0`: o termo `estoque_antes *
-- medio_antes` some, e sobra `unit_cost`.
--
-- Guarda: se `estoque_antes + quantidade_comprada <= 0` (só possível com
-- estoque negativo habilitado — mesma cautela que A10 teve com numero/serie
-- antes do cast), não há proporção positiva para calcular uma média sobre.
-- O novo custo unitário vira a média, por ser o único fato disponível sobre o
-- que está fisicamente entrando no estoque.
--
-- Divergência DELIBERADA do campo irmão `cost_price` nesta mesma função:
-- `cost_price` só muda quando `update_cost_price` (payload) é true — decisão
-- comercial do operador ("essa compra foi uma exceção, não quero que vire o
-- novo preço de tabela"). `average_cost` muda sempre, porque é fato contábil
-- sobre o que fisicamente está no estoque — não pode ficar errado só porque o
-- operador não queria mexer no preço de venda.

CREATE OR REPLACE FUNCTION "public"."create_purchase"("payload" "jsonb") RETURNS "public"."purchases"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_branch_id uuid := (payload->>'branch_id')::uuid;
  v_contact_id uuid := (payload->>'contact_id')::uuid;
  v_contact_kind public.contact_kind;
  v_method public.sale_payment_method := (payload->>'payment_method')::public.sale_payment_method;
  v_method_label text;
  v_purchase public.purchases;
  v_item jsonb;
  v_product record;
  v_items_total numeric(14,2) := 0;
  v_code text;
  v_installment_count integer := coalesce((payload->>'installment_count')::int, 1);
  v_first_due_date date;
  v_interval_days integer := coalesce((payload->>'interval_days')::int, 30);
  v_issue_date date := coalesce((payload->>'issue_date')::date, current_date);
  v_entry_date date := coalesce((payload->>'entry_date')::date, current_date);
  v_update_cost boolean := coalesce((payload->>'update_cost_price')::boolean, true);
  v_qty numeric;
  v_unit_cost numeric;
  v_stock_before numeric;
  v_avg_before numeric;
  v_avg_after numeric;
begin
  if not has_permission('compras', 'create') then
    raise exception 'Sem permissão para criar compras.' using errcode = '42501';
  end if;
  if not has_branch_access(v_branch_id) then
    raise exception 'Sem acesso a esta filial.' using errcode = '42501';
  end if;
  if payload->'items' is null or jsonb_array_length(payload->'items') = 0 then
    raise exception 'A compra precisa de ao menos um item.';
  end if;

  select kind into v_contact_kind from public.contacts where id = v_contact_id;
  if v_contact_kind is null then
    raise exception 'Fornecedor não encontrado.';
  end if;
  if v_contact_kind <> 'fornecedores' then
    raise exception 'O contato selecionado não é um fornecedor.' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_branch_id::text || ':purchases'));

  select coalesce(max(code::int), 0) + 1 into v_code from public.purchases where branch_id = v_branch_id;
  v_code := lpad(v_code::text, 4, '0');

  insert into public.purchases (
    branch_id, code, status, contact_id, payment_method, installment_total,
    document, issue_date, entry_date, created_by
  ) values (
    v_branch_id, v_code, 'confirmed', v_contact_id, v_method,
    case when v_method in ('credito', 'boleto', 'outro') then greatest(v_installment_count, 1) else 1 end,
    nullif(payload->>'document', ''), v_issue_date, v_entry_date, auth.uid()
  ) returning * into v_purchase;

  for v_item in select * from jsonb_array_elements(payload->'items') loop
    select id, branch_id, stock, average_cost into v_product from public.products
    where id = (v_item->>'product_id')::uuid for update;

    if v_product.id is null then
      raise exception 'Produto não encontrado.';
    end if;
    if v_product.branch_id <> v_branch_id then
      raise exception 'Produto não pertence à filial da compra.';
    end if;

    v_qty := (v_item->>'quantity')::numeric;
    v_unit_cost := (v_item->>'unit_cost')::numeric;
    v_stock_before := v_product.stock;
    v_avg_before := coalesce(v_product.average_cost, 0);

    if v_stock_before + v_qty > 0 then
      v_avg_after := (v_stock_before * v_avg_before + v_qty * v_unit_cost) / (v_stock_before + v_qty);
    else
      v_avg_after := v_unit_cost;
    end if;

    insert into public.purchase_items (purchase_id, product_id, quantity, unit_cost, total_amount)
    values (
      v_purchase.id, v_product.id, v_qty, v_unit_cost, v_qty * v_unit_cost
    );

    update public.products
      set stock = stock + v_qty,
          cost_price = case when v_update_cost then v_unit_cost else cost_price end,
          average_cost = v_avg_after,
          updated_at = now()
      where id = v_product.id;

    v_items_total := v_items_total + v_qty * v_unit_cost;
  end loop;

  update public.purchases set subtotal_amount = v_items_total, total_amount = v_items_total, updated_at = now()
    where id = v_purchase.id returning * into v_purchase;

  v_method_label := case v_method
    when 'dinheiro' then 'Dinheiro'
    when 'debito' then 'Débito'
    when 'credito' then 'Crédito'
    when 'pix' then 'PIX'
    when 'boleto' then 'Boleto'
    else 'Outro'
  end;

  -- Mesma regra de create_sale, em sentido oposto (aqui o dinheiro sai):
  -- dinheiro/pix/débito já foi pago no ato (nasce baixado, parcela única,
  -- vencimento = emissão). Crédito/boleto/outro entram depois — parcelas,
  -- primeiro vencimento e intervalo vêm do formulário (nota real com prazo
  -- do fornecedor), não de uma convenção fixa como os 30 dias de create_sale.
  if v_method in ('dinheiro', 'pix', 'debito') then
    perform public.financial_entries_create_installments(
      v_branch_id, 'a_pagar', v_contact_id, v_purchase.total_amount,
      1, v_issue_date, 1, v_method_label, 'Compra ' || v_code,
      'compra', v_purchase.id, true, v_issue_date
    );
  else
    v_first_due_date := (payload->>'first_due_date')::date;
    if v_first_due_date is null then
      raise exception 'Informe o vencimento da primeira parcela.';
    end if;
    perform public.financial_entries_create_installments(
      v_branch_id, 'a_pagar', v_contact_id, v_purchase.total_amount,
      greatest(v_installment_count, 1), v_first_due_date, greatest(v_interval_days, 1),
      v_method_label, 'Compra ' || v_code,
      'compra', v_purchase.id, false, v_issue_date
    );
  end if;

  return v_purchase;
end;
$$;

ALTER FUNCTION "public"."create_purchase"("payload" "jsonb") OWNER TO "postgres";

-- ---------------------------------------------------------------------
-- 4. Os dois campos na tela de Produtos
-- ---------------------------------------------------------------------
--
-- `sort_order` 20/21, depois de `minimum_stock` (19) — o último campo hoje —
-- em vez de intercalados perto de `cost_price` (7), porque não há espaço
-- inteiro entre 7 e 8 (wholesale_price) sem renumerar campo existente, e
-- renumerar não traz benefício nenhum aqui (diferente do caso de B5, que
-- tinha lacunas de sobra entre alíquotas percentual/ad-rem).
--
-- `average_cost`: `show_in_form = false` — é calculado, não uma opinião para
-- o operador digitar; aparece só na ficha.
-- `replacement_cost`: `show_in_form = true`, mesmo formato de `cost_price`
-- (texto livre, validado como número em `validateProductFormValues`).

insert into public.module_fields
  (module_id, field_key, label, data_type, is_required, sort_order, show_in_table, show_in_details, show_in_form, hint)
values
  ('produtos', 'average_cost', 'Custo médio (ponderado)', 'text', false, 20, false, true, false,
   'Calculado automaticamente pelo sistema a cada compra (média ponderada do que entra no estoque). Não é editável.'),
  ('produtos', 'replacement_cost', 'Custo de reposição', 'text', false, 21, false, true, true,
   'Estimativa de quanto você acredita que vai pagar na próxima compra deste produto — não é calculada pelo sistema, é o que você digitar aqui.')
on conflict (module_id, field_key) do nothing;

-- ---------------------------------------------------------------------
-- O que esta migration deliberadamente NÃO faz
-- ---------------------------------------------------------------------
--
--   * **Não toca `adjust_stock_batch` nem `stock_adjustments`.** Um ajuste de
--     contagem/correção de estoque não é evento de compra e não carrega
--     informação de custo (a tabela não tem nenhuma coluna de custo) — não há
--     dado para recalcular `average_cost` com, e inventar um (ex.: "usa o
--     average_cost atual") não moveria a média para lugar nenhum, só criaria
--     a ilusão de que o ajuste tem opinião sobre custo, que não tem.
--   * **Não toca nenhuma RPC de venda, devolução, pedido ou condicional**
--     (`create_sale`, `create_pos_sale`, `create_sale_return`,
--     `register_conditional_return`, `convert_conditional_to_sale`,
--     `convert_sale_order_to_sale`). Consumir estoque não muda a média do que
--     sobra — é assim que custo médio ponderado funciona: a média só se move
--     quando entra material novo a um preço diferente, nunca quando sai.
--   * **Não cria relatório de margem.** O plano fala dessa obrigação
--     condicional a um relatório de margem existir — hoje não existe nenhum
--     (conferido em `src/features/reports/reports.ts`, 11 relatórios
--     cadastrados, nenhum cruza custo × venda), e inventar um está fora do
--     que D3 pede. Fica para quando um relatório de margem for pedido de
--     verdade.
--   * **Não mexe na RLS de `products`.** As duas colunas novas são metadado
--     do mesmo produto (não segredo), e a policy existente
--     (`has_permission('produtos', ...)` + `has_branch_access`) já é a certa
--     para elas.
--   * **Não resolve "editar `cost_price`/`stock` direto no cadastro deixa
--     `average_cost` sem sincronizar".** Isso já é um comportamento aceito
--     hoje neste sistema — Produtos não é ledger, é cadastro, e uma correção
--     manual (ex.: contagem de inventário corrigindo o saldo) nunca precisou
--     "avisar" nenhum outro campo. `average_cost` segue a mesma categoria: é
--     mantido por `create_purchase` e, na criação de um produto novo, pelo
--     front (ver `productsRepository.ts`) — uma edição manual posterior de
--     `cost_price` ou `stock` não recalcula `average_cost` sozinha, e não é
--     esperado que recalcule. Não é um problema novo que D3 introduz.
