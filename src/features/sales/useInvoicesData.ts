import { useCallback, useEffect, useState } from "react";
import { extractErrorMessage } from "../../lib/errorMessage";
import {
  emitInvoiceForSale,
  fetchInvoiceSales,
  type EmitOutcome,
  type InvoiceSaleRow,
} from "../../lib/repositories/fiscalDocumentsRepository";
import { requestFiscalCancel } from "../../lib/repositories/fiscalEmitApi";

/**
 * Reexportado de `src/lib/errorMessage.ts`, onde a função passou a morar em A1
 * (01/09/2026) — `CancelInvoiceModal.tsx` e outras telas já importavam daqui.
 */
export { extractErrorMessage };

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
   * que desde A1 é uma chamada à Edge Function `fiscal-emit`, reaproveitada
   * também pelo wizard de Realizar Venda; aqui só se soma o `reload()` da
   * lista, que só faz sentido para esta tela.
   */
  async function emitInvoice(saleId: string): Promise<EmitOutcome> {
    if (!branchId) return { ok: false, errors: ["Selecione uma filial."] };
    const outcome = await emitInvoiceForSale(branchId, saleId);
    await reload();
    return outcome;
  }

  /**
   * Cancela a nota da venda.
   *
   * **Lança** quando a SEFAZ recusa (justificativa curta, nota já cancelada) —
   * é o contrato que `CancelInvoiceModal` sempre esperou, e é ele que faz a
   * recusa aparecer dentro do modal em vez de fechar como se tivesse dado
   * certo. A Edge Function devolve `{ ok, errors }` como todo o resto; a
   * conversão para exceção acontece aqui, no único lugar que a quer.
   */
  async function cancelInvoice(saleId: string, justificativa: string): Promise<void> {
    if (!branchId) throw new Error("Selecione uma filial.");
    const outcome = await requestFiscalCancel(branchId, { saleId }, justificativa);
    await reload();
    if (!outcome.ok) throw new Error(outcome.errors.join(" "));
  }

  return { sales, loading, error, reload, emitInvoice, cancelInvoice };
}
