/**
 * Leitura dos documentos fiscais (etapa 8, Notas Emitidas).
 *
 * **Desde A1 (01/09/2026) este arquivo só lê.** Ele já foi o lugar onde o
 * navegador montava a nota, chamava o `FiscalProvider` e gravava
 * `fiscal_documents` sob RLS; quem faz isso agora é a Edge Function
 * `fiscal-emit` (`supabase/functions/fiscal-emit/`), com `service_role`, a
 * partir de dados que ela mesma lê do banco. Saíram daqui:
 *
 * - `fetchSaleForInvoice` — a leitura virou `data.ts` da Edge Function;
 * - `persistEmitResult` / `persistCancelResult` — a escrita virou `persist.ts`,
 *   agora nas três tabelas do modelo canônico de A3;
 * - `updateSaleItemsCfop` — o CFOP do item passou a ser gravado em
 *   `fiscal_document_items.cfop`, que é o lugar canônico dele (A3);
 * - `saleFiscalRef` — a `ref` é derivada no servidor
 *   (`supabase/functions/_shared/fiscal/refs.ts`), nunca informada pelo cliente.
 *
 * O que sobrou é o que a tela precisa para **mostrar** notas, e `emitInvoiceForSale`,
 * que virou uma chamada à Edge Function com o mesmo contrato de antes.
 */
import { supabase } from "../supabaseClient";
import type { Tables } from "../../types/supabase";
import type { FiscalArtifact } from "../fiscal/types";
import { requestFiscalEmit } from "./fiscalEmitApi";

type FiscalDocumentRow = Tables<"fiscal_documents">;

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

function toArtifact(content: string | null, path: string | null, contentType: string): FiscalArtifact | null {
  if (!content && !path) return null;
  return { content, path, contentType };
}

export type InvoiceDocument = {
  id: string;
  /**
   * Nulo quando o documento é a nota de uma **devolução** (etapa 9) em vez de
   * uma venda — `fiscal_documents` tem duas origens mutuamente exclusivas
   * (`sale_id` / `sale_return_id`), garantidas por CHECK no banco.
   */
  saleId: string | null;
  saleReturnId: string | null;
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
  /** Só para NFC-e (`model === "nfce"`) — `null` em documentos NF-e. */
  qrCodeUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export function toInvoiceDocument(row: FiscalDocumentRow): InvoiceDocument {
  return {
    id: row.id,
    saleId: row.sale_id,
    saleReturnId: row.sale_return_id,
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
    // O XML de cancelamento saiu daqui em A1: ele é uma linha de
    // `fiscal_document_events` (tipo `cancelamento`), e as colunas `cancel_*`
    // de `fiscal_documents` são removidas pela migration desta tarefa. Nenhuma
    // tela exibia esse artefato — quando alguma precisar, a fonte é o evento.
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
    // Documento de devolução (`sale_id` nulo) não pertence a nenhuma venda
    // desta lista — quem o mostra é o módulo Devolução de venda.
    if (!row.sale_id) continue;
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
      clientName: sale.contact?.name ?? "Consumidor final",
      paymentMethod,
      installments,
      total: sale.total_amount,
      document: documentBySaleId.get(sale.id) ?? null,
    };
  });
}

export type EmitOutcome = { ok: true } | { ok: false; errors: string[] };

/**
 * "Emitir NF-e para uma venda" — agora uma chamada à Edge Function.
 *
 * Continua sendo o núcleo compartilhado entre Notas Emitidas
 * (`useInvoicesData.emitInvoice`, que soma um `reload()` da lista) e o wizard de
 * Realizar Venda (`useSaleDraft.confirmSale`), pelo mesmo motivo de sempre:
 * duas implementações do mesmo botão foi o que causou o bug de 21/08/2026, em
 * que "Gerar Nota Fiscal" não emitia nada.
 *
 * O que mudou em A1 é só quem faz o trabalho. Antes esta função lia a venda,
 * montava o payload, chamava o provedor e gravava; agora ela manda `saleId` e
 * espera. **Nunca lança** — mesmo contrato de antes.
 */
export async function emitInvoiceForSale(branchId: string, saleId: string): Promise<EmitOutcome> {
  const outcome = await requestFiscalEmit(branchId, { saleId }, "nfe");
  return outcome.ok ? { ok: true } : outcome;
}
