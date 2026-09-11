import { describe, expect, it } from "vitest";

import { buildProductInput, validateProductFormValues } from "../../src/features/products/products";

/**
 * Validação do formulário de Produto no que E4 acrescentou: o campo GTIN.
 *
 * A decisão que estes testes trancam é **recusar salvar**, não só avisar. É
 * divergência consciente da chave PIX (D11) e do e-mail (D1), que ficaram sem
 * validação estrita — nos dois casos "o que é válido" era ambíguo. O dígito
 * verificador do GTIN não é: é uma conta publicada pela GS1 que fecha ou não
 * fecha. Ver o comentário de `gtinFieldError` para o porquê por extenso.
 */

/** Só os campos que importam aqui — o resto do formulário é opcional. */
function valores(patch: Record<string, string> = {}): Record<string, string> {
  return { description: "Produto", stock: "1", salePrice: "10", ...patch };
}

const GTIN13_VALIDO = "9780132350884";

describe("validateProductFormValues — campo GTIN", () => {
  it("aceita GTIN válido nos quatro comprimentos", () => {
    for (const gtin of ["96385074", "036000291452", GTIN13_VALIDO, "10012345678902"]) {
      expect(validateProductFormValues(valores({ gtin }))).toEqual([]);
    }
  });

  it("aceita campo vazio — GTIN é opcional", () => {
    // Granel, serviço e fabricação própria não têm código de barras, e isso é
    // estado normal, não pendência.
    expect(validateProductFormValues(valores({ gtin: "" }))).toEqual([]);
    expect(validateProductFormValues(valores({ gtin: "   " }))).toEqual([]);
    expect(validateProductFormValues(valores())).toEqual([]);
  });

  it("recusa salvar com dígito verificador errado", () => {
    const erros = validateProductFormValues(valores({ gtin: "9780132350880" }));
    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain("Código de barras");
  });

  it("recusa comprimento fora dos quatro e caractere que não é dígito", () => {
    expect(validateProductFormValues(valores({ gtin: "12345" }))).toHaveLength(1);
    expect(validateProductFormValues(valores({ gtin: "978-0-13-235088-4" }))).toHaveLength(1);
  });

  it("não engole os outros erros do formulário", () => {
    // O GTIN entra na lista junto com os demais, não no lugar deles.
    const erros = validateProductFormValues(valores({ gtin: "12345", salePrice: "abc" }));
    expect(erros).toHaveLength(2);
  });
});

describe("buildProductInput — campo GTIN", () => {
  it("apara espaço em volta antes de gravar", () => {
    // O GTIN é chave de comparação em dois lugares que não perdoam espaço: a
    // constraint `products_branch_id_gtin_key` e o casamento exato do scanner
    // no PDV. Um leitor que mande espaço antes do CR não pode criar um
    // cadastro que ele mesmo depois não acha.
    const input = buildProductInput(valores({ gtin: `  ${GTIN13_VALIDO}  ` }), null, "", "", "", "");
    expect(input.gtin).toBe(GTIN13_VALIDO);
  });

  it("campo vazio vira undefined, não string vazia", () => {
    // `undefined` é o que o repositório converte em `null` no banco. String
    // vazia gravada seria pior que nulo: com a constraint de unicidade, um
    // segundo produto com GTIN vazio colidiria com o primeiro — nulo, não.
    expect(buildProductInput(valores({ gtin: "" }), null, "", "", "", "").gtin).toBeUndefined();
    expect(buildProductInput(valores({ gtin: "   " }), null, "", "", "", "").gtin).toBeUndefined();
    expect(buildProductInput(valores(), null, "", "", "", "").gtin).toBeUndefined();
  });
});
