import { describe, expect, it } from "vitest";

import { gs1CheckDigit, isValidGtin } from "../../src/lib/gtin";

/**
 * Dígito verificador de GTIN (E4, 10/09/2026) — módulo 10 com pesos 3/1 da GS1.
 *
 * Bateria dedicada pela mesma razão de `cpfCnpj.test.ts` (A9): o algoritmo é a
 * única parte de E4 que é **conta**, e não regra de presença — acerta ou erra
 * sozinho, sem depender de tela, banco ou leitor nenhum.
 *
 * A procedência de cada vetor está anotada de propósito. "Testei contra a
 * minha própria implementação" não prova nada: se a conta estivesse invertida,
 * a implementação e o vetor estariam invertidos juntos. Por isso os casos
 * abaixo vêm de fora — do documento da GS1 e de códigos publicamente
 * conhecidos — e não de rodar a função e anotar o que saiu.
 */

/**
 * **Vetor da própria GS1.** Figura 7.9.1-2 ("Check digit calculation example")
 * da GS1 General Specifications 17.0.1, o exemplo trabalhado do campo de 18
 * dígitos: o documento mostra a soma dando `101` e o verificador saindo `9`.
 *
 * Vale mais do que qualquer GTIN aqui: exerce `gs1CheckDigit` direto, no
 * comprimento em que a soma **não** é múltiplo de dez, e é a única linha
 * desta bateria cujo resultado está impresso em letra de forma no padrão.
 * Não passa por `isValidGtin` porque 18 dígitos é SSCC, não GTIN — o cálculo
 * é o mesmo ("identical for all fixed length numeric GS1 data structures"),
 * mas o cadastro de produto deste sistema não aceita esse comprimento.
 */
const EXEMPLO_GS1_18_DIGITOS = { dados: "37610425002123456", verificador: 9 };

/**
 * GTIN-14 tirados do corpo da GS1 General Specifications 17.0.1 — são os
 * números que o próprio padrão usa nos exemplos de suas seções.
 */
const GTIN14_DO_PADRAO = ["10012345678902", "90614141000015", "01234567890128"];

/**
 * GTIN-12 (UPC-A): exemplo trabalhado do artigo "Universal Product Code" da
 * Wikipédia, que mostra a conta passo a passo terminando em `2`.
 */
const GTIN12_CONHECIDO = "036000291452";

/**
 * GTIN-13 (EAN-13) **real, de produto que existe**: é o ISBN-13 do livro
 * *Clean Code*, de Robert C. Martin — `978-0-13-235088-4`. ISBN-13 é um EAN-13
 * de verdade (prefixo GS1 `978`, "Bookland"), com o mesmo dígito verificador,
 * e é o tipo de código que um leitor de loja lê da contracapa sem saber que é
 * um livro.
 */
const GTIN13_REAL = "9780132350884";

/**
 * GTIN-8: `96385074` é o exemplo canônico de EAN-8 repetido pela literatura de
 * código de barras. Procedência mais fraca que os demais — não achei GTIN-8 no
 * corpo do GenSpecs extraído — e está anotado aqui como tal, em vez de fingir
 * que saiu do padrão.
 */
const GTIN8_CONHECIDO = "96385074";

describe("gs1CheckDigit", () => {
  it("reproduz o exemplo trabalhado da Figura 7.9.1-2 da GS1", () => {
    expect(gs1CheckDigit(EXEMPLO_GS1_18_DIGITOS.dados)).toBe(EXEMPLO_GS1_18_DIGITOS.verificador);
  });

  it("devolve 0 quando a soma já é múltiplo de dez", () => {
    // O caso que um `10 - (soma % 10)` sem o `% 10` de fora erraria, devolvendo
    // 10 em vez de 0. `0000000000000` soma zero, que é múltiplo de dez.
    expect(gs1CheckDigit("0000000000000")).toBe(0);
    // E o mesmo em código não trivial: os 12 dígitos abaixo somam 89.
    expect(gs1CheckDigit("400638133393")).toBe(1);
  });

  it("pesa da direita para a esquerda, não da esquerda para a direita", () => {
    // A armadilha que este teste tranca: `1000000000000` e `0000000000001` têm
    // os mesmos dígitos, em pontas opostas. Ancorado no verificador, o `1` da
    // direita pesa x3 e o da esquerda pesa x3 também (13 dígitos, ímpar) —
    // então escolhemos um par que distingue de verdade, com 12 dígitos de
    // dado (GTIN-13): aí o da direita pesa x3 e o da esquerda pesa x1.
    expect(gs1CheckDigit("100000000000")).toBe(9); // 1 x1 = 1 -> falta 9
    expect(gs1CheckDigit("000000000001")).toBe(7); // 1 x3 = 3 -> falta 7
  });
});

describe("isValidGtin", () => {
  it("aceita os quatro comprimentos da Figura 7.9.1-1 da GS1", () => {
    expect(isValidGtin(GTIN8_CONHECIDO)).toBe(true);
    expect(isValidGtin(GTIN12_CONHECIDO)).toBe(true);
    expect(isValidGtin(GTIN13_REAL)).toBe(true);
    for (const gtin of GTIN14_DO_PADRAO) {
      expect(isValidGtin(gtin)).toBe(true);
    }
  });

  it("recusa dígito verificador errado", () => {
    // Cada um destes é um dos códigos válidos acima com **só** o verificador
    // trocado — o resto dos dígitos continua idêntico.
    expect(isValidGtin("96385070")).toBe(false);
    expect(isValidGtin("036000291450")).toBe(false);
    expect(isValidGtin("9780132350880")).toBe(false);
    expect(isValidGtin("10012345678900")).toBe(false);
  });

  it("recusa um dígito trocado no meio do código", () => {
    // Um verificador só pega erro de digitação se o resto do código entrar na
    // conta. `9780132350884` com o `2` virando `3` tem que cair.
    expect(isValidGtin("9780133350884")).toBe(false);
    // Transposição de vizinhos — o erro de digitação mais comum. Trocar `35`
    // por `53` em `9780132350884` muda a soma porque os dois dígitos têm
    // pesos diferentes (x3 e x1).
    expect(isValidGtin("9780132530884")).toBe(false);
  });

  it("recusa comprimento fora dos quatro, mesmo com o verificador fechando", () => {
    // Estes três NÃO são "quase um GTIN": o cálculo fecha em cima deles, e
    // mesmo assim não são GTIN, porque a GS1 não define chave desse tamanho.
    // É a prova de que o comprimento é conferido de verdade, e não só por
    // acidente de o verificador não bater.
    expect(gs1CheckDigit("000000000")).toBe(0); // 10 dígitos com verificador 0...
    expect(isValidGtin("0000000000")).toBe(false); // ...e mesmo assim recusado.
    expect(isValidGtin("00000000000")).toBe(false); // 11 dígitos, idem.
    expect(isValidGtin(`${GTIN13_REAL}0`)).toBe(false); // 14 dígitos com verificador de 13.
    // O exemplo de 18 dígitos da GS1 fecha a conta e não é GTIN.
    expect(isValidGtin(`${EXEMPLO_GS1_18_DIGITOS.dados}${EXEMPLO_GS1_18_DIGITOS.verificador}`)).toBe(false);
  });

  it("um GTIN pode ser prefixo válido de outro — o risco de disparo prematuro", () => {
    // Descoberto escrevendo esta bateria, não previsto: `9780132350884`
    // (GTIN-13 real) **sem o último dígito** é `978013235088`, que por
    // coincidência é um GTIN-12 válido — a soma dos 11 primeiros dá 112, e o
    // `8` que sobrou é exatamente o verificador que falta para 120.
    //
    // Não é bug: os dois são GTIN válidos de comprimentos diferentes, e a
    // chance de isso acontecer com qualquer código é de 1 em 10 (o
    // verificador tem dez valores possíveis).
    //
    // Importa porque `scanDetection.ts` usa "o verificador fechou" como sinal
    // de fim de leitura. Num leitor sem sufixo, um GTIN-13 chegando dígito a
    // dígito passa por este estado 12 dígitos antes de terminar. O que impede
    // isso de virar item errado no carrinho não é o cálculo — é o PDV só
    // adicionar sozinho quando o código casa **exatamente um produto
    // cadastrado**, e esse GTIN-12 fantasma não está cadastrado em lugar
    // nenhum. Ver o comentário de `SCAN_MIN_LENGTH` em `scanDetection.ts`.
    expect(isValidGtin(GTIN13_REAL)).toBe(true);
    expect(isValidGtin(GTIN13_REAL.slice(0, -1))).toBe(true);
  });

  it("recusa vazio, nulo e qualquer coisa que não seja dígito", () => {
    expect(isValidGtin(null)).toBe(false);
    expect(isValidGtin(undefined)).toBe(false);
    expect(isValidGtin("")).toBe(false);
    expect(isValidGtin("   ")).toBe(false);
    // Pontuação não é aparada como em CPF/CNPJ: GTIN não tem formato pontuado.
    expect(isValidGtin("978-0-13-235088-4")).toBe(false);
    expect(isValidGtin("97801322350O4")).toBe(false); // letra O no lugar do zero
    expect(isValidGtin("+978013235088")).toBe(false);
  });

  it("apara espaço em volta — sujeira de cadastro, não código diferente", () => {
    expect(isValidGtin(`  ${GTIN13_REAL}  `)).toBe(true);
    expect(isValidGtin(`\t${GTIN12_CONHECIDO}\n`)).toBe(true);
  });

  it("não trata sequência repetida como caso especial, ao contrário de CPF/CNPJ", () => {
    // Divergência deliberada de `isValidCpf`/`isValidCnpj`, que recusam
    // `111.111.111-11` por definição da Receita. A GS1 não tem regra
    // equivalente: `00000000` é um GTIN-8 aritmeticamente válido, e recusá-lo
    // seria inventar uma regra que o padrão não tem. Se algum dia um produto
    // de verdade tiver esse código, o sistema aceita.
    expect(isValidGtin("00000000")).toBe(true);
  });
});
