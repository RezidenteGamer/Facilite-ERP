


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "unaccent" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."cash_movement_type" AS ENUM (
    'sangria',
    'suprimento'
);


ALTER TYPE "public"."cash_movement_type" OWNER TO "postgres";


CREATE TYPE "public"."cash_session_status" AS ENUM (
    'aberto',
    'fechado'
);


ALTER TYPE "public"."cash_session_status" OWNER TO "postgres";


CREATE TYPE "public"."conditional_status" AS ENUM (
    'confirmed',
    'cancelled'
);


ALTER TYPE "public"."conditional_status" OWNER TO "postgres";


CREATE TYPE "public"."contact_kind" AS ENUM (
    'clientes',
    'fornecedores'
);


ALTER TYPE "public"."contact_kind" OWNER TO "postgres";


CREATE TYPE "public"."financial_entry_origin_kind" AS ENUM (
    'manual',
    'venda',
    'compra',
    'devolucao'
);


ALTER TYPE "public"."financial_entry_origin_kind" OWNER TO "postgres";


CREATE TYPE "public"."financial_entry_status" AS ENUM (
    'aberto',
    'baixado',
    'cancelado'
);


ALTER TYPE "public"."financial_entry_status" OWNER TO "postgres";


CREATE TYPE "public"."financial_entry_type" AS ENUM (
    'a_pagar',
    'a_receber'
);


ALTER TYPE "public"."financial_entry_type" OWNER TO "postgres";


CREATE TYPE "public"."fiscal_document_model" AS ENUM (
    'nfe',
    'nfce'
);


ALTER TYPE "public"."fiscal_document_model" OWNER TO "postgres";


CREATE TYPE "public"."fiscal_document_status" AS ENUM (
    'processando_autorizacao',
    'autorizado',
    'cancelado',
    'erro_autorizacao',
    'denegado'
);


ALTER TYPE "public"."fiscal_document_status" OWNER TO "postgres";


CREATE TYPE "public"."purchase_status" AS ENUM (
    'confirmed',
    'cancelled'
);


ALTER TYPE "public"."purchase_status" OWNER TO "postgres";


CREATE TYPE "public"."sale_order_status" AS ENUM (
    'aberto',
    'convertido',
    'cancelado'
);


ALTER TYPE "public"."sale_order_status" OWNER TO "postgres";


CREATE TYPE "public"."sale_payment_method" AS ENUM (
    'dinheiro',
    'debito',
    'credito',
    'pix',
    'boleto',
    'outro'
);


ALTER TYPE "public"."sale_payment_method" OWNER TO "postgres";


CREATE TYPE "public"."sale_return_status" AS ENUM (
    'confirmed',
    'cancelled'
);


ALTER TYPE "public"."sale_return_status" OWNER TO "postgres";


CREATE TYPE "public"."sale_status" AS ENUM (
    'confirmed',
    'cancelled'
);


ALTER TYPE "public"."sale_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."adjust_stock_batch"("p_branch_id" "uuid", "p_items" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_item jsonb;
  v_product_id uuid;
  v_reason text;
  v_change numeric;
  v_counted numeric;
  v_stock numeric;
  v_new_stock numeric;
  v_product_branch uuid;
begin
  if not has_permission('ajuste-estoque', 'create') then
    raise exception 'Você não tem permissão para ajustar o estoque.' using errcode = '42501';
  end if;

  if not has_branch_access(p_branch_id) then
    raise exception 'Você não tem acesso a esta filial.' using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Informe ao menos um produto no lote.' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_reason     := btrim(coalesce(v_item->>'reason', ''));
    v_change     := nullif(v_item->>'change', '')::numeric;
    v_counted    := nullif(v_item->>'counted_balance', '')::numeric;

    if (v_change is null) = (v_counted is null) then
      raise exception 'Cada item precisa ter alteração (+/-) OU saldo contado — nunca os dois, nem nenhum.'
        using errcode = '22023';
    end if;

    select stock, branch_id into v_stock, v_product_branch
    from products where id = v_product_id for update;

    if not found then
      raise exception 'Produto não encontrado.' using errcode = '22023';
    end if;

    if v_product_branch <> p_branch_id then
      raise exception 'Produto não pertence à filial informada.' using errcode = '42501';
    end if;

    if v_counted is not null then
      v_change := v_counted - v_stock;
    elsif v_change = 0 then
      raise exception 'A alteração não pode ser zero. Para registrar uma contagem sem diferença, use o saldo contado.'
        using errcode = '22023';
    end if;

    v_new_stock := v_stock + v_change;

    if v_new_stock < 0 and not coalesce(stock_allows_negative(p_branch_id, v_product_id), false) then
      raise exception 'Estoque insuficiente: o ajuste deixaria o produto com saldo negativo (%).', v_new_stock
        using errcode = '22023';
    end if;

    update products set stock = stock + v_change, updated_at = now() where id = v_product_id;

    insert into stock_adjustments (branch_id, product_id, change, reason, balance_after, created_by)
    values (p_branch_id, v_product_id, v_change, v_reason, v_new_stock, auth.uid());
  end loop;
end;
$$;


ALTER FUNCTION "public"."adjust_stock_batch"("p_branch_id" "uuid", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assert_module_workflow_editable"("p_module_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_kind text;
begin
  if not coalesce(public.can_manage_modules(), false) then
    raise exception 'Você não tem permissão para configurar módulos.';
  end if;

  select storage_kind into v_kind from public.modules where id = p_module_id;

  if v_kind is null then
    raise exception 'Módulo "%" não existe.', p_module_id;
  end if;

  if v_kind <> 'generic' then
    raise exception 'Só módulos de armazenamento genérico aceitam situações e transições — "%" guarda os dados em tabela própria.', p_module_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."assert_module_workflow_editable"("p_module_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_branches"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(r.can_manage_branches, false)
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = (select auth.uid()) and p.active = true;
$$;


ALTER FUNCTION "public"."can_manage_branches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_modules"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(r.can_manage_modules, false)
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = (select auth.uid()) and p.active = true;
$$;


ALTER FUNCTION "public"."can_manage_modules"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_permissions"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(r.can_manage_permissions, false)
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = auth.uid() and p.active = true;
$$;


ALTER FUNCTION "public"."can_manage_permissions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_users"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(r.can_manage_users, false)
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = auth.uid() and p.active = true;
$$;


ALTER FUNCTION "public"."can_manage_users"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_users_for"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(r.can_manage_users, false)
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = p_user_id and p.active = true;
$$;


ALTER FUNCTION "public"."can_manage_users_for"("p_user_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."conditionals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "status" "public"."conditional_status" DEFAULT 'confirmed'::"public"."conditional_status" NOT NULL,
    "issue_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "due_date" "date" NOT NULL,
    "total_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."conditionals" OWNER TO "postgres";


COMMENT ON TABLE "public"."conditionals" IS 'Peças enviadas ao cliente para experimentar em casa. O estoque já sai na criação (create_conditional) — diferente de sale_orders, que só reserva no papel. status é confirmed/cancelled; o "Em aberto/Vencida/Devolvida/Convertida/Parcialmente resolvida" mostrado na tela é calculado a partir dos itens (ver conditional_item_returns/conditional_item_conversions), nunca guardado.';



CREATE OR REPLACE FUNCTION "public"."cancel_conditional"("p_conditional_id" "uuid") RETURNS "public"."conditionals"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_conditional public.conditionals;
  v_item public.conditional_items;
  v_resolved numeric(14,3);
begin
  select * into v_conditional from public.conditionals where id = p_conditional_id for update;
  if v_conditional.id is null then
    raise exception 'Condicional não encontrada.';
  end if;

  if not has_permission('condicionais', 'create') then
    raise exception 'Sem permissão para cancelar condicionais.' using errcode = '42501';
  end if;
  if not has_branch_access(v_conditional.branch_id) then
    raise exception 'Sem acesso a esta filial.' using errcode = '42501';
  end if;
  if v_conditional.status <> 'confirmed' then
    raise exception 'Esta condicional já está cancelada.';
  end if;

  -- `for update` nos itens serializa contra register_conditional_return/
  -- convert_conditional_to_sale concorrentes na mesma condicional.
  for v_item in select * from public.conditional_items where conditional_id = p_conditional_id for update loop
    select coalesce((select sum(quantity) from public.conditional_item_returns where conditional_item_id = v_item.id), 0)
         + coalesce((select sum(quantity) from public.conditional_item_conversions where conditional_item_id = v_item.id), 0)
      into v_resolved;

    if v_resolved > 0 then
      raise exception 'Esta condicional já tem itens devolvidos ou convertidos — não pode ser cancelada por inteiro.';
    end if;
  end loop;

  update public.products p
    set stock = stock + ci.quantity, updated_at = now()
    from public.conditional_items ci
    where ci.conditional_id = p_conditional_id and p.id = ci.product_id;

  update public.conditionals set status = 'cancelled', updated_at = now()
    where id = p_conditional_id returning * into v_conditional;

  return v_conditional;
end;
$$;


ALTER FUNCTION "public"."cancel_conditional"("p_conditional_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cash_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "register_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "code" "text" DEFAULT ''::"text" NOT NULL,
    "status" "public"."cash_session_status" DEFAULT 'aberto'::"public"."cash_session_status" NOT NULL,
    "opened_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "opened_by" "uuid",
    "opening_amount" numeric(14,2) NOT NULL,
    "closed_at" timestamp with time zone,
    "closed_by" "uuid",
    "counted_amount" numeric(14,2),
    "expected_amount" numeric(14,2),
    "difference" numeric(14,2),
    CONSTRAINT "cash_sessions_closed_consistency" CHECK ((("status" = 'fechado'::"public"."cash_session_status") = ("closed_at" IS NOT NULL))),
    CONSTRAINT "cash_sessions_opening_amount_check" CHECK (("opening_amount" >= (0)::numeric))
);


ALTER TABLE "public"."cash_sessions" OWNER TO "postgres";


COMMENT ON TABLE "public"."cash_sessions" IS 'Sessão de caixa (abrir/fechar). Dado operacional, isolado por filial. expected_amount/difference só são preenchidos no fechamento.';



CREATE OR REPLACE FUNCTION "public"."close_cash_session"("p_session_id" "uuid", "p_counted_amount" numeric) RETURNS "public"."cash_sessions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_session public.cash_sessions;
  v_supplies numeric(14,2);
  v_withdrawals numeric(14,2);
  v_cash_sales numeric(14,2);
  v_expected numeric(14,2);
begin
  select * into v_session from public.cash_sessions where id = p_session_id for update;
  if v_session.id is null then
    raise exception 'Sessão de caixa não encontrada.';
  end if;
  if not has_permission('controle-caixa', 'edit') then
    raise exception 'Sem permissão para fechar caixa.' using errcode = '42501';
  end if;
  if not has_branch_access(v_session.branch_id) then
    raise exception 'Sem acesso a esta filial.' using errcode = '42501';
  end if;
  if v_session.status <> 'aberto' then
    raise exception 'Esta sessão de caixa já está fechada.';
  end if;
  if p_counted_amount is null or p_counted_amount < 0 then
    raise exception 'Informe o valor contado.';
  end if;

  select coalesce(sum(amount), 0) into v_supplies from public.cash_movements
    where session_id = p_session_id and type = 'suprimento';
  select coalesce(sum(amount), 0) into v_withdrawals from public.cash_movements
    where session_id = p_session_id and type = 'sangria';
  select coalesce(sum(fe.total), 0) into v_cash_sales
    from public.financial_entries_cash_sales_in_window(v_session.branch_id, v_session.opened_at, now(), p_session_id) fe;

  v_expected := v_session.opening_amount + v_supplies - v_withdrawals + v_cash_sales;

  update public.cash_sessions
    set status = 'fechado',
        closed_at = now(),
        closed_by = auth.uid(),
        counted_amount = p_counted_amount,
        expected_amount = v_expected,
        difference = p_counted_amount - v_expected
    where id = p_session_id
    returning * into v_session;

  return v_session;
end;
$$;


ALTER FUNCTION "public"."close_cash_session"("p_session_id" "uuid", "p_counted_amount" numeric) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "status" "public"."sale_status" DEFAULT 'confirmed'::"public"."sale_status" NOT NULL,
    "contact_id" "uuid",
    "seller_id" "uuid" NOT NULL,
    "address" "text",
    "delivery_address" "text",
    "operation_type" "text",
    "department" "text",
    "cost_center" "text",
    "issue_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "exit_date" "date",
    "freight_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "discount_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "subtotal_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "confirmed_at" timestamp with time zone,
    "icms_total" numeric,
    "ipi_total" numeric,
    "pis_total" numeric,
    "cofins_total" numeric,
    "ibs_total" numeric,
    "cbs_total" numeric,
    "cash_session_id" "uuid"
);


ALTER TABLE "public"."sales" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."convert_conditional_to_sale"("payload" "jsonb") RETURNS "public"."sales"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_conditional_id uuid := (payload->>'conditional_id')::uuid;
  v_conditional public.conditionals;
  v_branch_id uuid;
  v_item jsonb;
  v_ci public.conditional_items;
  v_quantity numeric(14,3);
  v_resolved numeric(14,3);
  v_sale public.sales;
  v_sale_item public.sale_items;
  v_code text;
  v_items_total numeric(14,2) := 0;
  v_method public.sale_payment_method := (payload->'payment'->>'method')::public.sale_payment_method;
  v_installments int := coalesce((payload->'payment'->>'installments')::int, 1);
  v_method_label text;
  v_payment_row public.sale_payments;
begin
  select * into v_conditional from public.conditionals where id = v_conditional_id for update;
  if v_conditional.id is null then
    raise exception 'Condicional não encontrada.';
  end if;
  v_branch_id := v_conditional.branch_id;

  -- Sem permissão adicional além de 'condicionais'/'create': diferente de
  -- convert_sale_order_to_sale (que chama create_sale internamente e por
  -- isso também exige has_permission('realizar-venda','create')), esta RPC
  -- é irmã de create_sale, não consumidora dela — grava sales/sale_items/
  -- sale_payments diretamente. Ver AGENTS.md.
  if not has_permission('condicionais', 'create') then
    raise exception 'Sem permissão para converter condicionais em venda.' using errcode = '42501';
  end if;
  if not has_branch_access(v_branch_id) then
    raise exception 'Sem acesso a esta filial.' using errcode = '42501';
  end if;
  if v_conditional.status <> 'confirmed' then
    raise exception 'Esta condicional não está mais em aberto.';
  end if;
  if payload->'items' is null or jsonb_array_length(payload->'items') = 0 then
    raise exception 'Informe ao menos um item a converter.';
  end if;
  if v_method is null then
    raise exception 'Informe a forma de pagamento.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_branch_id::text || ':sales'));

  select coalesce(max(code::int), 0) + 1 into v_code from public.sales where branch_id = v_branch_id;
  v_code := lpad(v_code::text, 4, '0');

  -- Vendedor: sem seletor, seller_id = auth.uid() direto — mesma decisão já
  -- tomada no PDV ("quem está operando é quem vende").
  insert into public.sales (
    branch_id, code, status, contact_id, seller_id, issue_date, created_by, confirmed_at
  ) values (
    v_branch_id, v_code, 'confirmed', v_conditional.contact_id, auth.uid(), current_date, auth.uid(), now()
  ) returning * into v_sale;

  for v_item in select * from jsonb_array_elements(payload->'items') loop
    v_quantity := (v_item->>'quantity')::numeric;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Quantidade a converter inválida.';
    end if;

    select * into v_ci from public.conditional_items
      where id = (v_item->>'conditional_item_id')::uuid for update;

    if v_ci.id is null then
      raise exception 'Item da condicional não encontrado.';
    end if;
    if v_ci.conditional_id <> v_conditional_id then
      raise exception 'Item informado não pertence a esta condicional.';
    end if;

    select coalesce((select sum(quantity) from public.conditional_item_returns where conditional_item_id = v_ci.id), 0)
         + coalesce((select sum(quantity) from public.conditional_item_conversions where conditional_item_id = v_ci.id), 0)
      into v_resolved;

    if v_resolved + v_quantity > v_ci.quantity then
      raise exception 'Conversão maior que o saldo da condicional: já resolvidos % de %, tentando converter mais %.',
        v_resolved, v_ci.quantity, v_quantity
        using errcode = '23514';
    end if;

    insert into public.sale_items (sale_id, product_id, quantity, unit_price, discount_amount, total_amount)
    values (v_sale.id, v_ci.product_id, v_quantity, v_ci.unit_price, 0, round(v_quantity * v_ci.unit_price, 2))
    returning * into v_sale_item;

    -- Sem baixa de estoque aqui: a peça já saiu na criação da condicional.
    -- Por isso esta RPC é irmã de create_sale, não consumidora dela.

    insert into public.conditional_item_conversions (conditional_item_id, sale_id, sale_item_id, quantity)
    values (v_ci.id, v_sale.id, v_sale_item.id, v_quantity);

    v_items_total := v_items_total + v_sale_item.total_amount;
  end loop;

  update public.sales set subtotal_amount = v_items_total, total_amount = v_items_total, updated_at = now()
    where id = v_sale.id returning * into v_sale;

  v_method_label := case v_method
    when 'dinheiro' then 'Dinheiro'
    when 'debito' then 'Débito'
    when 'credito' then 'Crédito'
    when 'pix' then 'PIX'
    when 'boleto' then 'Boleto'
    else 'Outro'
  end;

  insert into public.sale_payments (sale_id, method, amount, installments)
  values (v_sale.id, v_method, v_items_total, v_installments)
  returning * into v_payment_row;

  -- Mesmo núcleo de parcelamento que create_sale usa, mesma regra por forma
  -- de pagamento (dinheiro/pix/débito nasce baixado; crédito/boleto parcela
  -- com vencimento a 30 dias; outro é tratado como a prazo, conservador).
  if v_method in ('dinheiro', 'pix', 'debito') then
    perform public.financial_entries_create_installments(
      v_branch_id, 'a_receber', v_sale.contact_id, v_payment_row.amount,
      1, v_sale.issue_date, 30, v_method_label, 'Venda ' || v_code,
      'venda', v_sale.id, true, v_sale.issue_date
    );
  elsif v_method in ('credito', 'boleto') then
    perform public.financial_entries_create_installments(
      v_branch_id, 'a_receber', v_sale.contact_id, v_payment_row.amount,
      v_installments, v_sale.issue_date + 30, 30,
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

  return v_sale;
end;
$$;


ALTER FUNCTION "public"."convert_conditional_to_sale"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."convert_sale_order_to_sale"("p_sale_order_id" "uuid") RETURNS "public"."sales"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order public.sale_orders;
  v_items jsonb;
  v_payload jsonb;
  v_sale public.sales;
begin
  select * into v_order from public.sale_orders where id = p_sale_order_id for update;

  if not found then
    raise exception 'Pedido não encontrado.';
  end if;

  if not has_permission('pedidos-venda', 'create') then
    raise exception 'Sem permissão para converter pedidos em venda.' using errcode = '42501';
  end if;
  if not has_branch_access(v_order.branch_id) then
    raise exception 'Sem acesso a esta filial.' using errcode = '42501';
  end if;
  if v_order.status <> 'aberto' then
    raise exception 'Este pedido já foi convertido ou está cancelado.';
  end if;

  select jsonb_agg(jsonb_build_object(
    'product_id', product_id,
    'quantity', quantity,
    'unit_price', unit_price,
    'discount_amount', discount_amount
  )) into v_items
  from public.sale_order_items where sale_order_id = p_sale_order_id;

  v_payload := jsonb_build_object(
    'branch_id', v_order.branch_id,
    'contact_id', v_order.contact_id,
    'seller_id', v_order.seller_id,
    'address', v_order.address,
    'delivery_address', v_order.delivery_address,
    'operation_type', v_order.operation_type,
    'department', v_order.department,
    'cost_center', v_order.cost_center,
    'issue_date', current_date,
    'freight_amount', v_order.freight_amount,
    'discount_amount', v_order.discount_amount,
    'items', v_items,
    'payments', jsonb_build_array(jsonb_build_object(
      'method', v_order.payment_method,
      'amount', v_order.total_amount,
      'installments', v_order.installments
    ))
  );

  v_sale := public.create_sale(v_payload);

  update public.sale_orders set
    status = 'convertido',
    converted_sale_id = v_sale.id,
    updated_at = now()
  where id = p_sale_order_id;

  return v_sale;
end;
$$;


ALTER FUNCTION "public"."convert_sale_order_to_sale"("p_sale_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_conditional"("payload" "jsonb") RETURNS "public"."conditionals"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
    v_unit_price := (v_item->>'unit_price')::numeric;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Quantidade inválida em um dos itens.';
    end if;
    if v_unit_price is null or v_unit_price < 0 then
      raise exception 'Preço unitário inválido em um dos itens.';
    end if;

    select id, stock, branch_id into v_product from public.products
      where id = (v_item->>'product_id')::uuid for update;

    if v_product.id is null then raise exception 'Produto não encontrado.'; end if;
    if v_product.branch_id <> v_branch_id then raise exception 'Produto não pertence à filial da condicional.'; end if;

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
$$;


ALTER FUNCTION "public"."create_conditional"("payload" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."financial_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "code" "text" DEFAULT ''::"text" NOT NULL,
    "type" "public"."financial_entry_type" NOT NULL,
    "status" "public"."financial_entry_status" DEFAULT 'aberto'::"public"."financial_entry_status" NOT NULL,
    "contact_id" "uuid",
    "payment_method" "text",
    "installment_number" integer DEFAULT 1 NOT NULL,
    "installment_total" integer DEFAULT 1 NOT NULL,
    "total" numeric(14,2) NOT NULL,
    "document" "text",
    "due_date" "date" NOT NULL,
    "issue_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "settled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "origin_kind" "public"."financial_entry_origin_kind" DEFAULT 'manual'::"public"."financial_entry_origin_kind" NOT NULL,
    "origin_id" "uuid",
    "installment_group_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    CONSTRAINT "financial_entries_installment_check" CHECK ((("installment_number" >= 1) AND ("installment_total" >= 1) AND ("installment_number" <= "installment_total"))),
    CONSTRAINT "financial_entries_settled_check" CHECK ((("status" = 'baixado'::"public"."financial_entry_status") = ("settled_at" IS NOT NULL))),
    CONSTRAINT "financial_entries_total_check" CHECK (("total" > (0)::numeric))
);


ALTER TABLE "public"."financial_entries" OWNER TO "postgres";


COMMENT ON TABLE "public"."financial_entries" IS 'Contas a pagar/receber. Dado operacional, isolado por filial. type é permanente; status é o que muda com a baixa.';



CREATE OR REPLACE FUNCTION "public"."create_financial_entry_installments"("p_branch_id" "uuid", "p_type" "public"."financial_entry_type", "p_contact_id" "uuid", "p_total" numeric, "p_installment_count" integer, "p_first_due_date" "date", "p_interval_days" integer, "p_payment_method" "text", "p_document" "text", "p_settled" boolean) RETURNS SETOF "public"."financial_entries"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not has_permission('financeiro', 'create') then
    raise exception 'Sem permissão para lançar contas.' using errcode = '42501';
  end if;
  if not has_branch_access(p_branch_id) then
    raise exception 'Sem acesso a esta filial.' using errcode = '42501';
  end if;

  return query
  select * from public.financial_entries_create_installments(
    p_branch_id, p_type, p_contact_id, p_total, p_installment_count,
    p_first_due_date, p_interval_days, p_payment_method, p_document,
    'manual'::public.financial_entry_origin_kind, null, p_settled
  );
end;
$$;


ALTER FUNCTION "public"."create_financial_entry_installments"("p_branch_id" "uuid", "p_type" "public"."financial_entry_type", "p_contact_id" "uuid", "p_total" numeric, "p_installment_count" integer, "p_first_due_date" "date", "p_interval_days" integer, "p_payment_method" "text", "p_document" "text", "p_settled" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_pos_sale"("payload" "jsonb") RETURNS "public"."sales"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_branch_id uuid := (payload->>'branch_id')::uuid;
  v_session_id uuid;
  v_sale public.sales;
begin
  if not has_permission('ponto-de-venda', 'create') then
    raise exception 'Sem permissão para vender no ponto de venda.' using errcode = '42501';
  end if;
  if not has_branch_access(v_branch_id) then
    raise exception 'Sem acesso a esta filial.' using errcode = '42501';
  end if;

  select id into v_session_id
    from public.cash_sessions
    where branch_id = v_branch_id and status = 'aberto'
    limit 1;

  if v_session_id is null then
    raise exception 'Abra uma sessão de caixa antes de vender.';
  end if;

  v_sale := public.create_sale(payload);

  update public.sales set cash_session_id = v_session_id
    where id = v_sale.id
    returning * into v_sale;

  return v_sale;
end;
$$;


ALTER FUNCTION "public"."create_pos_sale"("payload" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "code" "text" DEFAULT ''::"text" NOT NULL,
    "status" "public"."purchase_status" DEFAULT 'confirmed'::"public"."purchase_status" NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "payment_method" "public"."sale_payment_method" NOT NULL,
    "installment_total" integer DEFAULT 1 NOT NULL,
    "document" "text",
    "issue_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "entry_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "subtotal_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "purchases_installment_total_check" CHECK (("installment_total" >= 1))
);


ALTER TABLE "public"."purchases" OWNER TO "postgres";


COMMENT ON TABLE "public"."purchases" IS 'Compras (cabeçalho). Dado operacional, isolado por filial. Espelha sales estruturalmente.';



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
    select id, branch_id into v_product from public.products
    where id = (v_item->>'product_id')::uuid for update;

    if v_product.id is null then
      raise exception 'Produto não encontrado.';
    end if;
    if v_product.branch_id <> v_branch_id then
      raise exception 'Produto não pertence à filial da compra.';
    end if;

    insert into public.purchase_items (purchase_id, product_id, quantity, unit_cost, total_amount)
    values (
      v_purchase.id, v_product.id, (v_item->>'quantity')::numeric, (v_item->>'unit_cost')::numeric,
      (v_item->>'quantity')::numeric * (v_item->>'unit_cost')::numeric
    );

    update public.products
      set stock = stock + (v_item->>'quantity')::numeric,
          cost_price = case when v_update_cost then (v_item->>'unit_cost')::numeric else cost_price end,
          updated_at = now()
      where id = v_product.id;

    v_items_total := v_items_total
      + (v_item->>'quantity')::numeric * (v_item->>'unit_cost')::numeric;
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


CREATE OR REPLACE FUNCTION "public"."create_sale"("payload" "jsonb") RETURNS "public"."sales"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
    select id, stock, branch_id into v_product from public.products
    where id = (v_item->>'product_id')::uuid for update;

    if v_product.id is null then raise exception 'Produto não encontrado.'; end if;
    if v_product.branch_id <> v_branch_id then raise exception 'Produto não pertence à filial da venda.'; end if;

    v_new_stock := v_product.stock - (v_item->>'quantity')::numeric;
    if v_new_stock < 0 and not coalesce(stock_allows_negative(v_branch_id, v_product.id), false) then
      raise exception 'Estoque insuficiente para o produto %.', v_product.id;
    end if;

    insert into public.sale_items (sale_id, product_id, quantity, unit_price, discount_amount, total_amount)
    values (
      v_sale.id, v_product.id, (v_item->>'quantity')::numeric, (v_item->>'unit_price')::numeric,
      coalesce((v_item->>'discount_amount')::numeric, 0),
      (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric - coalesce((v_item->>'discount_amount')::numeric, 0)
    );

    update public.products set stock = v_new_stock, updated_at = now() where id = v_product.id;

    v_items_total := v_items_total
      + (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric
      - coalesce((v_item->>'discount_amount')::numeric, 0);
  end loop;

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
$$;


ALTER FUNCTION "public"."create_sale"("payload" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sale_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "status" "public"."sale_order_status" DEFAULT 'aberto'::"public"."sale_order_status" NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "seller_id" "uuid" NOT NULL,
    "payment_method" "public"."sale_payment_method" NOT NULL,
    "installments" integer DEFAULT 1 NOT NULL,
    "address" "text",
    "delivery_address" "text",
    "operation_type" "text",
    "department" "text",
    "cost_center" "text",
    "issue_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "freight_amount" numeric DEFAULT 0 NOT NULL,
    "discount_amount" numeric DEFAULT 0 NOT NULL,
    "subtotal_amount" numeric DEFAULT 0 NOT NULL,
    "total_amount" numeric DEFAULT 0 NOT NULL,
    "converted_sale_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sale_orders_installments_check" CHECK (("installments" >= 1))
);


ALTER TABLE "public"."sale_orders" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_sale_order"("payload" "jsonb") RETURNS "public"."sale_orders"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_branch_id uuid := (payload->>'branch_id')::uuid;
  v_order public.sale_orders;
  v_item jsonb;
  v_items_total numeric(14,2) := 0;
  v_code text;
  v_product record;
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
    select id, branch_id into v_product from public.products
    where id = (v_item->>'product_id')::uuid;

    if v_product.id is null then
      raise exception 'Produto não encontrado.';
    end if;
    if v_product.branch_id <> v_branch_id then
      raise exception 'Produto não pertence à filial do pedido.';
    end if;

    insert into public.sale_order_items (sale_order_id, product_id, quantity, unit_price, discount_amount, total_amount)
    values (
      v_order.id, v_product.id, (v_item->>'quantity')::numeric, (v_item->>'unit_price')::numeric,
      coalesce((v_item->>'discount_amount')::numeric, 0),
      (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric - coalesce((v_item->>'discount_amount')::numeric, 0)
    );

    v_items_total := v_items_total
      + (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric
      - coalesce((v_item->>'discount_amount')::numeric, 0);
  end loop;

  update public.sale_orders set
    subtotal_amount = v_items_total,
    total_amount = v_items_total + freight_amount - discount_amount,
    updated_at = now()
  where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;


ALTER FUNCTION "public"."create_sale_order"("payload" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sale_returns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "sale_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "status" "public"."sale_return_status" DEFAULT 'confirmed'::"public"."sale_return_status" NOT NULL,
    "reason" "text" DEFAULT ''::"text" NOT NULL,
    "subtotal_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "issue_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sale_returns" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_sale_return"("payload" "jsonb") RETURNS "public"."sale_returns"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_branch_id uuid := (payload->>'branch_id')::uuid;
  v_sale_id uuid := (payload->>'sale_id')::uuid;
  v_sale public.sales;
  v_return public.sale_returns;
  v_item jsonb;
  v_sale_item public.sale_items;
  v_quantity numeric(14,3);
  v_returned numeric(14,3);
  v_product record;
  v_gross numeric(14,2);
  v_item_discount numeric(14,2);
  v_header_discount numeric(14,2);
  v_line_total numeric(14,2);
  v_items_gross numeric(14,2) := 0;
  v_items_total numeric(14,2) := 0;
  v_code text;
  v_payment_method text;
  v_method_count integer;
  v_issue_date date := current_date;
begin
  if not has_permission('devolucao-venda', 'create') then
    raise exception 'Sem permissão para criar devoluções de venda.' using errcode = '42501';
  end if;
  if not has_branch_access(v_branch_id) then
    raise exception 'Sem acesso a esta filial.' using errcode = '42501';
  end if;
  if payload->'items' is null or jsonb_array_length(payload->'items') = 0 then
    raise exception 'A devolução precisa de ao menos um item.';
  end if;

  select * into v_sale from public.sales where id = v_sale_id;
  if v_sale.id is null then
    raise exception 'Venda de origem não encontrada.';
  end if;
  if v_sale.branch_id <> v_branch_id then
    raise exception 'A venda de origem não pertence a esta filial.';
  end if;
  if v_sale.status <> 'confirmed' then
    raise exception 'Só é possível devolver uma venda confirmada.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_branch_id::text || ':sale_returns'));

  select coalesce(max(code::int), 0) + 1 into v_code from public.sale_returns where branch_id = v_branch_id;
  v_code := lpad(v_code::text, 4, '0');

  insert into public.sale_returns (branch_id, sale_id, code, status, reason, issue_date, created_by)
  values (v_branch_id, v_sale_id, v_code, 'confirmed', coalesce(payload->>'reason', ''), v_issue_date, auth.uid())
  returning * into v_return;

  for v_item in select * from jsonb_array_elements(payload->'items') loop
    v_quantity := (v_item->>'quantity')::numeric;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Quantidade devolvida inválida.';
    end if;

    -- `for update` serializa duas devoluções simultâneas da mesma linha: sem
    -- ele, as duas leriam o mesmo "já devolvido" e as duas passariam.
    select * into v_sale_item from public.sale_items
      where id = (v_item->>'sale_item_id')::uuid for update;

    if v_sale_item.id is null then
      raise exception 'Item da venda não encontrado.';
    end if;
    if v_sale_item.sale_id <> v_sale_id then
      raise exception 'Item informado não pertence à venda de origem.';
    end if;

    select coalesce(sum(sri.quantity), 0) into v_returned
      from public.sale_return_items sri
      join public.sale_returns sr on sr.id = sri.sale_return_id
     where sri.sale_item_id = v_sale_item.id
       and sr.status <> 'cancelled'
       and sr.id <> v_return.id;

    if v_returned + v_quantity > v_sale_item.quantity then
      raise exception 'Devolução maior que a quantidade vendida: já devolvidos % de %, tentando devolver mais %.',
        v_returned, v_sale_item.quantity, v_quantity
        using errcode = '23514';
    end if;

    select id, branch_id into v_product from public.products
      where id = v_sale_item.product_id for update;
    if v_product.id is null then
      raise exception 'Produto do item não encontrado.';
    end if;

    -- Valor proporcional ao que o cliente pagou por esta linha: preço unitário
    -- herdado do item original (nunca digitado de novo), menos a fatia do
    -- desconto daquele item e a fatia do desconto do cabeçalho da venda.
    -- Frete não é devolvido (o transporte já foi consumido) — decisão
    -- documentada no AGENTS.md.
    v_gross := round(v_sale_item.unit_price * v_quantity, 2);
    v_item_discount := round(v_sale_item.discount_amount * v_quantity / v_sale_item.quantity, 2);
    v_header_discount := case
      when v_sale.discount_amount > 0 and v_sale.subtotal_amount > 0
        then round(v_sale.discount_amount * (v_gross - v_item_discount) / v_sale.subtotal_amount, 2)
      else 0
    end;
    v_line_total := v_gross - v_item_discount - v_header_discount;
    if v_line_total < 0 then
      v_line_total := 0;
    end if;

    insert into public.sale_return_items (
      sale_return_id, sale_item_id, product_id, quantity, unit_price, discount_amount, total_amount
    ) values (
      v_return.id, v_sale_item.id, v_product.id, v_quantity, v_sale_item.unit_price,
      v_item_discount + v_header_discount, v_line_total
    );

    -- Devolver sempre é permitido, sem checagem de saldo — mesma lógica da
    -- entrada de estoque em Compras (só o `for update` por concorrência).
    update public.products
      set stock = stock + v_quantity, updated_at = now()
      where id = v_product.id;

    v_items_gross := v_items_gross + v_gross;
    v_items_total := v_items_total + v_line_total;
  end loop;

  update public.sale_returns
     set subtotal_amount = v_items_gross, total_amount = v_items_total, updated_at = now()
   where id = v_return.id
  returning * into v_return;

  if v_items_total <= 0 then
    raise exception 'O valor da devolução precisa ser maior que zero.';
  end if;

  -- Forma de pagamento só é copiada quando a venda teve uma só — com split não
  -- há uma resposta certa, e inventar uma seria pior que deixar em branco.
  select count(distinct method) into v_method_count from public.sale_payments where sale_id = v_sale_id;
  if v_method_count = 1 then
    select case method
      when 'dinheiro' then 'Dinheiro'
      when 'debito' then 'Débito'
      when 'credito' then 'Crédito'
      when 'pix' then 'PIX'
      when 'boleto' then 'Boleto'
      else 'Outro'
    end into v_payment_method
    from public.sale_payments where sale_id = v_sale_id limit 1;
  else
    v_payment_method := null;
  end if;

  -- Núcleo de parcelamento (não a porta pública) — quem já validou
  -- has_permission('devolucao-venda','create') não deve precisar também de
  -- permissão de Financeiro. Sexto consumidor do núcleo.
  perform public.financial_entries_create_installments(
    v_branch_id, 'a_pagar', v_sale.contact_id, v_return.total_amount,
    1, v_issue_date, 1, v_payment_method, 'Devolução ' || v_code,
    'devolucao', v_return.id, false, v_issue_date
  );

  return v_return;
end;
$$;


ALTER FUNCTION "public"."create_sale_return"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_user_module"("p_label" "text", "p_branch_scoped" boolean, "p_sort_order" integer, "p_fields" "jsonb") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_id text;
  v_role_id uuid;
  v_field jsonb;
  v_key text;
  v_type text;
  v_order integer := 0;
  v_keys text[] := '{}';
begin
  if not coalesce(public.can_manage_modules(), false) then
    raise exception 'Você não tem permissão para criar módulos.';
  end if;

  if coalesce(btrim(p_label), '') = '' then
    raise exception 'Informe um nome para o módulo.';
  end if;

  v_id := public.slugify_text(p_label);
  if v_id = '' then
    raise exception 'O nome do módulo precisa ter pelo menos uma letra ou número.';
  end if;

  if exists (select 1 from public.modules m where m.id = v_id) then
    raise exception 'Já existe um módulo com esse nome.';
  end if;

  if exists (select 1 from public.modules m where m.path = '/' || v_id) then
    raise exception 'Já existe um módulo usando a rota /%.', v_id;
  end if;

  if jsonb_typeof(p_fields) is distinct from 'array' or jsonb_array_length(p_fields) = 0 then
    raise exception 'Um módulo precisa de pelo menos um campo.';
  end if;

  select p.role_id into v_role_id
  from public.profiles p
  where p.id = auth.uid() and p.active = true;

  if v_role_id is null then
    raise exception 'Seu usuário não tem um papel de acesso definido.';
  end if;

  insert into public.modules (
    id, label, data_table, layout_variant, is_locked, path, icon_key,
    sort_order, show_on_home, access_gate, branch_scoped, storage_kind
  ) values (
    v_id, btrim(p_label), null, 'three', false, '/' || v_id, null,
    coalesce(p_sort_order, 1000), true, 'permission',
    coalesce(p_branch_scoped, false), 'generic'
  );

  for v_field in select value from jsonb_array_elements(p_fields) loop
    v_order := v_order + 10;
    v_key := public.module_field_key(v_field->>'label');
    v_type := coalesce(v_field->>'data_type', 'text');

    if v_key = '' then
      raise exception 'Todo campo precisa de um rótulo com letra ou número.';
    end if;

    if v_key = any (array['id', 'module_id', 'branch_id', 'data', 'created_at', 'updated_at', 'created_by']) then
      raise exception 'O campo "%" usa um nome reservado (%).', v_field->>'label', v_key;
    end if;

    if v_key = any (v_keys) then
      raise exception 'Dois campos gerariam a mesma chave (%). Use rótulos diferentes.', v_key;
    end if;
    v_keys := v_keys || v_key;

    if v_type not in ('text', 'date', 'boolean', 'phone', 'email') then
      raise exception 'Tipo de campo desconhecido: %.', v_type;
    end if;

    insert into public.module_fields (
      module_id, field_key, label, data_type, is_required, sort_order,
      show_in_table, table_width, table_align, show_in_details, show_in_form
    ) values (
      v_id, v_key, btrim(v_field->>'label'), v_type,
      coalesce((v_field->>'is_required')::boolean, false), v_order,
      coalesce((v_field->>'show_in_table')::boolean, true), null, 'left',
      coalesce((v_field->>'show_in_details')::boolean, true),
      coalesce((v_field->>'show_in_form')::boolean, true)
    );
  end loop;

  insert into public.role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
  values (v_role_id, v_id, true, true, true, true)
  on conflict (role_id, module_id) do update
    set can_view = true, can_create = true, can_edit = true, can_delete = true;

  return v_id;
end;
$$;


ALTER FUNCTION "public"."create_user_module"("p_label" "text", "p_branch_scoped" boolean, "p_sort_order" integer, "p_fields" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_module_situation"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.module_situations;
  v_count integer;
begin
  select * into v_row from public.module_situations where id = p_id;
  if not found then
    raise exception 'Situação não encontrada.';
  end if;

  perform public.assert_module_workflow_editable(v_row.module_id);

  -- Mesmo atrito deliberado de `delete_user_module`: o que a exclusão
  -- destruiria precisa estar visível antes, não depois.
  select count(*) into v_count
  from public.module_records
  where module_id = v_row.module_id and status = v_row.code;

  if v_count > 0 then
    raise exception 'A situação "%" está em uso por % registro(s). Mova esses registros para outra situação antes de excluí-la.', v_row.label, v_count;
  end if;

  if exists (
    select 1 from public.module_transitions
    where from_situation_id = p_id or to_situation_id = p_id
  ) then
    raise exception 'A situação "%" é usada por uma transição. Exclua a transição primeiro.', v_row.label;
  end if;

  delete from public.module_situations where id = p_id;
end;
$$;


ALTER FUNCTION "public"."delete_module_situation"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_module_transition"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_module_id text;
begin
  select module_id into v_module_id from public.module_transitions where id = p_id;
  if v_module_id is null then
    raise exception 'Transição não encontrada.';
  end if;

  perform public.assert_module_workflow_editable(v_module_id);

  -- A FK já tem cascade; a exclusão está escrita à mão pelo mesmo motivo de
  -- `delete_user_module`: o que some precisa estar visível na função.
  delete from public.module_transition_actions where transition_id = p_id;
  delete from public.module_transitions where id = p_id;
end;
$$;


ALTER FUNCTION "public"."delete_module_transition"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_module_transition_action"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_module_id text;
begin
  select t.module_id into v_module_id
  from public.module_transition_actions a
  join public.module_transitions t on t.id = a.transition_id
  where a.id = p_id;

  if v_module_id is null then
    raise exception 'Ação não encontrada.';
  end if;

  perform public.assert_module_workflow_editable(v_module_id);

  delete from public.module_transition_actions where id = p_id;
end;
$$;


ALTER FUNCTION "public"."delete_module_transition_action"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_user_module"("p_module_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_referencing text;
begin
  if not coalesce(public.can_manage_modules(), false) then
    raise exception 'Você não tem permissão para excluir módulos.';
  end if;

  if not exists (
    select 1 from public.modules m where m.id = p_module_id and m.is_locked = false
  ) then
    raise exception 'Só é possível excluir módulos criados pelo usuário.';
  end if;

  select string_agg(distinct m.label, ', ') into v_referencing
  from public.module_fields f
  join public.modules m on m.id = f.module_id
  where f.reference_module_id = p_module_id;

  if v_referencing is not null then
    raise exception 'Não dá para excluir: o módulo % tem campo(s) apontando para este. Remova a referência antes.', v_referencing;
  end if;

  delete from public.module_transition_actions
  where transition_id in (select id from public.module_transitions where module_id = p_module_id);
  delete from public.module_transitions where module_id = p_module_id;
  delete from public.module_records where module_id = p_module_id;
  delete from public.module_situations where module_id = p_module_id;
  delete from public.module_fields where module_id = p_module_id;
  delete from public.module_tabs where module_id = p_module_id;
  delete from public.role_permissions where module_id = p_module_id;
  delete from public.modules where id = p_module_id;
end;
$$;


ALTER FUNCTION "public"."delete_user_module"("p_module_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."financial_entries_before_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."financial_entries_before_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."financial_entries_cash_sales_in_window"("p_branch_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_session_id" "uuid" DEFAULT NULL::"uuid") RETURNS SETOF "public"."financial_entries"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select fe.*
  from public.financial_entries fe
  join public.sales s on s.id = fe.origin_id
  where fe.origin_kind = 'venda'
    and fe.branch_id = p_branch_id
    and exists (
      select 1 from public.sale_payments sp
      where sp.sale_id = s.id
        and sp.method = 'dinheiro'
        and sp.amount = fe.total
    )
    and (
      (s.cash_session_id is not null and s.cash_session_id = p_session_id)
      or (
        s.cash_session_id is null
        and fe.created_at >= p_from
        and fe.created_at <= p_to
      )
    )
  order by fe.created_at asc;
$$;


ALTER FUNCTION "public"."financial_entries_cash_sales_in_window"("p_branch_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."financial_entries_create_installments"("p_branch_id" "uuid", "p_type" "public"."financial_entry_type", "p_contact_id" "uuid", "p_total" numeric, "p_installment_count" integer, "p_first_due_date" "date", "p_interval_days" integer, "p_payment_method" "text", "p_document" "text", "p_origin_kind" "public"."financial_entry_origin_kind", "p_origin_id" "uuid", "p_settled" boolean, "p_issue_date" "date" DEFAULT CURRENT_DATE) RETURNS SETOF "public"."financial_entries"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_group_id uuid := gen_random_uuid();
  v_total_cents bigint;
  v_base_cents bigint;
  v_remainder_cents bigint;
  v_installment_cents bigint;
  v_amount numeric(14,2);
  v_sum_check numeric(14,2) := 0;
  v_row public.financial_entries;
  i integer;
begin
  if not has_branch_access(p_branch_id) then
    raise exception 'Sem acesso a esta filial.' using errcode = '42501';
  end if;
  if p_total is null or p_total <= 0 then
    raise exception 'O valor total precisa ser maior que zero.';
  end if;
  if p_installment_count is null or p_installment_count < 1 then
    raise exception 'Número de parcelas inválido.';
  end if;
  if p_interval_days is null or p_interval_days < 1 then
    raise exception 'Intervalo entre parcelas inválido.';
  end if;
  if p_first_due_date is null then
    raise exception 'Informe o vencimento da primeira parcela.';
  end if;

  v_total_cents := round(p_total * 100)::bigint;
  v_base_cents := v_total_cents / p_installment_count;
  v_remainder_cents := v_total_cents - (v_base_cents * p_installment_count);

  for i in 1..p_installment_count loop
    v_installment_cents := v_base_cents + case when i = 1 then v_remainder_cents else 0 end;
    v_amount := v_installment_cents / 100.0;
    v_sum_check := v_sum_check + v_amount;

    insert into public.financial_entries (
      branch_id, type, status, contact_id, payment_method,
      installment_number, installment_total, installment_group_id,
      total, document, due_date, issue_date,
      origin_kind, origin_id, settled_at
    ) values (
      p_branch_id, p_type,
      (case when p_settled then 'baixado' else 'aberto' end)::public.financial_entry_status,
      p_contact_id, p_payment_method,
      i, p_installment_count, v_group_id,
      v_amount, p_document,
      p_first_due_date + (i - 1) * p_interval_days,
      p_issue_date,
      p_origin_kind, p_origin_id,
      case when p_settled then now() else null end
    )
    returning * into v_row;

    return next v_row;
  end loop;

  if round(v_sum_check, 2) <> round(p_total, 2) then
    raise exception 'Erro interno: soma das parcelas (%) não bate com o total (%).', v_sum_check, p_total;
  end if;

  return;
end;
$$;


ALTER FUNCTION "public"."financial_entries_create_installments"("p_branch_id" "uuid", "p_type" "public"."financial_entry_type", "p_contact_id" "uuid", "p_total" numeric, "p_installment_count" integer, "p_first_due_date" "date", "p_interval_days" integer, "p_payment_method" "text", "p_document" "text", "p_origin_kind" "public"."financial_entry_origin_kind", "p_origin_id" "uuid", "p_settled" boolean, "p_issue_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_branch_access"("p_branch_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.user_branches ub
    where ub.user_id = (select auth.uid()) and ub.branch_id = p_branch_id
  );
$$;


ALTER FUNCTION "public"."has_branch_access"("p_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_facilite_developer_access"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(p.is_facilite_developer, false)
  from public.profiles p
  where p.id = (select auth.uid()) and p.active = true;
$$;


ALTER FUNCTION "public"."has_facilite_developer_access"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_permission"("p_module_id" "text", "p_action" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    case p_action
      when 'view' then rp.can_view
      when 'create' then rp.can_create
      when 'edit' then rp.can_edit
      when 'delete' then rp.can_delete
      else false
    end,
    false
  )
  from public.profiles p
  join public.role_permissions rp on rp.role_id = p.role_id and rp.module_id = p_module_id
  where p.id = auth.uid() and p.active = true;
$$;


ALTER FUNCTION "public"."has_permission"("p_module_id" "text", "p_action" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_cash_session_cash_sales"("p_session_id" "uuid") RETURNS SETOF "public"."financial_entries"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_branch_id uuid;
  v_opened_at timestamptz;
  v_closed_at timestamptz;
begin
  select branch_id, opened_at, closed_at into v_branch_id, v_opened_at, v_closed_at
  from public.cash_sessions where id = p_session_id;

  if v_branch_id is null then
    raise exception 'Sessão de caixa não encontrada.';
  end if;
  if not has_permission('controle-caixa', 'view') then
    raise exception 'Sem permissão para ver o caixa.' using errcode = '42501';
  end if;
  if not has_branch_access(v_branch_id) then
    raise exception 'Sem acesso a esta filial.' using errcode = '42501';
  end if;

  return query
    select * from public.financial_entries_cash_sales_in_window(
      v_branch_id, v_opened_at, coalesce(v_closed_at, now()), p_session_id
    );
end;
$$;


ALTER FUNCTION "public"."list_cash_session_cash_sales"("p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_orphan_cash_sales"("p_branch_id" "uuid") RETURNS SETOF "public"."financial_entries"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not has_permission('controle-caixa', 'view') then
    raise exception 'Sem permissão para ver o caixa.' using errcode = '42501';
  end if;
  if not has_branch_access(p_branch_id) then
    raise exception 'Sem acesso a esta filial.' using errcode = '42501';
  end if;

  return query
    select fe.*
    from public.financial_entries fe
    join public.sales s on s.id = fe.origin_id
    where fe.origin_kind = 'venda'
      and fe.branch_id = p_branch_id
      and s.cash_session_id is null
      and exists (
        select 1 from public.sale_payments sp
        where sp.sale_id = s.id
          and sp.method = 'dinheiro'
          and sp.amount = fe.total
      )
      and not exists (
        select 1 from public.cash_sessions cs
        where cs.branch_id = p_branch_id
          and fe.created_at >= cs.opened_at
          and fe.created_at <= coalesce(cs.closed_at, now())
      )
    order by fe.created_at asc;
end;
$$;


ALTER FUNCTION "public"."list_orphan_cash_sales"("p_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."module_field_key"("p_label" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case
    when k = '' then ''
    when k ~ '^[0-9]' then 'campo_' || k
    else k
  end
  from (select replace(public.slugify_text(p_label), '-', '_') as k) s;
$$;


ALTER FUNCTION "public"."module_field_key"("p_label" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."module_fields_guard_reference"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_owner_kind text;
  v_ref_kind text;
begin
  if tg_op = 'UPDATE'
     and new.reference_module_id is not distinct from old.reference_module_id then
    return new;
  end if;

  if tg_op = 'INSERT' and new.reference_module_id is null then
    return new;
  end if;

  if not coalesce(public.has_facilite_developer_access(), false) then
    raise exception 'Só um desenvolvedor do Facilite pode apontar um campo para outro módulo.';
  end if;

  -- Limpar a referência já passou pelo portão acima; nada mais a validar.
  if new.reference_module_id is null then
    return new;
  end if;

  if new.reference_module_id = new.module_id then
    raise exception 'Um campo não pode referenciar o próprio módulo.';
  end if;

  select storage_kind into v_owner_kind from public.modules where id = new.module_id;
  select storage_kind into v_ref_kind from public.modules where id = new.reference_module_id;

  if v_owner_kind is distinct from v_ref_kind then
    raise exception 'Campo de referência só existe entre módulos do mesmo tipo de armazenamento (generic com generic, table com table).';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."module_fields_guard_reference"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."module_records_apply_initial_status"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  select s.code into new.status
  from public.module_situations s
  where s.module_id = new.module_id and s.is_initial;
  return new;
end;
$$;


ALTER FUNCTION "public"."module_records_apply_initial_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."module_records_guard_status"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('facilite.workflow_transition', true), '') <> 'on' then
    raise exception 'A situação do registro só muda por uma transição do módulo.';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."module_records_guard_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."open_cash_session"("p_register_id" "uuid", "p_opening_amount" numeric) RETURNS "public"."cash_sessions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_branch_id uuid;
  v_code text;
  v_session public.cash_sessions;
begin
  if not has_permission('controle-caixa', 'create') then
    raise exception 'Sem permissão para abrir caixa.' using errcode = '42501';
  end if;

  select branch_id into v_branch_id from public.cash_registers where id = p_register_id and active = true;
  if v_branch_id is null then
    raise exception 'Caixa não encontrado.';
  end if;
  if not has_branch_access(v_branch_id) then
    raise exception 'Sem acesso a esta filial.' using errcode = '42501';
  end if;
  if p_opening_amount is null or p_opening_amount < 0 then
    raise exception 'Informe o valor de abertura.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_branch_id::text || ':cash_sessions'));

  if exists (select 1 from public.cash_sessions where branch_id = v_branch_id and status = 'aberto') then
    raise exception 'Já existe uma sessão de caixa aberta nesta filial. Feche-a antes de abrir outra.';
  end if;

  select coalesce(max(code::int), 0) + 1 into v_code from public.cash_sessions where branch_id = v_branch_id;
  v_code := lpad(v_code::text, 4, '0');

  insert into public.cash_sessions (
    register_id, branch_id, code, status, opened_at, opened_by, opening_amount
  ) values (
    p_register_id, v_branch_id, v_code, 'aberto', now(), auth.uid(), p_opening_amount
  ) returning * into v_session;

  return v_session;
end;
$$;


ALTER FUNCTION "public"."open_cash_session"("p_register_id" "uuid", "p_opening_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_role_escalation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.role_id is distinct from old.role_id
     and auth.role() <> 'service_role'
     and not public.can_manage_users() then
    raise exception 'Não autorizado a alterar o papel de acesso.';
  end if;

  if new.is_facilite_developer is distinct from old.is_facilite_developer
     and auth.role() is not null then
    raise exception 'is_facilite_developer só pode ser alterado por SQL direto no banco.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_role_escalation"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cash_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "type" "public"."cash_movement_type" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cash_movements_amount_check" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "public"."cash_movements" OWNER TO "postgres";


COMMENT ON TABLE "public"."cash_movements" IS 'Sangria/suprimento de uma sessão de caixa. Sem branch_id próprio — herda via session_id.';



CREATE OR REPLACE FUNCTION "public"."register_cash_movement"("p_session_id" "uuid", "p_type" "public"."cash_movement_type", "p_amount" numeric, "p_description" "text") RETURNS "public"."cash_movements"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_branch_id uuid;
  v_status public.cash_session_status;
  v_movement public.cash_movements;
begin
  if not has_permission('controle-caixa', 'create') then
    raise exception 'Sem permissão para lançar movimentação de caixa.' using errcode = '42501';
  end if;

  select branch_id, status into v_branch_id, v_status from public.cash_sessions where id = p_session_id;
  if v_branch_id is null then
    raise exception 'Sessão de caixa não encontrada.';
  end if;
  if not has_branch_access(v_branch_id) then
    raise exception 'Sem acesso a esta filial.' using errcode = '42501';
  end if;
  if v_status <> 'aberto' then
    raise exception 'A sessão de caixa não está aberta.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Informe um valor maior que zero.';
  end if;

  insert into public.cash_movements (session_id, type, amount, description, created_by)
  values (p_session_id, p_type, p_amount, coalesce(p_description, ''), auth.uid())
  returning * into v_movement;

  return v_movement;
end;
$$;


ALTER FUNCTION "public"."register_cash_movement"("p_session_id" "uuid", "p_type" "public"."cash_movement_type", "p_amount" numeric, "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_conditional_return"("payload" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_conditional_id uuid := (payload->>'conditional_id')::uuid;
  v_conditional public.conditionals;
  v_item jsonb;
  v_ci public.conditional_items;
  v_quantity numeric(14,3);
  v_resolved numeric(14,3);
  v_reason text := coalesce(payload->>'reason', '');
begin
  select * into v_conditional from public.conditionals where id = v_conditional_id for update;
  if v_conditional.id is null then
    raise exception 'Condicional não encontrada.';
  end if;
  if not has_permission('condicionais', 'create') then
    raise exception 'Sem permissão para registrar devolução de condicional.' using errcode = '42501';
  end if;
  if not has_branch_access(v_conditional.branch_id) then
    raise exception 'Sem acesso a esta filial.' using errcode = '42501';
  end if;
  if v_conditional.status <> 'confirmed' then
    raise exception 'Esta condicional não está mais em aberto.';
  end if;
  if payload->'items' is null or jsonb_array_length(payload->'items') = 0 then
    raise exception 'Informe ao menos um item a devolver.';
  end if;

  for v_item in select * from jsonb_array_elements(payload->'items') loop
    v_quantity := (v_item->>'quantity')::numeric;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Quantidade a devolver inválida.';
    end if;

    select * into v_ci from public.conditional_items
      where id = (v_item->>'conditional_item_id')::uuid for update;

    if v_ci.id is null then
      raise exception 'Item da condicional não encontrado.';
    end if;
    if v_ci.conditional_id <> v_conditional_id then
      raise exception 'Item informado não pertence a esta condicional.';
    end if;

    select coalesce((select sum(quantity) from public.conditional_item_returns where conditional_item_id = v_ci.id), 0)
         + coalesce((select sum(quantity) from public.conditional_item_conversions where conditional_item_id = v_ci.id), 0)
      into v_resolved;

    if v_resolved + v_quantity > v_ci.quantity then
      raise exception 'Devolução maior que o saldo da condicional: já resolvidos % de %, tentando devolver mais %.',
        v_resolved, v_ci.quantity, v_quantity
        using errcode = '23514';
    end if;

    insert into public.conditional_item_returns (conditional_item_id, quantity, reason)
    values (v_ci.id, v_quantity, v_reason);

    -- Devolver sempre é permitido, sem checagem de saldo (mesma lógica já
    -- usada em Compras/Devolução de venda para entrada de estoque).
    update public.products set stock = stock + v_quantity, updated_at = now() where id = v_ci.product_id;
  end loop;
end;
$$;


ALTER FUNCTION "public"."register_conditional_return"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_module_situation"("p_id" "uuid", "p_module_id" "text", "p_label" "text", "p_sort_order" integer, "p_is_initial" boolean) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_id uuid;
  v_code text;
  v_row public.module_situations;
  v_initial boolean;
begin
  perform public.assert_module_workflow_editable(p_module_id);

  if coalesce(btrim(p_label), '') = '' then
    raise exception 'Informe um nome para a situação.';
  end if;

  if p_id is null then
    v_code := public.module_field_key(p_label);
    if v_code = '' then
      raise exception 'O nome da situação precisa ter pelo menos uma letra ou número.';
    end if;

    if exists (
      select 1 from public.module_situations
      where module_id = p_module_id and code = v_code
    ) then
      raise exception 'Já existe uma situação com esse nome (código %).', v_code;
    end if;

    -- A primeira situação de um módulo é sempre a inicial: um workflow sem
    -- ponto de partida não conseguiria nem carimbar um registro novo.
    v_initial := coalesce(p_is_initial, false)
      or not exists (select 1 from public.module_situations where module_id = p_module_id);

    if v_initial then
      update public.module_situations set is_initial = false
      where module_id = p_module_id and is_initial;
    end if;

    insert into public.module_situations (module_id, code, label, sort_order, is_initial)
    values (p_module_id, v_code, btrim(p_label), coalesce(p_sort_order, 0), v_initial)
    returning id into v_id;

    return v_id;
  end if;

  select * into v_row from public.module_situations where id = p_id;
  if not found or v_row.module_id <> p_module_id then
    raise exception 'Situação não encontrada neste módulo.';
  end if;

  v_initial := coalesce(p_is_initial, false);

  if v_row.is_initial and not v_initial then
    raise exception 'O módulo precisa de uma situação inicial — marque outra como inicial antes de desmarcar esta.';
  end if;

  if v_initial and not v_row.is_initial then
    update public.module_situations set is_initial = false
    where module_id = p_module_id and is_initial;
  end if;

  -- `code` fica de fora do patch, sempre: é o que está gravado em
  -- `module_records.status`, e trocá-lo orfanaria a situação dos registros
  -- existentes. O rótulo continua livre para mudar.
  update public.module_situations
  set label = btrim(p_label),
      sort_order = coalesce(p_sort_order, 0),
      is_initial = v_initial
  where id = p_id;

  return p_id;
end;
$$;


ALTER FUNCTION "public"."save_module_situation"("p_id" "uuid", "p_module_id" "text", "p_label" "text", "p_sort_order" integer, "p_is_initial" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_module_situation_position"("p_id" "uuid", "p_canvas_x" numeric, "p_canvas_y" numeric) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_module_id text;
begin
  select module_id into v_module_id from public.module_situations where id = p_id;
  if v_module_id is null then
    raise exception 'Situação não encontrada.';
  end if;

  -- Mesmo portão das outras RPCs de workflow: `can_manage_modules` e módulo
  -- de armazenamento genérico. Nenhuma fronteira nova nasce aqui.
  perform public.assert_module_workflow_editable(v_module_id);

  update public.module_situations
  set canvas_x = p_canvas_x,
      canvas_y = p_canvas_y
  where id = p_id;
end;
$$;


ALTER FUNCTION "public"."save_module_situation_position"("p_id" "uuid", "p_canvas_x" numeric, "p_canvas_y" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_module_transition"("p_id" "uuid", "p_module_id" "text", "p_from_situation_id" "uuid", "p_to_situation_id" "uuid", "p_label" "text", "p_sort_order" integer) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_id uuid;
begin
  perform public.assert_module_workflow_editable(p_module_id);

  if coalesce(btrim(p_label), '') = '' then
    raise exception 'Informe um rótulo para a transição (é o texto do botão que o usuário vê).';
  end if;

  if p_id is not null then
    -- Só rótulo e ordem mudam. Trocar o par de situações significaria mudar
    -- o sentido das ações penduradas nesta transição sem elas saberem —
    -- para isso, exclua e recrie.
    update public.module_transitions
    set label = btrim(p_label), sort_order = coalesce(p_sort_order, 0)
    where id = p_id and module_id = p_module_id;

    if not found then
      raise exception 'Transição não encontrada neste módulo.';
    end if;
    return p_id;
  end if;

  if p_from_situation_id = p_to_situation_id then
    raise exception 'A transição precisa ir de uma situação para outra.';
  end if;

  if not exists (
    select 1 from public.module_situations
    where id = p_from_situation_id and module_id = p_module_id
  ) or not exists (
    select 1 from public.module_situations
    where id = p_to_situation_id and module_id = p_module_id
  ) then
    raise exception 'As duas situações da transição precisam ser deste mesmo módulo.';
  end if;

  if exists (
    select 1 from public.module_transitions
    where from_situation_id = p_from_situation_id and to_situation_id = p_to_situation_id
  ) then
    raise exception 'Já existe uma transição entre essas duas situações.';
  end if;

  insert into public.module_transitions (
    module_id, from_situation_id, to_situation_id, label, sort_order
  ) values (
    p_module_id, p_from_situation_id, p_to_situation_id, btrim(p_label), coalesce(p_sort_order, 0)
  )
  returning id into v_id;

  return v_id;
end;
$$;


ALTER FUNCTION "public"."save_module_transition"("p_id" "uuid", "p_module_id" "text", "p_from_situation_id" "uuid", "p_to_situation_id" "uuid", "p_label" "text", "p_sort_order" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_module_transition_action"("p_id" "uuid", "p_transition_id" "uuid", "p_target_kind" "text", "p_target_field_key" "text", "p_via_reference_field_key" "text", "p_value_kind" "text", "p_value" "text", "p_source_field_key" "text", "p_sort_order" integer) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_module_id text;
  v_ref_module_id text;
  v_target_kind text := coalesce(p_target_kind, 'self');
  v_value_kind text := coalesce(p_value_kind, 'literal');
  v_via text := p_via_reference_field_key;
  v_value text := p_value;
  v_source text := p_source_field_key;
  v_target_module_id text;
  v_target_reference text;
  v_id uuid;
  v_found boolean;
begin
  select module_id into v_module_id from public.module_transitions where id = p_transition_id;
  if v_module_id is null then
    raise exception 'Transição não encontrada.';
  end if;

  perform public.assert_module_workflow_editable(v_module_id);

  if v_target_kind not in ('self', 'related_record') then
    raise exception 'Destino de ação desconhecido: %.', v_target_kind;
  end if;
  if v_value_kind not in ('literal', 'now', 'current_user', 'related_field') then
    raise exception 'Origem de valor desconhecida: %.', v_value_kind;
  end if;

  -- ---- Portão da Camada 2 -----------------------------------------
  -- Não é sugestão de UI: um cliente adulterado chamando a RPC direto para
  -- aqui também. Ler ou escrever através de uma referência é a única coisa
  -- que consegue levar dado para o registro errado de outro módulo.
  if v_target_kind = 'related_record' or v_value_kind = 'related_field' then
    if not coalesce(public.has_facilite_developer_access(), false) then
      raise exception 'Ação que lê ou escreve em outro módulo só pode ser configurada por um desenvolvedor do Facilite.';
    end if;
  end if;

  -- Zera o que não se aplica à combinação escolhida, para os CHECK da tabela
  -- não recusarem por sobra de campo vindo de um formulário mal limpo.
  if v_value_kind <> 'literal' then
    v_value := null;
  elsif v_value is null then
    v_value := '';
  end if;
  if v_value_kind <> 'related_field' then
    v_source := null;
  end if;
  if v_target_kind <> 'related_record' and v_value_kind <> 'related_field' then
    v_via := null;
  end if;

  if coalesce(btrim(p_target_field_key), '') = '' then
    raise exception 'Informe o campo que a ação preenche.';
  end if;

  -- ---- O caminho da referência ------------------------------------
  if v_via is not null then
    select reference_module_id into v_ref_module_id
    from public.module_fields
    where module_id = v_module_id and field_key = v_via;

    if not found then
      raise exception 'O campo de referência "%" não existe neste módulo.', v_via;
    end if;
    if v_ref_module_id is null then
      raise exception 'O campo "%" não aponta para outro módulo.', v_via;
    end if;
  end if;

  -- ---- O campo de destino existe? ---------------------------------
  v_target_module_id := case when v_target_kind = 'related_record' then v_ref_module_id else v_module_id end;

  select true, reference_module_id into v_found, v_target_reference
  from public.module_fields
  where module_id = v_target_module_id and field_key = btrim(p_target_field_key);

  if not found then
    raise exception 'O campo de destino "%" não existe no módulo "%".', btrim(p_target_field_key), v_target_module_id;
  end if;

  -- Gravar por cima de um campo de referência quebraria o apontamento que
  -- outras ações usam para chegar no registro relacionado.
  if v_target_reference is not null then
    raise exception 'O campo "%" aponta para outro módulo e não pode ser preenchido por uma ação.', btrim(p_target_field_key);
  end if;

  -- ---- O campo de origem existe? ----------------------------------
  if v_source is not null then
    if not exists (
      select 1 from public.module_fields
      where module_id = v_ref_module_id and field_key = btrim(v_source)
    ) then
      raise exception 'O campo de origem "%" não existe no módulo "%".', btrim(v_source), v_ref_module_id;
    end if;
    v_source := btrim(v_source);
  end if;

  if p_id is null then
    insert into public.module_transition_actions (
      transition_id, sort_order, target_kind, target_field_key,
      via_reference_field_key, value_kind, value, source_field_key
    ) values (
      p_transition_id, coalesce(p_sort_order, 0), v_target_kind, btrim(p_target_field_key),
      v_via, v_value_kind, v_value, v_source
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.module_transition_actions
  set sort_order = coalesce(p_sort_order, 0),
      target_kind = v_target_kind,
      target_field_key = btrim(p_target_field_key),
      via_reference_field_key = v_via,
      value_kind = v_value_kind,
      value = v_value,
      source_field_key = v_source
  where id = p_id and transition_id = p_transition_id;

  if not found then
    raise exception 'Ação não encontrada nesta transição.';
  end if;

  return p_id;
end;
$$;


ALTER FUNCTION "public"."save_module_transition_action"("p_id" "uuid", "p_transition_id" "uuid", "p_target_kind" "text", "p_target_field_key" "text", "p_via_reference_field_key" "text", "p_value_kind" "text", "p_value" "text", "p_source_field_key" "text", "p_sort_order" integer) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kind" "public"."contact_kind" NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "document" "text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "rg" "text",
    "birth_date" "date",
    "phone" "text",
    "email" "text",
    "whatsapp" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "photo_url" "text",
    "inscricao_estadual" "text",
    "indicador_ie" "text",
    "codigo_ibge_municipio" "text",
    "logradouro" "text",
    "numero" "text",
    "bairro" "text",
    "municipio" "text",
    "uf" "text",
    "cep" "text",
    "is_favorite" boolean DEFAULT false NOT NULL,
    CONSTRAINT "contacts_indicador_ie_check" CHECK ((("indicador_ie" IS NULL) OR ("indicador_ie" = ANY (ARRAY['1'::"text", '2'::"text", '9'::"text"]))))
);


ALTER TABLE "public"."contacts" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_contacts_by_kind"("p_kind" "public"."contact_kind", "p_term" "text" DEFAULT ''::"text") RETURNS SETOF "public"."contacts"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select *
  from public.contacts
  where kind = p_kind
    and active = true
    and (
      p_term = '' or
      extensions.unaccent(lower(name)) ilike '%' || extensions.unaccent(lower(p_term)) || '%' or
      extensions.unaccent(lower(document)) ilike '%' || extensions.unaccent(lower(p_term)) || '%'
    )
  order by is_favorite desc, name
  limit 20;
$$;


ALTER FUNCTION "public"."search_contacts_by_kind"("p_kind" "public"."contact_kind", "p_term" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ncm_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "codigo" "text" NOT NULL,
    "descricao" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ncm_codes" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_ncm_codes"("p_term" "text" DEFAULT ''::"text") RETURNS SETOF "public"."ncm_codes"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select *
  from public.ncm_codes
  where p_term = '' or
    codigo ilike p_term || '%' or
    extensions.unaccent(lower(descricao)) ilike '%' || extensions.unaccent(lower(p_term)) || '%'
  order by codigo
  limit 20;
$$;


ALTER FUNCTION "public"."search_ncm_codes"("p_term" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_returnable_sales"("p_branch_id" "uuid", "p_term" "text" DEFAULT ''::"text") RETURNS TABLE("id" "uuid", "code" "text", "client_name" "text", "issue_date" "date", "total_amount" numeric)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
declare
  v_term text := coalesce(p_term, '');
  v_by_code_count integer;
begin
  if v_term = '' then
    return query
      select s.id, s.code, coalesce(c.name, 'Sem cliente'), s.issue_date, s.total_amount
      from public.sales s
      left join public.contacts c on c.id = s.contact_id
      where s.branch_id = p_branch_id and s.status = 'confirmed'
      order by s.created_at desc
      limit 30;
    return;
  end if;

  select count(*) into v_by_code_count
  from public.sales s
  where s.branch_id = p_branch_id
    and s.status = 'confirmed'
    and extensions.unaccent(lower(s.code)) ilike '%' || extensions.unaccent(lower(v_term)) || '%';

  if v_by_code_count > 0 then
    return query
      select s.id, s.code, coalesce(c.name, 'Sem cliente'), s.issue_date, s.total_amount
      from public.sales s
      left join public.contacts c on c.id = s.contact_id
      where s.branch_id = p_branch_id
        and s.status = 'confirmed'
        and extensions.unaccent(lower(s.code)) ilike '%' || extensions.unaccent(lower(v_term)) || '%'
      order by s.created_at desc
      limit 30;
    return;
  end if;

  return query
    select s.id, s.code, coalesce(c.name, 'Sem cliente'), s.issue_date, s.total_amount
    from public.sales s
    join public.contacts c on c.id = s.contact_id
    where s.branch_id = p_branch_id
      and s.status = 'confirmed'
      and extensions.unaccent(lower(c.name)) ilike '%' || extensions.unaccent(lower(v_term)) || '%'
    order by s.created_at desc
    limit 30;
end;
$$;


ALTER FUNCTION "public"."search_returnable_sales"("p_branch_id" "uuid", "p_term" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_sale_sellers"("p_term" "text" DEFAULT ''::"text") RETURNS TABLE("id" "uuid", "name" "text", "operator_code" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select id, name, operator_code
  from public.profiles
  where active = true
    and (
      p_term = '' or
      extensions.unaccent(lower(name)) ilike '%' || extensions.unaccent(lower(p_term)) || '%'
    )
  order by name
  limit 20;
$$;


ALTER FUNCTION "public"."search_sale_sellers"("p_term" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tax_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "cst_icms" "text",
    "csosn" "text",
    "aliquota_icms" numeric(7,4),
    "cst_pis" "text",
    "aliquota_pis" numeric(7,4),
    "cst_cofins" "text",
    "aliquota_cofins" numeric(7,4),
    "cst_ibs_cbs" "text",
    "cclasstrib" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tax_groups" OWNER TO "postgres";


COMMENT ON TABLE "public"."tax_groups" IS 'Grupo tributario: perfil nomeado e reutilizavel de CST/CSOSN e aliquotas, atrelado ao produto (products.tax_group_id). Correcao da etapa 7: CFOP e da operacao (tax_rules), CST/aliquota sao do produto. Nao isolada por filial.';



CREATE OR REPLACE FUNCTION "public"."search_tax_groups"("p_term" "text" DEFAULT ''::"text") RETURNS SETOF "public"."tax_groups"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select *
  from public.tax_groups
  where p_term = '' or
    extensions.unaccent(lower(code)) ilike '%' || extensions.unaccent(lower(p_term)) || '%' or
    extensions.unaccent(lower(name)) ilike '%' || extensions.unaccent(lower(p_term)) || '%'
  order by code
  limit 20;
$$;


ALTER FUNCTION "public"."search_tax_groups"("p_term" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."slugify_text"("p_text" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select trim(both '-' from
    regexp_replace(
      regexp_replace(
        translate(
          lower(coalesce(p_text, '')),
          'áàâãäéèêëíìîïóòôõöúùûüçñ',
          'aaaaaeeeeiiiiooooouuuucn'
        ),
        '[^a-z0-9]+', '-', 'g'
      ),
      '-{2,}', '-', 'g'
    )
  );
$$;


ALTER FUNCTION "public"."slugify_text"("p_text" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stock_allows_negative"("p_branch_id" "uuid", "p_product_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_product_value boolean;
  v_branch_value boolean;
begin
  select allow_negative_stock into v_product_value
  from public.products where id = p_product_id;

  if v_product_value is not null then
    return v_product_value;
  end if;

  select allow_negative_stock into v_branch_value
  from public.branches where id = p_branch_id;

  return v_branch_value;
end;
$$;


ALTER FUNCTION "public"."stock_allows_negative"("p_branch_id" "uuid", "p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_module_records_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_module_records_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transition_module_record"("p_record_id" "uuid", "p_to_situation_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_record public.module_records;
  v_to public.module_situations;
  v_from_code text;
  v_transition public.module_transitions;
  v_action public.module_transition_actions;
  v_ref_module_id text;
  v_related public.module_records;
  v_raw text;
  v_target_id uuid;
  v_target_module_id text;
  v_target_type text;
  v_value text;
  v_now timestamp;
begin
  select * into v_record from public.module_records where id = p_record_id for update;
  if not found then
    raise exception 'Registro não encontrado.';
  end if;

  -- Permissão de quem aciona, no módulo da transição.
  if not coalesce(public.has_permission(v_record.module_id, 'edit'), false) then
    raise exception 'Você não tem permissão para alterar registros deste módulo.';
  end if;

  if v_record.branch_id is not null
     and not coalesce(public.has_branch_access(v_record.branch_id), false) then
    raise exception 'Você não tem acesso à filial deste registro.';
  end if;

  select * into v_to
  from public.module_situations
  where id = p_to_situation_id and module_id = v_record.module_id;
  if not found then
    raise exception 'A situação de destino não pertence a este módulo.';
  end if;

  -- Registro criado antes de o módulo ganhar workflow: a situação atual é a
  -- inicial (é onde ele teria nascido).
  v_from_code := v_record.status;
  if v_from_code is null then
    select code into v_from_code
    from public.module_situations
    where module_id = v_record.module_id and is_initial;
  end if;
  if v_from_code is null then
    raise exception 'Este módulo não tem situações configuradas.';
  end if;

  select t.* into v_transition
  from public.module_transitions t
  join public.module_situations fs on fs.id = t.from_situation_id
  where t.module_id = v_record.module_id
    and fs.code = v_from_code
    and t.to_situation_id = p_to_situation_id;
  if not found then
    raise exception 'Não existe transição da situação atual para "%".', v_to.label;
  end if;

  -- O trigger `module_records_guard_status` só deixa `status` mudar com este
  -- sinal ligado, e ele fica ligado pelo tempo exato deste update.
  perform set_config('facilite.workflow_transition', 'on', true);
  update public.module_records set status = v_to.code where id = p_record_id;
  perform set_config('facilite.workflow_transition', 'off', true);

  -- "Agora" no fuso de quem usa o sistema: o banco roda em UTC, e uma
  -- transição às 22h em São Paulo carimbaria o dia seguinte.
  v_now := timezone('America/Sao_Paulo', now());

  for v_action in
    select * from public.module_transition_actions
    where transition_id = v_transition.id
    order by sort_order, created_at
  loop
    v_related := null;
    v_ref_module_id := null;

    -- ---- Um salto pela referência, quando a ação atravessa ---------
    if v_action.via_reference_field_key is not null then
      select reference_module_id into v_ref_module_id
      from public.module_fields
      where module_id = v_record.module_id and field_key = v_action.via_reference_field_key;

      if v_ref_module_id is null then
        raise exception 'O campo "%" não aponta mais para outro módulo — a ação desta transição ficou inválida.',
          v_action.via_reference_field_key;
      end if;

      v_raw := v_record.data ->> v_action.via_reference_field_key;
      if coalesce(v_raw, '') = '' then
        raise exception 'O campo de referência "%" está vazio neste registro; a transição precisa dele para chegar no módulo "%".',
          v_action.via_reference_field_key, v_ref_module_id;
      end if;

      begin
        v_target_id := v_raw::uuid;
      exception when others then
        raise exception 'O campo de referência "%" não guarda um registro válido.', v_action.via_reference_field_key;
      end;

      -- `for update` só quando a ação vai escrever lá; leitura não precisa
      -- segurar a linha do outro módulo.
      if v_action.target_kind = 'related_record' then
        select * into v_related from public.module_records
        where id = v_target_id and module_id = v_ref_module_id
        for update;
      else
        select * into v_related from public.module_records
        where id = v_target_id and module_id = v_ref_module_id;
      end if;

      -- Referência quebrada (o registro relacionado foi excluído): derruba a
      -- transição inteira, de propósito.
      if not found then
        raise exception 'A referência de "%" aponta para um registro que não existe mais em "%".',
          v_action.via_reference_field_key, v_ref_module_id;
      end if;
    end if;

    -- ---- O campo de destino ainda existe? --------------------------
    v_target_module_id := case
      when v_action.target_kind = 'related_record' then v_ref_module_id
      else v_record.module_id
    end;

    select data_type into v_target_type
    from public.module_fields
    where module_id = v_target_module_id and field_key = v_action.target_field_key;

    if not found then
      raise exception 'O campo de destino "%" não existe mais no módulo "%".',
        v_action.target_field_key, v_target_module_id;
    end if;

    -- ---- O valor -----------------------------------------------------
    if v_action.value_kind = 'literal' then
      v_value := v_action.value;

    elsif v_action.value_kind = 'now' then
      -- Campo de data usa `<input type="date">` no motor, que só entende
      -- `YYYY-MM-DD`; nos demais vale o carimbo completo.
      v_value := case
        when v_target_type = 'date' then to_char(v_now, 'YYYY-MM-DD')
        else to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS')
      end;

    elsif v_action.value_kind = 'current_user' then
      -- O nome, não o uuid: o campo é texto e aparece na ficha; um uuid
      -- deixaria a ficha ilegível. Se um dia existir `data_type` de
      -- referência a usuário, isto passa a gravar o id.
      select coalesce(nullif(btrim(p.name), ''), p.id::text) into v_value
      from public.profiles p where p.id = auth.uid();
      v_value := coalesce(v_value, auth.uid()::text);

    else -- related_field
      v_value := v_related.data ->> v_action.source_field_key;
    end if;

    -- ---- A escrita ---------------------------------------------------
    -- Merge não-destrutivo (`data || jsonb_build_object(...)`), o mesmo que
    -- `genericModuleRepository.ts` já faz: nunca sobrescreve `data` inteiro,
    -- para não apagar chaves de campos removidos que continuam guardadas.
    if v_action.target_kind = 'related_record' then
      update public.module_records
      set data = data || jsonb_build_object(v_action.target_field_key, to_jsonb(v_value))
      where id = v_related.id;
    else
      update public.module_records
      set data = data || jsonb_build_object(v_action.target_field_key, to_jsonb(v_value))
      where id = p_record_id;

      -- Ações seguintes leem `v_record.data` (inclusive para seguir uma
      -- referência); manter a cópia em memória em dia evita que a segunda
      -- ação enxergue o registro como estava antes da primeira.
      select * into v_record from public.module_records where id = p_record_id;
    end if;
  end loop;

  return v_to.code;
end;
$$;


ALTER FUNCTION "public"."transition_module_record"("p_record_id" "uuid", "p_to_situation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_sale_order"("p_id" "uuid", "payload" "jsonb") RETURNS "public"."sale_orders"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order public.sale_orders;
  v_item jsonb;
  v_items_total numeric(14,2) := 0;
  v_product record;
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
    select id, branch_id into v_product from public.products
    where id = (v_item->>'product_id')::uuid;

    if v_product.id is null then
      raise exception 'Produto não encontrado.';
    end if;
    if v_product.branch_id <> v_order.branch_id then
      raise exception 'Produto não pertence à filial do pedido.';
    end if;

    insert into public.sale_order_items (sale_order_id, product_id, quantity, unit_price, discount_amount, total_amount)
    values (
      v_order.id, v_product.id, (v_item->>'quantity')::numeric, (v_item->>'unit_price')::numeric,
      coalesce((v_item->>'discount_amount')::numeric, 0),
      (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric - coalesce((v_item->>'discount_amount')::numeric, 0)
    );

    v_items_total := v_items_total
      + (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric
      - coalesce((v_item->>'discount_amount')::numeric, 0);
  end loop;

  update public.sale_orders set
    subtotal_amount = v_items_total,
    total_amount = v_items_total + freight_amount - discount_amount,
    updated_at = now()
  where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;


ALTER FUNCTION "public"."update_sale_order"("p_id" "uuid", "payload" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."branches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "cnpj" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "inscricao_estadual" "text",
    "regime_tributario" "text",
    "cnae" "text",
    "codigo_ibge_municipio" "text",
    "certificado_digital_ref" "text",
    "logradouro" "text",
    "numero" "text",
    "bairro" "text",
    "municipio" "text",
    "uf" "text",
    "cep" "text",
    "allow_negative_stock" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."branches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cash_registers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cash_registers" OWNER TO "postgres";


COMMENT ON TABLE "public"."cash_registers" IS 'Catálogo de caixas físicos/lógicos de uma filial. Dado operacional, isolado por filial.';



CREATE TABLE IF NOT EXISTS "public"."cfop_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "codigo" "text" NOT NULL,
    "descricao" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cfop_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conditional_item_conversions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conditional_item_id" "uuid" NOT NULL,
    "sale_id" "uuid" NOT NULL,
    "sale_item_id" "uuid" NOT NULL,
    "quantity" numeric(14,3) NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "conditional_item_conversions_quantity_check" CHECK (("quantity" > (0)::numeric))
);


ALTER TABLE "public"."conditional_item_conversions" OWNER TO "postgres";


COMMENT ON TABLE "public"."conditional_item_conversions" IS 'Ponte entre um item de condicional e a venda real criada ao converter (convert_conditional_to_sale). A venda (sales/sale_items/sale_payments) já é o "cabeçalho" desta operação — não precisa de uma tabela de cabeçalho própria.';



CREATE TABLE IF NOT EXISTS "public"."conditional_item_returns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conditional_item_id" "uuid" NOT NULL,
    "quantity" numeric(14,3) NOT NULL,
    "reason" "text" DEFAULT ''::"text" NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "conditional_item_returns_quantity_check" CHECK (("quantity" > (0)::numeric))
);


ALTER TABLE "public"."conditional_item_returns" OWNER TO "postgres";


COMMENT ON TABLE "public"."conditional_item_returns" IS 'Linhas de auditoria de devolução de item de condicional — sem cabeçalho próprio (diferente de sale_returns): não há nota fiscal nem código agrupador para uma devolução de condicional, então uma linha por devolução de item basta. A trava contra devolver mais do que foi enviado mora na RPC (register_conditional_return), não aqui.';



CREATE TABLE IF NOT EXISTS "public"."conditional_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conditional_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "quantity" numeric(14,3) NOT NULL,
    "unit_price" numeric(14,2) NOT NULL,
    "total_amount" numeric(14,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "conditional_items_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "conditional_items_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."conditional_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fiscal_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "sale_id" "uuid",
    "model" "public"."fiscal_document_model" DEFAULT 'nfe'::"public"."fiscal_document_model" NOT NULL,
    "ref" "text" NOT NULL,
    "status" "public"."fiscal_document_status" NOT NULL,
    "chave" "text",
    "numero" "text",
    "serie" "text",
    "protocolo" "text",
    "status_sefaz" "text",
    "mensagem_sefaz" "text",
    "xml_content" "text",
    "xml_path" "text",
    "pdf_content" "text",
    "pdf_path" "text",
    "cancel_xml_content" "text",
    "cancel_xml_path" "text",
    "cancel_justificativa" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "qr_code_url" "text",
    "sale_return_id" "uuid",
    CONSTRAINT "fiscal_documents_one_origin_check" CHECK ((("sale_id" IS NOT NULL) <> ("sale_return_id" IS NOT NULL)))
);


ALTER TABLE "public"."fiscal_documents" OWNER TO "postgres";


COMMENT ON COLUMN "public"."fiscal_documents"."qr_code_url" IS 'URL de consulta do QR Code (NFC-e apenas). O CSC em si não trafega aqui: no provedor real ele é configuração de conta (CNPJ+UF), não campo de payload/registro por emissão.';



CREATE TABLE IF NOT EXISTS "public"."module_fields" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "module_id" "text" NOT NULL,
    "field_key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "data_type" "text" DEFAULT 'text'::"text" NOT NULL,
    "is_required" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "show_in_table" boolean DEFAULT false NOT NULL,
    "table_width" "text",
    "table_align" "text" DEFAULT 'left'::"text",
    "show_in_details" boolean DEFAULT true NOT NULL,
    "show_in_form" boolean DEFAULT true NOT NULL,
    "reference_module_id" "text",
    "hint" "text"
);


ALTER TABLE "public"."module_fields" OWNER TO "postgres";


COMMENT ON COLUMN "public"."module_fields"."reference_module_id" IS 'Quando preenchido, o valor do campo é um module_records.id do módulo apontado. Só desenvolvedor do Facilite grava (trigger module_fields_guard_reference).';



CREATE TABLE IF NOT EXISTS "public"."module_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "module_id" "text" NOT NULL,
    "branch_id" "uuid",
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "status" "text"
);


ALTER TABLE "public"."module_records" OWNER TO "postgres";


COMMENT ON COLUMN "public"."module_records"."status" IS 'Código da situação atual (module_situations.code). Preenchido pelo trigger na criação e alterado só por transition_module_record().';



CREATE TABLE IF NOT EXISTS "public"."module_situations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "module_id" "text" NOT NULL,
    "code" "text" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_initial" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "canvas_x" numeric,
    "canvas_y" numeric
);


ALTER TABLE "public"."module_situations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."module_tabs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "module_id" "text" NOT NULL,
    "tab_key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."module_tabs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."module_transition_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transition_id" "uuid" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "target_kind" "text" DEFAULT 'self'::"text" NOT NULL,
    "target_field_key" "text" NOT NULL,
    "via_reference_field_key" "text",
    "value_kind" "text" NOT NULL,
    "value" "text",
    "source_field_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "module_transition_actions_single_hop_ck" CHECK ((NOT (("target_kind" = 'related_record'::"text") AND ("value_kind" = 'related_field'::"text")))),
    CONSTRAINT "module_transition_actions_source_ck" CHECK ((("source_field_key" IS NOT NULL) = ("value_kind" = 'related_field'::"text"))),
    CONSTRAINT "module_transition_actions_target_kind_ck" CHECK (("target_kind" = ANY (ARRAY['self'::"text", 'related_record'::"text"]))),
    CONSTRAINT "module_transition_actions_value_ck" CHECK ((("value" IS NOT NULL) = ("value_kind" = 'literal'::"text"))),
    CONSTRAINT "module_transition_actions_value_kind_ck" CHECK (("value_kind" = ANY (ARRAY['literal'::"text", 'now'::"text", 'current_user'::"text", 'related_field'::"text"]))),
    CONSTRAINT "module_transition_actions_via_ck" CHECK ((("via_reference_field_key" IS NOT NULL) = (("target_kind" = 'related_record'::"text") OR ("value_kind" = 'related_field'::"text"))))
);


ALTER TABLE "public"."module_transition_actions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."module_transitions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "module_id" "text" NOT NULL,
    "from_situation_id" "uuid" NOT NULL,
    "to_situation_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "module_transitions_distinct_ck" CHECK (("from_situation_id" <> "to_situation_id"))
);


ALTER TABLE "public"."module_transitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."modules" (
    "id" "text" NOT NULL,
    "label" "text" NOT NULL,
    "data_table" "text",
    "layout_variant" "text" DEFAULT 'three'::"text" NOT NULL,
    "is_locked" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "path" "text",
    "icon_key" "text",
    "sort_order" integer DEFAULT 1000 NOT NULL,
    "show_on_home" boolean DEFAULT true NOT NULL,
    "access_gate" "text" DEFAULT 'permission'::"text" NOT NULL,
    "branch_scoped" boolean DEFAULT false NOT NULL,
    "storage_kind" "text" DEFAULT 'table'::"text" NOT NULL,
    CONSTRAINT "modules_access_gate_check" CHECK (("access_gate" = ANY (ARRAY['permission'::"text", 'manage_users'::"text", 'manage_permissions'::"text", 'manage_branches'::"text", 'manage_modules'::"text", 'authenticated'::"text"]))),
    CONSTRAINT "modules_storage_kind_check" CHECK (("storage_kind" = ANY (ARRAY['table'::"text", 'generic'::"text"]))),
    CONSTRAINT "modules_storage_kind_data_table_check" CHECK ((("storage_kind" <> 'generic'::"text") OR ("data_table" IS NULL)))
);


ALTER TABLE "public"."modules" OWNER TO "postgres";


COMMENT ON COLUMN "public"."modules"."data_table" IS 'Tabela de dados do módulo. Nulo para telas sem dados próprios (mock/administrativas); obrigatório para módulo servido pelo motor genérico.';



COMMENT ON COLUMN "public"."modules"."is_locked" IS 'Módulo de sistema (true, entregue com o produto) x módulo criado pelo usuário (false, M3). Até aqui a coluna existia sem nenhum leitor; este é o significado que ela passa a ter.';



COMMENT ON COLUMN "public"."modules"."path" IS 'Rota do módulo (ex.: /produtos). Nulo = item de catálogo sem tela própria (ex.: Relatórios, que hoje é só um tile inerte).';



COMMENT ON COLUMN "public"."modules"."icon_key" IS 'Chave no registro de ícones do código (src/features/modules/moduleIcons.ts). Nulo ou sem entrada = ícone genérico de reserva.';



COMMENT ON COLUMN "public"."modules"."sort_order" IS 'Ordem padrão na tela inicial. A ordem escolhida pelo usuário mora no localStorage e é reconciliada contra esta.';



COMMENT ON COLUMN "public"."modules"."show_on_home" IS 'Se o módulo ganha um tile na tela inicial. Falso para telas alcançadas por outro caminho (Configurações pela engrenagem, Permissões de dentro de Usuários).';



COMMENT ON COLUMN "public"."modules"."access_gate" IS 'Qual portão decide o acesso. As telas administrativas usam as flags globais do papel — colocá-las em ''permission'' criaria um segundo portão que ninguém tem marcado e trancaria todo mundo para fora de /permissoes.';



COMMENT ON COLUMN "public"."modules"."branch_scoped" IS 'Se a tabela de dados é isolada por filial (tem branch_id). Lido pelo motor genérico para filtrar/gravar com a filial ativa.';



CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "description" "text" NOT NULL,
    "stock" numeric DEFAULT 0 NOT NULL,
    "sale_price" numeric DEFAULT 0 NOT NULL,
    "cost_price" numeric,
    "wholesale_price" numeric,
    "type" "text",
    "ncm" "text",
    "location" "text",
    "sub_location" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cest" "text",
    "origem_mercadoria" "text",
    "unidade_comercial" "text",
    "unidade_tributavel" "text",
    "cst_ipi" "text",
    "tax_group_id" "uuid",
    "allow_negative_stock" boolean,
    "minimum_stock" numeric,
    "photo_url" "text"
);


ALTER TABLE "public"."products" OWNER TO "postgres";


COMMENT ON COLUMN "public"."products"."tax_group_id" IS 'Grupo tributario do produto (CST/CSOSN + aliquotas). Fonte unica de tributacao do produto desde 19/08/2026; antes disso os CSTs ficavam soltos em colunas de products.';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "code" "text" DEFAULT ''::"text" NOT NULL,
    "name" "text" NOT NULL,
    "document" "text" DEFAULT ''::"text" NOT NULL,
    "operator_code" "text" DEFAULT ''::"text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "role_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "email" "text" DEFAULT ''::"text" NOT NULL,
    "is_facilite_developer" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."is_facilite_developer" IS 'Desenvolvedor do Facilite. Não é RBAC do cliente: sem UI, só SQL direto no banco (o trigger profiles_prevent_role_escalation recusa qualquer alteração vinda da API).';



CREATE TABLE IF NOT EXISTS "public"."purchase_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "purchase_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "quantity" numeric NOT NULL,
    "unit_cost" numeric NOT NULL,
    "total_amount" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "purchase_items_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "purchase_items_unit_cost_check" CHECK (("unit_cost" >= (0)::numeric))
);


ALTER TABLE "public"."purchase_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."regimes_tributarios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "chave" "text" NOT NULL,
    "rotulo" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."regimes_tributarios" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."report_purchase_items_by_product_day" WITH ("security_invoker"='true') AS
 SELECT "pu"."branch_id",
    "pi"."product_id",
    "p"."code" AS "product_code",
    "p"."description" AS "product_description",
    "pu"."issue_date" AS "purchase_date",
    "sum"("pi"."quantity") AS "quantity",
    "sum"("pi"."total_amount") AS "total_amount",
    "sum"(("pi"."unit_cost" * "pi"."quantity")) AS "cost_amount"
   FROM (("public"."purchase_items" "pi"
     JOIN "public"."purchases" "pu" ON (("pu"."id" = "pi"."purchase_id")))
     LEFT JOIN "public"."products" "p" ON (("p"."id" = "pi"."product_id")))
  WHERE ("pu"."status" = 'confirmed'::"public"."purchase_status")
  GROUP BY "pu"."branch_id", "pi"."product_id", "p"."code", "p"."description", "pu"."issue_date";


ALTER VIEW "public"."report_purchase_items_by_product_day" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."report_purchases_by_contact_day" WITH ("security_invoker"='true') AS
 SELECT "pu"."branch_id",
    "pu"."contact_id",
    "c"."name" AS "contact_name",
    "pu"."issue_date" AS "purchase_date",
    ("count"(*))::integer AS "purchase_count",
    "sum"("pu"."total_amount") AS "total_amount"
   FROM ("public"."purchases" "pu"
     LEFT JOIN "public"."contacts" "c" ON (("c"."id" = "pu"."contact_id")))
  WHERE ("pu"."status" = 'confirmed'::"public"."purchase_status")
  GROUP BY "pu"."branch_id", "pu"."contact_id", "c"."name", "pu"."issue_date";


ALTER VIEW "public"."report_purchases_by_contact_day" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sale_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sale_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "quantity" numeric(14,3) NOT NULL,
    "unit_price" numeric(14,2) NOT NULL,
    "discount_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(14,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cfop" "text",
    CONSTRAINT "sale_items_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "sale_items_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."sale_items" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."report_sale_items_by_product_day" WITH ("security_invoker"='true') AS
 SELECT "s"."branch_id",
    "si"."product_id",
    "p"."code" AS "product_code",
    "p"."description" AS "product_description",
    "s"."issue_date" AS "sale_date",
    "sum"("si"."quantity") AS "quantity",
    "sum"("si"."total_amount") AS "total_amount"
   FROM (("public"."sale_items" "si"
     JOIN "public"."sales" "s" ON (("s"."id" = "si"."sale_id")))
     LEFT JOIN "public"."products" "p" ON (("p"."id" = "si"."product_id")))
  WHERE ("s"."status" = 'confirmed'::"public"."sale_status")
  GROUP BY "s"."branch_id", "si"."product_id", "p"."code", "p"."description", "s"."issue_date";


ALTER VIEW "public"."report_sale_items_by_product_day" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."report_sales_by_contact_day" WITH ("security_invoker"='true') AS
 SELECT "s"."branch_id",
    "s"."contact_id",
    "c"."name" AS "contact_name",
    "s"."issue_date" AS "sale_date",
    ("count"(*))::integer AS "sale_count",
    "sum"("s"."total_amount") AS "total_amount"
   FROM ("public"."sales" "s"
     LEFT JOIN "public"."contacts" "c" ON (("c"."id" = "s"."contact_id")))
  WHERE ("s"."status" = 'confirmed'::"public"."sale_status")
  GROUP BY "s"."branch_id", "s"."contact_id", "c"."name", "s"."issue_date";


ALTER VIEW "public"."report_sales_by_contact_day" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."report_sales_by_day" WITH ("security_invoker"='true') AS
 SELECT "branch_id",
    "issue_date" AS "sale_date",
    ("count"(*))::integer AS "sale_count",
    "sum"("total_amount") AS "total_amount"
   FROM "public"."sales" "s"
  WHERE ("status" = 'confirmed'::"public"."sale_status")
  GROUP BY "branch_id", "issue_date";


ALTER VIEW "public"."report_sales_by_day" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "role_id" "uuid" NOT NULL,
    "module_id" "text" NOT NULL,
    "can_view" boolean DEFAULT false NOT NULL,
    "can_create" boolean DEFAULT false NOT NULL,
    "can_edit" boolean DEFAULT false NOT NULL,
    "can_delete" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "can_manage_permissions" boolean DEFAULT false NOT NULL,
    "can_manage_users" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "can_manage_branches" boolean DEFAULT false NOT NULL,
    "can_manage_modules" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sale_order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sale_order_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "quantity" numeric NOT NULL,
    "unit_price" numeric NOT NULL,
    "discount_amount" numeric DEFAULT 0 NOT NULL,
    "total_amount" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sale_order_items_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "sale_order_items_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."sale_order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sale_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sale_id" "uuid" NOT NULL,
    "method" "public"."sale_payment_method" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "installments" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sale_payments_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "sale_payments_installments_check" CHECK (("installments" >= 1))
);


ALTER TABLE "public"."sale_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sale_return_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sale_return_id" "uuid" NOT NULL,
    "sale_item_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "quantity" numeric(14,3) NOT NULL,
    "unit_price" numeric(14,2) NOT NULL,
    "discount_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(14,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sale_return_items_quantity_check" CHECK (("quantity" > (0)::numeric))
);


ALTER TABLE "public"."sale_return_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_adjustments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "change" numeric(14,2) NOT NULL,
    "reason" "text" NOT NULL,
    "balance_after" numeric(14,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."stock_adjustments" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."stock_movements_view" WITH ("security_barrier"='true') AS
 WITH "movements" AS (
         SELECT ('venda:'::"text" || ("si"."id")::"text") AS "id",
            "s"."branch_id",
            "si"."product_id",
            (- "si"."quantity") AS "quantity_delta",
            'venda'::"text" AS "movement_type",
            "s"."code" AS "origin_code",
            "si"."created_at" AS "occurred_at"
           FROM ("public"."sale_items" "si"
             JOIN "public"."sales" "s" ON (("s"."id" = "si"."sale_id")))
          WHERE (NOT (EXISTS ( SELECT 1
                   FROM "public"."conditional_item_conversions" "cic"
                  WHERE ("cic"."sale_item_id" = "si"."id"))))
        UNION ALL
         SELECT ('compra:'::"text" || ("pi"."id")::"text"),
            "p"."branch_id",
            "pi"."product_id",
            "pi"."quantity",
            'compra'::"text",
            "p"."code",
            "pi"."created_at"
           FROM ("public"."purchase_items" "pi"
             JOIN "public"."purchases" "p" ON (("p"."id" = "pi"."purchase_id")))
        UNION ALL
         SELECT ('condicional:'::"text" || ("ci"."id")::"text"),
            "c"."branch_id",
            "ci"."product_id",
            (- "ci"."quantity"),
            'condicional'::"text",
            "c"."code",
            "ci"."created_at"
           FROM ("public"."conditional_items" "ci"
             JOIN "public"."conditionals" "c" ON (("c"."id" = "ci"."conditional_id")))
        UNION ALL
         SELECT ('condicional-devolucao:'::"text" || ("cir"."id")::"text"),
            "c"."branch_id",
            "ci"."product_id",
            "cir"."quantity",
            'devolucao-condicional'::"text",
            "c"."code",
            "cir"."created_at"
           FROM (("public"."conditional_item_returns" "cir"
             JOIN "public"."conditional_items" "ci" ON (("ci"."id" = "cir"."conditional_item_id")))
             JOIN "public"."conditionals" "c" ON (("c"."id" = "ci"."conditional_id")))
        UNION ALL
         SELECT ('condicional-cancelada:'::"text" || ("ci"."id")::"text"),
            "c"."branch_id",
            "ci"."product_id",
            "ci"."quantity",
            'condicional-cancelada'::"text",
            "c"."code",
            "c"."updated_at"
           FROM ("public"."conditional_items" "ci"
             JOIN "public"."conditionals" "c" ON (("c"."id" = "ci"."conditional_id")))
          WHERE ("c"."status" = 'cancelled'::"public"."conditional_status")
        UNION ALL
         SELECT ('devolucao:'::"text" || ("sri"."id")::"text"),
            "sr"."branch_id",
            "sri"."product_id",
            "sri"."quantity",
            'devolucao'::"text",
            "sr"."code",
            "sri"."created_at"
           FROM ("public"."sale_return_items" "sri"
             JOIN "public"."sale_returns" "sr" ON (("sr"."id" = "sri"."sale_return_id")))
        UNION ALL
         SELECT ('ajuste:'::"text" || ("sa"."id")::"text"),
            "sa"."branch_id",
            "sa"."product_id",
            "sa"."change",
            'ajuste'::"text",
            NULLIF("btrim"("sa"."reason"), ''::"text") AS "nullif",
            "sa"."created_at"
           FROM "public"."stock_adjustments" "sa"
        )
 SELECT "m"."id",
    "m"."branch_id",
    "m"."product_id",
    "m"."quantity_delta",
    "m"."movement_type",
    "m"."origin_code",
    "m"."occurred_at",
    "pr"."code" AS "product_code",
    "pr"."description" AS "product_description"
   FROM ("movements" "m"
     LEFT JOIN "public"."products" "pr" ON (("pr"."id" = "m"."product_id")))
  WHERE ("public"."has_permission"('ajuste-estoque'::"text", 'view'::"text") AND "public"."has_branch_access"("m"."branch_id"));


ALTER VIEW "public"."stock_movements_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tax_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "regime" "text" NOT NULL,
    "natureza_operacao" "text" NOT NULL,
    "uf_origem" "text" NOT NULL,
    "uf_destino" "text" NOT NULL,
    "tipo_cliente" "text" NOT NULL,
    "cfop" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tax_rules" OWNER TO "postgres";


COMMENT ON TABLE "public"."tax_rules" IS 'Regras de CFOP por natureza da operacao x UF origem/destino x tipo de cliente x regime tributario de quem emite. So decide CFOP: CST/aliquota sao do produto, via products.tax_group_id -> tax_groups (correcao de 19/08/2026). Nao isolada por filial. resolveTaxRule() (src/lib/fiscal/taxRules.ts) le esta tabela.';



CREATE TABLE IF NOT EXISTS "public"."tipos_cliente" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "chave" "text" NOT NULL,
    "rotulo" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tipos_cliente" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ufs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sigla" "text" NOT NULL,
    "nome" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ufs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."units_of_measure" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "label" "text" NOT NULL,
    "allows_fraction" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."units_of_measure" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_branches" (
    "user_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL
);


ALTER TABLE "public"."user_branches" OWNER TO "postgres";


ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_movements"
    ADD CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_registers"
    ADD CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_sessions"
    ADD CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cfop_codes"
    ADD CONSTRAINT "cfop_codes_codigo_key" UNIQUE ("codigo");



ALTER TABLE ONLY "public"."cfop_codes"
    ADD CONSTRAINT "cfop_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conditional_item_conversions"
    ADD CONSTRAINT "conditional_item_conversions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conditional_item_returns"
    ADD CONSTRAINT "conditional_item_returns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conditional_items"
    ADD CONSTRAINT "conditional_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conditionals"
    ADD CONSTRAINT "conditionals_branch_id_code_key" UNIQUE ("branch_id", "code");



ALTER TABLE ONLY "public"."conditionals"
    ADD CONSTRAINT "conditionals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_kind_code_key" UNIQUE ("kind", "code");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."financial_entries"
    ADD CONSTRAINT "financial_entries_branch_code_key" UNIQUE ("branch_id", "code");



ALTER TABLE ONLY "public"."financial_entries"
    ADD CONSTRAINT "financial_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fiscal_documents"
    ADD CONSTRAINT "fiscal_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fiscal_documents"
    ADD CONSTRAINT "fiscal_documents_ref_key" UNIQUE ("ref");



ALTER TABLE ONLY "public"."module_fields"
    ADD CONSTRAINT "module_fields_module_id_field_key_key" UNIQUE ("module_id", "field_key");



ALTER TABLE ONLY "public"."module_fields"
    ADD CONSTRAINT "module_fields_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."module_records"
    ADD CONSTRAINT "module_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."module_situations"
    ADD CONSTRAINT "module_situations_module_code_key" UNIQUE ("module_id", "code");



ALTER TABLE ONLY "public"."module_situations"
    ADD CONSTRAINT "module_situations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."module_tabs"
    ADD CONSTRAINT "module_tabs_module_id_tab_key_key" UNIQUE ("module_id", "tab_key");



ALTER TABLE ONLY "public"."module_tabs"
    ADD CONSTRAINT "module_tabs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."module_transition_actions"
    ADD CONSTRAINT "module_transition_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."module_transitions"
    ADD CONSTRAINT "module_transitions_pair_key" UNIQUE ("from_situation_id", "to_situation_id");



ALTER TABLE ONLY "public"."module_transitions"
    ADD CONSTRAINT "module_transitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."modules"
    ADD CONSTRAINT "modules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ncm_codes"
    ADD CONSTRAINT "ncm_codes_codigo_key" UNIQUE ("codigo");



ALTER TABLE ONLY "public"."ncm_codes"
    ADD CONSTRAINT "ncm_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_branch_id_code_key" UNIQUE ("branch_id", "code");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_items"
    ADD CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."regimes_tributarios"
    ADD CONSTRAINT "regimes_tributarios_chave_key" UNIQUE ("chave");



ALTER TABLE ONLY "public"."regimes_tributarios"
    ADD CONSTRAINT "regimes_tributarios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_module_id_key" UNIQUE ("role_id", "module_id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sale_items"
    ADD CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sale_order_items"
    ADD CONSTRAINT "sale_order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sale_orders"
    ADD CONSTRAINT "sale_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sale_payments"
    ADD CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sale_return_items"
    ADD CONSTRAINT "sale_return_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sale_returns"
    ADD CONSTRAINT "sale_returns_code_per_branch_unique" UNIQUE ("branch_id", "code");



ALTER TABLE ONLY "public"."sale_returns"
    ADD CONSTRAINT "sale_returns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_branch_id_code_key" UNIQUE ("branch_id", "code");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_adjustments"
    ADD CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tax_groups"
    ADD CONSTRAINT "tax_groups_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."tax_groups"
    ADD CONSTRAINT "tax_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tax_rules"
    ADD CONSTRAINT "tax_rules_dimensions_unique" UNIQUE ("regime", "natureza_operacao", "uf_origem", "uf_destino", "tipo_cliente");



ALTER TABLE ONLY "public"."tax_rules"
    ADD CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tipos_cliente"
    ADD CONSTRAINT "tipos_cliente_chave_key" UNIQUE ("chave");



ALTER TABLE ONLY "public"."tipos_cliente"
    ADD CONSTRAINT "tipos_cliente_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ufs"
    ADD CONSTRAINT "ufs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ufs"
    ADD CONSTRAINT "ufs_sigla_key" UNIQUE ("sigla");



ALTER TABLE ONLY "public"."units_of_measure"
    ADD CONSTRAINT "units_of_measure_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."units_of_measure"
    ADD CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_branches"
    ADD CONSTRAINT "user_branches_pkey" PRIMARY KEY ("user_id", "branch_id");



CREATE INDEX "cash_movements_created_by_idx" ON "public"."cash_movements" USING "btree" ("created_by");



CREATE INDEX "cash_movements_session_id_idx" ON "public"."cash_movements" USING "btree" ("session_id");



CREATE INDEX "cash_registers_branch_id_idx" ON "public"."cash_registers" USING "btree" ("branch_id");



CREATE INDEX "cash_sessions_branch_id_idx" ON "public"."cash_sessions" USING "btree" ("branch_id");



CREATE INDEX "cash_sessions_closed_by_idx" ON "public"."cash_sessions" USING "btree" ("closed_by");



CREATE UNIQUE INDEX "cash_sessions_one_open_per_branch" ON "public"."cash_sessions" USING "btree" ("branch_id") WHERE ("status" = 'aberto'::"public"."cash_session_status");



CREATE INDEX "cash_sessions_opened_by_idx" ON "public"."cash_sessions" USING "btree" ("opened_by");



CREATE INDEX "cash_sessions_register_id_idx" ON "public"."cash_sessions" USING "btree" ("register_id");



CREATE INDEX "conditional_item_conversions_conditional_item_id_idx" ON "public"."conditional_item_conversions" USING "btree" ("conditional_item_id");



CREATE INDEX "conditional_item_conversions_created_by_idx" ON "public"."conditional_item_conversions" USING "btree" ("created_by");



CREATE INDEX "conditional_item_conversions_sale_id_idx" ON "public"."conditional_item_conversions" USING "btree" ("sale_id");



CREATE INDEX "conditional_item_conversions_sale_item_id_idx" ON "public"."conditional_item_conversions" USING "btree" ("sale_item_id");



CREATE INDEX "conditional_item_returns_conditional_item_id_idx" ON "public"."conditional_item_returns" USING "btree" ("conditional_item_id");



CREATE INDEX "conditional_item_returns_created_by_idx" ON "public"."conditional_item_returns" USING "btree" ("created_by");



CREATE INDEX "conditional_items_conditional_id_idx" ON "public"."conditional_items" USING "btree" ("conditional_id");



CREATE INDEX "conditional_items_product_id_idx" ON "public"."conditional_items" USING "btree" ("product_id");



CREATE INDEX "conditionals_branch_id_idx" ON "public"."conditionals" USING "btree" ("branch_id");



CREATE INDEX "conditionals_contact_id_idx" ON "public"."conditionals" USING "btree" ("contact_id");



CREATE INDEX "conditionals_created_by_idx" ON "public"."conditionals" USING "btree" ("created_by");



CREATE INDEX "contacts_kind_idx" ON "public"."contacts" USING "btree" ("kind");



CREATE INDEX "financial_entries_branch_type_status_idx" ON "public"."financial_entries" USING "btree" ("branch_id", "type", "status", "due_date");



CREATE INDEX "financial_entries_contact_id_idx" ON "public"."financial_entries" USING "btree" ("contact_id");



CREATE INDEX "financial_entries_created_by_idx" ON "public"."financial_entries" USING "btree" ("created_by");



CREATE INDEX "financial_entries_installment_group_idx" ON "public"."financial_entries" USING "btree" ("installment_group_id");



CREATE INDEX "financial_entries_origin_idx" ON "public"."financial_entries" USING "btree" ("origin_kind", "origin_id");



CREATE INDEX "fiscal_documents_branch_id_idx" ON "public"."fiscal_documents" USING "btree" ("branch_id");



CREATE INDEX "fiscal_documents_created_by_idx" ON "public"."fiscal_documents" USING "btree" ("created_by");



CREATE INDEX "fiscal_documents_sale_id_idx" ON "public"."fiscal_documents" USING "btree" ("sale_id");



CREATE UNIQUE INDEX "fiscal_documents_sale_model_unique" ON "public"."fiscal_documents" USING "btree" ("sale_id", "model") WHERE ("sale_id" IS NOT NULL);



CREATE INDEX "fiscal_documents_sale_return_id_idx" ON "public"."fiscal_documents" USING "btree" ("sale_return_id");



CREATE UNIQUE INDEX "fiscal_documents_sale_return_model_unique" ON "public"."fiscal_documents" USING "btree" ("sale_return_id", "model") WHERE ("sale_return_id" IS NOT NULL);



CREATE INDEX "module_fields_reference_module_id_idx" ON "public"."module_fields" USING "btree" ("reference_module_id");



CREATE INDEX "module_records_branch_id_idx" ON "public"."module_records" USING "btree" ("branch_id");



CREATE INDEX "module_records_created_by_idx" ON "public"."module_records" USING "btree" ("created_by");



CREATE INDEX "module_records_module_id_idx" ON "public"."module_records" USING "btree" ("module_id");



CREATE UNIQUE INDEX "module_situations_single_initial_idx" ON "public"."module_situations" USING "btree" ("module_id") WHERE "is_initial";



CREATE INDEX "module_transition_actions_transition_id_idx" ON "public"."module_transition_actions" USING "btree" ("transition_id");



CREATE INDEX "module_transitions_module_id_idx" ON "public"."module_transitions" USING "btree" ("module_id");



CREATE INDEX "module_transitions_to_situation_id_idx" ON "public"."module_transitions" USING "btree" ("to_situation_id");



CREATE UNIQUE INDEX "modules_path_key" ON "public"."modules" USING "btree" ("path") WHERE ("path" IS NOT NULL);



CREATE INDEX "ncm_codes_codigo_idx" ON "public"."ncm_codes" USING "btree" ("codigo");



CREATE INDEX "products_branch_id_idx" ON "public"."products" USING "btree" ("branch_id");



CREATE INDEX "products_tax_group_id_idx" ON "public"."products" USING "btree" ("tax_group_id");



CREATE INDEX "profiles_role_id_idx" ON "public"."profiles" USING "btree" ("role_id");



CREATE INDEX "purchase_items_product_id_idx" ON "public"."purchase_items" USING "btree" ("product_id");



CREATE INDEX "purchase_items_purchase_id_idx" ON "public"."purchase_items" USING "btree" ("purchase_id");



CREATE INDEX "purchases_branch_id_idx" ON "public"."purchases" USING "btree" ("branch_id");



CREATE INDEX "purchases_contact_id_idx" ON "public"."purchases" USING "btree" ("contact_id");



CREATE INDEX "purchases_created_by_idx" ON "public"."purchases" USING "btree" ("created_by");



CREATE INDEX "role_permissions_module_id_idx" ON "public"."role_permissions" USING "btree" ("module_id");



CREATE INDEX "sale_items_product_id_idx" ON "public"."sale_items" USING "btree" ("product_id");



CREATE INDEX "sale_items_sale_id_idx" ON "public"."sale_items" USING "btree" ("sale_id");



CREATE INDEX "sale_order_items_product_id_idx" ON "public"."sale_order_items" USING "btree" ("product_id");



CREATE INDEX "sale_order_items_sale_order_id_idx" ON "public"."sale_order_items" USING "btree" ("sale_order_id");



CREATE INDEX "sale_orders_branch_id_idx" ON "public"."sale_orders" USING "btree" ("branch_id");



CREATE INDEX "sale_orders_contact_id_idx" ON "public"."sale_orders" USING "btree" ("contact_id");



CREATE INDEX "sale_orders_converted_sale_id_idx" ON "public"."sale_orders" USING "btree" ("converted_sale_id");



CREATE INDEX "sale_orders_created_by_idx" ON "public"."sale_orders" USING "btree" ("created_by");



CREATE INDEX "sale_orders_seller_id_idx" ON "public"."sale_orders" USING "btree" ("seller_id");



CREATE INDEX "sale_payments_sale_id_idx" ON "public"."sale_payments" USING "btree" ("sale_id");



CREATE INDEX "sale_return_items_product_id_idx" ON "public"."sale_return_items" USING "btree" ("product_id");



CREATE INDEX "sale_return_items_sale_item_id_idx" ON "public"."sale_return_items" USING "btree" ("sale_item_id");



CREATE INDEX "sale_return_items_sale_return_id_idx" ON "public"."sale_return_items" USING "btree" ("sale_return_id");



CREATE INDEX "sale_returns_branch_id_idx" ON "public"."sale_returns" USING "btree" ("branch_id");



CREATE INDEX "sale_returns_created_by_idx" ON "public"."sale_returns" USING "btree" ("created_by");



CREATE INDEX "sale_returns_sale_id_idx" ON "public"."sale_returns" USING "btree" ("sale_id");



CREATE INDEX "sales_branch_id_idx" ON "public"."sales" USING "btree" ("branch_id");



CREATE INDEX "sales_cash_session_id_idx" ON "public"."sales" USING "btree" ("cash_session_id");



CREATE INDEX "sales_contact_id_idx" ON "public"."sales" USING "btree" ("contact_id");



CREATE INDEX "sales_created_by_idx" ON "public"."sales" USING "btree" ("created_by");



CREATE INDEX "sales_seller_id_idx" ON "public"."sales" USING "btree" ("seller_id");



CREATE INDEX "stock_adjustments_branch_id_idx" ON "public"."stock_adjustments" USING "btree" ("branch_id");



CREATE INDEX "stock_adjustments_created_by_idx" ON "public"."stock_adjustments" USING "btree" ("created_by");



CREATE INDEX "stock_adjustments_product_id_idx" ON "public"."stock_adjustments" USING "btree" ("product_id");



CREATE INDEX "tax_rules_lookup_idx" ON "public"."tax_rules" USING "btree" ("regime", "natureza_operacao", "uf_origem");



CREATE INDEX "user_branches_branch_id_idx" ON "public"."user_branches" USING "btree" ("branch_id");



CREATE OR REPLACE TRIGGER "financial_entries_before_write" BEFORE INSERT OR UPDATE ON "public"."financial_entries" FOR EACH ROW EXECUTE FUNCTION "public"."financial_entries_before_write"();



CREATE OR REPLACE TRIGGER "module_fields_guard_reference" BEFORE INSERT OR UPDATE ON "public"."module_fields" FOR EACH ROW EXECUTE FUNCTION "public"."module_fields_guard_reference"();



CREATE OR REPLACE TRIGGER "module_records_guard_status" BEFORE UPDATE ON "public"."module_records" FOR EACH ROW EXECUTE FUNCTION "public"."module_records_guard_status"();



CREATE OR REPLACE TRIGGER "module_records_set_initial_status" BEFORE INSERT ON "public"."module_records" FOR EACH ROW EXECUTE FUNCTION "public"."module_records_apply_initial_status"();



CREATE OR REPLACE TRIGGER "module_records_touch_updated_at" BEFORE UPDATE ON "public"."module_records" FOR EACH ROW EXECUTE FUNCTION "public"."touch_module_records_updated_at"();



CREATE OR REPLACE TRIGGER "profiles_prevent_role_escalation" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_role_escalation"();



ALTER TABLE ONLY "public"."cash_movements"
    ADD CONSTRAINT "cash_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."cash_movements"
    ADD CONSTRAINT "cash_movements_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."cash_sessions"("id");



ALTER TABLE ONLY "public"."cash_registers"
    ADD CONSTRAINT "cash_registers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."cash_sessions"
    ADD CONSTRAINT "cash_sessions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."cash_sessions"
    ADD CONSTRAINT "cash_sessions_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."cash_sessions"
    ADD CONSTRAINT "cash_sessions_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."cash_sessions"
    ADD CONSTRAINT "cash_sessions_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "public"."cash_registers"("id");



ALTER TABLE ONLY "public"."conditional_item_conversions"
    ADD CONSTRAINT "conditional_item_conversions_conditional_item_id_fkey" FOREIGN KEY ("conditional_item_id") REFERENCES "public"."conditional_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conditional_item_conversions"
    ADD CONSTRAINT "conditional_item_conversions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."conditional_item_conversions"
    ADD CONSTRAINT "conditional_item_conversions_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id");



ALTER TABLE ONLY "public"."conditional_item_conversions"
    ADD CONSTRAINT "conditional_item_conversions_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sale_items"("id");



ALTER TABLE ONLY "public"."conditional_item_returns"
    ADD CONSTRAINT "conditional_item_returns_conditional_item_id_fkey" FOREIGN KEY ("conditional_item_id") REFERENCES "public"."conditional_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conditional_item_returns"
    ADD CONSTRAINT "conditional_item_returns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."conditional_items"
    ADD CONSTRAINT "conditional_items_conditional_id_fkey" FOREIGN KEY ("conditional_id") REFERENCES "public"."conditionals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conditional_items"
    ADD CONSTRAINT "conditional_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."conditionals"
    ADD CONSTRAINT "conditionals_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."conditionals"
    ADD CONSTRAINT "conditionals_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id");



ALTER TABLE ONLY "public"."conditionals"
    ADD CONSTRAINT "conditionals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."financial_entries"
    ADD CONSTRAINT "financial_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."financial_entries"
    ADD CONSTRAINT "financial_entries_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id");



ALTER TABLE ONLY "public"."financial_entries"
    ADD CONSTRAINT "financial_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."fiscal_documents"
    ADD CONSTRAINT "fiscal_documents_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."fiscal_documents"
    ADD CONSTRAINT "fiscal_documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."fiscal_documents"
    ADD CONSTRAINT "fiscal_documents_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id");



ALTER TABLE ONLY "public"."fiscal_documents"
    ADD CONSTRAINT "fiscal_documents_sale_return_id_fkey" FOREIGN KEY ("sale_return_id") REFERENCES "public"."sale_returns"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."module_fields"
    ADD CONSTRAINT "module_fields_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."module_fields"
    ADD CONSTRAINT "module_fields_reference_module_id_fkey" FOREIGN KEY ("reference_module_id") REFERENCES "public"."modules"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."module_records"
    ADD CONSTRAINT "module_records_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."module_records"
    ADD CONSTRAINT "module_records_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."module_records"
    ADD CONSTRAINT "module_records_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."module_situations"
    ADD CONSTRAINT "module_situations_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."module_tabs"
    ADD CONSTRAINT "module_tabs_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."module_transition_actions"
    ADD CONSTRAINT "module_transition_actions_transition_id_fkey" FOREIGN KEY ("transition_id") REFERENCES "public"."module_transitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."module_transitions"
    ADD CONSTRAINT "module_transitions_from_situation_id_fkey" FOREIGN KEY ("from_situation_id") REFERENCES "public"."module_situations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."module_transitions"
    ADD CONSTRAINT "module_transitions_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."module_transitions"
    ADD CONSTRAINT "module_transitions_to_situation_id_fkey" FOREIGN KEY ("to_situation_id") REFERENCES "public"."module_situations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_tax_group_id_fkey" FOREIGN KEY ("tax_group_id") REFERENCES "public"."tax_groups"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id");



ALTER TABLE ONLY "public"."purchase_items"
    ADD CONSTRAINT "purchase_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."purchase_items"
    ADD CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sale_items"
    ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."sale_items"
    ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sale_order_items"
    ADD CONSTRAINT "sale_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."sale_order_items"
    ADD CONSTRAINT "sale_order_items_sale_order_id_fkey" FOREIGN KEY ("sale_order_id") REFERENCES "public"."sale_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sale_orders"
    ADD CONSTRAINT "sale_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."sale_orders"
    ADD CONSTRAINT "sale_orders_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id");



ALTER TABLE ONLY "public"."sale_orders"
    ADD CONSTRAINT "sale_orders_converted_sale_id_fkey" FOREIGN KEY ("converted_sale_id") REFERENCES "public"."sales"("id");



ALTER TABLE ONLY "public"."sale_orders"
    ADD CONSTRAINT "sale_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."sale_orders"
    ADD CONSTRAINT "sale_orders_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."sale_payments"
    ADD CONSTRAINT "sale_payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sale_return_items"
    ADD CONSTRAINT "sale_return_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sale_return_items"
    ADD CONSTRAINT "sale_return_items_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sale_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sale_return_items"
    ADD CONSTRAINT "sale_return_items_sale_return_id_fkey" FOREIGN KEY ("sale_return_id") REFERENCES "public"."sale_returns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sale_returns"
    ADD CONSTRAINT "sale_returns_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sale_returns"
    ADD CONSTRAINT "sale_returns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."sale_returns"
    ADD CONSTRAINT "sale_returns_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."stock_adjustments"
    ADD CONSTRAINT "stock_adjustments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."stock_adjustments"
    ADD CONSTRAINT "stock_adjustments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."stock_adjustments"
    ADD CONSTRAINT "stock_adjustments_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."user_branches"
    ADD CONSTRAINT "user_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_branches"
    ADD CONSTRAINT "user_branches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."branches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cash_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cash_registers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cash_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cfop_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conditional_item_conversions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conditional_item_returns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conditional_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conditionals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "create module_records" ON "public"."module_records" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_permission"("module_id", 'create'::"text") AND (("branch_id" IS NULL) OR "public"."has_branch_access"("branch_id"))));



CREATE POLICY "delete cfop_codes" ON "public"."cfop_codes" FOR DELETE USING ("public"."has_permission"('cfop'::"text", 'delete'::"text"));



CREATE POLICY "delete contacts by permission" ON "public"."contacts" FOR DELETE TO "authenticated" USING ("public"."has_permission"('clientes-fornecedores'::"text", 'delete'::"text"));



CREATE POLICY "delete financial_entries" ON "public"."financial_entries" FOR DELETE TO "authenticated" USING (("public"."has_permission"('financeiro'::"text", 'delete'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "delete module_records" ON "public"."module_records" FOR DELETE TO "authenticated" USING (("public"."has_permission"("module_id", 'delete'::"text") AND (("branch_id" IS NULL) OR "public"."has_branch_access"("branch_id"))));



CREATE POLICY "delete products by permission" ON "public"."products" FOR DELETE TO "authenticated" USING (("public"."has_permission"('produtos'::"text", 'delete'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "delete regimes_tributarios" ON "public"."regimes_tributarios" FOR DELETE USING ("public"."has_permission"('regimes-tributarios'::"text", 'delete'::"text"));



CREATE POLICY "delete tax_groups" ON "public"."tax_groups" FOR DELETE USING ("public"."has_permission"('grupos-tributarios'::"text", 'delete'::"text"));



CREATE POLICY "delete tax_rules" ON "public"."tax_rules" FOR DELETE USING ("public"."has_permission"('tributacoes'::"text", 'delete'::"text"));



CREATE POLICY "delete tipos_cliente" ON "public"."tipos_cliente" FOR DELETE USING ("public"."has_permission"('tipos-cliente'::"text", 'delete'::"text"));



CREATE POLICY "delete ufs" ON "public"."ufs" FOR DELETE USING ("public"."has_permission"('ufs'::"text", 'delete'::"text"));



CREATE POLICY "delete units_of_measure" ON "public"."units_of_measure" FOR DELETE USING ("public"."has_permission"('unidades-medida'::"text", 'delete'::"text"));



ALTER TABLE "public"."financial_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fiscal_documents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "insert cfop_codes" ON "public"."cfop_codes" FOR INSERT WITH CHECK ("public"."has_permission"('cfop'::"text", 'create'::"text"));



CREATE POLICY "insert contacts by permission" ON "public"."contacts" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_permission"('clientes-fornecedores'::"text", 'create'::"text"));



CREATE POLICY "insert financial_entries" ON "public"."financial_entries" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_permission"('financeiro'::"text", 'create'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "insert fiscal_documents" ON "public"."fiscal_documents" FOR INSERT WITH CHECK (("public"."has_permission"('notas-emitidas'::"text", 'create'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "insert products by permission" ON "public"."products" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_permission"('produtos'::"text", 'create'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "insert purchases" ON "public"."purchases" FOR INSERT WITH CHECK (("public"."has_permission"('compras'::"text", 'create'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "insert regimes_tributarios" ON "public"."regimes_tributarios" FOR INSERT WITH CHECK ("public"."has_permission"('regimes-tributarios'::"text", 'create'::"text"));



CREATE POLICY "insert sale_orders" ON "public"."sale_orders" FOR INSERT WITH CHECK (("public"."has_permission"('pedidos-venda'::"text", 'create'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "insert sales" ON "public"."sales" FOR INSERT WITH CHECK (("public"."has_permission"('realizar-venda'::"text", 'create'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "insert tax_groups" ON "public"."tax_groups" FOR INSERT WITH CHECK ("public"."has_permission"('grupos-tributarios'::"text", 'create'::"text"));



CREATE POLICY "insert tax_rules" ON "public"."tax_rules" FOR INSERT WITH CHECK ("public"."has_permission"('tributacoes'::"text", 'create'::"text"));



CREATE POLICY "insert tipos_cliente" ON "public"."tipos_cliente" FOR INSERT WITH CHECK ("public"."has_permission"('tipos-cliente'::"text", 'create'::"text"));



CREATE POLICY "insert ufs" ON "public"."ufs" FOR INSERT WITH CHECK ("public"."has_permission"('ufs'::"text", 'create'::"text"));



CREATE POLICY "insert units_of_measure" ON "public"."units_of_measure" FOR INSERT WITH CHECK ("public"."has_permission"('unidades-medida'::"text", 'create'::"text"));



CREATE POLICY "manage branches delete" ON "public"."branches" FOR DELETE TO "authenticated" USING ("public"."can_manage_branches"());



CREATE POLICY "manage branches insert" ON "public"."branches" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_manage_branches"());



CREATE POLICY "manage branches update" ON "public"."branches" FOR UPDATE TO "authenticated" USING ("public"."can_manage_branches"()) WITH CHECK ("public"."can_manage_branches"());



CREATE POLICY "manage module_fields delete" ON "public"."module_fields" FOR DELETE TO "authenticated" USING (("public"."can_manage_permissions"() OR "public"."can_manage_modules"()));



CREATE POLICY "manage module_fields insert" ON "public"."module_fields" FOR INSERT TO "authenticated" WITH CHECK (("public"."can_manage_permissions"() OR "public"."can_manage_modules"()));



CREATE POLICY "manage module_fields update" ON "public"."module_fields" FOR UPDATE TO "authenticated" USING (("public"."can_manage_permissions"() OR "public"."can_manage_modules"())) WITH CHECK (("public"."can_manage_permissions"() OR "public"."can_manage_modules"()));



CREATE POLICY "manage module_tabs delete" ON "public"."module_tabs" FOR DELETE TO "authenticated" USING ("public"."can_manage_permissions"());



CREATE POLICY "manage module_tabs insert" ON "public"."module_tabs" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_manage_permissions"());



CREATE POLICY "manage module_tabs update" ON "public"."module_tabs" FOR UPDATE TO "authenticated" USING ("public"."can_manage_permissions"()) WITH CHECK ("public"."can_manage_permissions"());



CREATE POLICY "manage modules" ON "public"."modules" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_manage_permissions"());



CREATE POLICY "manage modules delete" ON "public"."modules" FOR DELETE TO "authenticated" USING ("public"."can_manage_permissions"());



CREATE POLICY "manage modules update" ON "public"."modules" FOR UPDATE TO "authenticated" USING (("public"."can_manage_permissions"() OR ("public"."can_manage_modules"() AND ("is_locked" = false)))) WITH CHECK (("public"."can_manage_permissions"() OR ("public"."can_manage_modules"() AND ("is_locked" = false) AND ("access_gate" = 'permission'::"text") AND ("storage_kind" = 'generic'::"text"))));



CREATE POLICY "manage role_permissions delete" ON "public"."role_permissions" FOR DELETE TO "authenticated" USING ("public"."can_manage_permissions"());



CREATE POLICY "manage role_permissions insert" ON "public"."role_permissions" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_manage_permissions"());



CREATE POLICY "manage role_permissions update" ON "public"."role_permissions" FOR UPDATE TO "authenticated" USING ("public"."can_manage_permissions"()) WITH CHECK ("public"."can_manage_permissions"());



CREATE POLICY "manage roles delete" ON "public"."roles" FOR DELETE TO "authenticated" USING ("public"."can_manage_permissions"());



CREATE POLICY "manage roles insert" ON "public"."roles" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_manage_permissions"());



CREATE POLICY "manage roles update" ON "public"."roles" FOR UPDATE TO "authenticated" USING ("public"."can_manage_permissions"()) WITH CHECK ("public"."can_manage_permissions"());



CREATE POLICY "manage user_branches delete" ON "public"."user_branches" FOR DELETE TO "authenticated" USING ("public"."can_manage_branches"());



CREATE POLICY "manage user_branches insert" ON "public"."user_branches" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_manage_branches"());



ALTER TABLE "public"."module_fields" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."module_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."module_situations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."module_tabs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."module_transition_actions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."module_transitions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."modules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ncm_codes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notas-emitidas update sale_items cfop" ON "public"."sale_items" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."sales" "s"
  WHERE (("s"."id" = "sale_items"."sale_id") AND "public"."has_permission"('notas-emitidas'::"text", 'create'::"text") AND "public"."has_branch_access"("s"."branch_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sales" "s"
  WHERE (("s"."id" = "sale_items"."sale_id") AND "public"."has_permission"('notas-emitidas'::"text", 'create'::"text") AND "public"."has_branch_access"("s"."branch_id")))));



ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read accessible branches" ON "public"."branches" FOR SELECT TO "authenticated" USING (("public"."has_branch_access"("id") OR "public"."can_manage_branches"()));



CREATE POLICY "read cash_movements" ON "public"."cash_movements" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."cash_sessions" "cs"
  WHERE (("cs"."id" = "cash_movements"."session_id") AND "public"."has_permission"('controle-caixa'::"text", 'view'::"text") AND "public"."has_branch_access"("cs"."branch_id")))));



CREATE POLICY "read cash_registers" ON "public"."cash_registers" FOR SELECT USING (("public"."has_permission"('controle-caixa'::"text", 'view'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "read cash_sessions" ON "public"."cash_sessions" FOR SELECT USING (("public"."has_permission"('controle-caixa'::"text", 'view'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "read cfop_codes" ON "public"."cfop_codes" FOR SELECT USING ("public"."has_permission"('cfop'::"text", 'view'::"text"));



CREATE POLICY "read conditional_item_conversions" ON "public"."conditional_item_conversions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."conditional_items" "ci"
     JOIN "public"."conditionals" "c" ON (("c"."id" = "ci"."conditional_id")))
  WHERE (("ci"."id" = "conditional_item_conversions"."conditional_item_id") AND "public"."has_permission"('condicionais'::"text", 'view'::"text") AND "public"."has_branch_access"("c"."branch_id")))));



CREATE POLICY "read conditional_item_returns" ON "public"."conditional_item_returns" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."conditional_items" "ci"
     JOIN "public"."conditionals" "c" ON (("c"."id" = "ci"."conditional_id")))
  WHERE (("ci"."id" = "conditional_item_returns"."conditional_item_id") AND "public"."has_permission"('condicionais'::"text", 'view'::"text") AND "public"."has_branch_access"("c"."branch_id")))));



CREATE POLICY "read conditional_items" ON "public"."conditional_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."conditionals" "c"
  WHERE (("c"."id" = "conditional_items"."conditional_id") AND "public"."has_permission"('condicionais'::"text", 'view'::"text") AND "public"."has_branch_access"("c"."branch_id")))));



CREATE POLICY "read conditionals" ON "public"."conditionals" FOR SELECT USING (("public"."has_permission"('condicionais'::"text", 'view'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "read financial_entries" ON "public"."financial_entries" FOR SELECT TO "authenticated" USING (("public"."has_permission"('financeiro'::"text", 'view'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "read fiscal_documents" ON "public"."fiscal_documents" FOR SELECT USING (("public"."has_permission"('notas-emitidas'::"text", 'view'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "read module_fields" ON "public"."module_fields" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read module_records" ON "public"."module_records" FOR SELECT TO "authenticated" USING (("public"."has_permission"("module_id", 'view'::"text") AND (("branch_id" IS NULL) OR "public"."has_branch_access"("branch_id"))));



CREATE POLICY "read module_situations" ON "public"."module_situations" FOR SELECT USING ("public"."has_permission"("module_id", 'view'::"text"));



CREATE POLICY "read module_tabs" ON "public"."module_tabs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read module_transition_actions" ON "public"."module_transition_actions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."module_transitions" "t"
  WHERE (("t"."id" = "module_transition_actions"."transition_id") AND "public"."has_permission"("t"."module_id", 'view'::"text")))));



CREATE POLICY "read module_transitions" ON "public"."module_transitions" FOR SELECT USING ("public"."has_permission"("module_id", 'view'::"text"));



CREATE POLICY "read modules" ON "public"."modules" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read ncm_codes" ON "public"."ncm_codes" FOR SELECT USING ("public"."has_permission"('produtos'::"text", 'view'::"text"));



CREATE POLICY "read own branch links" ON "public"."user_branches" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."can_manage_branches"()));



CREATE POLICY "read purchase_items" ON "public"."purchase_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."purchases" "p"
  WHERE (("p"."id" = "purchase_items"."purchase_id") AND "public"."has_permission"('compras'::"text", 'view'::"text") AND "public"."has_branch_access"("p"."branch_id")))));



CREATE POLICY "read purchases" ON "public"."purchases" FOR SELECT USING (("public"."has_permission"('compras'::"text", 'view'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "read regimes_tributarios" ON "public"."regimes_tributarios" FOR SELECT USING ("public"."has_permission"('regimes-tributarios'::"text", 'view'::"text"));



CREATE POLICY "read role_permissions" ON "public"."role_permissions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read roles" ON "public"."roles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read sale return items" ON "public"."sale_return_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sale_returns" "sr"
  WHERE (("sr"."id" = "sale_return_items"."sale_return_id") AND "public"."has_permission"('devolucao-venda'::"text", 'view'::"text") AND "public"."has_branch_access"("sr"."branch_id")))));



CREATE POLICY "read sale returns" ON "public"."sale_returns" FOR SELECT TO "authenticated" USING (("public"."has_permission"('devolucao-venda'::"text", 'view'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "read sale_items" ON "public"."sale_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."sales" "s"
  WHERE (("s"."id" = "sale_items"."sale_id") AND "public"."has_permission"('realizar-venda'::"text", 'view'::"text") AND "public"."has_branch_access"("s"."branch_id")))));



CREATE POLICY "read sale_order_items" ON "public"."sale_order_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."sale_orders" "so"
  WHERE (("so"."id" = "sale_order_items"."sale_order_id") AND "public"."has_permission"('pedidos-venda'::"text", 'view'::"text") AND "public"."has_branch_access"("so"."branch_id")))));



CREATE POLICY "read sale_orders" ON "public"."sale_orders" FOR SELECT USING (("public"."has_permission"('pedidos-venda'::"text", 'view'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "read sale_payments" ON "public"."sale_payments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."sales" "s"
  WHERE (("s"."id" = "sale_payments"."sale_id") AND "public"."has_permission"('realizar-venda'::"text", 'view'::"text") AND "public"."has_branch_access"("s"."branch_id")))));



CREATE POLICY "read sales" ON "public"."sales" FOR SELECT USING (("public"."has_permission"('realizar-venda'::"text", 'view'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "read stock_adjustments" ON "public"."stock_adjustments" FOR SELECT USING (("public"."has_permission"('ajuste-estoque'::"text", 'view'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "read tax_groups" ON "public"."tax_groups" FOR SELECT USING ("public"."has_permission"('grupos-tributarios'::"text", 'view'::"text"));



CREATE POLICY "read tax_rules" ON "public"."tax_rules" FOR SELECT USING ("public"."has_permission"('tributacoes'::"text", 'view'::"text"));



CREATE POLICY "read tipos_cliente" ON "public"."tipos_cliente" FOR SELECT USING ("public"."has_permission"('tipos-cliente'::"text", 'view'::"text"));



CREATE POLICY "read ufs" ON "public"."ufs" FOR SELECT USING ("public"."has_permission"('ufs'::"text", 'view'::"text"));



CREATE POLICY "read units_of_measure" ON "public"."units_of_measure" FOR SELECT USING ("public"."has_permission"('unidades-medida'::"text", 'view'::"text"));



ALTER TABLE "public"."regimes_tributarios" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sale_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sale_order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sale_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sale_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sale_return_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sale_returns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "select contacts by permission" ON "public"."contacts" FOR SELECT TO "authenticated" USING ("public"."has_permission"('clientes-fornecedores'::"text", 'view'::"text"));



CREATE POLICY "select products by permission" ON "public"."products" FOR SELECT TO "authenticated" USING (("public"."has_permission"('produtos'::"text", 'view'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "select profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."can_manage_users"()));



ALTER TABLE "public"."stock_adjustments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tax_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tax_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tipos_cliente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ufs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."units_of_measure" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "update cfop_codes" ON "public"."cfop_codes" FOR UPDATE USING ("public"."has_permission"('cfop'::"text", 'edit'::"text"));



CREATE POLICY "update contacts by permission" ON "public"."contacts" FOR UPDATE TO "authenticated" USING ("public"."has_permission"('clientes-fornecedores'::"text", 'edit'::"text")) WITH CHECK ("public"."has_permission"('clientes-fornecedores'::"text", 'edit'::"text"));



CREATE POLICY "update financial_entries" ON "public"."financial_entries" FOR UPDATE TO "authenticated" USING (("public"."has_permission"('financeiro'::"text", 'edit'::"text") AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."has_permission"('financeiro'::"text", 'edit'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "update fiscal_documents" ON "public"."fiscal_documents" FOR UPDATE USING (("public"."has_permission"('notas-emitidas'::"text", 'edit'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "update module_records" ON "public"."module_records" FOR UPDATE TO "authenticated" USING (("public"."has_permission"("module_id", 'edit'::"text") AND (("branch_id" IS NULL) OR "public"."has_branch_access"("branch_id")))) WITH CHECK (("public"."has_permission"("module_id", 'edit'::"text") AND (("branch_id" IS NULL) OR "public"."has_branch_access"("branch_id"))));



CREATE POLICY "update products by permission" ON "public"."products" FOR UPDATE TO "authenticated" USING (("public"."has_permission"('produtos'::"text", 'edit'::"text") AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."has_permission"('produtos'::"text", 'edit'::"text") AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "update profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((("id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."can_manage_users"())) WITH CHECK ((("id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."can_manage_users"()));



CREATE POLICY "update regimes_tributarios" ON "public"."regimes_tributarios" FOR UPDATE USING ("public"."has_permission"('regimes-tributarios'::"text", 'edit'::"text"));



CREATE POLICY "update tax_groups" ON "public"."tax_groups" FOR UPDATE USING ("public"."has_permission"('grupos-tributarios'::"text", 'edit'::"text"));



CREATE POLICY "update tax_rules" ON "public"."tax_rules" FOR UPDATE USING ("public"."has_permission"('tributacoes'::"text", 'edit'::"text")) WITH CHECK ("public"."has_permission"('tributacoes'::"text", 'edit'::"text"));



CREATE POLICY "update tipos_cliente" ON "public"."tipos_cliente" FOR UPDATE USING ("public"."has_permission"('tipos-cliente'::"text", 'edit'::"text"));



CREATE POLICY "update ufs" ON "public"."ufs" FOR UPDATE USING ("public"."has_permission"('ufs'::"text", 'edit'::"text"));



CREATE POLICY "update units_of_measure" ON "public"."units_of_measure" FOR UPDATE USING ("public"."has_permission"('unidades-medida'::"text", 'edit'::"text"));



ALTER TABLE "public"."user_branches" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


































































































































































REVOKE ALL ON FUNCTION "public"."adjust_stock_batch"("p_branch_id" "uuid", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."adjust_stock_batch"("p_branch_id" "uuid", "p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."adjust_stock_batch"("p_branch_id" "uuid", "p_items" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."assert_module_workflow_editable"("p_module_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assert_module_workflow_editable"("p_module_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_manage_branches"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_manage_branches"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_branches"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_manage_modules"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_manage_modules"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_modules"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_manage_permissions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_manage_permissions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_permissions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_manage_users"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_manage_users"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_users"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_manage_users_for"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_manage_users_for"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."conditionals" TO "anon";
GRANT ALL ON TABLE "public"."conditionals" TO "authenticated";
GRANT ALL ON TABLE "public"."conditionals" TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_conditional"("p_conditional_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_conditional"("p_conditional_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_conditional"("p_conditional_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."cash_sessions" TO "anon";
GRANT ALL ON TABLE "public"."cash_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."cash_sessions" TO "service_role";



REVOKE ALL ON FUNCTION "public"."close_cash_session"("p_session_id" "uuid", "p_counted_amount" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."close_cash_session"("p_session_id" "uuid", "p_counted_amount" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."close_cash_session"("p_session_id" "uuid", "p_counted_amount" numeric) TO "service_role";



GRANT ALL ON TABLE "public"."sales" TO "anon";
GRANT ALL ON TABLE "public"."sales" TO "authenticated";
GRANT ALL ON TABLE "public"."sales" TO "service_role";



REVOKE ALL ON FUNCTION "public"."convert_conditional_to_sale"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."convert_conditional_to_sale"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."convert_conditional_to_sale"("payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."convert_sale_order_to_sale"("p_sale_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."convert_sale_order_to_sale"("p_sale_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."convert_sale_order_to_sale"("p_sale_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_conditional"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_conditional"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_conditional"("payload" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."financial_entries" TO "anon";
GRANT ALL ON TABLE "public"."financial_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."financial_entries" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_financial_entry_installments"("p_branch_id" "uuid", "p_type" "public"."financial_entry_type", "p_contact_id" "uuid", "p_total" numeric, "p_installment_count" integer, "p_first_due_date" "date", "p_interval_days" integer, "p_payment_method" "text", "p_document" "text", "p_settled" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_financial_entry_installments"("p_branch_id" "uuid", "p_type" "public"."financial_entry_type", "p_contact_id" "uuid", "p_total" numeric, "p_installment_count" integer, "p_first_due_date" "date", "p_interval_days" integer, "p_payment_method" "text", "p_document" "text", "p_settled" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_financial_entry_installments"("p_branch_id" "uuid", "p_type" "public"."financial_entry_type", "p_contact_id" "uuid", "p_total" numeric, "p_installment_count" integer, "p_first_due_date" "date", "p_interval_days" integer, "p_payment_method" "text", "p_document" "text", "p_settled" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_pos_sale"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_pos_sale"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_pos_sale"("payload" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."purchases" TO "anon";
GRANT ALL ON TABLE "public"."purchases" TO "authenticated";
GRANT ALL ON TABLE "public"."purchases" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_purchase"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_purchase"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_purchase"("payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_sale"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_sale"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_sale"("payload" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."sale_orders" TO "anon";
GRANT ALL ON TABLE "public"."sale_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."sale_orders" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_sale_order"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_sale_order"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_sale_order"("payload" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."sale_returns" TO "anon";
GRANT ALL ON TABLE "public"."sale_returns" TO "authenticated";
GRANT ALL ON TABLE "public"."sale_returns" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_sale_return"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_sale_return"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_sale_return"("payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_user_module"("p_label" "text", "p_branch_scoped" boolean, "p_sort_order" integer, "p_fields" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_user_module"("p_label" "text", "p_branch_scoped" boolean, "p_sort_order" integer, "p_fields" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_user_module"("p_label" "text", "p_branch_scoped" boolean, "p_sort_order" integer, "p_fields" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_module_situation"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_module_situation"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_module_situation"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_module_transition"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_module_transition"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_module_transition"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_module_transition_action"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_module_transition_action"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_module_transition_action"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_user_module"("p_module_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_user_module"("p_module_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_user_module"("p_module_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."financial_entries_before_write"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."financial_entries_before_write"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."financial_entries_cash_sales_in_window"("p_branch_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."financial_entries_cash_sales_in_window"("p_branch_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."financial_entries_create_installments"("p_branch_id" "uuid", "p_type" "public"."financial_entry_type", "p_contact_id" "uuid", "p_total" numeric, "p_installment_count" integer, "p_first_due_date" "date", "p_interval_days" integer, "p_payment_method" "text", "p_document" "text", "p_origin_kind" "public"."financial_entry_origin_kind", "p_origin_id" "uuid", "p_settled" boolean, "p_issue_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."financial_entries_create_installments"("p_branch_id" "uuid", "p_type" "public"."financial_entry_type", "p_contact_id" "uuid", "p_total" numeric, "p_installment_count" integer, "p_first_due_date" "date", "p_interval_days" integer, "p_payment_method" "text", "p_document" "text", "p_origin_kind" "public"."financial_entry_origin_kind", "p_origin_id" "uuid", "p_settled" boolean, "p_issue_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_branch_access"("p_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_branch_access"("p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_branch_access"("p_branch_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_facilite_developer_access"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_facilite_developer_access"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_facilite_developer_access"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_permission"("p_module_id" "text", "p_action" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_permission"("p_module_id" "text", "p_action" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_permission"("p_module_id" "text", "p_action" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_cash_session_cash_sales"("p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_cash_session_cash_sales"("p_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_cash_session_cash_sales"("p_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_orphan_cash_sales"("p_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_orphan_cash_sales"("p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_orphan_cash_sales"("p_branch_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."module_field_key"("p_label" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."module_field_key"("p_label" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."module_field_key"("p_label" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."module_fields_guard_reference"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."module_fields_guard_reference"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."module_records_apply_initial_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."module_records_apply_initial_status"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."module_records_guard_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."module_records_guard_status"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."open_cash_session"("p_register_id" "uuid", "p_opening_amount" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."open_cash_session"("p_register_id" "uuid", "p_opening_amount" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."open_cash_session"("p_register_id" "uuid", "p_opening_amount" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_role_escalation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_role_escalation"() TO "service_role";



GRANT ALL ON TABLE "public"."cash_movements" TO "anon";
GRANT ALL ON TABLE "public"."cash_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."cash_movements" TO "service_role";



REVOKE ALL ON FUNCTION "public"."register_cash_movement"("p_session_id" "uuid", "p_type" "public"."cash_movement_type", "p_amount" numeric, "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_cash_movement"("p_session_id" "uuid", "p_type" "public"."cash_movement_type", "p_amount" numeric, "p_description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_cash_movement"("p_session_id" "uuid", "p_type" "public"."cash_movement_type", "p_amount" numeric, "p_description" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."register_conditional_return"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_conditional_return"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_conditional_return"("payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_module_situation"("p_id" "uuid", "p_module_id" "text", "p_label" "text", "p_sort_order" integer, "p_is_initial" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_module_situation"("p_id" "uuid", "p_module_id" "text", "p_label" "text", "p_sort_order" integer, "p_is_initial" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_module_situation"("p_id" "uuid", "p_module_id" "text", "p_label" "text", "p_sort_order" integer, "p_is_initial" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_module_situation_position"("p_id" "uuid", "p_canvas_x" numeric, "p_canvas_y" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_module_situation_position"("p_id" "uuid", "p_canvas_x" numeric, "p_canvas_y" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_module_situation_position"("p_id" "uuid", "p_canvas_x" numeric, "p_canvas_y" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_module_transition"("p_id" "uuid", "p_module_id" "text", "p_from_situation_id" "uuid", "p_to_situation_id" "uuid", "p_label" "text", "p_sort_order" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_module_transition"("p_id" "uuid", "p_module_id" "text", "p_from_situation_id" "uuid", "p_to_situation_id" "uuid", "p_label" "text", "p_sort_order" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_module_transition"("p_id" "uuid", "p_module_id" "text", "p_from_situation_id" "uuid", "p_to_situation_id" "uuid", "p_label" "text", "p_sort_order" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_module_transition_action"("p_id" "uuid", "p_transition_id" "uuid", "p_target_kind" "text", "p_target_field_key" "text", "p_via_reference_field_key" "text", "p_value_kind" "text", "p_value" "text", "p_source_field_key" "text", "p_sort_order" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_module_transition_action"("p_id" "uuid", "p_transition_id" "uuid", "p_target_kind" "text", "p_target_field_key" "text", "p_via_reference_field_key" "text", "p_value_kind" "text", "p_value" "text", "p_source_field_key" "text", "p_sort_order" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_module_transition_action"("p_id" "uuid", "p_transition_id" "uuid", "p_target_kind" "text", "p_target_field_key" "text", "p_via_reference_field_key" "text", "p_value_kind" "text", "p_value" "text", "p_source_field_key" "text", "p_sort_order" integer) TO "service_role";



GRANT ALL ON TABLE "public"."contacts" TO "anon";
GRANT ALL ON TABLE "public"."contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."contacts" TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_contacts_by_kind"("p_kind" "public"."contact_kind", "p_term" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_contacts_by_kind"("p_kind" "public"."contact_kind", "p_term" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_contacts_by_kind"("p_kind" "public"."contact_kind", "p_term" "text") TO "service_role";



GRANT ALL ON TABLE "public"."ncm_codes" TO "anon";
GRANT ALL ON TABLE "public"."ncm_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."ncm_codes" TO "service_role";



GRANT ALL ON FUNCTION "public"."search_ncm_codes"("p_term" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."search_ncm_codes"("p_term" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_ncm_codes"("p_term" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_returnable_sales"("p_branch_id" "uuid", "p_term" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_returnable_sales"("p_branch_id" "uuid", "p_term" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_returnable_sales"("p_branch_id" "uuid", "p_term" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_sale_sellers"("p_term" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_sale_sellers"("p_term" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_sale_sellers"("p_term" "text") TO "service_role";



GRANT ALL ON TABLE "public"."tax_groups" TO "anon";
GRANT ALL ON TABLE "public"."tax_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."tax_groups" TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_tax_groups"("p_term" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_tax_groups"("p_term" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_tax_groups"("p_term" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."slugify_text"("p_text" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."slugify_text"("p_text" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."slugify_text"("p_text" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."stock_allows_negative"("p_branch_id" "uuid", "p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stock_allows_negative"("p_branch_id" "uuid", "p_product_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_module_records_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_module_records_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_module_records_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."transition_module_record"("p_record_id" "uuid", "p_to_situation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transition_module_record"("p_record_id" "uuid", "p_to_situation_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."transition_module_record"("p_record_id" "uuid", "p_to_situation_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_sale_order"("p_id" "uuid", "payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_sale_order"("p_id" "uuid", "payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_sale_order"("p_id" "uuid", "payload" "jsonb") TO "service_role";


















GRANT ALL ON TABLE "public"."branches" TO "anon";
GRANT ALL ON TABLE "public"."branches" TO "authenticated";
GRANT ALL ON TABLE "public"."branches" TO "service_role";



GRANT ALL ON TABLE "public"."cash_registers" TO "anon";
GRANT ALL ON TABLE "public"."cash_registers" TO "authenticated";
GRANT ALL ON TABLE "public"."cash_registers" TO "service_role";



GRANT ALL ON TABLE "public"."cfop_codes" TO "anon";
GRANT ALL ON TABLE "public"."cfop_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."cfop_codes" TO "service_role";



GRANT ALL ON TABLE "public"."conditional_item_conversions" TO "anon";
GRANT ALL ON TABLE "public"."conditional_item_conversions" TO "authenticated";
GRANT ALL ON TABLE "public"."conditional_item_conversions" TO "service_role";



GRANT ALL ON TABLE "public"."conditional_item_returns" TO "anon";
GRANT ALL ON TABLE "public"."conditional_item_returns" TO "authenticated";
GRANT ALL ON TABLE "public"."conditional_item_returns" TO "service_role";



GRANT ALL ON TABLE "public"."conditional_items" TO "anon";
GRANT ALL ON TABLE "public"."conditional_items" TO "authenticated";
GRANT ALL ON TABLE "public"."conditional_items" TO "service_role";



GRANT ALL ON TABLE "public"."fiscal_documents" TO "anon";
GRANT ALL ON TABLE "public"."fiscal_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."fiscal_documents" TO "service_role";



GRANT ALL ON TABLE "public"."module_fields" TO "anon";
GRANT ALL ON TABLE "public"."module_fields" TO "authenticated";
GRANT ALL ON TABLE "public"."module_fields" TO "service_role";



GRANT ALL ON TABLE "public"."module_records" TO "anon";
GRANT ALL ON TABLE "public"."module_records" TO "authenticated";
GRANT ALL ON TABLE "public"."module_records" TO "service_role";



GRANT ALL ON TABLE "public"."module_situations" TO "anon";
GRANT ALL ON TABLE "public"."module_situations" TO "authenticated";
GRANT ALL ON TABLE "public"."module_situations" TO "service_role";



GRANT ALL ON TABLE "public"."module_tabs" TO "anon";
GRANT ALL ON TABLE "public"."module_tabs" TO "authenticated";
GRANT ALL ON TABLE "public"."module_tabs" TO "service_role";



GRANT ALL ON TABLE "public"."module_transition_actions" TO "anon";
GRANT ALL ON TABLE "public"."module_transition_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."module_transition_actions" TO "service_role";



GRANT ALL ON TABLE "public"."module_transitions" TO "anon";
GRANT ALL ON TABLE "public"."module_transitions" TO "authenticated";
GRANT ALL ON TABLE "public"."module_transitions" TO "service_role";



GRANT ALL ON TABLE "public"."modules" TO "anon";
GRANT ALL ON TABLE "public"."modules" TO "authenticated";
GRANT ALL ON TABLE "public"."modules" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_items" TO "anon";
GRANT ALL ON TABLE "public"."purchase_items" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_items" TO "service_role";



GRANT ALL ON TABLE "public"."regimes_tributarios" TO "anon";
GRANT ALL ON TABLE "public"."regimes_tributarios" TO "authenticated";
GRANT ALL ON TABLE "public"."regimes_tributarios" TO "service_role";



GRANT ALL ON TABLE "public"."report_purchase_items_by_product_day" TO "anon";
GRANT ALL ON TABLE "public"."report_purchase_items_by_product_day" TO "authenticated";
GRANT ALL ON TABLE "public"."report_purchase_items_by_product_day" TO "service_role";



GRANT ALL ON TABLE "public"."report_purchases_by_contact_day" TO "anon";
GRANT ALL ON TABLE "public"."report_purchases_by_contact_day" TO "authenticated";
GRANT ALL ON TABLE "public"."report_purchases_by_contact_day" TO "service_role";



GRANT ALL ON TABLE "public"."sale_items" TO "anon";
GRANT ALL ON TABLE "public"."sale_items" TO "authenticated";
GRANT ALL ON TABLE "public"."sale_items" TO "service_role";



GRANT ALL ON TABLE "public"."report_sale_items_by_product_day" TO "anon";
GRANT ALL ON TABLE "public"."report_sale_items_by_product_day" TO "authenticated";
GRANT ALL ON TABLE "public"."report_sale_items_by_product_day" TO "service_role";



GRANT ALL ON TABLE "public"."report_sales_by_contact_day" TO "anon";
GRANT ALL ON TABLE "public"."report_sales_by_contact_day" TO "authenticated";
GRANT ALL ON TABLE "public"."report_sales_by_contact_day" TO "service_role";



GRANT ALL ON TABLE "public"."report_sales_by_day" TO "anon";
GRANT ALL ON TABLE "public"."report_sales_by_day" TO "authenticated";
GRANT ALL ON TABLE "public"."report_sales_by_day" TO "service_role";



GRANT ALL ON TABLE "public"."role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";



GRANT ALL ON TABLE "public"."sale_order_items" TO "anon";
GRANT ALL ON TABLE "public"."sale_order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."sale_order_items" TO "service_role";



GRANT ALL ON TABLE "public"."sale_payments" TO "anon";
GRANT ALL ON TABLE "public"."sale_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."sale_payments" TO "service_role";



GRANT ALL ON TABLE "public"."sale_return_items" TO "anon";
GRANT ALL ON TABLE "public"."sale_return_items" TO "authenticated";
GRANT ALL ON TABLE "public"."sale_return_items" TO "service_role";



GRANT ALL ON TABLE "public"."stock_adjustments" TO "anon";
GRANT ALL ON TABLE "public"."stock_adjustments" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_adjustments" TO "service_role";



GRANT ALL ON TABLE "public"."stock_movements_view" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_movements_view" TO "service_role";



GRANT ALL ON TABLE "public"."tax_rules" TO "anon";
GRANT ALL ON TABLE "public"."tax_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."tax_rules" TO "service_role";



GRANT ALL ON TABLE "public"."tipos_cliente" TO "anon";
GRANT ALL ON TABLE "public"."tipos_cliente" TO "authenticated";
GRANT ALL ON TABLE "public"."tipos_cliente" TO "service_role";



GRANT ALL ON TABLE "public"."ufs" TO "anon";
GRANT ALL ON TABLE "public"."ufs" TO "authenticated";
GRANT ALL ON TABLE "public"."ufs" TO "service_role";



GRANT ALL ON TABLE "public"."units_of_measure" TO "anon";
GRANT ALL ON TABLE "public"."units_of_measure" TO "authenticated";
GRANT ALL ON TABLE "public"."units_of_measure" TO "service_role";



GRANT ALL ON TABLE "public"."user_branches" TO "anon";
GRANT ALL ON TABLE "public"."user_branches" TO "authenticated";
GRANT ALL ON TABLE "public"."user_branches" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































