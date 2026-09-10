/**
 * Formatação de texto para o cupom térmico — largura fixa de coluna,
 * acentuação, dinheiro. Tudo puro (sem `Uint8Array`, sem ESC/POS): produz
 * texto pronto para virar bytes em `receiptEscpos.ts` (tarefa E1, 10/09/2026).
 *
 * ## Largura da bobina assumida: 48 colunas (80mm, fonte A)
 *
 * 48 é o valor que a própria Epson documenta para a fonte A (9×17 pontos) em
 * papel de 80mm nas folhas técnicas das TM-T20/TM-T20II — a família mais
 * comum de impressora térmica barata do mercado. 58mm (tipicamente 32
 * colunas) não é suportado nesta tarefa — ver AGENTS.md.
 */
export const RECEIPT_WIDTH = 48;

/**
 * Remove acento e qualquer caractere fora do ASCII imprimível (0x20–0x7E),
 * preservando maiúscula/minúscula — mesma técnica de `normalizePixText`
 * (D11), mas sem truncar por tamanho (quem corta por coluna é `wrapText`/
 * `padColumns` abaixo).
 *
 * ## Por que isso, e não selecionar uma code page (`ESC t`) por acento
 *
 * ESC/POS troca de code page com `ESC t n` (Epson documenta a página 3 como
 * PC860, "Portuguese":
 * https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/esc_lt.html),
 * mas **qual code page cada impressora de fato tem gravada** varia por
 * fabricante e nem sempre inclui PC860 — a mesma página da Epson lista mais
 * de 50 páginas possíveis, "different depending on the printers". Sem uma
 * impressora real para testar (ver limitação no AGENTS.md), mandar bytes
 * acima de 0x7E apostando numa code page específica arrisca imprimir lixo
 * em qualquer impressora que não tenha essa página exata — o mesmo raciocínio
 * de "impressão de lixo" que o `ESC t` da própria Epson deixa implícito ao
 * dizer que só a faixa 0x20–0x7E é igual em todas as páginas. Remover acento
 * garante legibilidade em 100% das impressoras ESC/POS, sempre. Não
 * selecionamos `ESC t` neste código — não há ganho em declarar uma code page
 * se todo texto enviado já é ASCII puro.
 */
export function stripToPrintableAscii(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "");
}

/**
 * Formato monetário do cupom — mesma regra de `pos.ts formatMoney`
 * (`R$ ` + número pt-BR), mas passado por `stripToPrintableAscii` de
 * propósito: `toLocaleString("pt-BR", { style: "currency" })` insere um
 * espaço NBSP (0xA0) entre "R$" e o número, que não é ASCII imprimível —
 * por isso o formato usado aqui é o de `pos.ts` (espaço comum) e não o de
 * `sales.ts formatMoney` (que usa `style: "currency"`, teria o NBSP).
 */
export function formatReceiptMoney(value: number): string {
  const text = `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return stripToPrintableAscii(text);
}

/** Linha inteira preenchida com `char`, do tamanho de `width`. */
export function ruleLine(char: string, width = RECEIPT_WIDTH): string {
  return char.repeat(width);
}

/** Centraliza `text` numa linha de `width` colunas, truncando se não couber. */
export function centerText(text: string, width = RECEIPT_WIDTH): string {
  const clean = stripToPrintableAscii(text).slice(0, width);
  const padding = width - clean.length;
  const left = Math.floor(padding / 2);
  return " ".repeat(Math.max(0, left)) + clean;
}

/**
 * Uma linha com `left` colado à esquerda e `right` colado à direita, com
 * pelo menos um espaço entre os dois — usada pra pares "rótulo ... valor"
 * (item/preço, "TOTAL"/valor, forma de pagamento/valor). Se não couber nem
 * com um espaço de separação, `left` é truncado (não `right` — o valor em
 * dinheiro precisa continuar legível por inteiro). Se nem `right` sozinho
 * couber na largura (não deveria acontecer com valor em dinheiro real, mas
 * não há como encolher um valor sem mentir sobre ele), a linha sai maior que
 * `width` — a impressora quebra ela sozinha, o que ainda é melhor que perder
 * dígito do valor.
 */
export function padColumns(left: string, right: string, width = RECEIPT_WIDTH): string {
  const cleanLeft = stripToPrintableAscii(left);
  const cleanRight = stripToPrintableAscii(right);
  if (cleanRight.length >= width) return cleanRight;
  const maxLeft = Math.max(0, width - cleanRight.length - 1);
  const truncatedLeft = cleanLeft.slice(0, maxLeft);
  const gap = width - truncatedLeft.length - cleanRight.length;
  return truncatedLeft + " ".repeat(Math.max(1, gap)) + cleanRight;
}

/**
 * Quebra `text` em linhas de até `width` colunas, sem cortar palavra no
 * meio quando cabe quebrar antes dela. Usado nas descrições de produto, que
 * não têm tamanho máximo cadastrado (`products.description`) e podem passar
 * de 48 caracteres.
 */
export function wrapText(text: string, width = RECEIPT_WIDTH): string[] {
  const clean = stripToPrintableAscii(text).trim();
  if (!clean) return [""];

  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}
