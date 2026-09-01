/**
 * Emissão fiscal do PDV — NFC-e, etapa 8.5. Chamada depois de toda venda do
 * PDV confirmada com sucesso (`usePosSale.ts`).
 *
 * **Desde A1 (01/09/2026) esta função só faz o pedido.** Quem lê a venda, monta
 * a NFC-e, fala com o `FiscalProvider` e grava é a Edge Function `fiscal-emit`.
 * Aqui ficou o que é do PDV: o modelo (`nfce`) e a regra de que uma nota que
 * não sai **não** desfaz a venda.
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
 *   a Edge Function grava a linha com `status: "erro_autorizacao"` e o evento
 *   de rejeição — a mesma leitura que já existe em Notas Emitidas para nota
 *   recusada.
 */
import { requestFiscalEmit } from "../../lib/repositories/fiscalEmitApi";

export type FiscalEmissionOutcome = { ok: true } | { ok: false; errors: string[] };

export async function emitFiscalDocumentForSale(saleId: string, branchId: string): Promise<FiscalEmissionOutcome> {
  const outcome = await requestFiscalEmit(branchId, { saleId }, "nfce");
  return outcome.ok ? { ok: true } : outcome;
}
