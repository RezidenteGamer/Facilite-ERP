/**
 * Persistência dos documentos fiscais (etapa 8, Notas Emitidas).
 *
 * A camada `src/lib/fiscal/` (etapa F1) deliberadamente não persiste nada — o
 * `SimulatedFiscalProvider` guarda estado em memória e documenta que "quem
 * persiste é Notas Emitidas". É este arquivo. Escritas são diretas (insert/
 * update client-side, RLS garante `has_permission('notas-emitidas', ...)` +
 * `has_branch_access`) — não há RPC aqui porque não há lógica atômica
 * multi-tabela (é um insert/update de um registro só por vez), mesmo critério
 * já usado em Compras/Financeiro para escrita de registro único.
 */
import { supabase } from "../supabaseClient";
import type { Tables, TablesInsert } from "../../types/supabase";
import type { FiscalArtifact, FiscalCancelResult, FiscalDocument } from "../fiscal/types";
import type { SaleForInvoice } from "../../features/sales/invoiceMapping";
import { toTaxGroup } from "./taxGroupLookups";

type FiscalDocumentRow = Tables<"fiscal_documents">;

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

/** `ref` estável por venda — o mesmo em qualquer tentativa de emissão dela, o que faz `emit()` ser idempotente por venda (proteção contra duplo clique/retry). */
export function saleFiscalRef(saleId: string): string {
  return `venda-${saleId}`;
}

function toArtifact(content: string | null, path: string | null, contentType: string): FiscalArtifact | null {
  if (!content && !path) return null;
  return { content, path, contentType };
}

export type InvoiceDocument = {
  id: string;
  saleId: string;
  branchId: string;
  model: "nfe" | "nfce";
  ref: string;
  status: FiscalDocumentRow["status"];
  chave: string | null;
  numero: string | null;
  serie: string | null;
  protocolo: string | null;
  statusSefaz: string | null;
  mensagemSefaz: string | null;
  xml: FiscalArtifact | null;
  pdf: FiscalArtifact | null;
  xmlCancelamento: FiscalArtifact | null;
  /** Só para NFC-e (`model === "nfce"`) — `null` em documentos NF-e. */
  qrCodeUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

function toInvoiceDocument(row: FiscalDocumentRow): InvoiceDocument {
  return {
    id: row.id,
    saleId: row.sale_id,
    branchId: row.branch_id,
    model: row.model,
    ref: row.ref,
    status: row.status,
    chave: row.chave,
    numero: row.numero,
    serie: row.serie,
    protocolo: row.protocolo,
    statusSefaz: row.status_sefaz,
    mensagemSefaz: row.mensagem_sefaz,
    xml: toArtifact(row.xml_content, row.xml_path, "application/xml"),
    pdf: toArtifact(row.pdf_content, row.pdf_path, "text/html"),
    xmlCancelamento: toArtifact(row.cancel_xml_content, row.cancel_xml_path, "application/xml"),
    qrCodeUrl: row.qr_code_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type InvoiceSaleRow = {
  saleId: string;
  saleCode: string;
  clientName: string;
  paymentMethod: string;
  installments: number;
  total: number;
  document: InvoiceDocument | null;
};

/**
 * Vendas confirmadas da filial com o respectivo documento fiscal (nulo = ainda
 * sem nota). Traz NF-e **e** NFC-e juntas — a lista não é exclusiva de um
 * modelo (ver AGENTS.md, etapa 8.5): uma venda do PDV tem NFC-e, uma venda de
 * Realizar Venda/Pedidos tem NF-e, e as duas aparecem lado a lado.
 */
export async function fetchInvoiceSales(branchId: string): Promise<InvoiceSaleRow[]> {
  const client = assertSupabase();
  const [{ data: sales, error: salesError }, { data: documents, error: documentsError }] = await Promise.all([
    client
      .from("sales")
      .select("id, code, total_amount, contact:contacts(name), payments:sale_payments(method, installments)")
      .eq("branch_id", branchId)
      .eq("status", "confirmed")
      .order("created_at", { ascending: false }),
    client
      .from("fiscal_documents")
      .select("*")
      .eq("branch_id", branchId)
      .order("updated_at", { ascending: false }),
  ]);
  if (salesError) throw salesError;
  if (documentsError) throw documentsError;

  // Uma venda pode, em tese, ter documento de mais de um modelo (ex.: NF-e
  // emitida manualmente para uma venda que já tinha NFC-e do PDV) — a
  // constraint é `unique (sale_id, model)`, não `unique (sale_id)`. A lista
  // mostra um só por linha; com a ordenação acima, o primeiro por `sale_id`
  // encontrado é o mais recente.
  const documentBySaleId = new Map<string, InvoiceDocument>();
  for (const row of documents ?? []) {
    if (!documentBySaleId.has(row.sale_id)) documentBySaleId.set(row.sale_id, toInvoiceDocument(row));
  }

  const METHOD_LABEL: Record<string, string> = {
    dinheiro: "Dinheiro",
    debito: "Débito",
    credito: "Crédito",
    pix: "PIX",
    boleto: "Boleto",
    outro: "Outro",
  };

  return (sales ?? []).map((sale) => {
    const payments = sale.payments ?? [];
    const paymentMethod =
      payments.length === 0
        ? "—"
        : payments.length === 1
          ? (METHOD_LABEL[payments[0].method] ?? payments[0].method)
          : "Múltiplas formas";
    const installments = payments.length === 1 ? payments[0].installments : payments.length;

    return {
      saleId: sale.id,
      saleCode: sale.code,
      clientName: sale.contact?.name ?? "Sem cliente",
      paymentMethod,
      installments,
      total: sale.total_amount,
      document: documentBySaleId.get(sale.id) ?? null,
    };
  });
}

/** Monta os dados de uma venda no formato que `buildNfePayloadFromSale` espera. */
export async function fetchSaleForInvoice(saleId: string): Promise<SaleForInvoice> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("sales")
    .select(
      `code, issue_date, subtotal_amount, total_amount, discount_amount, freight_amount,
       branch:branches(cnpj, name, inscricao_estadual, regime_tributario, logradouro, numero, bairro, municipio, uf, cep),
       contact:contacts(name, document, inscricao_estadual, indicador_ie, logradouro, numero, bairro, municipio, uf, cep, phone),
       items:sale_items(quantity, unit_price, discount_amount, total_amount,
         product:products(code, description, ncm, cest, unidade_comercial, unidade_tributavel, origem_mercadoria, cst_ipi,
           tax_group:tax_groups(id, code, name, cst_icms, csosn, aliquota_icms, cst_pis, aliquota_pis, cst_cofins, aliquota_cofins, cst_ibs_cbs, cclasstrib))),
       payments:sale_payments(method, amount)`,
    )
    .eq("id", saleId)
    .single();
  if (error) throw error;
  if (!data.branch) throw new Error("Venda sem filial associada.");

  return {
    code: data.code,
    issueDate: data.issue_date,
    subtotalAmount: data.subtotal_amount,
    totalAmount: data.total_amount,
    discountAmount: data.discount_amount,
    freightAmount: data.freight_amount,
    branch: {
      cnpj: data.branch.cnpj,
      name: data.branch.name,
      inscricaoEstadual: data.branch.inscricao_estadual,
      regimeTributario: data.branch.regime_tributario,
      logradouro: data.branch.logradouro,
      numero: data.branch.numero,
      bairro: data.branch.bairro,
      municipio: data.branch.municipio,
      uf: data.branch.uf,
      cep: data.branch.cep,
    },
    contact: data.contact
      ? {
          name: data.contact.name,
          document: data.contact.document,
          inscricaoEstadual: data.contact.inscricao_estadual,
          indicadorIe: data.contact.indicador_ie,
          logradouro: data.contact.logradouro,
          numero: data.contact.numero,
          bairro: data.contact.bairro,
          municipio: data.contact.municipio,
          uf: data.contact.uf,
          cep: data.contact.cep,
          phone: data.contact.phone,
        }
      : null,
    payments: (data.payments ?? []).map((payment) => ({ method: payment.method, amount: payment.amount })),
    items: (data.items ?? []).map((item) => ({
      quantity: item.quantity,
      unitPrice: item.unit_price,
      discountAmount: item.discount_amount,
      totalAmount: item.total_amount,
      product: {
        code: item.product!.code,
        description: item.product!.description,
        ncm: item.product!.ncm,
        cest: item.product!.cest,
        unidadeComercial: item.product!.unidade_comercial,
        unidadeTributavel: item.product!.unidade_tributavel,
        origemMercadoria: item.product!.origem_mercadoria,
        cstIpi: item.product!.cst_ipi,
        // Nulo quando o produto não foi atrelado a nenhum grupo — quem recusa
        // a emissão com mensagem é `buildNfePayloadFromSale`, não aqui.
        taxGroup: item.product!.tax_group ? toTaxGroup(item.product!.tax_group) : null,
      },
    })),
  };
}

/** Grava o CFOP resolvido em todos os itens da venda — a nota e a venda passam a contar a mesma história. */
export async function updateSaleItemsCfop(saleId: string, cfop: string): Promise<void> {
  const client = assertSupabase();
  const { error } = await client.from("sale_items").update({ cfop }).eq("sale_id", saleId);
  if (error) throw error;
}

/** Persiste o resultado de `FiscalProvider.emit()` — upsert por `ref` (idempotente, mesma garantia do provedor). */
export async function persistEmitResult(
  branchId: string,
  saleId: string,
  document: FiscalDocument,
): Promise<InvoiceDocument> {
  // `nao_encontrado` é resultado de consulta (ref desconhecida), nunca algo que
  // emit() devolve de verdade — narrow defensivo para bater com o enum do banco.
  if (document.status === "nao_encontrado") {
    throw new Error("Estado inesperado: emit() devolveu nao_encontrado.");
  }
  const client = assertSupabase();
  const row: TablesInsert<"fiscal_documents"> = {
    branch_id: branchId,
    sale_id: saleId,
    model: document.model,
    ref: document.ref,
    status: document.status,
    chave: document.chave,
    numero: document.numero,
    serie: document.serie,
    protocolo: document.protocolo,
    status_sefaz: document.statusSefaz,
    mensagem_sefaz: document.mensagemSefaz,
    xml_content: document.xml?.content ?? null,
    xml_path: document.xml?.path ?? null,
    pdf_content: document.pdf?.content ?? null,
    pdf_path: document.pdf?.path ?? null,
    cancel_xml_content: document.xmlCancelamento?.content ?? null,
    cancel_xml_path: document.xmlCancelamento?.path ?? null,
    qr_code_url: document.qrCodeUrl,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client
    .from("fiscal_documents")
    .upsert(row, { onConflict: "ref" })
    .select()
    .single();
  if (error) throw error;
  return toInvoiceDocument(data);
}

/**
 * Persiste um cancelamento bem-sucedido. Recusa (`erro_cancelamento`) ou
 * `nao_encontrado` **não gravam nada** — o documento continua "autorizado"
 * no banco, e é isso mesmo: a recusa é do evento de cancelamento, não uma
 * mudança de status do documento. Quem chama decide o que mostrar com a
 * mensagem da SEFAZ (`result.mensagemSefaz`) sem persistir nada.
 *
 * Note: o `SimulatedFiscalProvider` guarda estado em memória — um cancelamento
 * depois de um F5 na página pode devolver `nao_encontrado` mesmo para uma nota
 * que está `autorizado` aqui no banco, porque o simulado "esqueceu" a emissão.
 * O provedor real não tem essa limitação (a API dele persiste). Documentado
 * também no AGENTS.md.
 */
export async function persistCancelResult(
  documentId: string,
  result: FiscalCancelResult,
  justificativa: string,
): Promise<InvoiceDocument> {
  if (result.status !== "cancelado") {
    throw new Error(result.mensagemSefaz ?? "Não foi possível cancelar o documento.");
  }
  const client = assertSupabase();
  const patch: Partial<FiscalDocumentRow> = {
    status: "cancelado",
    status_sefaz: result.statusSefaz,
    mensagem_sefaz: result.mensagemSefaz,
    cancel_xml_content: result.xmlCancelamento?.content ?? null,
    cancel_xml_path: result.xmlCancelamento?.path ?? null,
    cancel_justificativa: justificativa,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client
    .from("fiscal_documents")
    .update(patch)
    .eq("id", documentId)
    .select()
    .single();
  if (error) throw error;
  return toInvoiceDocument(data);
}
