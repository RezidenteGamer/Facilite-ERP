import { useCallback, useEffect, useState } from "react";
import { createProductsRepository } from "../../lib/repositories/productsRepository";
import type { Product } from "./products";

export type NewProductInput = Omit<Product, "id" | "code" | "createdAt">;

/** Carrega e muta os produtos de uma filial via Supabase, com estado de loading/erro. */
export function useProductsData(branchId: string | null) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!branchId) {
      setProducts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const repository = createProductsRepository(branchId);
      const rows = await repository.list({});
      setProducts(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar produtos.");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function createProduct(input: NewProductInput): Promise<Product> {
    if (!branchId) throw new Error("Selecione uma filial antes de cadastrar um produto.");
    const repository = createProductsRepository(branchId);
    // `code` é gerado pelo repositório; o placeholder abaixo nunca é usado.
    const created = await repository.create({ ...input, code: "" });
    await reload();
    return created;
  }

  async function updateProduct(id: string, patch: Partial<Product>) {
    if (!branchId) throw new Error("Selecione uma filial.");
    const repository = createProductsRepository(branchId);
    await repository.update(id, patch);
    await reload();
  }

  async function deleteProduct(id: string) {
    if (!branchId) throw new Error("Selecione uma filial.");
    const repository = createProductsRepository(branchId);
    await repository.remove(id);
    await reload();
  }

  return { products, loading, error, reload, createProduct, updateProduct, deleteProduct };
}
