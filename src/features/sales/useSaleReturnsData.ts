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
import { getFiscalProvider } from "../../lib/fiscal/provider";
import {
  persistCancelResult,
  persistEmitResult,
  saleFiscalRef,
} from "../../lib/repositories/fiscalDocumentsRepository";
import {
  createSaleReturn,
  fetchSaleReturnForInvoice,
  fetchSaleReturns,
  saleReturnFiscalRef,
  type CreateSaleReturnInput,
  type SaleReturnListRow,
} from "../../lib/repositories/saleReturnsRepository";
import { fetchTaxRules } from "../../lib/repositories/taxRulesRepository";
import { buildReturnNfePayload } from "./invoiceMapping";
import { extractErrorMessage } from "./useInvoicesData";

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
   * Emite a NF-e de devolução da devolução informada. Nunca lança — devolve
   * um resultado que a tela mostra como aviso, porque a devolução em si já
   * está gravada e não é desfeita por uma nota que não saiu.
   */
  async function emitReturnInvoice(saleReturnId: string): Promise<FiscalOutcome> {
    if (!branchId) return { ok: false, errors: ["Selecione uma filial."] };
    try {
      const [saleReturn, rules] = await Promise.all([
        fetchSaleReturnForInvoice(saleReturnId),
        fetchTaxRules(),
      ]);
      const built = buildReturnNfePayload(saleReturn, rules);
      if (!built.ok) return { ok: false, errors: built.errors };

      const provider = getFiscalProvider();
      const document = await provider.emit({
        ref: saleReturnFiscalRef(saleReturnId),
        model: "nfe",
        payload: built.payload,
      });
      await persistEmitResult(branchId, { saleReturnId }, document);
      await reload();

      if (document.status !== "autorizado") {
        return { ok: false, errors: [document.mensagemSefaz ?? "A SEFAZ recusou a emissão da nota de devolução."] };
      }
      return { ok: true, message: `Nota de devolução autorizada (chave ${document.chave}).` };
    } catch (err) {
      return { ok: false, errors: [extractErrorMessage(err, "Erro inesperado ao emitir a nota de devolução.")] };
    }
  }

  /**
   * Cancela a nota **da venda original** — o outro caminho fiscal, para quando
   * o operador julga estar dentro do prazo legal de cancelamento. O sistema
   * não calcula esse prazo (varia por UF e modelo; ver AGENTS.md) — a decisão
   * é do operador.
   */
  async function cancelOriginalInvoice(
    documentId: string,
    saleId: string,
    justificativa: string,
  ): Promise<FiscalOutcome> {
    try {
      const provider = getFiscalProvider();
      const result = await provider.cancel({ ref: saleFiscalRef(saleId), justificativa });
      await persistCancelResult(documentId, result, justificativa);
      await reload();
      return { ok: true, message: "Nota da venda original cancelada." };
    } catch (err) {
      return { ok: false, errors: [extractErrorMessage(err, "Não foi possível cancelar a nota da venda.")] };
    }
  }

  return { returns, loading, error, reload, createReturn, emitReturnInvoice, cancelOriginalInvoice };
}

