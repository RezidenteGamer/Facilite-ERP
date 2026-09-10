/**
 * Código de barras **Code 128, subconjunto C** — o das barras da chave de
 * acesso no DANFE.
 *
 * ## Por que só o subconjunto C (D13, 10/09/2026)
 *
 * O único código de barras que este projeto precisa desenhar é o da chave de
 * acesso: 44 dígitos, sempre. O subconjunto C codifica **dois dígitos por
 * símbolo**, que é exatamente o caso, e por isso é o que o MOC especifica para
 * esse campo. Os subconjuntos A e B (letras e controle) não teriam uso aqui, e
 * incluí-los significaria carregar as regras de troca de subconjunto — código
 * que nunca rodaria.
 *
 * ## Como o símbolo é montado
 *
 * `Start C` + os pares de dígitos + dígito verificador + `Stop`. Cada símbolo
 * é um padrão de 11 módulos descrito por seis larguras alternando
 * barra/espaço (o `Stop` é a exceção: 13 módulos, sete larguras). O dígito
 * verificador é a soma ponderada dos valores, módulo 103.
 *
 * ## O limite da verificação desta tabela — leia antes de confiar
 *
 * A tabela de padrões abaixo é a tabela pública da norma ISO/IEC 15417.
 * `tests/unit/code128.test.ts` confere: o dígito verificador contra um exemplo
 * cuja aritmética qualquer pessoa refaz à mão, e as invariantes estruturais da
 * tabela inteira (todo padrão soma 11 módulos, começa em barra, termina em
 * espaço, tem seis larguras entre 1 e 4, e nenhum se repete). Essas invariantes
 * pegam qualquer erro de um dígito só.
 *
 * O que **não** foi verificado: não existe neste projeto — nem no `node_modules`
 * — nenhuma outra implementação de Code 128 para servir de oráculo, do jeito
 * que o `qrcode.react` serviu para o QR Code, e nenhum leitor de código de
 * barras foi usado. Uma transposição dentro de um padrão que ainda somasse 11 e
 * não colidisse com outro passaria. O risco foi aceito por ser um artefato
 * simulado, sem valor fiscal, que ninguém vai bipar; se algum dia alguém for
 * conferir com um leitor de verdade, este é o parágrafo que diz que a
 * conferência nunca foi feita.
 */

/**
 * Larguras dos 107 símbolos do Code 128 (valores 0–106), na ordem da norma.
 * Cada string alterna barra/espaço a partir de uma barra.
 */
const PATTERNS: readonly string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

/** Valor do símbolo `Start C` — o que declara "daqui em diante, dois dígitos por símbolo". */
const START_C = 105;
/** Valor do símbolo `Stop`, o único de 13 módulos. */
const STOP = 106;

/** Uma barra do símbolo, em módulos: onde começa e quantos módulos ocupa. */
export type Code128Bar = { start: number; width: number };

export type Code128Symbol = {
  /** Largura total do símbolo em módulos — o denominador para caber numa largura em pontos. */
  modules: number;
  /** Só as barras (os espaços são o que sobra); `start` é medido da borda esquerda. */
  bars: Code128Bar[];
  /** Os valores codificados, incluindo `Start C`, o verificador e o `Stop` — para teste. */
  values: number[];
};

/** A tabela crua, para as invariantes estruturais serem conferidas no teste. */
export const CODE128_PATTERNS = PATTERNS;

/**
 * O dígito verificador do Code 128: `(valor do Start + Σ posição × valor) % 103`,
 * com a primeira posição depois do Start valendo 1.
 */
export function code128CheckDigit(values: readonly number[]): number {
  const [start, ...rest] = values;
  let sum = start;
  rest.forEach((value, index) => {
    sum += value * (index + 1);
  });
  return sum % 103;
}

/**
 * Codifica um texto **só de dígitos** em Code 128C.
 *
 * Um número ímpar de dígitos não tem representação nesse subconjunto (ele
 * codifica pares), então a entrada é recusada em vez de completada com zero —
 * uma chave de acesso tem sempre 44 dígitos, e um zero inventado mudaria o
 * conteúdo do código de barras sem ninguém perceber.
 */
export function encodeCode128C(digits: string): Code128Symbol {
  if (!/^\d+$/.test(digits) || digits.length % 2 !== 0) {
    throw new Error(`Code 128C exige uma quantidade par de dígitos; recebeu ${JSON.stringify(digits)}.`);
  }

  const values = [START_C];
  for (let i = 0; i < digits.length; i += 2) values.push(Number(digits.slice(i, i + 2)));
  values.push(code128CheckDigit(values));
  values.push(STOP);

  const bars: Code128Bar[] = [];
  let cursor = 0;
  for (const value of values) {
    const pattern = PATTERNS[value];
    for (let i = 0; i < pattern.length; i += 1) {
      const width = Number(pattern[i]);
      // Índice par = barra, ímpar = espaço. Todo padrão começa em barra.
      if (i % 2 === 0) bars.push({ start: cursor, width });
      cursor += width;
    }
  }

  return { modules: cursor, bars, values };
}
