import { describe, expect, it } from "vitest";

import { productMatchesSearch, type Product } from "../../src/features/products/products";
import { normalizeSearchText } from "../../src/lib/searchText";

/**
 * Busca de produto por descrição, código interno e GTIN (E4, 10/09/2026).
 *
 * Esta função nasceu de uma linha duplicada: até E4, o PDV (`PosPage.tsx`) e o
 * `ProductPickerPanel` (Realizar Venda, Ajuste de Estoque) tinham a **mesma**
 * condição de filtro copiada, os dois com placeholder prometendo código de
 * barras e nenhum dos dois casando código de barras nenhum — porque a coluna
 * não existia. Testar a função é testar os dois lugares de uma vez, que é o
 * ponto de ela existir.
 */

/** Produto mínimo — só o que o filtro olha; o resto não influencia nada. */
function produto(patch: Partial<Product>): Product {
  return {
    id: "id",
    code: "001",
    description: "Produto",
    stock: 10,
    salePrice: 1,
    active: true,
    ...patch,
  };
}

/** Como a tela chama: o termo já vem normalizado e aparado. */
function casa(p: Product, termoDigitado: string): boolean {
  return productMatchesSearch(p, normalizeSearchText(termoDigitado.trim()));
}

const COCA = produto({
  code: "042",
  description: "Refrigerante Coca-Cola 2L",
  gtin: "7894900011517",
});

describe("productMatchesSearch — o que já funcionava antes de E4", () => {
  it("casa por descrição, sem acento e sem caixa", () => {
    expect(casa(COCA, "coca")).toBe(true);
    expect(casa(COCA, "REFRIGERANTE")).toBe(true);
    const oleo = produto({ description: "Óleo de soja 900ml" });
    expect(casa(oleo, "oleo")).toBe(true);
    expect(casa(oleo, "óleo")).toBe(true);
  });

  it("casa por código interno", () => {
    expect(casa(COCA, "042")).toBe(true);
  });

  it("termo vazio devolve tudo — o filtro só entra em cena quando há busca", () => {
    expect(casa(COCA, "")).toBe(true);
    expect(casa(COCA, "   ")).toBe(true);
  });

  it("não casa o que não está em campo nenhum", () => {
    expect(casa(COCA, "guaraná")).toBe(false);
  });
});

describe("productMatchesSearch — o GTIN que E4 acrescentou", () => {
  it("casa o código de barras inteiro, como o leitor entrega", () => {
    expect(casa(COCA, "7894900011517")).toBe(true);
  });

  it("casa pedaço do código — quem digita na mão raramente digita os 13", () => {
    expect(casa(COCA, "78949")).toBe(true);
    expect(casa(COCA, "11517")).toBe(true);
    expect(casa(COCA, "490001")).toBe(true);
  });

  it("produto sem GTIN não quebra nem casa por engano", () => {
    // Granel, serviço e fabricação própria não têm código de barras, e `gtin`
    // fica indefinido. Um `undefined` virando "undefined" em texto faria a
    // busca por "und" casar todos eles.
    const granel = produto({ description: "Banana prata (kg)", code: "007" });
    expect(granel.gtin).toBeUndefined();
    expect(casa(granel, "banana")).toBe(true);
    expect(casa(granel, "7894900011517")).toBe(false);
    expect(casa(granel, "undefined")).toBe(false);
    expect(casa(granel, "und")).toBe(false);
  });

  it("não confunde código interno com código de barras", () => {
    // `code` é o sequencial "001" da filial; `gtin` é o da embalagem. Buscar
    // um não pode trazer produto que só casa no outro.
    const a = produto({ id: "a", code: "123", description: "Sabão", gtin: "7894900011517" });
    const b = produto({ id: "b", code: "777", description: "Detergente", gtin: "0000000001236" });
    expect(casa(a, "123")).toBe(true);
    expect(casa(b, "123")).toBe(true); // "123" aparece dentro do GTIN de `b`, e isso é busca por substring, não engano
    expect(casa(b, "777")).toBe(true);
    expect(casa(a, "777")).toBe(false);
  });

  it("acha GTIN com zeros à esquerda", () => {
    // O motivo de `gtin` ser `text` e não número: um GTIN-14 como
    // `01234567890128` perderia o zero da frente se virasse número, e a busca
    // por "012" deixaria de achá-lo.
    const importado = produto({ description: "Item importado", gtin: "01234567890128" });
    expect(casa(importado, "012345")).toBe(true);
    expect(casa(importado, "01234567890128")).toBe(true);
  });
});
