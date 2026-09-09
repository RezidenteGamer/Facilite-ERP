/**
 * Dígito verificador de CPF e CNPJ — módulo 11 com as tabelas de peso da
 * Receita Federal (A9, 09/09/2026).
 *
 * ## Por que isto existe, e por que agora
 *
 * Até A9 o sistema **não conferia dígito verificador de documento em lugar
 * nenhum**: nem no núcleo fiscal, nem em `src/lib`, nem em `cnpjLookup.ts`
 * (que só consulta a BrasilAPI para autopreencher endereço e checa o
 * comprimento de 14). O que existia era o DV **da chave de acesso**
 * (`accessKeyCheckDigit`, em `accessKey.ts`), que é módulo 11 de outro
 * conjunto de dígitos e não diz nada sobre o CNPJ que entra nela — a chave
 * fecha o DV dela mesma ainda que o CNPJ nas posições 7-20 seja inventado.
 *
 * ## A fonte do algoritmo
 *
 * O cálculo é **público e determinístico**, e a fonte é a própria Receita
 * Federal, não uma biblioteca de terceiros:
 *
 * - **CNPJ**: o cálculo dos dois DV está descrito no material oficial do
 *   Cadastro Nacional da Pessoa Jurídica — módulo 11, com os pesos `2` a `9`
 *   ciclando da direita para a esquerda sobre os 12 primeiros dígitos (1º DV)
 *   e sobre os 13 primeiros (2º DV). Resto `0` ou `1` ⇒ DV `0`.
 * - **CPF**: o mesmo módulo 11, com os pesos descendo de `10` a `2` sobre os 9
 *   primeiros dígitos (1º DV) e de `11` a `2` sobre os 10 primeiros (2º DV).
 *   Mesma regra de resto.
 *
 * As duas tabelas são **a mesma progressão** vista de pontas diferentes, e é
 * por isso que `digitoModulo11` abaixo serve aos dois: o peso começa no valor
 * que a tabela manda e desce até `2`, voltando a `9` quando passa disso. Para
 * o CPF o ciclo nunca chega a reiniciar (9 e 10 dígitos cabem em `10..2` e
 * `11..2`); para o CNPJ ele reinicia uma vez, que é exatamente o
 * `5,4,3,2,9,8,7,6,5,4,3,2` da tabela oficial.
 *
 * É a mesma família do `accessKeyCheckDigit`, e de propósito não se
 * compartilha código com ele: lá o peso **sobe** de 2 a 9 percorrendo a chave
 * de trás para frente, aqui ele **desce** percorrendo o documento da frente
 * para trás. Unificar as duas em uma função parametrizada esconderia a
 * diferença em vez de mostrá-la.
 *
 * ## As duas armadilhas clássicas
 *
 * 1. **Sequência de dígitos repetidos.** `111.111.111-11` e
 *    `00.000.000/0000-00` **passam** o cálculo do módulo 11 — a conta fecha de
 *    verdade. A Receita as trata como inválidas por definição, e por isso a
 *    checagem explícita (`SEQUENCIA_REPETIDA`) vem **antes** do cálculo. Sem
 *    ela, o algoritmo sozinho aceitaria o documento mais obviamente falso que
 *    existe.
 * 2. **Zeros à esquerda.** Todo o cálculo roda sobre a **string** de dígitos,
 *    nunca sobre `Number`: `00000000000191` é um CNPJ válido, e um
 *    `Number.parseInt` o transformaria em `191`. É também por isso que o
 *    comprimento é conferido depois de tirar a pontuação e antes de qualquer
 *    outra coisa — 13 dígitos não são "um CNPJ a que falta um zero", são um
 *    CNPJ inválido.
 *
 * ## O que estas funções **não** fazem
 *
 * Não normalizam nem devolvem valor formatado. Elas respondem `true`/`false` e
 * mais nada — o formato **gravado** continua sendo o que cada tabela já usa
 * (`branches.cnpj` e `contacts.document` são `text` livre, e `invoiceMapping`
 * já aplica `onlyDigits` no documento do destinatário antes de montar o
 * payload). A9 não introduz um formato paralelo: ela **lê** o que está lá,
 * tira a pontuação só para conferir, e não reescreve nada.
 */

import { onlyDigits } from "./accessKey.ts";

/** `11111111111`, `00000000000000` e companhia — fecham a conta e são inválidos assim mesmo. */
const SEQUENCIA_REPETIDA = /^(\d)\1+$/;

/**
 * Um dígito verificador de módulo 11, com o peso **descendo** de `pesoInicial`
 * até `2` e voltando a `9` quando passa disso.
 *
 * Resto `0` ou `1` devolve `0` — a regra da Receita, não um atalho, e a mesma
 * que o DV da chave de acesso usa.
 */
function digitoModulo11(digitos: string, pesoInicial: number): number {
  let soma = 0;
  let peso = pesoInicial;
  for (const digito of digitos) {
    soma += Number(digito) * peso;
    peso = peso === 2 ? 9 : peso - 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** O documento tem só dígitos, o comprimento certo, e não é sequência repetida? */
function formatoUtilizavel(digitos: string, tamanho: number): boolean {
  return digitos.length === tamanho && !SEQUENCIA_REPETIDA.test(digitos);
}

/**
 * Este CPF é válido? Aceita com ou sem pontuação (`123.456.789-09` e
 * `12345678909` são o mesmo documento); nulo, vazio, tamanho errado, dígito
 * verificador errado e sequência repetida devolvem `false`.
 */
export function isValidCpf(value: string | null | undefined): boolean {
  const digitos = onlyDigits(value ?? "");
  if (!formatoUtilizavel(digitos, 11)) return false;

  const primeiro = digitoModulo11(digitos.slice(0, 9), 10);
  const segundo = digitoModulo11(digitos.slice(0, 10), 11);
  return digitos.slice(9) === `${primeiro}${segundo}`;
}

/**
 * Este CNPJ é válido? Mesmas regras do CPF, com 14 dígitos e as tabelas de
 * peso do CNPJ. Aceita `00.000.000/0001-91` e `00000000000191` igualmente.
 */
export function isValidCnpj(value: string | null | undefined): boolean {
  const digitos = onlyDigits(value ?? "");
  if (!formatoUtilizavel(digitos, 14)) return false;

  const primeiro = digitoModulo11(digitos.slice(0, 12), 5);
  const segundo = digitoModulo11(digitos.slice(0, 13), 6);
  return digitos.slice(12) === `${primeiro}${segundo}`;
}
