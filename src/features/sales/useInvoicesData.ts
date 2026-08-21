import { useCallback, useEffect, useState } from "react";
import {
  emitInvoiceForSale,
  fetchInvoiceSales,
  persistCancelResult,
  saleFiscalRef,
  type EmitOutcome,
  type InvoiceSaleRow,
} from "../../lib/repositories/fiscalDocumentsRepository";
import { getFiscalProvider } from "../../lib/fiscal/provider";

/** Mesmo padrão de `extractErrorMessage` do Financeiro/Controle de Caixa: erros do supabase-js não são `instanceof Error`. */
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return fallback;
}

export type { EmitOutcome };

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

  /**
   * Emite (ou reemite — idempotente por venda) a nota da venda selecionada.
   * Wrapper fino sobre `emitInvoiceForSale` (fiscalDocumentsRepository.ts) —
   * o núcleo de "montar payload + emitir + persistir" mora lá, reaproveitado
   * também pelo wizard de Realizar Venda; aqui só se soma o `reload()` da
   * lista, que só faz sentido para esta tela.
   */
  async function emitInvoice(saleId: string): Promise<EmitOutcome> {
    if (!branchId) return { ok: false, errors: ["Selecione uma filial."] };
    const outcome = await emitInvoiceForSale(branchId, saleId);
    await reload();
    return outcome;
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
