/**
 * Contrato comum de acesso a dados para um módulo dirigido por metadados.
 * Hoje só há uma implementação (Supabase, tabela dedicada por módulo).
 * Futuramente um "Faça você mesmo" pode implementar o mesmo contrato sobre
 * uma tabela JSONB genérica, sem exigir mudanças na camada de apresentação.
 *
 * `TInput` existe porque nem sempre "o que se grava" é o registro menos o
 * `id`: o Financeiro, por exemplo, tem acessores que só existem para a tela
 * (nome do contato, "1/3", valores formatados) e não são graváveis. O padrão
 * cobre os módulos em que os dois coincidem (Clientes, Produtos), então eles
 * continuam declarando só `ModuleDataRepository<T>`.
 */
export type ModuleDataRepository<TRow, TInput = Omit<TRow, "id" | "createdAt">> = {
  list(filter: Record<string, unknown>): Promise<TRow[]>;
  create(input: TInput): Promise<TRow>;
  update(id: string, patch: Partial<TInput>): Promise<TRow>;
  remove(id: string): Promise<void>;
};

/**
 * Contrato irmão do acima, para módulos de **lançamento em lote** (layout
 * `batch`): vários itens são acumulados na tela e gravados de uma vez só.
 *
 * Não estende `ModuleDataRepository` de propósito. Módulos deste tipo — o
 * primeiro é Ajuste de estoque — são registros de auditoria: não existe
 * "editar o ajuste 3" nem "excluir o ajuste 3", porque apagar o registro não
 * desfaz a alteração de estoque que ele representa. Forçar `create`/`update`/
 * `remove` aqui só para reaproveitar a mesma interface daria três métodos que
 * lançam erro — pior que um contrato menor e honesto.
 *
 * `createBatch` não devolve as linhas criadas porque a escrita é uma RPC
 * transacional específica do módulo (ex.: `adjust_stock_batch`); quem consome
 * recarrega a lista depois.
 */
export type ModuleBatchRepository<TRow, TBatchItem> = {
  list(filter: Record<string, unknown>): Promise<TRow[]>;
  createBatch(items: TBatchItem[]): Promise<void>;
};
