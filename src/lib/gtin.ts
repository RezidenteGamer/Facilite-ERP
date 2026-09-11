/**
 * Dígito verificador de GTIN — o "módulo 10 com pesos 3/1" da GS1 (E4, 10/09/2026).
 *
 * ## A fonte
 *
 * Ao contrário do ESC/POS de E1 (padrão de fato da Epson, sem dono neutro), o
 * GTIN tem dono formal e especificação publicada: a **GS1**. O algoritmo aqui
 * é a transcrição direta da **GS1 General Specifications, Release 17.0.1
 * (Ratified, Jan 2017), seção 7.9.1 — "Standard check digit calculations for
 * GS1 data structures", Figura 7.9.1-1**, obtida em
 * `https://ref.gs1.org/standards/genspecs/17.0.1/`. Mesma disciplina de A9
 * (CPF/CNPJ na fonte da Receita) e D11 (CRC16 na fonte do Bacen): fonte
 * primária, não memória e não biblioteca de terceiros.
 *
 * Os três passos, como o documento os enumera:
 *
 *   1. *"Multiply value of each position by"* — os pesos alternam `x3` e `x1`,
 *      **da direita para a esquerda**, com `x3` caindo sempre no dígito
 *      imediatamente à esquerda do verificador.
 *   2. Somar os produtos.
 *   3. *"Subtract sum from nearest equal or higher multiple of ten = check
 *      digit"*.
 *
 * O documento é explícito quanto ao alcance: *"This algorithm is identical for
 * all fixed length numeric GS1 data structures"* — a mesma figura alinha
 * GTIN-8, GTIN-12, GTIN-13, GTIN-14, 17 e 18 dígitos na mesma tabela de pesos,
 * todos justificados à direita. É por isso que `gs1CheckDigit` abaixo não sabe
 * o comprimento do que recebe: **não precisa saber**. Quem decide quais
 * comprimentos este sistema aceita é `isValidGtin`, não o cálculo.
 *
 * ## Por que a direção importa (e por que não se parametriza com cpfCnpj.ts)
 *
 * Contar os pesos da **esquerda** daria resultado diferente conforme o
 * comprimento: num GTIN-13 (12 dígitos de dado, par) o primeiro dígito pesa
 * `x1`; num GTIN-14 (13 de dado, ímpar) pesa `x3`. Ancorar no verificador
 * elimina o caso especial — é exatamente como a figura da GS1 desenha, com
 * todos os comprimentos alinhados à direita.
 *
 * Deliberadamente **não** compartilha código com `digitoModulo11` de
 * `cpfCnpj.ts`: lá é módulo 11 com pesos descendo de uma tabela da Receita,
 * aqui é módulo 10 com dois pesos alternados da GS1. São duas contas
 * diferentes de duas autoridades diferentes, e unificá-las numa função
 * parametrizada esconderia a diferença em vez de mostrá-la — a mesma leitura
 * que A9 já tinha feito ao não reaproveitar `accessKeyCheckDigit`.
 *
 * ## O que estas funções não fazem
 *
 * Não normalizam, não formatam e não reescrevem nada. Respondem `true`/`false`
 * (e, em `gs1CheckDigit`, um dígito), e mais nada — `products.gtin` é `text`
 * livre no banco, sem `CHECK` de formato, pela mesma razão que D11 não pôs
 * `CHECK` na chave PIX: um `CHECK` errado recusaria um GTIN legítimo de
 * comprimento incomum. A recusa é do formulário, e só dele.
 */

/** Comprimentos de GTIN que este sistema aceita — os quatro da GS1. */
const GTIN_LENGTHS = [8, 12, 13, 14];

/** Só dígitos, nada mais — um GTIN não tem pontuação nem letra. */
const SOMENTE_DIGITOS = /^\d+$/;

/**
 * O dígito verificador que a GS1 calcula para `digitosSemVerificador` — os
 * dígitos de dado **sem** o verificador, de qualquer comprimento.
 *
 * Percorre da direita para a esquerda começando com peso `3`, soma, e devolve
 * o quanto falta para o próximo múltiplo de dez (`0` quando a soma já é
 * múltiplo — é o `% 10` de fora que garante isso, sem caso especial).
 *
 * Presume que a entrada já foi conferida (só dígitos): quem chama de fora é
 * `isValidGtin`, que confere antes.
 */
export function gs1CheckDigit(digitosSemVerificador: string): number {
  let soma = 0;
  let peso = 3;
  for (let i = digitosSemVerificador.length - 1; i >= 0; i--) {
    soma += Number(digitosSemVerificador[i]) * peso;
    peso = peso === 3 ? 1 : 3;
  }
  return (10 - (soma % 10)) % 10;
}

/**
 * Este GTIN é válido? Aceita GTIN-8, GTIN-12 (UPC-A), GTIN-13 (EAN-13) e
 * GTIN-14 — os quatro que a Figura 7.9.1-1 da GS1 lista.
 *
 * Nulo, vazio, qualquer caractere que não seja dígito, comprimento fora dos
 * quatro e dígito verificador errado devolvem `false`. Espaço em volta é
 * sujeira de cadastro (ou de leitor mal configurado), não um código diferente:
 * é aparado antes de conferir, mesma leitura de `isValidCnpj`.
 *
 * Aceitar os quatro comprimentos, e não só o EAN-13 do varejo brasileiro, é
 * decisão consciente: a caixa de um produto que chega do distribuidor traz
 * GTIN-14 (o DUN-14 da embalagem de transporte), produto importado dos EUA
 * traz GTIN-12, e item pequeno demais para um EAN-13 traz GTIN-8. Restringir a
 * 13 recusaria código legítimo que o operador tem na mão, sem ganhar nada — o
 * cálculo é literalmente o mesmo para os quatro.
 */
export function isValidGtin(value: string | null | undefined): boolean {
  const digitos = (value ?? "").trim();
  if (!SOMENTE_DIGITOS.test(digitos)) return false;
  if (!GTIN_LENGTHS.includes(digitos.length)) return false;

  const esperado = gs1CheckDigit(digitos.slice(0, -1));
  return Number(digitos[digitos.length - 1]) === esperado;
}

/**
 * Este texto **tem cara** de GTIN completo — comprimento certo e verificador
 * fechando? É `isValidGtin` com outro nome, e existe só para dar nome ao papel
 * que ela faz no PDV: lá a pergunta não é "o operador digitou um cadastro
 * válido?", é "a rajada de teclas que acabou de chegar já formou um código
 * inteiro?". Um dígito verificador que fecha é o próprio sinal de fim de
 * leitura — ver `scanDetection.ts`.
 */
export const looksLikeCompleteGtin = isValidGtin;
