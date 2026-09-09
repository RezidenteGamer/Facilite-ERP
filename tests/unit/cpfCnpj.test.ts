import { describe, expect, it } from "vitest";

import { isValidCnpj, isValidCpf } from "@fiscal-core/cpfCnpj.ts";

/**
 * Dígito verificador de CPF e CNPJ (A9, 09/09/2026) — módulo 11 com as tabelas
 * de peso da Receita Federal.
 *
 * Bateria dedicada porque o algoritmo é a única parte de A9 que é **conta**, e
 * não regra de presença: ele acerta ou erra sozinho, sem depender de payload
 * nenhum. Os casos cobrem as duas armadilhas clássicas (sequência de dígitos
 * repetidos, que fecha a conta mas é inválida por definição; e zeros à
 * esquerda, que um `Number` engoliria) além do óbvio — dígito errado e tamanho
 * errado.
 */

/**
 * CNPJ válidos, conferidos dígito a dígito.
 *
 * `00000000000191` é o CNPJ do Banco do Brasil e o exemplo canônico com zeros
 * à esquerda: sem tratar a string, `Number("00000000000191")` viraria `191` e
 * a conta sairia com pesos deslocados.
 */
const CNPJ_VALIDOS = [
  "00000000000191",
  "11222333000181",
  "11444777000161",
];

/** CPF válidos — os dois primeiros são exemplos didáticos consagrados. */
const CPF_VALIDOS = [
  "12345678909",
  "39053344705",
  "01234567890",
];

describe("isValidCnpj", () => {
  it("aceita CNPJ válido, com e sem pontuação", () => {
    for (const cnpj of CNPJ_VALIDOS) {
      expect(isValidCnpj(cnpj)).toBe(true);
    }
    expect(isValidCnpj("00.000.000/0001-91")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    // Espaço em volta é sujeira de cadastro, não documento diferente.
    expect(isValidCnpj("  11222333000181  ")).toBe(true);
  });

  it("recusa dígito verificador errado", () => {
    // Cada um destes é um CNPJ válido com **um** dígito do DV trocado.
    expect(isValidCnpj("00000000000192")).toBe(false);
    expect(isValidCnpj("00000000000181")).toBe(false);
    expect(isValidCnpj("11222333000182")).toBe(false);
    expect(isValidCnpj("11444777000162")).toBe(false);
  });

  it("recusa tamanho errado — inclusive o CNPJ a que falta o zero à esquerda", () => {
    // `0000000000191` é `00000000000191` sem o primeiro zero: 13 dígitos. Não é
    // "um CNPJ quase certo", é um CNPJ inválido.
    expect(isValidCnpj("0000000000191")).toBe(false);
    expect(isValidCnpj("000000000001911")).toBe(false);
    expect(isValidCnpj("11222333")).toBe(false);
    expect(isValidCnpj("")).toBe(false);
    expect(isValidCnpj(null)).toBe(false);
    expect(isValidCnpj(undefined)).toBe(false);
  });

  it("recusa sequência de dígitos repetidos, que o módulo 11 sozinho aceitaria", () => {
    for (let digito = 0; digito <= 9; digito += 1) {
      const repetido = String(digito).repeat(14);
      expect(isValidCnpj(repetido)).toBe(false);
    }
    // A prova de que a checagem explícita é necessária: `00000000000000` fecha
    // o módulo 11 (soma zero ⇒ resto zero ⇒ DV `00`), e só a lista de
    // sequências repetidas o recusa.
    expect(isValidCnpj("00.000.000/0000-00")).toBe(false);
  });

  it("recusa texto que não é documento", () => {
    expect(isValidCnpj("CNPJ não informado")).toBe(false);
    expect(isValidCnpj("--------------")).toBe(false);
  });
});

describe("isValidCpf", () => {
  it("aceita CPF válido, com e sem pontuação", () => {
    for (const cpf of CPF_VALIDOS) {
      expect(isValidCpf(cpf)).toBe(true);
    }
    expect(isValidCpf("123.456.789-09")).toBe(true);
    expect(isValidCpf("390.533.447-05")).toBe(true);
    // Zero à esquerda, o mesmo caso do CNPJ do Banco do Brasil.
    expect(isValidCpf("012.345.678-90")).toBe(true);
  });

  it("recusa dígito verificador errado", () => {
    expect(isValidCpf("12345678900")).toBe(false);
    expect(isValidCpf("12345678919")).toBe(false);
    expect(isValidCpf("39053344704")).toBe(false);
  });

  it("recusa tamanho errado — inclusive o CPF a que falta o zero à esquerda", () => {
    expect(isValidCpf("1234567890")).toBe(false);
    expect(isValidCpf("123456789099")).toBe(false);
    // `12345678` seria "01234567890" sem os dois zeros e o DV: nada disso é CPF.
    expect(isValidCpf("12345678")).toBe(false);
    expect(isValidCpf("")).toBe(false);
    expect(isValidCpf(null)).toBe(false);
    expect(isValidCpf(undefined)).toBe(false);
  });

  it("recusa sequência de dígitos repetidos, que o módulo 11 sozinho aceitaria", () => {
    for (let digito = 0; digito <= 9; digito += 1) {
      expect(isValidCpf(String(digito).repeat(11))).toBe(false);
    }
    expect(isValidCpf("111.111.111-11")).toBe(false);
  });

  it("não confunde CPF com CNPJ: o comprimento decide qual tabela de pesos vale", () => {
    // Um CNPJ válido não é um CPF válido, e vice-versa — as duas funções
    // recusam pelo tamanho antes de calcular.
    expect(isValidCpf("00000000000191")).toBe(false);
    expect(isValidCnpj("12345678909")).toBe(false);
  });
});
