/**
 * Ponto de extensão para a emissão fiscal do PDV (NFC-e, etapa 8.5 do
 * roteiro). Hoje é um no-op de propósito — chamado depois de toda venda do
 * PDV confirmada com sucesso, para a etapa futura só precisar implementar o
 * corpo desta função, sem tocar de novo no fluxo de confirmação da venda.
 */
export async function emitFiscalDocumentForSale(_saleId: string): Promise<void> {
  // Sem lógica fiscal ainda — ver AGENTS.md, decisão do módulo Ponto de Venda.
}
