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
