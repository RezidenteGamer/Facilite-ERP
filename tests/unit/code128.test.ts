import { describe, expect, it } from "vitest";
import {
  CODE128_PATTERNS,
  code128CheckDigit,
  encodeCode128C,
} from "../../supabase/functions/_shared/pdf/code128";

/**
 * Ao contrário do QR Code, o Code 128 **não tem oráculo** neste projeto: nada
 * no `node_modules` codifica código de barras. O que dá para conferir de fora
 * está aqui — a aritmética do verificador (refazível à mão) e as invariantes
 * estruturais da tabela da norma. O que isso não prova está escrito, sem
 * eufemismo, no cabeçalho de `code128.ts`.
 */
describe("tabela de padrões do Code 128", () => {
  it("tem os 107 símbolos da norma", () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
  });

  it("todo símbolo de dado soma 11 módulos em seis larguras de 1 a 4", () => {
    // O `Stop` (106) é a exceção declarada pela norma: 13 módulos, sete larguras.
    CODE128_PATTERNS.slice(0, 106).forEach((pattern, value) => {
      const widths = [...pattern].map(Number);
      expect({ value, length: widths.length }).toEqual({ value, length: 6 });
      expect({ value, total: widths.reduce((a, b) => a + b, 0) }).toEqual({ value, total: 11 });
      expect({ value, fora: widths.filter((w) => w < 1 || w > 4) }).toEqual({ value, fora: [] });
    });

    const stop = [...CODE128_PATTERNS[106]].map(Number);
    expect(stop).toHaveLength(7);
    expect(stop.reduce((a, b) => a + b, 0)).toBe(13);
  });

  it("nenhum padrão se repete — é o que torna o símbolo decodificável", () => {
    expect(new Set(CODE128_PATTERNS).size).toBe(CODE128_PATTERNS.length);
  });
});

describe("code128CheckDigit", () => {
  it("bate com a conta feita à mão para 1234567890 em Code 128C", () => {
    // Start C = 105, pares 12/34/56/78/90 com pesos 1..5:
    // 105 + 12·1 + 34·2 + 56·3 + 78·4 + 90·5 = 105+12+68+168+312+450 = 1115
    // 1115 mod 103 = 1115 − 10·103 = 85.
    expect(code128CheckDigit([105, 12, 34, 56, 78, 90])).toBe(85);
  });

  it("o verificador de um símbolo só com o Start é o próprio valor do Start", () => {
    expect(code128CheckDigit([105])).toBe(105 % 103);
  });
});

describe("encodeCode128C", () => {
  it("codifica dois dígitos por símbolo, entre Start C e Stop", () => {
    const symbol = encodeCode128C("1234567890");
    expect(symbol.values).toEqual([105, 12, 34, 56, 78, 90, 85, 106]);
  });

  it("a chave de acesso de 44 dígitos vira 22 símbolos de dado", () => {
    const chave = "35250912345678000199650010000000011000000017";
    expect(chave).toHaveLength(44);
    const symbol = encodeCode128C(chave);
    // Start + 22 pares + verificador + Stop.
    expect(symbol.values).toHaveLength(25);
    // 24 símbolos de 11 módulos + o Stop de 13.
    expect(symbol.modules).toBe(24 * 11 + 13);
    // Toda barra cabe dentro do símbolo e tem largura de 1 a 4 módulos.
    for (const bar of symbol.bars) {
      expect(bar.width).toBeGreaterThanOrEqual(1);
      expect(bar.width).toBeLessThanOrEqual(4);
      expect(bar.start + bar.width).toBeLessThanOrEqual(symbol.modules);
    }
  });

  it("recusa quantidade ímpar de dígitos e texto não numérico", () => {
    expect(() => encodeCode128C("123")).toThrow(/par de dígitos/i);
    expect(() => encodeCode128C("12a4")).toThrow(/par de dígitos/i);
    expect(() => encodeCode128C("")).toThrow(/par de dígitos/i);
  });
});
