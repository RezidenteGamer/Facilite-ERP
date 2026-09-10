/**
 * Métricas e codificação da Helvetica — o mínimo para escrever texto num PDF
 * sem embutir fonte nenhuma.
 *
 * ## Por que isto existe (D13, 10/09/2026)
 *
 * Um PDF que usa uma das 14 fontes-padrão (Helvetica entre elas) **não embute
 * o arquivo da fonte**: o leitor já tem a fonte, e o arquivo só diz
 * `/BaseFont /Helvetica`. O preço é que quem escreve o PDF fica sem saber a
 * largura do texto — e sem largura não existe alinhamento à direita, que é o
 * que uma tabela de itens de nota fiscal precisa em toda coluna de valor.
 *
 * As larguras abaixo são as do AFM oficial da Adobe (unidades de 1/1000 do
 * corpo, o padrão de métrica de fonte PostScript). Elas são constantes
 * públicas da fonte, não uma escolha nossa: qualquer implementação que
 * escreva Helvetica usa exatamente estes números.
 *
 * ## Acentuação
 *
 * A tabela cobre o ASCII imprimível (32–126). Para as letras acentuadas do
 * português a largura é a da letra-base — o que é **fato** nas fontes-padrão,
 * não aproximação: `á` é um glifo composto de `a` + acento, e composto não
 * muda o avanço. `normalize("NFD")` faz essa redução sem tabela nenhuma.
 *
 * A codificação de saída é WinAnsi (o `/Encoding /WinAnsiEncoding` declarado
 * no dicionário da fonte), que para a faixa 0xA0–0xFF coincide com Latin-1 —
 * de onde vem todo o acento do português. O que sobra (aspas tipográficas,
 * travessão, bullet) tem um mapa curto; qualquer outro caractere fora de
 * Latin-1 vira `?`, porque um byte inválido no meio de uma string de PDF
 * estraga o arquivo inteiro, e um `?` visível é melhor que isso.
 */

/** Larguras da Helvetica normal, ASCII 32–126, em unidades de 1/1000 do corpo. */
const HELVETICA: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Larguras da Helvetica-Bold, mesma faixa e mesma unidade. */
const HELVETICA_BOLD: readonly number[] = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/**
 * Caracteres tipográficos que o WinAnsi coloca na faixa 0x80–0x9F — a única
 * parte em que ele diverge do Latin-1. Só os que aparecem em texto escrito por
 * gente (aspas curvas que vêm de copiar/colar, travessão, bullet).
 */
const WIN_ANSI_EXTRA: Record<string, number> = {
  "\u20AC": 0x80, // €
  "\u201A": 0x82,
  "\u0192": 0x83,
  "\u201E": 0x84,
  "\u2026": 0x85, // …
  "\u2020": 0x86,
  "\u2021": 0x87,
  "\u2030": 0x89,
  "\u2039": 0x8b,
  "\u2018": 0x91, // '
  "\u2019": 0x92, // '
  "\u201C": 0x93, // "
  "\u201D": 0x94, // "
  "\u2022": 0x95, // •
  "\u2013": 0x96, // –
  "\u2014": 0x97, // —
  "\u203A": 0x9b,
};

/** O byte WinAnsi de um caractere, ou `null` quando ele não cabe na codificação. */
function winAnsiByte(char: string): number | null {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 32 && code <= 126) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  const extra = WIN_ANSI_EXTRA[char];
  return extra ?? null;
}

/**
 * A letra-base de um caractere acentuado, para consulta de largura.
 * `NFD` separa `á` em `a` + combining acute; o primeiro elemento é a base.
 */
function baseChar(char: string): string {
  return char.normalize("NFD").charAt(0);
}

export type HelveticaFace = "regular" | "bold";

/** Largura de um caractere em unidades de 1/1000 do corpo. */
function charWidth(char: string, face: HelveticaFace): number {
  const table = face === "bold" ? HELVETICA_BOLD : HELVETICA;
  const direct = char.charCodeAt(0);
  if (direct >= 32 && direct <= 126) return table[direct - 32];

  const base = baseChar(char).charCodeAt(0);
  if (base >= 32 && base <= 126) return table[base - 32];

  // Fora da faixa e sem letra-base (ç já cai na base `c`; sobram símbolos como
  // º, ª, ©). 556 é a largura mais comum da fonte — erra pouco e nunca zera.
  return 556;
}

/** Largura de um texto, em pontos, para um corpo de `size` pontos. */
export function measureHelvetica(text: string, size: number, face: HelveticaFace = "regular"): number {
  let total = 0;
  for (const char of text) total += charWidth(char, face);
  return (total * size) / 1000;
}

/**
 * O texto convertido em bytes WinAnsi, já com `\`, `(` e `)` escapados — que é
 * exatamente a forma que uma string literal de PDF (`(...)`) exige.
 *
 * Devolve string e não `Uint8Array` de propósito: o arquivo inteiro é montado
 * como string de code units 0–255 e só vira bytes no fim (ver `pdfDocument.ts`,
 * seção sobre offsets), então converter aqui só criaria um vai-e-volta.
 */
export function toPdfLiteral(text: string): string {
  let out = "";
  for (const char of text) {
    // Caractere de controle (a quebra de linha que vem de um campo de texto
    // livre, por exemplo) vira **espaço**, e é checado antes de tudo: um `Tj`
    // desenha uma linha só, então 0x0A não quebraria linha nenhuma. Sem esta
    // linha ele cairia no `?` do fim, que é pior — inventa pontuação onde
    // havia um fim de linha.
    if ((char.codePointAt(0) ?? 0) < 0x20) {
      out += " ";
      continue;
    }
    const byte = winAnsiByte(char) ?? winAnsiByte(baseChar(char)) ?? 0x3f; // '?'
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += "\\";
    out += String.fromCharCode(byte);
  }
  return out;
}

/**
 * Corta o texto no limite de largura, com reticências, quando ele não cabe.
 * Descrição de produto em nota fiscal é livre; sem isto ela invade a coluna
 * seguinte e a tabela deixa de ser legível.
 */
export function truncateHelvetica(
  text: string,
  maxWidth: number,
  size: number,
  face: HelveticaFace = "regular",
): string {
  if (measureHelvetica(text, size, face) <= maxWidth) return text;
  const ellipsis = "...";
  const room = maxWidth - measureHelvetica(ellipsis, size, face);
  if (room <= 0) return "";
  let out = "";
  for (const char of text) {
    if (measureHelvetica(out + char, size, face) > room) break;
    out += char;
  }
  return out + ellipsis;
}
