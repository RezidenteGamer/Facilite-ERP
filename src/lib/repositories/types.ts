/**
 * Contrato comum de acesso a dados para um módulo dirigido por metadados.
 * Hoje só há uma implementação (Supabase, tabela dedicada por módulo).
 * Futuramente um "Faça você mesmo" pode implementar o mesmo contrato sobre
 * uma tabela JSONB genérica, sem exigir mudanças na camada de apresentação.
 */
export type ModuleDataRepository<TRow> = {
  list(filter: Record<string, unknown>): Promise<TRow[]>;
  create(input: Omit<TRow, "id" | "createdAt">): Promise<TRow>;
  update(id: string, patch: Partial<TRow>): Promise<TRow>;
  remove(id: string): Promise<void>;
};
