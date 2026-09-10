/**
 * Comandos ESC/POS de baixo nível — bytes puros, sem conhecimento de recibo
 * ou de hardware (tarefa E1/E2, 10/09/2026).
 *
 * Fonte primária de cada comando: o "ESC/POS Command Reference for TM
 * Printers" da própria Epson, consultado página por página em
 * download4.epson.biz/sec_pubs/pos/reference_en/escpos/ (mesmo critério de
 * "fonte primária, não memória" de D11/D13 — o CRC do PIX foi conferido
 * contra o manual do Bacen, o QR/Code128 do DANFE contra a norma; aqui o
 * conjunto de comandos é conferido contra a referência do fabricante que
 * cunhou o protocolo, replicado por praticamente toda impressora térmica
 * barata do mercado). Cada função abaixo cita a página exata.
 *
 * ESC/POS não é um padrão ISO/ANSI com um dono neutro — é o protocolo de
 * fato da Epson. Ainda assim é a referência correta: é o que "impressora
 * ESC/POS" significa na prática, inclusive em impressoras de outras marcas.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Concatena vários trechos de bytes num só `Uint8Array`. */
export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export const LINE_FEED = new Uint8Array([LF]);

/**
 * `ESC @` (1B 40) — Initialize printer.
 * Limpa o buffer de impressão e restaura os modos (negrito, alinhamento,
 * tabela de caracteres) para o estado de ligamento.
 * https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/esc_atsign.html
 */
export const INITIALIZE = new Uint8Array([ESC, 0x40]);

/**
 * `ESC E n` (1B 45 n) — Turn emphasized (bold) mode on/off.
 * "Quando o LSB de n é 0, desliga; quando é 1, liga" — usamos só 0/1.
 * Efeito dura até `ESC @`/reset/desligar (não precisa desligar entre linhas
 * se a próxima também for negrito).
 * https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/esc_ce.html
 */
export function bold(on: boolean): Uint8Array {
  return new Uint8Array([ESC, 0x45, on ? 1 : 0]);
}

export type Justification = "left" | "center" | "right";

const JUSTIFICATION_CODE: Record<Justification, number> = { left: 0, center: 1, right: 2 };

/**
 * `ESC a n` (1B 61 n) — Select justification (0 esquerda, 1 centro, 2
 * direita). Só tem efeito no início da linha — por isso quem monta o recibo
 * (`receiptEscpos.ts`) sempre emite isto logo depois de uma quebra de linha.
 * https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/esc_la.html
 */
export function justify(alignment: Justification): Uint8Array {
  return new Uint8Array([ESC, 0x61, JUSTIFICATION_CODE[alignment]]);
}

/**
 * `GS V m` (1D 56 m), <Function A> — Select cut mode and cut paper.
 * m=1 (partial cut, um ponto não cortado — a bobina se destaca com um
 * puxão, sem se soltar sozinha). Só tem efeito no início de linha (por isso
 * `receiptEscpos.ts` sempre alimenta algumas linhas em branco antes).
 * https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_cv.html
 */
export const PARTIAL_CUT = new Uint8Array([GS, 0x56, 0x01]);

/**
 * `ESC p m t1 t2` (1B 70 m t1 t2) — Generate pulse (abertura de gaveta).
 * m seleciona o pino do conector (0 = pino 2, 1 = pino 5 — a maioria das
 * gavetas usa o pino 2, por isso é o padrão aqui). O tempo do pulso em ON é
 * `t1 × 2ms` e em OFF é `t2 × 2ms`; a norma só documenta o intervalo válido
 * (0–255 cada), não um valor obrigatório. `t1=25, t2=250` (≈50ms ligado,
 * ≈500ms desligado) é a convenção comum de mercado para gaveta de solenoide
 * — não é um requisito da Epson, é o que a maioria dos drivers ESC/POS usa.
 * https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/esc_lp.html
 */
export function drawerPulse(pin: 0 | 1 = 0): Uint8Array {
  return new Uint8Array([ESC, 0x70, pin, 25, 250]);
}

/**
 * Alimenta `count` linhas em branco (LF repetido) — usado antes do corte
 * para a lâmina não passar em cima do último texto impresso.
 */
export function feedLines(count: number): Uint8Array {
  return new Uint8Array(Array(count).fill(LF));
}
