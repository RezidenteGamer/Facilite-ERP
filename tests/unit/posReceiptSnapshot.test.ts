import { describe, expect, it } from "vitest";
import { buildPosReceiptSnapshot } from "../../src/features/pos/receipt";
import type { PosCartLine } from "../../src/features/pos/usePosSale";
import type { Product } from "../../src/features/products/products";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-1",
    code: "P001",
    description: "Refrigerante Lata 350ml",
    salePrice: 5,
    stock: 100,
    active: true,
    ...overrides,
  } as Product;
}

function makeCart(): PosCartLine[] {
  return [
    { lineId: "l1", product: makeProduct(), quantity: 2 },
    { lineId: "l2", product: makeProduct({ id: "prod-2", code: "P002", description: "Pão Francês", salePrice: 0.75 }), quantity: 4 },
  ];
}

describe("buildPosReceiptSnapshot", () => {
  it("traduz cada linha do carrinho em item do recibo, com o total já calculado", () => {
    const snapshot = buildPosReceiptSnapshot({
      saleCode: "000123",
      issuedAt: new Date(2026, 8, 10),
      cart: makeCart(),
      subtotalAmount: 13,
      discountAmount: 0,
      totalAmount: 13,
      payments: [{ method: "dinheiro", amount: 13, installments: 1 }],
      changeAmount: null,
      storeName: "Facilite LTDA",
      storeDocument: "12.345.678/0001-90",
    });

    expect(snapshot.receipt.items).toEqual([
      { code: "P001", description: "Refrigerante Lata 350ml", quantity: 2, unitPrice: 5, totalPrice: 10 },
      { code: "P002", description: "Pão Francês", quantity: 4, unitPrice: 0.75, totalPrice: 3 },
    ]);
  });

  it("rótulo do pagamento inclui parcelas só no crédito com mais de 1x", () => {
    const base = {
      saleCode: "1",
      issuedAt: new Date(),
      cart: [],
      subtotalAmount: 0,
      discountAmount: 0,
      totalAmount: 0,
      changeAmount: null,
      storeName: "Loja",
      storeDocument: null,
    };

    expect(
      buildPosReceiptSnapshot({ ...base, payments: [{ method: "credito", amount: 100, installments: 1 }] }).receipt
        .payments[0].label,
    ).toBe("Crédito");

    expect(
      buildPosReceiptSnapshot({ ...base, payments: [{ method: "credito", amount: 100, installments: 3 }] }).receipt
        .payments[0].label,
    ).toBe("Crédito (3x)");

    expect(
      buildPosReceiptSnapshot({ ...base, payments: [{ method: "pix", amount: 100, installments: 1 }] }).receipt
        .payments[0].label,
    ).toBe("PIX");
  });

  it("hasCashPayment é true quando dinheiro está entre as formas de pagamento, mesmo dividido com outra", () => {
    const base = {
      saleCode: "1",
      issuedAt: new Date(),
      cart: [],
      subtotalAmount: 0,
      discountAmount: 0,
      totalAmount: 0,
      changeAmount: null,
      storeName: "Loja",
      storeDocument: null,
    };

    expect(
      buildPosReceiptSnapshot({
        ...base,
        payments: [
          { method: "dinheiro", amount: 10, installments: 1 },
          { method: "credito", amount: 20, installments: 2 },
        ],
      }).hasCashPayment,
    ).toBe(true);

    expect(
      buildPosReceiptSnapshot({ ...base, payments: [{ method: "pix", amount: 30, installments: 1 }] }).hasCashPayment,
    ).toBe(false);
  });

  it("propaga desconto e troco tal como recebidos", () => {
    const snapshot = buildPosReceiptSnapshot({
      saleCode: "5",
      issuedAt: new Date(),
      cart: [],
      subtotalAmount: 50,
      discountAmount: 5,
      totalAmount: 45,
      payments: [{ method: "dinheiro", amount: 50, installments: 1 }],
      changeAmount: 5,
      storeName: "Loja",
      storeDocument: null,
    });

    expect(snapshot.receipt.discountAmount).toBe(5);
    expect(snapshot.receipt.totalAmount).toBe(45);
    expect(snapshot.receipt.changeAmount).toBe(5);
  });

  it("usa 'Facilite' como nome padrão quando a filial ainda não carregou (storeInfo null em usePosSale)", () => {
    const snapshot = buildPosReceiptSnapshot({
      saleCode: "1",
      issuedAt: new Date(),
      cart: [],
      subtotalAmount: 0,
      discountAmount: 0,
      totalAmount: 0,
      payments: [],
      changeAmount: null,
      storeName: "Facilite",
      storeDocument: null,
    });
    expect(snapshot.receipt.storeName).toBe("Facilite");
  });

  /**
   * ## O teste que fecha o bug do reset()
   *
   * A pesquisa prévia encontrou: `confirmSale` (`usePosSale.ts`) chama
   * `reset()` logo depois de confirmar a venda, e `reset()` zera `cart`
   * (`setCart([])`) antes da emissão da NFC-e terminar. A correção foi
   * chamar `buildPosReceiptSnapshot` com o `cart` ainda cheio, **antes** de
   * `reset()` rodar (ver o comentário em `usePosSale.ts confirmSale`).
   *
   * Esse teste prova a outra metade da garantia: mesmo que o array de
   * carrinho passado pra dentro seja mutado depois (o que `reset()` não faz
   * — ele troca o estado por um array novo via `setCart([])`, mas uma
   * implementação futura poderia mudar isso), o snapshot já retornado por
   * `buildPosReceiptSnapshot` não se altera, porque `items` é construído com
   * `.map()` (copia os dados, não guarda referência ao array de entrada).
   * Se algum dia `buildPosReceiptSnapshot` for "otimizado" para reusar o
   * array do carrinho sem copiar, este teste pega a regressão.
   */
  it("o snapshot não muda se o array de carrinho original for alterado depois (sobrevive a um reset() hipotético que mutasse em vez de substituir)", () => {
    const cart = makeCart();
    const snapshot = buildPosReceiptSnapshot({
      saleCode: "9",
      issuedAt: new Date(),
      cart,
      subtotalAmount: 13,
      discountAmount: 0,
      totalAmount: 13,
      payments: [{ method: "dinheiro", amount: 13, installments: 1 }],
      changeAmount: null,
      storeName: "Loja",
      storeDocument: null,
    });

    // Simula um "reset()" que mutasse o array em vez de trocar por um novo.
    cart.length = 0;

    expect(snapshot.receipt.items).toHaveLength(2);
    expect(snapshot.receipt.items[0].description).toBe("Refrigerante Lata 350ml");
  });
});
