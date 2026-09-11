import { describe, expect, it } from "vitest";
import { buildReceiptBytes, buildReceiptLines, buildDrawerPulseBytes, type ReceiptData } from "../../src/lib/printer/receiptEscpos";
import { INITIALIZE, PARTIAL_CUT } from "../../src/lib/printer/escposCommands";

const SAMPLE: ReceiptData = {
  storeName: "Padaria São José",
  storeDocument: "12.345.678/0001-90",
  saleCode: "000123",
  issuedAt: new Date(2026, 8, 10, 14, 32),
  items: [
    { code: "P001", description: "Pão de Queijo", quantity: 2, unitPrice: 5, totalPrice: 10 },
    { code: "P002", description: "Café Coado 300ml", quantity: 1, unitPrice: 8.5, totalPrice: 8.5 },
  ],
  subtotalAmount: 18.5,
  discountAmount: 0,
  totalAmount: 18.5,
  payments: [{ label: "Dinheiro", amount: 20 }],
  changeAmount: 1.5,
};

describe("buildReceiptLines", () => {
  const lines = buildReceiptLines(SAMPLE);

  it("cabeçalho: nome da loja, CNPJ e uma linha dupla logo abaixo", () => {
    expect(lines[0]).toContain("Padaria Sao Jose");
    expect(lines[1]).toContain("12.345.678/0001-90");
    expect(lines[2]).toBe("=".repeat(48));
  });

  it("linha da venda tem o código e a data/hora", () => {
    const saleLine = lines.find((line) => line.includes("Venda #000123"));
    expect(saleLine).toBeDefined();
    expect(saleLine).toContain("10/09/2026");
  });

  it("todo item aparece com quantidade, descrição e os dois preços", () => {
    const text = lines.join("\n");
    expect(text).toContain("2x Pao de Queijo");
    expect(text).toContain("R$ 5,00 un.");
    expect(text).toContain("R$ 10,00");
    expect(text).toContain("1x Cafe Coado 300ml");
  });

  it("TOTAL aparece depois do Subtotal, com o valor certo", () => {
    const subtotalIndex = lines.findIndex((line) => line.startsWith("Subtotal"));
    const totalIndex = lines.findIndex((line) => line.startsWith("TOTAL"));
    expect(subtotalIndex).toBeGreaterThanOrEqual(0);
    expect(totalIndex).toBeGreaterThan(subtotalIndex);
    expect(lines[totalIndex]).toContain("R$ 18,50");
  });

  it("desconto só aparece quando é maior que zero", () => {
    expect(lines.some((line) => line.startsWith("Desconto"))).toBe(false);

    const withDiscount = buildReceiptLines({ ...SAMPLE, discountAmount: 2, totalAmount: 16.5 });
    const discountLine = withDiscount.find((line) => line.startsWith("Desconto"));
    expect(discountLine).toContain("-R$ 2,00");
  });

  it("forma de pagamento e troco aparecem no fim", () => {
    const text = lines.join("\n");
    expect(text).toContain("Dinheiro");
    expect(text).toContain("R$ 20,00");
    const trocoLine = lines.find((line) => line.startsWith("Troco"));
    expect(trocoLine).toContain("R$ 1,50");
  });

  it("troco não aparece quando changeAmount é null (venda não paga em dinheiro único)", () => {
    const withoutChange = buildReceiptLines({ ...SAMPLE, changeAmount: null });
    expect(withoutChange.some((line) => line.startsWith("Troco"))).toBe(false);
  });

  it("nenhuma linha excede a largura da bobina assumida (48 colunas)", () => {
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(48);
  });

  it("nenhum byte de acento sobrevive — tudo ASCII imprimível", () => {
    for (const line of lines) expect(line).not.toMatch(/[^\x20-\x7E]/);
  });
});

/**
 * O recado da venda offline (E6, 10/09/2026): um cupom que sai de uma venda
 * que ainda não está gravada no sistema precisa dizer isso no papel.
 */
describe("buildReceiptLines com `notice`", () => {
  it("imprime o recado logo depois da linha da venda, antes dos itens", () => {
    const lines = buildReceiptLines({
      ...SAMPLE,
      saleCode: "PEND-0F8A1B2C",
      notice: "VENDA PENDENTE DE SINCRONIZACAO",
    });
    const saleIndex = lines.findIndex((line) => line.includes("Venda #PEND-0F8A1B2C"));
    const noticeIndex = lines.findIndex((line) => line.includes("VENDA PENDENTE DE SINCRONIZACAO"));
    const firstItemIndex = lines.findIndex((line) => line.includes("2x Pao de Queijo"));
    expect(saleIndex).toBeGreaterThanOrEqual(0);
    expect(noticeIndex).toBe(saleIndex + 1);
    expect(firstItemIndex).toBeGreaterThan(noticeIndex);
  });

  it("ausente ou nulo, o cupom sai idêntico ao de antes de E6 — venda comum não muda uma linha", () => {
    expect(buildReceiptLines({ ...SAMPLE, notice: null })).toEqual(buildReceiptLines(SAMPLE));
  });
});

describe("buildReceiptBytes", () => {
  const bytes = buildReceiptBytes(SAMPLE);

  it("começa com o comando de inicialização (ESC @)", () => {
    expect(Array.from(bytes.slice(0, INITIALIZE.length))).toEqual(Array.from(INITIALIZE));
  });

  it("termina com o corte de papel (GS V 1), depois de alimentar algumas linhas em branco", () => {
    const tail = bytes.slice(bytes.length - PARTIAL_CUT.length);
    expect(Array.from(tail)).toEqual(Array.from(PARTIAL_CUT));
    // Os bytes logo antes do corte são LF (0x0A) — a folga antes da lâmina.
    const beforeCut = bytes[bytes.length - PARTIAL_CUT.length - 1];
    expect(beforeCut).toBe(0x0a);
  });

  it("contém o comando de negrito ligado (1B 45 01) seguido, em algum ponto, do desligado (1B 45 00)", () => {
    function indexOfSequence(haystack: Uint8Array, needle: number[], from = 0): number {
      for (let i = from; i <= haystack.length - needle.length; i += 1) {
        if (needle.every((value, offset) => haystack[i + offset] === value)) return i;
      }
      return -1;
    }

    const onIndex = indexOfSequence(bytes, [0x1b, 0x45, 0x01]);
    const offIndex = indexOfSequence(bytes, [0x1b, 0x45, 0x00], onIndex + 1);
    expect(onIndex).toBeGreaterThanOrEqual(0);
    expect(offIndex).toBeGreaterThan(onIndex);
  });

  it("decodifica de volta (ignorando os comandos ESC/GS) para o mesmo texto de buildReceiptLines, acentuado ou não", () => {
    const accented = { ...SAMPLE, storeName: "Padaria São José & Cia" };
    const accentedBytes = Array.from(buildReceiptBytes(accented));
    const decodedText = accentedBytes.map((byte) => String.fromCharCode(byte)).join("");
    // Sem acento nenhum sobrevivendo aos bytes finais — a garantia central de
    // `stripToPrintableAscii` chegando até a ponta que realmente sai pro fio.
    expect(decodedText).not.toContain("ã");
    expect(decodedText).not.toContain("é");
    expect(decodedText).toContain("Padaria Sao Jose & Cia");
  });
});

describe("buildDrawerPulseBytes", () => {
  it("é o comando ESC p m t1 t2 (mesmo canal do cupom, tarefa E2)", () => {
    expect(Array.from(buildDrawerPulseBytes()).slice(0, 2)).toEqual([0x1b, 0x70]);
  });
});
