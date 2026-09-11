/**
 * O catálogo do PDV com retaguarda local (E6, 10/09/2026).
 *
 * ## Por que isto é um envelope em volta de `useProductsData`, e não uma
 * mudança dentro dele
 *
 * `useProductsData` é de Produtos: ele cadastra, edita e apaga produto, e é
 * usado por telas que **não** devem servir lista velha — editar um produto a
 * partir de um cache de ontem é gravar por cima de mudança de outra pessoa.
 * O PDV é o caso oposto: vender com preço de uma hora atrás é muito melhor do
 * que não vender. Como a regra é diferente, o cache mora do lado do PDV, e
 * `useProductsData` fica exatamente como estava.
 *
 * ## O que o cache guarda, e o que ele não conserta
 *
 * O que vai para o IndexedDB é a lista inteira que a filial devolveu na
 * última carga bem-sucedida — descrição, preço, GTIN (é o que faz o modo
 * scanner de E4 continuar funcionando sem rede) e **estoque**.
 *
 * Esse estoque é a parte que envelhece pior, e o aviso na tela existe por
 * causa dele: o número mostrado é o de quando a rede ainda existia. Outro
 * terminal pode ter vendido a última unidade nesse meio-tempo, e este PDV não
 * tem como saber. Ele deixa vender assim mesmo — quem decide de verdade é o
 * `select ... for update` de `create_sale`, na hora de sincronizar, e é lá que
 * a venda pode ser recusada. Ver o risco de concorrência entre terminais em
 * AGENTS.md: aceito e não resolvido.
 */
import { useCallback, useEffect, useState } from "react";
import { useProductsData } from "../products/useProductsData";
import type { Product } from "../products/products";
import { readCachedCatalog, saveCachedCatalog } from "./offlineStore";

export type PosCatalog = {
  products: Product[];
  loading: boolean;
  /** A lista veio do IndexedDB, não do servidor — a tela precisa dizer isso. */
  servedFromCache: boolean;
  /** `Date.now()` da carga que gerou o cache em uso; `null` quando a lista é fresca. */
  cachedAt: number | null;
  reload: () => void;
};

export function usePosCatalog(branchId: string | null): PosCatalog {
  const { products, loading, error, reload } = useProductsData(branchId);
  const [cached, setCached] = useState<{ branchId: string; savedAt: number; products: Product[] } | null>(null);

  // Leitura do cache assim que a filial é conhecida, sem esperar a rede
  // responder. Num caixa que abriu com a internet já caída, é isto que faz a
  // tela nascer com produtos em vez de nascer vazia e ficar assim.
  useEffect(() => {
    if (!branchId) {
      setCached(null);
      return;
    }
    let cancelado = false;
    void readCachedCatalog(branchId).then((entry) => {
      if (cancelado || !entry) return;
      /*
       * Esta leitura corre com a busca de rede, e pode chegar depois dela. Se
       * a rede já tiver respondido e regravado o cache, o que está no disco é
       * a versão VELHA — sobrescrever com ela deixaria o PDV, na próxima
       * queda de rede, servindo um catálogo mais antigo (e uma hora mais
       * antiga) do que o que ele já tinha carregado com sucesso nesta sessão.
       * Fica quem for mais novo.
       */
      setCached((atual) =>
        atual && atual.branchId === entry.branchId && atual.savedAt >= entry.savedAt ? atual : entry,
      );
    });
    return () => {
      cancelado = true;
    };
  }, [branchId]);

  // Toda carga bem-sucedida regrava o cache. "Bem-sucedida" aqui é
  // `!loading && !error` — inclusive quando a filial tem zero produtos, que é
  // um cache legítimo de "não há nada para vender", não um cache vazio por
  // acidente.
  useEffect(() => {
    if (!branchId || loading || error) return;
    setCached({ branchId, savedAt: Date.now(), products });
    void saveCachedCatalog(branchId, products);
  }, [branchId, loading, error, products]);

  const cacheEmUso = cached !== null && cached.branchId === branchId && (loading || error !== null);

  const recarregar = useCallback(() => {
    void reload();
  }, [reload]);

  return {
    products: cacheEmUso ? cached.products : products,
    // Com cache em mão não há por que mostrar "carregando" e esconder os
    // produtos: a tela já tem o que vender enquanto a rede é tentada.
    loading: loading && !cacheEmUso,
    servedFromCache: cacheEmUso && error !== null,
    cachedAt: cacheEmUso ? cached.savedAt : null,
    reload: recarregar,
  };
}
