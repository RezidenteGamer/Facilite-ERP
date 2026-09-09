/**
 * **A `ref` de uma emissão — derivada, nunca informada.**
 *
 * `ref` é o identificador que o `FiscalProvider` usa para tudo (emitir,
 * consultar, cancelar) e é o que torna a emissão idempotente: pedir duas vezes
 * a mesma `ref` devolve o mesmo documento, em vez de gerar uma segunda nota.
 * Ver `FiscalEmitRequest.ref` em `types.ts`.
 *
 * ## Por que estas duas funções moram no núcleo desde A1 (01/09/2026)
 *
 * Até aqui elas viviam no front (`fiscalDocumentsRepository.saleFiscalRef` e
 * `saleReturnsRepository.saleReturnFiscalRef`) e a `ref` viajava do navegador
 * para quem emitia. Depois de A1 quem emite é a Edge Function `fiscal-emit`, e
 * **a `ref` é derivada lá dentro** a partir do id da venda ou da devolução que
 * o cliente pediu: aceitar uma `ref` pronta deixaria o cliente escolher em qual
 * linha de `fiscal_documents` (que é `unique (ref)`) o resultado da emissão
 * cairia — inclusive na linha de outra filial. Mesmo espírito da decisão C3:
 * o que decide o efeito no banco vem do banco, não do corpo da requisição.
 *
 * O formato é estável e não pode mudar sem migração: ele é a chave de
 * idempotência das notas já emitidas, aqui e no provedor real.
 */

/** `ref` estável por venda — a mesma em qualquer tentativa de emissão dela. */
export function saleFiscalRef(saleId: string): string {
  return `venda-${saleId}`;
}

/** `ref` estável por devolução — o que torna `emit()` idempotente por devolução. */
export function saleReturnFiscalRef(saleReturnId: string): string {
  return `devolucao-${saleReturnId}`;
}

/**
 * O caminho de volta: a palavra que descreve a origem, lida da própria `ref`.
 *
 * Existe desde A8 (09/09/2026) porque `fiscal-webhook` é o primeiro chamador
 * que **só tem a `ref`** — a notificação da Focus não traz `saleId` nem
 * `saleReturnId`, e as outras três ações recebem a origem no corpo da
 * requisição (`describeOrigin` em `fiscal-emit/index.ts`). A palavra entra nas
 * mensagens que `decideConsulta` monta ("a nota desta venda…").
 *
 * Mora aqui, e não no chamador, porque o prefixo é formato desta função: quem
 * decide como a `ref` é escrita é quem deve saber lê-la de volta. Uma `ref` de
 * formato desconhecido cai em "venda", que é o caso comum e não muda decisão
 * nenhuma — a palavra é texto de mensagem, nunca chave de despacho.
 */
export function describeRefOrigin(ref: string): string {
  return ref.startsWith("devolucao-") ? "devolução" : "venda";
}
