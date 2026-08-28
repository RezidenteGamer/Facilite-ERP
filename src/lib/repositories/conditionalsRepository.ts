/**
 * Módulo Condicionais (etapa 10) — leitura das condicionais e as quatro RPCs
 * que escrevem (`create_conditional`, `register_conditional_return`,
 * `convert_conditional_to_sale`, `cancel_conditional`).
 *
 * Mesma trava de Devolução de venda: não há policy de `insert`/`update` em
 * nenhuma das quatro tabelas para o cliente direto — só as RPCs
 * (`security definer`) escrevem.
 *
 * O status mostrado na lista ("Em aberto"/"Vencida"/"Parcialmente
 * resolvida"/"Devolvida"/"Convertida em venda"/"Cancelada") **não é uma
 * coluna** — é calculado aqui a partir da soma de `conditional_item_returns`/
 * `conditional_item_conversions` contra a quantidade enviada de cada item,
 * mais a comparação de `due_date` com hoje. Mesmo raciocínio já usado para
 * "vencido" em Financeiro: um status guardado poderia divergir do que os
 * movimentos realmente dizem, e aqui isso seria pior porque devolução parcial
 * cria estados que um enum fixo não cobre sozinho.
 */
import { supabase } from "../supabaseClient";
import type { Tables } from "../../types/supabase";
import type { SalePaymentMethod } from "../../features/sales/sales";

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

type ConditionalRow = Tables<"conditionals">;

export type ConditionalStatus =
  | "Em aberto"
  | "Vencida"
  | "Parcialmente resolvida"
  | "Devolvida"
  | "Convertida em venda"
  | "Cancelada";

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * O quinto rótulo do mock original ("Em aberto"/"Vencida"/"Devolvida"/
 * "Convertida em venda") não cobria uma condicional resolvida aos poucos
 * (3 itens devolvidos, 2 convertidos, da mesma condicional) — caso real, não
 * extremo. "Parcialmente resolvida" cobre tanto "ainda falta resolver algo"
 * quanto "tudo resolvido, mas misturado entre devolução e conversão".
 *
 * "Vencida" é só um alerta visual (mesmo espírito de "vencido" em
 * Financeiro) — só se aplica enquanto sobra algo a resolver; uma condicional
 * já totalmente resolvida nunca é "vencida", mesmo que o prazo já tenha
 * passado (mesma lógica de "baixado" nunca ser "vencido" no Financeiro).
 */
export function computeConditionalStatus(input: {
  headerStatus: ConditionalRow["status"];
  totalSent: number;
  totalReturned: number;
  totalConverted: number;
  dueDate: string;
}): ConditionalStatus {
  if (input.headerStatus === "cancelled") return "Cancelada";

  const remaining = Math.max(input.totalSent - input.totalReturned - input.totalConverted, 0);

  if (remaining === 0) {
    if (input.totalSent > 0 && input.totalConverted === input.totalSent) return "Convertida em venda";
    if (input.totalSent > 0 && input.totalReturned === input.totalSent) return "Devolvida";
    return "Parcialmente resolvida";
  }

  const overdue = input.dueDate < todayIso();
  if (input.totalReturned === 0 && input.totalConverted === 0) {
    return overdue ? "Vencida" : "Em aberto";
  }
  return overdue ? "Vencida" : "Parcialmente resolvida";
}

export type ConditionalListRow = {
  id: string;
  code: string;
  clientName: string;
  issueDate: string;
  dueDate: string;
  totalAmount: number;
  itemCount: number;
  status: ConditionalStatus;
};

/** As condicionais da filial, com o status computado a partir dos movimentos de cada item. */
export async function fetchConditionals(branchId: string): Promise<ConditionalListRow[]> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("conditionals")
    .select(
      `id, code, issue_date, due_date, status, total_amount,
       contact:contacts(name),
       items:conditional_items(id, quantity,
         returns:conditional_item_returns(quantity),
         conversions:conditional_item_conversions(quantity))`,
    )
    .eq("branch_id", branchId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const items = row.items ?? [];
    const totalSent = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalReturned = items.reduce(
      (sum, item) => sum + (item.returns ?? []).reduce((s, r) => s + r.quantity, 0),
      0,
    );
    const totalConverted = items.reduce(
      (sum, item) => sum + (item.conversions ?? []).reduce((s, c) => s + c.quantity, 0),
      0,
    );

    return {
      id: row.id,
      code: row.code,
      clientName: row.contact?.name ?? "Consumidor final",
      issueDate: row.issue_date,
      dueDate: row.due_date,
      totalAmount: row.total_amount,
      itemCount: items.length,
      status: computeConditionalStatus({
        headerStatus: row.status,
        totalSent,
        totalReturned,
        totalConverted,
        dueDate: row.due_date,
      }),
    };
  });
}

export type ConditionalDetailItem = {
  conditionalItemId: string;
  productId: string;
  productCode: string;
  productDescription: string;
  /** Quantidade enviada nesta linha, na criação da condicional. */
  quantity: number;
  returnedQuantity: number;
  convertedQuantity: number;
  /** `quantity - returnedQuantity - convertedQuantity` — o teto de qualquer ação nova. */
  remainingQuantity: number;
  unitPrice: number;
};

export type ConditionalDetail = {
  conditionalId: string;
  code: string;
  clientName: string;
  issueDate: string;
  dueDate: string;
  headerStatus: ConditionalRow["status"];
  items: ConditionalDetailItem[];
};

/**
 * A condicional selecionada, com o saldo **ainda disponível** de cada item —
 * o que "Registrar devolução"/"Converter em venda" operam. Mesmo espírito de
 * `fetchReturnableSaleDetail` em Devolução de venda: quem realmente barra é a
 * RPC (recalcula a mesma soma sob `for update`), isto é só para a tela não
 * deixar o operador digitar um número impossível.
 */
export async function fetchConditionalDetail(conditionalId: string): Promise<ConditionalDetail> {
  const client = assertSupabase();
  const [{ data: conditional, error: conditionalError }, { data: returns, error: returnsError }, { data: conversions, error: conversionsError }] =
    await Promise.all([
      client
        .from("conditionals")
        .select(
          `id, code, issue_date, due_date, status, contact:contacts(name),
           items:conditional_items(id, product_id, quantity, unit_price, product:products(code, description))`,
        )
        .eq("id", conditionalId)
        .single(),
      client
        .from("conditional_item_returns")
        .select("conditional_item_id, quantity, conditional_items!inner(conditional_id)")
        .eq("conditional_items.conditional_id", conditionalId),
      client
        .from("conditional_item_conversions")
        .select("conditional_item_id, quantity, conditional_items!inner(conditional_id)")
        .eq("conditional_items.conditional_id", conditionalId),
    ]);
  if (conditionalError) throw conditionalError;
  if (returnsError) throw returnsError;
  if (conversionsError) throw conversionsError;

  const returnedByItem = new Map<string, number>();
  for (const row of returns ?? []) {
    returnedByItem.set(row.conditional_item_id, (returnedByItem.get(row.conditional_item_id) ?? 0) + row.quantity);
  }
  const convertedByItem = new Map<string, number>();
  for (const row of conversions ?? []) {
    convertedByItem.set(row.conditional_item_id, (convertedByItem.get(row.conditional_item_id) ?? 0) + row.quantity);
  }

  return {
    conditionalId: conditional.id,
    code: conditional.code,
    clientName: conditional.contact?.name ?? "Consumidor final",
    issueDate: conditional.issue_date,
    dueDate: conditional.due_date,
    headerStatus: conditional.status,
    items: (conditional.items ?? []).map((item) => {
      const returnedQuantity = returnedByItem.get(item.id) ?? 0;
      const convertedQuantity = convertedByItem.get(item.id) ?? 0;
      return {
        conditionalItemId: item.id,
        productId: item.product_id,
        productCode: item.product?.code ?? "",
        productDescription: item.product?.description ?? "",
        quantity: item.quantity,
        returnedQuantity,
        convertedQuantity,
        remainingQuantity: Math.max(item.quantity - returnedQuantity - convertedQuantity, 0),
        unitPrice: item.unit_price,
      };
    }),
  };
}

/* ------------------------------------------------------------------------ */
/* Criação                                                                  */
/* ------------------------------------------------------------------------ */

export type CreateConditionalInput = {
  branchId: string;
  contactId: string;
  dueDate: string;
  items: { productId: string; quantity: number; unitPrice: number }[];
};

export async function createConditional(input: CreateConditionalInput): Promise<ConditionalRow> {
  const client = assertSupabase();
  const { data, error } = await client.rpc("create_conditional", {
    payload: {
      branch_id: input.branchId,
      contact_id: input.contactId,
      due_date: input.dueDate,
      items: input.items.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
        unit_price: item.unitPrice,
      })),
    },
  });
  if (error) throw error;
  return data as unknown as ConditionalRow;
}

/* ------------------------------------------------------------------------ */
/* Devolução                                                                */
/* ------------------------------------------------------------------------ */

export type RegisterConditionalReturnInput = {
  conditionalId: string;
  reason: string;
  items: { conditionalItemId: string; quantity: number }[];
};

export async function registerConditionalReturn(input: RegisterConditionalReturnInput): Promise<void> {
  const client = assertSupabase();
  const { error } = await client.rpc("register_conditional_return", {
    payload: {
      conditional_id: input.conditionalId,
      reason: input.reason,
      items: input.items.map((item) => ({
        conditional_item_id: item.conditionalItemId,
        quantity: item.quantity,
      })),
    },
  });
  if (error) throw error;
}

/* ------------------------------------------------------------------------ */
/* Conversão em venda                                                       */
/* ------------------------------------------------------------------------ */

export type ConvertConditionalToSaleInput = {
  conditionalId: string;
  paymentMethod: SalePaymentMethod;
  installments: number;
  items: { conditionalItemId: string; quantity: number }[];
};

export async function convertConditionalToSale(input: ConvertConditionalToSaleInput): Promise<Tables<"sales">> {
  const client = assertSupabase();
  const { data, error } = await client.rpc("convert_conditional_to_sale", {
    payload: {
      conditional_id: input.conditionalId,
      payment: { method: input.paymentMethod, installments: input.installments },
      items: input.items.map((item) => ({
        conditional_item_id: item.conditionalItemId,
        quantity: item.quantity,
      })),
    },
  });
  if (error) throw error;
  return data as unknown as Tables<"sales">;
}

/* ------------------------------------------------------------------------ */
/* Cancelamento                                                             */
/* ------------------------------------------------------------------------ */

export async function cancelConditional(conditionalId: string): Promise<ConditionalRow> {
  const client = assertSupabase();
  const { data, error } = await client.rpc("cancel_conditional", { p_conditional_id: conditionalId });
  if (error) throw error;
  return data as unknown as ConditionalRow;
}
