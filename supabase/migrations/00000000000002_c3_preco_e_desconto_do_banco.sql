-- C3 — tirar do cliente toda decisão que vale dinheiro (29/08/2026)
--
-- Duas lacunas achadas na auditoria desta tarefa, lendo o catálogo de
-- funções direto do banco (o SQL não estava versionado até este momento):
--
-- 1) `create_sale`, `create_sale_order`, `update_sale_order` e
--    `create_conditional` gravavam o `unit_price` que veio no payload —
--    nenhuma lia `products.sale_price`. Uma venda com `unit_price: 0.01`
--    passava por toda a validação, porque o total conferido contra os
--    pagamentos era calculado a partir do mesmo preço forjado. Corrigido
--    lendo o preço sempre do produto, com `for update`/lock já existente.
--    `convert_sale_order_to_sale` e `convert_conditional_to_sale` não
--    precisaram de mudança: a primeira só repassa `sale_order_items` (que
--    passa a nascer com preço correto) para `create_sale`; a segunda copia
--    `conditional_items.unit_price` (idem, agora correto na origem).
--
-- 2) Não existia teto de desconto por perfil — nasce `roles.max_discount_percent`
--    (NULL = sem teto, para não travar papel nenhum até ser configurado em
--    /permissoes) e a função `assert_discount_within_cap`, chamada por toda
--    função que decide preço de venda.
--
-- Um terceiro achado, adjacente: `financial_entries_before_write` só reage a
-- INSERT/UPDATE — não existe trigger de DELETE nenhum, e o UPDATE só bloqueia
-- edição de `total` quando o lançamento já está `baixado`. Uma parcela
-- `aberto` gerada por venda podia ter o valor editado ou a linha inteira
-- apagada direto por PostgREST, sem passar pela operação de origem.

-- ---------------------------------------------------------------------
-- 1. Teto de desconto por papel
-- ---------------------------------------------------------------------

alter table public.roles
  add column if not exists max_discount_percent numeric(5,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'roles_max_discount_percent_range'
  ) then
    alter table public.roles
      add constraint roles_max_discount_percent_range
      check (max_discount_percent is null or (max_discount_percent >= 0 and max_discount_percent <= 100));
  end if;
end $$;

comment on column public.roles.max_discount_percent is
  'Teto de desconto (%) que o papel pode aplicar numa venda/pedido — soma do desconto por item mais o desconto de cabeçalho, sobre o valor bruto (quantidade × preço de tabela). NULL = sem teto. Ver assert_discount_within_cap.';

create or replace function public.current_role_max_discount_percent()
returns numeric
language sql stable security definer
set search_path to 'public'
as $function$
  select r.max_discount_percent
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = auth.uid() and p.active = true
$function$;

revoke all on function public.current_role_max_discount_percent() from public, anon, authenticated;

create or replace function public.assert_discount_within_cap(p_gross numeric, p_discount numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cap numeric := public.current_role_max_discount_percent();
  v_percent numeric;
begin
  if v_cap is null or p_gross <= 0 or p_discount <= 0 then
    return;
  end if;

  v_percent := (p_discount / p_gross) * 100;

  -- 0.01 de tolerância só para arredondamento de centavos não travar um
  -- desconto que bate exatamente no teto.
  if v_percent > v_cap + 0.01 then
    raise exception 'Desconto de % acima do limite do seu perfil (%).',
      round(v_percent, 2)::text || '%', v_cap::text || '%'
      using errcode = '42501';
  end if;
end;
$function$;

revoke all on function public.assert_discount_within_cap(numeric, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Preço vem sempre do cadastro do produto
-- ---------------------------------------------------------------------

create or replace function public.create_sale(payload jsonb)
 RETURNS sales
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_branch_id uuid := (payload->>'branch_id')::uuid;
  v_sale public.sales;
  v_item jsonb;
  v_payment jsonb;
  v_payment_row public.sale_payments;
  v_items_total numeric(14,2) := 0;
  v_payments_total numeric(14,2) := 0;
  v_code text;
  v_product record;
  v_method public.sale_payment_method;
  v_method_label text;
  v_new_stock numeric;
  v_quantity numeric(14,3);
  v_unit_price numeric(14,2);
  v_item_discount numeric(14,2);
  v_gross_total numeric(14,2) := 0;
  v_discount_total numeric(14,2) := 0;
  -- Nulo quando o chamador não informou: o vencimento cai no padrão de 30 dias
  -- logo abaixo, na própria chamada do núcleo de parcelamento.
  v_first_due_date date := (payload->>'first_due_date')::date;
  -- `nullif(..., 0)` cobre um payload que mande 0 por engano; o núcleo já
  -- recusa intervalo negativo com mensagem própria.
  v_interval_days integer := coalesce(nullif((payload->>'interval_days')::int, 0), 30);
begin
  if not has_permission('realizar-venda', 'create') then
    raise exception 'Sem permissão para criar vendas.' using errcode = '42501';
  end if;
  if not has_branch_access(v_branch_id) then
    raise exception 'Sem acesso a esta filial.' using errcode = '42501';
  end if;
  if jsonb_array_length(payload->'items') = 0 then
    raise exception 'A venda precisa de ao menos um item.';
  end if;
  if jsonb_array_length(payload->'payments') = 0 then
    raise exception 'A venda precisa de ao menos uma forma de pagamento.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_branch_id::text || ':sales'));

  select coalesce(max(code::int), 0) + 1 into v_code from public.sales where branch_id = v_branch_id;
  v_code := lpad(v_code::text, 4, '0');

  insert into public.sales (
    branch_id, code, status, contact_id, seller_id, address, delivery_address,
    operation_type, department, cost_center, issue_date, exit_date,
    freight_amount, discount_amount, created_by, confirmed_at
  ) values (
    v_branch_id, v_code, 'confirmed',
    (payload->>'contact_id')::uuid, (payload->>'seller_id')::uuid,
    payload->>'address', payload->>'delivery_address',
    payload->>'operation_type', payload->>'department', payload->>'cost_center',
    coalesce((payload->>'issue_date')::date, current_date), (payload->>'exit_date')::date,
    coalesce((payload->>'freight_amount')::numeric, 0), coalesce((payload->>'discount_amount')::numeric, 0),
    auth.uid(), now()
  ) returning * into v_sale;

  for v_item in select * from jsonb_array_elements(payload->'items') loop
    select id, stock, branch_id, sale_price into v_product from public.products
    where id = (v_item->>'product_id')::uuid for update;

    if v_product.id is null then raise exception 'Produto não encontrado.'; end if;
    if v_product.branch_id <> v_branch_id then raise exception 'Produto não pertence à filial da venda.'; end if;

    v_quantity := (v_item->>'quantity')::numeric;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Quantidade inválida em um dos itens.';
    end if;

    -- Preço vem sempre do cadastro do produto, nunca do que o cliente
    -- mandar — o payload podia trazer qualquer unit_price e a venda passava
    -- pela validação porque o total conferido era calculado a partir dele
    -- mesmo (tarefa C3, 29/08/2026).
    v_unit_price := v_product.sale_price;
    v_item_discount := greatest(0, coalesce((v_item->>'discount_amount')::numeric, 0));
    if v_item_discount > v_quantity * v_unit_price then
      raise exception 'Desconto do item maior que o valor do item.';
    end if;

    v_new_stock := v_product.stock - v_quantity;
    if v_new_stock < 0 and not coalesce(stock_allows_negative(v_branch_id, v_product.id), false) then
      raise exception 'Estoque insuficiente para o produto %.', v_product.id;
    end if;

    insert into public.sale_items (sale_id, product_id, quantity, unit_price, discount_amount, total_amount)
    values (
      v_sale.id, v_product.id, v_quantity, v_unit_price, v_item_discount,
      v_quantity * v_unit_price - v_item_discount
    );

    update public.products set stock = v_new_stock, updated_at = now() where id = v_product.id;

    v_gross_total := v_gross_total + v_quantity * v_unit_price;
    v_discount_total := v_discount_total + v_item_discount;
    v_items_total := v_items_total + v_quantity * v_unit_price - v_item_discount;
  end loop;

  perform public.assert_discount_within_cap(v_gross_total, v_discount_total + v_sale.discount_amount);

  for v_payment in select * from jsonb_array_elements(payload->'payments') loop
    v_method := (v_payment->>'method')::public.sale_payment_method;
    v_method_label := case v_method
      when 'dinheiro' then 'Dinheiro'
      when 'debito' then 'Débito'
      when 'credito' then 'Crédito'
      when 'pix' then 'PIX'
      when 'boleto' then 'Boleto'
      else 'Outro'
    end;

    insert into public.sale_payments (sale_id, method, amount, installments)
    values (v_sale.id, v_method, (v_payment->>'amount')::numeric,
            coalesce((v_payment->>'installments')::int, 1))
    returning * into v_payment_row;

    v_payments_total := v_payments_total + v_payment_row.amount;

    if v_method in ('dinheiro', 'pix', 'debito') then
      perform public.financial_entries_create_installments(
        v_branch_id, 'a_receber', v_sale.contact_id, v_payment_row.amount,
        1, v_sale.issue_date, 30, v_method_label, 'Venda ' || v_code,
        'venda', v_sale.id, true, v_sale.issue_date
      );
    elsif v_method in ('credito', 'boleto') then
      perform public.financial_entries_create_installments(
        v_branch_id, 'a_receber', v_sale.contact_id, v_payment_row.amount,
        coalesce(v_payment_row.installments, 1),
        coalesce(v_first_due_date, v_sale.issue_date + 30), v_interval_days,
        v_method_label, 'Venda ' || v_code,
        'venda', v_sale.id, false, v_sale.issue_date
      );
    else
      perform public.financial_entries_create_installments(
        v_branch_id, 'a_receber', v_sale.contact_id, v_payment_row.amount,
        1, v_sale.issue_date + 30, 30,
        v_method_label, 'Venda ' || v_code,
        'venda', v_sale.id, false, v_sale.issue_date
      );
    end if;
  end loop;

  if round(v_payments_total, 2) <> round(v_items_total + v_sale.freight_amount - v_sale.discount_amount, 2) then
    raise exception 'A soma dos pagamentos (%) não bate com o total da venda (%).',
      v_payments_total, v_items_total + v_sale.freight_amount - v_sale.discount_amount;
  end if;

  update public.sales set subtotal_amount = v_items_total, total_amount = v_items_total + freight_amount - discount_amount,
    updated_at = now() where id = v_sale.id returning * into v_sale;

  return v_sale;
end;
$function$;

create or replace function public.create_sale_order(payload jsonb)
 RETURNS sale_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_branch_id uuid := (payload->>'branch_id')::uuid;
  v_order public.sale_orders;
  v_item jsonb;
  v_items_total numeric(14,2) := 0;
  v_code text;
  v_product record;
  v_quantity numeric(14,3);
  v_unit_price numeric(14,2);
  v_item_discount numeric(14,2);
  v_gross_total numeric(14,2) := 0;
  v_discount_total numeric(14,2) := 0;
begin
  if not has_permission('pedidos-venda', 'create') then
    raise exception 'Sem permissão para criar pedidos de venda.' using errcode = '42501';
  end if;
  if not has_branch_access(v_branch_id) then
    raise exception 'Sem acesso a esta filial.' using errcode = '42501';
  end if;
  if payload->'items' is null or jsonb_array_length(payload->'items') = 0 then
    raise exception 'O pedido precisa de ao menos um item.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_branch_id::text || ':sale_orders'));

  select coalesce(max(code::int), 0) + 1 into v_code from public.sale_orders where branch_id = v_branch_id;
  v_code := lpad(v_code::text, 4, '0');

  insert into public.sale_orders (
    branch_id, code, status, contact_id, seller_id, payment_method, installments,
    address, delivery_address, operation_type, department, cost_center,
    issue_date, freight_amount, discount_amount, created_by
  ) values (
    v_branch_id, v_code, 'aberto',
    (payload->>'contact_id')::uuid, (payload->>'seller_id')::uuid,
    (payload->>'payment_method')::public.sale_payment_method, coalesce((payload->>'installments')::int, 1),
    payload->>'address', payload->>'delivery_address',
    payload->>'operation_type', payload->>'department', payload->>'cost_center',
    coalesce((payload->>'issue_date')::date, current_date),
    coalesce((payload->>'freight_amount')::numeric, 0), coalesce((payload->>'discount_amount')::numeric, 0),
    auth.uid()
  ) returning * into v_order;

  for v_item in select * from jsonb_array_elements(payload->'items') loop
    select id, branch_id, sale_price into v_product from public.products
    where id = (v_item->>'product_id')::uuid;

    if v_product.id is null then
      raise exception 'Produto não encontrado.';
    end if;
    if v_product.branch_id <> v_branch_id then
      raise exception 'Produto não pertence à filial do pedido.';
    end if;

    v_quantity := (v_item->>'quantity')::numeric;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Quantidade inválida em um dos itens.';
    end if;

    v_unit_price := v_product.sale_price;
    v_item_discount := greatest(0, coalesce((v_item->>'discount_amount')::numeric, 0));
    if v_item_discount > v_quantity * v_unit_price then
      raise exception 'Desconto do item maior que o valor do item.';
    end if;

    insert into public.sale_order_items (sale_order_id, product_id, quantity, unit_price, discount_amount, total_amount)
    values (v_order.id, v_product.id, v_quantity, v_unit_price, v_item_discount, v_quantity * v_unit_price - v_item_discount);

    v_gross_total := v_gross_total + v_quantity * v_unit_price;
    v_discount_total := v_discount_total + v_item_discount;
    v_items_total := v_items_total + v_quantity * v_unit_price - v_item_discount;
  end loop;

  perform public.assert_discount_within_cap(v_gross_total, v_discount_total + v_order.discount_amount);

  update public.sale_orders set
    subtotal_amount = v_items_total,
    total_amount = v_items_total + freight_amount - discount_amount,
    updated_at = now()
  where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$function$;

create or replace function public.update_sale_order(p_id uuid, payload jsonb)
 RETURNS sale_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order public.sale_orders;
  v_item jsonb;
  v_items_total numeric(14,2) := 0;
  v_product record;
  v_quantity numeric(14,3);
  v_unit_price numeric(14,2);
  v_item_discount numeric(14,2);
  v_gross_total numeric(14,2) := 0;
  v_discount_total numeric(14,2) := 0;
begin
  select * into v_order from public.sale_orders where id = p_id for update;

  if not found then
    raise exception 'Pedido não encontrado.';
  end if;

  -- `coalesce` por fora é obrigatório: `has_permission` devolve NULL (não
  -- false) quando não há perfil correspondente, e `not NULL` faria o IF não
  -- executar — a checagem falharia aberto. Ver AGENTS.md, item 3 do roteiro.
  if not coalesce(has_permission('pedidos-venda', 'edit'), false) then
    raise exception 'Sem permissão para editar pedidos de venda.' using errcode = '42501';
  end if;
  if not coalesce(has_branch_access(v_order.branch_id), false) then
    raise exception 'Sem acesso a esta filial.' using errcode = '42501';
  end if;
  if v_order.status <> 'aberto' then
    raise exception 'Só é possível editar pedido em aberto.';
  end if;
  if payload->'items' is null or jsonb_array_length(payload->'items') = 0 then
    raise exception 'O pedido precisa de ao menos um item.';
  end if;

  update public.sale_orders set
    contact_id = (payload->>'contact_id')::uuid,
    seller_id = (payload->>'seller_id')::uuid,
    payment_method = (payload->>'payment_method')::public.sale_payment_method,
    installments = coalesce((payload->>'installments')::int, 1),
    address = payload->>'address',
    delivery_address = payload->>'delivery_address',
    operation_type = payload->>'operation_type',
    department = payload->>'department',
    cost_center = payload->>'cost_center',
    issue_date = coalesce((payload->>'issue_date')::date, v_order.issue_date),
    freight_amount = coalesce((payload->>'freight_amount')::numeric, 0),
    discount_amount = coalesce((payload->>'discount_amount')::numeric, 0),
    updated_at = now()
  where id = p_id
  returning * into v_order;

  delete from public.sale_order_items where sale_order_id = p_id;

  for v_item in select * from jsonb_array_elements(payload->'items') loop
    select id, branch_id, sale_price into v_product from public.products
    where id = (v_item->>'product_id')::uuid;

    if v_product.id is null then
      raise exception 'Produto não encontrado.';
    end if;
    if v_product.branch_id <> v_order.branch_id then
      raise exception 'Produto não pertence à filial do pedido.';
    end if;

    v_quantity := (v_item->>'quantity')::numeric;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Quantidade inválida em um dos itens.';
    end if;

    v_unit_price := v_product.sale_price;
    v_item_discount := greatest(0, coalesce((v_item->>'discount_amount')::numeric, 0));
    if v_item_discount > v_quantity * v_unit_price then
      raise exception 'Desconto do item maior que o valor do item.';
    end if;

    insert into public.sale_order_items (sale_order_id, product_id, quantity, unit_price, discount_amount, total_amount)
    values (v_order.id, v_product.id, v_quantity, v_unit_price, v_item_discount, v_quantity * v_unit_price - v_item_discount);

    v_gross_total := v_gross_total + v_quantity * v_unit_price;
    v_discount_total := v_discount_total + v_item_discount;
    v_items_total := v_items_total + v_quantity * v_unit_price - v_item_discount;
  end loop;

  perform public.assert_discount_within_cap(v_gross_total, v_discount_total + v_order.discount_amount);

  update public.sale_orders set
    subtotal_amount = v_items_total,
    total_amount = v_items_total + freight_amount - discount_amount,
    updated_at = now()
  where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$function$;

create or replace function public.create_conditional(payload jsonb)
 RETURNS conditionals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_branch_id uuid := (payload->>'branch_id')::uuid;
  v_contact_id uuid := (payload->>'contact_id')::uuid;
  v_due_date date := (payload->>'due_date')::date;
  v_issue_date date := coalesce((payload->>'issue_date')::date, current_date);
  v_conditional public.conditionals;
  v_item jsonb;
  v_product record;
  v_quantity numeric(14,3);
  v_unit_price numeric(14,2);
  v_line_total numeric(14,2);
  v_items_total numeric(14,2) := 0;
  v_code text;
  v_new_stock numeric;
begin
  if not has_permission('condicionais', 'create') then
    raise exception 'Sem permissão para criar condicionais.' using errcode = '42501';
  end if;
  if not has_branch_access(v_branch_id) then
    raise exception 'Sem acesso a esta filial.' using errcode = '42501';
  end if;
  if payload->'items' is null or jsonb_array_length(payload->'items') = 0 then
    raise exception 'A condicional precisa de ao menos um item.';
  end if;
  if v_due_date is null then
    raise exception 'Informe o prazo de devolução.';
  end if;
  if not exists (select 1 from public.contacts where id = v_contact_id and kind = 'clientes') then
    raise exception 'O cliente da condicional precisa ser um cliente cadastrado.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_branch_id::text || ':conditionals'));

  select coalesce(max(code::int), 0) + 1 into v_code from public.conditionals where branch_id = v_branch_id;
  v_code := lpad(v_code::text, 4, '0');

  insert into public.conditionals (branch_id, contact_id, code, status, issue_date, due_date, created_by)
  values (v_branch_id, v_contact_id, v_code, 'confirmed', v_issue_date, v_due_date, auth.uid())
  returning * into v_conditional;

  for v_item in select * from jsonb_array_elements(payload->'items') loop
    v_quantity := (v_item->>'quantity')::numeric;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Quantidade inválida em um dos itens.';
    end if;

    select id, stock, branch_id, sale_price into v_product from public.products
      where id = (v_item->>'product_id')::uuid for update;

    if v_product.id is null then raise exception 'Produto não encontrado.'; end if;
    if v_product.branch_id <> v_branch_id then raise exception 'Produto não pertence à filial da condicional.'; end if;

    -- Preço vem sempre do cadastro — mesma correção de create_sale (C3).
    v_unit_price := v_product.sale_price;

    v_new_stock := v_product.stock - v_quantity;
    if v_new_stock < 0 and not coalesce(stock_allows_negative(v_branch_id, v_product.id), false) then
      raise exception 'Estoque insuficiente para o produto %.', v_product.id;
    end if;

    v_line_total := round(v_quantity * v_unit_price, 2);

    insert into public.conditional_items (conditional_id, product_id, quantity, unit_price, total_amount)
    values (v_conditional.id, v_product.id, v_quantity, v_unit_price, v_line_total);

    -- O estoque sai agora, na criação — é o momento em que a peça sai
    -- fisicamente da loja, diferente de Pedidos de venda (que só reserva
    -- no papel). Ver AGENTS.md.
    update public.products set stock = v_new_stock, updated_at = now() where id = v_product.id;

    v_items_total := v_items_total + v_line_total;
  end loop;

  update public.conditionals set total_amount = v_items_total, updated_at = now()
    where id = v_conditional.id returning * into v_conditional;

  return v_conditional;
end;
$function$;

-- ---------------------------------------------------------------------
-- 3. financial_entries: valor de parcela não-manual não muda por fora, e
--    não existe DELETE sem trigger de guarda nenhum.
-- ---------------------------------------------------------------------

create or replace function public.financial_entries_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_kind public.contact_kind;
  v_next integer;
begin
  if tg_op = 'INSERT' then
    if new.code is null or btrim(new.code) = '' then
      perform pg_advisory_xact_lock(hashtext('financial_entries:' || new.branch_id::text));
      select coalesce(max(code::integer), 0) + 1
        into v_next
        from public.financial_entries
       where branch_id = new.branch_id and code ~ '^[0-9]+$';
      new.code := lpad(v_next::text, 3, '0');
    end if;
  else
    -- Estrutura da parcela nasce na função de parcelamento, não é editável
    -- depois — senão uma edição solta desalinharia a soma do grupo, ou uma
    -- parcela "trocaria de venda" silenciosamente.
    if new.type <> old.type then
      raise exception 'O tipo do lançamento (a pagar/a receber) não pode ser alterado.' using errcode = '22023';
    end if;
    if new.installment_group_id <> old.installment_group_id then
      raise exception 'O grupo de parcelas não pode ser alterado.' using errcode = '22023';
    end if;
    if new.installment_number <> old.installment_number or new.installment_total <> old.installment_total then
      raise exception 'A numeração de parcelas não pode ser alterada diretamente.' using errcode = '22023';
    end if;
    if new.origin_kind <> old.origin_kind or new.origin_id is distinct from old.origin_id then
      raise exception 'A origem do lançamento não pode ser alterada.' using errcode = '22023';
    end if;

    -- Valor de uma parcela gerada por venda/compra/devolução/condicional
    -- nasce da operação de origem, não de uma edição solta — mesmo com o
    -- lançamento ainda `aberto`. Editar aqui e a venda que gerou a parcela
    -- ficariam contando histórias diferentes do mesmo dinheiro (tarefa C3,
    -- 29/08/2026). Só `origin_kind = 'manual'` pode ter o total editado.
    if new.origin_kind <> 'manual' and new.total <> old.total then
      raise exception 'O valor de um lançamento gerado por venda/compra/devolução não pode ser editado diretamente — ele nasce da operação de origem.' using errcode = '22023';
    end if;

    -- Baixado só aceita a transição de volta pra aberto ("Excluir baixa");
    -- qualquer outra edição de conteúdo é bloqueada — o caminho pra
    -- corrigir um baixado é excluir a baixa e editar depois.
    if old.status = 'baixado' and new.status = 'baixado' and (
      new.contact_id is distinct from old.contact_id or
      new.payment_method is distinct from old.payment_method or
      new.total <> old.total or
      coalesce(new.document, '') <> coalesce(old.document, '') or
      new.due_date <> old.due_date or
      new.issue_date <> old.issue_date
    ) then
      raise exception 'Um lançamento baixado não pode ser editado — exclua a baixa primeiro.' using errcode = '22023';
    end if;

    new.updated_at := now();
  end if;

  if new.contact_id is not null then
    select kind into v_kind from public.contacts where id = new.contact_id;
    if v_kind is null then
      raise exception 'Contato não encontrado.' using errcode = '23503';
    end if;
    -- Exceção deliberada: um `a_pagar` de devolução de venda referencia o
    -- cliente que devolveu — é ele quem tem o dinheiro a receber da loja.
    if new.type = 'a_pagar' and v_kind <> 'fornecedores' and new.origin_kind <> 'devolucao' then
      raise exception 'Uma conta a pagar só pode referenciar um fornecedor.' using errcode = '23514';
    end if;
    if new.type = 'a_pagar' and new.origin_kind = 'devolucao' and v_kind <> 'clientes' then
      raise exception 'Uma devolução de venda só pode referenciar um cliente.' using errcode = '23514';
    end if;
    if new.type = 'a_receber' and v_kind <> 'clientes' then
      raise exception 'Uma conta a receber só pode referenciar um cliente.' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.financial_entries_before_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Mesmo raciocínio do valor no UPDATE: uma parcela nascida de
  -- venda/compra/devolução/condicional não desaparece por um DELETE avulso
  -- — ela só sai se a operação de origem for desfeita. Sem este trigger, a
  -- policy de DELETE (has_permission('financeiro','delete')) era a única
  -- fronteira, e ela não sabe nada sobre origem.
  if old.origin_kind <> 'manual' then
    raise exception 'Um lançamento gerado por venda/compra/devolução não pode ser excluído diretamente — ele só desaparece se a operação de origem for desfeita.' using errcode = '22023';
  end if;
  return old;
end;
$function$;

drop trigger if exists financial_entries_before_delete on public.financial_entries;
create trigger financial_entries_before_delete
  before delete on public.financial_entries
  for each row execute function public.financial_entries_before_delete();
