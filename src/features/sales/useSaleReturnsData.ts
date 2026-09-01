/**
 * Devolução de venda (etapa 9) — carga da lista e as três ações do módulo:
 * criar a devolução, emitir a nota de devolução e cancelar a nota da venda
 * original.
 *
 * ## A ordem importa, e é o ponto da etapa
 *
 * `createReturn` grava estoque + financeiro **atomicamente** (RPC
 * `create_sale_return`) e devolve. Nenhuma chamada ao `FiscalProvider`
 * acontece dentro dela. A parte fiscal é um passo **seguinte e opcional**,
 * disparado pela tela depois — mesma filosofia já estabelecida no PDV/NFC-e:
 * uma falha na emissão não desfaz a devolução (não existe "voltar atrás" de
 * estoque já reposto), mas também não fica silenciosa.
 */
import { useCallback, useEffect, useState } from "react";
import { extractErrorMessage } from "../../lib/errorMessage";
import { requestFiscalCancel, requestFiscalEmit } from "../../lib/repositories/fiscalEmitApi";
import {
  createSaleReturn,
  fetchSaleReturns,
  type CreateSaleReturnInput,
  type SaleReturnListRow,
} from "../../lib/repositories/saleReturnsRepository";

export type FiscalOutcome = { ok: true; message: string } | { ok: false; errors: string[] };

export function useSaleReturnsData(branchId: string | null) {
  const [returns, setReturns] = useState<SaleReturnListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!branchId) {
      setReturns([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setReturns(await fetchSaleReturns(branchId));
    } catch (err) {
      setError(extractErrorMessage(err, "Erro ao carregar as devoluções."));
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Estoque + financeiro, numa transação só. A parte fiscal não entra aqui. */
  async function createReturn(input: Omit<CreateSaleReturnInput, "branchId">): Promise<string> {
    if (!branchId) throw new Error("Selecione uma filial.");
    const created = await createSaleReturn({ ...input, branchId });
    await reload();
    return created.id;
  }

  /**
   * Emite a NF-e de devolução da devolução informada — desde A1 (01/09/2026),
   * pela Edge Function `fiscal-emit`, que lê a devolução e a venda original do
   * banco. Nunca lança: devolve um resultado que a tela mostra como aviso,
   * porque a devolução em si já está gravada e não é desfeita por uma nota que
   * não saiu.
   */
  async function emitReturnInvoice(saleReturnId: string): Promise<FiscalOutcome> {
    if (!branchId) return { ok: false, errors: ["Selecione uma filial."] };
    const outcome = await requestFiscalEmit(branchId, { saleReturnId }, "nfe");
    await reload();
    if (!outcome.ok) return outcome;
    return { ok: true, message: `Nota de devolução autorizada (chave ${outcome.chave ?? "—"}).` };
  }

  /**
   * Cancela a nota **da venda original** — o outro caminho fiscal, para quando
   * o operador julga estar dentro do prazo legal de cancelamento. O sistema
   * não calcula esse prazo (varia por UF e modelo; ver AGENTS.md) — a decisão
   * é do operador.
   */
  async function cancelOriginalInvoice(saleId: string, justificativa: string): Promise<FiscalOutcome> {
    if (!branchId) return { ok: false, errors: ["Selecione uma filial."] };
    const outcome = await requestFiscalCancel(branchId, { saleId }, justificativa);
    await reload();
    if (!outcome.ok) return outcome;
    return { ok: true, message: "Nota da venda original cancelada." };
  }

  return { returns, loading, error, reload, createReturn, emitReturnInvoice, cancelOriginalInvoice };
}

