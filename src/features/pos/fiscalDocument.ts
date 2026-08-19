/**
 * Emissão fiscal do PDV — NFC-e, etapa 8.5. Chamada depois de toda venda do
 * PDV confirmada com sucesso (`usePosSale.ts`).
 *
 * ## O que acontece quando a emissão falha
 *
 * A venda já foi confirmada e o estoque já baixou **antes** deste gancho
 * rodar (por desenho — ver decisão do Ponto de Venda no AGENTS.md). Uma NFC-e
 * que falha (produto sem grupo tributário, por exemplo) não pode desfazer
 * isso: não há como "cancelar" uma venda que já aconteceu de verdade só
 * porque a nota não saiu. Por isso esta função **nunca lança exceção** — ela
 * devolve um resultado que `usePosSale.ts` transforma num aviso não
 * bloqueante (`fiscalWarning`), sem tocar em `submitError` (que continua
 * significando "a venda em si falhou"). O operador do caixa vê que a nota não
 * saiu, mas a venda continua confirmada.
 *
 * Duas formas de falha, e as duas ficam visíveis de formas diferentes:
 *
 * - **Validação do payload falha antes de chamar o provedor** (NCM ausente,
 *   produto sem grupo tributário, nenhuma regra de CFOP cadastrada): nenhuma
 *   chamada ao `FiscalProvider` acontece, e por isso **nenhuma linha é
 *   gravada em `fiscal_documents`** — não existe "documento" nenhum para
 *   persistir. Quem for investigar depois não encontra registro, só o aviso
 *   que apareceu na hora (não há tela de "erros de emissão" persistente hoje).
 * - **O provedor recusa** (raro no simulado, mas é o caminho real da SEFAZ):
 *   `persistEmitResult` grava a linha com `status: "erro_autorizacao"` — a
 *   mesma leitura que já existe em Notas Emitidas para nota recusada.
 */
import { getFiscalProvider } from "../../lib/fiscal/provider";
import {
  fetchSaleForInvoice,
  persistEmitResult,
  saleFiscalRef,
  updateSaleItemsCfop,
} from "../../lib/repositories/fiscalDocumentsRepository";
import { fetchTaxRules } from "../../lib/repositories/taxRulesRepository";
import { buildNfcePayloadFromSale } from "../sales/invoiceMapping";

export type FiscalEmissionOutcome = { ok: true } | { ok: false; errors: string[] };

export async function emitFiscalDocumentForSale(saleId: string, branchId: string): Promise<FiscalEmissionOutcome> {
  try {
    const [sale, rules] = await Promise.all([fetchSaleForInvoice(saleId), fetchTaxRules()]);
    const built = buildNfcePayloadFromSale(sale, rules);
    if (!built.ok) return { ok: false, errors: built.errors };

    const provider = getFiscalProvider();
    const document = await provider.emit({ ref: saleFiscalRef(saleId), model: "nfce", payload: built.payload });
    await persistEmitResult(branchId, saleId, document);

    if (document.status !== "autorizado") {
      return { ok: false, errors: [document.mensagemSefaz ?? "A SEFAZ recusou a emissão da NFC-e."] };
    }
    await updateSaleItemsCfop(saleId, built.cfop);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : "Erro inesperado ao emitir a NFC-e.";
    return { ok: false, errors: [message] };
  }
}
