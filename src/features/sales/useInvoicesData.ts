import { useCallback, useEffect, useState } from "react";
import { extractErrorMessage } from "../../lib/errorMessage";
import {
  emitInvoiceForSale,
  fetchInvoiceSales,
  type EmitOutcome,
  type InvoiceSaleRow,
} from "../../lib/repositories/fiscalDocumentsRepository";
import {
  requestFiscalCancel,
  requestFiscalQuery,
  type FiscalActionOutcome,
} from "../../lib/repositories/fiscalEmitApi";

/**
 * Reexportado de `src/lib/errorMessage.ts`, onde a função passou a morar em A1
 * (01/09/2026) — `CancelInvoiceModal.tsx` e outras telas já importavam daqui.
 */
export { extractErrorMessage };

export type { EmitOutcome, FiscalActionOutcome };

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

  /**
   * Consulta o provedor sobre a nota da venda e reconcilia o banco com a
   * resposta (A6, 09/09/2026).
   *
   * É o único caminho de saída de uma nota presa em `processando_autorizacao`:
   * a Edge Function pergunta ao provedor pela `ref` e, só se ele não conhecer a
   * nota, libera a reserva para nova emissão. Liberar sem perguntar poderia
   * criar uma segunda nota real para a mesma venda — ver `reservation.ts`.
   *
   * **Não lança**, ao contrário de `cancelInvoice`: aqui não há modal para
   * segurar a mensagem, e os três desfechos normais (autorizada, ainda
   * processando, liberada) não são erro. Quem chama exibe `mensagem` ou
   * `errors` na própria tela.
   */
  async function queryInvoice(saleId: string): Promise<FiscalActionOutcome> {
    if (!branchId) return { ok: false, errors: ["Selecione uma filial."] };
    const outcome = await requestFiscalQuery(branchId, { saleId });
    await reload();
    return outcome;
  }

  return { sales, loading, error, reload, emitInvoice, cancelInvoice, queryInvoice };
}
