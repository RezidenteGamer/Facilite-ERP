import { describe, expect, it } from "vitest";
import {
  centerText,
  formatReceiptMoney,
  padColumns,
  ruleLine,
  stripToPrintableAscii,
  wrapText,
} from "../../src/lib/printer/receiptFormat";

describe("stripToPrintableAscii", () => {
  it("remove acento preservando maiúscula/minúscula (diferente de normalizePixText, que também minusculiza)", () => {
    expect(stripToPrintableAscii("São João da Boa Vista")).toBe("Sao Joao da Boa Vista");
    expect(stripToPrintableAscii("PÃO DE QUEIJO")).toBe("PAO DE QUEIJO");
  });

  it("remove qualquer coisa fora de 0x20-0x7E", () => {
    expect(stripToPrintableAscii("Café ☕ Ltda")).toBe("Cafe  Ltda");
  });

  it("não mexe em texto já ASCII puro", () => {
    expect(stripToPrintableAscii("Total: 10 itens")).toBe("Total: 10 itens");
  });
});

describe("formatReceiptMoney", () => {
  it("usa espaço comum entre R$ e o valor, não o NBSP que toLocaleString(style: currency) insere", () => {
    const text = formatReceiptMoney(1234.5);
    expect(text).toBe("R$ 1.234,50");
    // 0xA0 é o NBSP que `Intl`/`toLocaleString` com `style: "currency"` usa —
    // achado da pesquisa (ver receiptFormat.ts): fora do ASCII imprimível,
    // imprimiria lixo numa impressora ESC/POS.
    expect(text.includes(String.fromCharCode(0xa0))).toBe(false);
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      expect(code).toBeGreaterThanOrEqual(0x20);
      expect(code).toBeLessThanOrEqual(0x7e);
    }
  });

  it("sempre duas casas decimais, mesmo em valor redondo", () => {
    expect(formatReceiptMoney(10)).toBe("R$ 10,00");
  });
});

describe("ruleLine", () => {
  it("repete o caractere pela largura pedida", () => {
    expect(ruleLine("-", 10)).toBe("----------");
    expect(ruleLine("=", 5)).toBe("=====");
  });
});

describe("centerText", () => {
  it("centraliza com espaço a mais à direita quando a sobra é ímpar", () => {
    expect(centerText("AB", 8)).toBe("   AB");
    expect(centerText("AB", 8)).toHaveLength(5);
  });

  it("trunca e remove acento quando o texto não cabe", () => {
    expect(centerText("São João da Boa Vista e Adjacências", 10)).toBe("Sao Joao d");
  });
});

describe("padColumns", () => {
  it("cola left na esquerda e right na direita com pelo menos 1 espaço entre os dois, preenchendo a largura pedida", () => {
    const result = padColumns("Subtotal", "R$ 10,00", 20);
    expect(result).toHaveLength(20);
    expect(result.startsWith("Subtotal")).toBe(true);
    expect(result.endsWith("R$ 10,00")).toBe(true);
    expect(result.slice("Subtotal".length, result.length - "R$ 10,00".length)).toBe(
      " ".repeat(20 - "Subtotal".length - "R$ 10,00".length),
    );
  });

  it("trunca o texto da esquerda quando não cabe, nunca o valor à direita", () => {
    const result = padColumns("Um nome de produto absurdamente comprido", "R$ 5,00", 20);
    expect(result).toHaveLength(20);
    expect(result.endsWith("R$ 5,00")).toBe(true);
  });

  it("quando nem o valor sozinho cabe na largura, devolve só o valor (não trunca dígito de dinheiro)", () => {
    // Não acontece com dinheiro de verdade (largura assumida é 48), mas a
    // função não pode responder cortando o valor — ver o comentário no código.
    const result = padColumns("Subtotal", "R$ 999.999,99", 5);
    expect(result).toBe("R$ 999.999,99");
  });

  it("remove acento dos dois lados", () => {
    const result = padColumns("Pão", "R$ 3,00", 15);
    expect(result).toHaveLength(15);
    expect(result.startsWith("Pao")).toBe(true);
    expect(result.endsWith("R$ 3,00")).toBe(true);
    expect(result).not.toMatch(/[^\x20-\x7E]/);
  });
});

describe("wrapText", () => {
  it("não quebra quando cabe numa linha só", () => {
    expect(wrapText("Refrigerante Lata", 48)).toEqual(["Refrigerante Lata"]);
  });

  it("quebra por palavra quando excede a largura", () => {
    const lines = wrapText("Refrigerante Lata 350ml sabor guarana gelado", 20);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(20);
    expect(lines.join(" ")).toBe("Refrigerante Lata 350ml sabor guarana gelado");
  });

  it("quebra uma palavra sozinha maior que a largura em pedaços", () => {
    const lines = wrapText("A".repeat(25), 10);
    expect(lines).toEqual(["A".repeat(10), "A".repeat(10), "A".repeat(5)]);
  });

  it("texto vazio vira uma linha vazia, não um array vazio", () => {
    expect(wrapText("   ", 10)).toEqual([""]);
  });
});
