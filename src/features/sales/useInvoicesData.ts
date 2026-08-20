import { useCallback, useEffect, useState } from "react";
import { getFiscalProvider } from "../../lib/fiscal/provider";
import {
  fetchInvoiceSales,
  fetchSaleForInvoice,
  persistCancelResult,
  persistEmitResult,
  saleFiscalRef,
  updateSaleItemsCfop,
  type InvoiceSaleRow,
} from "../../lib/repositories/fiscalDocumentsRepository";
import { fetchTaxRules } from "../../lib/repositories/taxRulesRepository";
import { buildNfePayloadFromSale } from "./invoiceMapping";

/** Mesmo padrão de `extractErrorMessage` do Financeiro/Controle de Caixa: erros do supabase-js não são `instanceof Error`. */
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return fallback;
}

export type EmitOutcome = { ok: true } | { ok: false; errors: string[] };

/** Carrega as vendas confirmadas da filial + documento fiscal associado, e expõe emitir/cancelar. */
export function useInvoicesData(branchId: string | null) {
  const [sales, setSales] = useState<InvoiceSaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!branchId) {
      setSales([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setSales(await fetchInvoiceSales(branchId));
    } catch (err) {
      setError(extractErrorMessage(err, "Erro ao carregar notas emitidas."));
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Emite (ou reemite — idempotente por venda) a nota da venda selecionada. */
  async function emitInvoice(saleId: string): Promise<EmitOutcome> {
    if (!branchId) return { ok: false, errors: ["Selecione uma filial."] };

    const [sale, rules] = await Promise.all([fetchSaleForInvoice(saleId), fetchTaxRules()]);
    const built = buildNfePayloadFromSale(sale, rules);
    if (!built.ok) return { ok: false, errors: built.errors };

    const provider = getFiscalProvider();
    const document = await provider.emit({ ref: saleFiscalRef(saleId), model: "nfe", payload: built.payload });
    await persistEmitResult(branchId, { saleId }, document);

    if (document.status === "autorizado") {
      await updateSaleItemsCfop(saleId, built.cfop);
    }

    await reload();

    if (document.status !== "autorizado") {
      return { ok: false, errors: [document.mensagemSefaz ?? "A SEFAZ recusou a emissão."] };
    }
    return { ok: true };
  }

  /** Cancela a nota — `run()` da tela cuida de mostrar a mensagem de recusa (justificativa curta, já cancelada etc.). */
  async function cancelInvoice(documentId: string, saleId: string, justificativa: string): Promise<void> {
    const provider = getFiscalProvider();
    const result = await provider.cancel({ ref: saleFiscalRef(saleId), justificativa });
    await persistCancelResult(documentId, result, justificativa);
    await reload();
  }

  return { sales, loading, error, reload, emitInvoice, cancelInvoice };
}
