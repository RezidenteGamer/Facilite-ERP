/**
 * Codificador de QR Code que devolve **só a matriz de módulos** — a grade de
 * claro/escuro —, sem desenhar nada.
 *
 * ## Por que existe (D13, 10/09/2026)
 *
 * O QR Code da NFC-e precisa aparecer **dentro do PDF**, e o PDF nasce no
 * servidor (Edge Function `fiscal-emit`, Deno). `qrcode.react`, que D11 trouxe
 * para o PIX, não serve aqui: é um componente React que emite SVG no DOM do
 * navegador. O que o escritor de PDF precisa é da matriz, para pintar um
 * retângulo preto por módulo escuro — que é exatamente o que `pdfDocument.ts`
 * já sabe fazer.
 *
 * Não é reimplementação por gosto: o algoritmo é o da norma ISO/IEC 18004,
 * público e determinístico, e a saída é verificável contra uma implementação
 * independente. `tests/unit/qrMatrix.test.ts` compara a matriz gerada aqui,
 * módulo a módulo, com a que o `qrcode.react` (que empacota o `qrcodegen` do
 * Nayuki) produz para a mesma entrada, em vários tamanhos e nos quatro níveis
 * de correção — mesmo espírito de D11 conferir o CRC16 contra o valor de
 * checagem catalogado em vez de contra si mesmo.
 *
 * ## Escopo
 *
 * Só o **modo byte** (8 bits por caractere), que é o que uma URL exige e o que
 * a NFC-e usa. Os modos numérico, alfanumérico e kanji comprimiriam mais em
 * outros casos, e ficaram de fora porque nenhum deles se aplica aqui.
 */

export type QrErrorCorrection = "L" | "M" | "Q" | "H";

/** A matriz pronta. `modules[y][x] === true` significa módulo **escuro**. */
export type QrMatrix = {
  /** Lado da matriz em módulos (21 na versão 1, 177 na versão 40). */
  size: number;
  version: number;
  modules: boolean[][];
};

/**
 * Codewords de correção de erro **por bloco**, por nível e por versão (1–40).
 * Índice 0 é buraco, para a versão poder indexar direto. Tabela da norma.
 */
const ECC_CODEWORDS_PER_BLOCK: Record<QrErrorCorrection, readonly number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

/** Quantidade de blocos de correção de erro, por nível e por versão. Tabela da norma. */
const ECC_BLOCKS: Record<QrErrorCorrection, readonly number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 5, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

/** Bits de identificação de cada nível dentro da informação de formato. */
const FORMAT_BITS: Record<QrErrorCorrection, number> = { L: 1, M: 0, Q: 3, H: 2 };

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/** Multiplicação no corpo de Galois GF(256), polinômio primitivo 0x11D — o da norma. */
function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** O polinômio gerador de grau `degree`, coeficientes do mais alto ao mais baixo. */
function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** O resto da divisão polinomial — os codewords de correção de erro do bloco. */
function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    for (let i = 0; i < divisor.length; i += 1) result[i] ^= gfMultiply(divisor[i], factor);
  }
  return result;
}

/**
 * Módulos totais da matriz que **cabem dado** (tirando padrões de função e a
 * informação de formato/versão). Fórmula da norma, não tabela.
 */
function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** Codewords de dado disponíveis numa versão + nível. */
function dataCodewords(version: number, ecc: QrErrorCorrection): number {
  return (
    Math.floor(rawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[ecc][version] * ECC_BLOCKS[ecc][version]
  );
}

/** Centros dos padrões de alinhamento, por versão. Fórmula da norma. */
function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

function getBit(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0;
}

/** Os bytes UTF-8 do texto — o modo byte do QR Code é uma sequência de bytes crus. */
function utf8Bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

/**
 * Monta o fluxo de bits (indicador de modo, contagem, dados, terminador,
 * preenchimento) já com o tamanho exato de `dataCodewords`.
 */
function buildDataCodewords(bytes: readonly number[], version: number, ecc: QrErrorCorrection): number[] {
  const capacityBits = dataCodewords(version, ecc) * 8;
  const bits: boolean[] = [];
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push(getBit(value, i));
  };

  append(0b0100, 4); // Indicador do modo byte.
  append(bytes.length, version <= 9 ? 8 : 16); // Largura da contagem muda na versão 10.
  for (const byte of bytes) append(byte, 8);

  // Terminador (até 4 bits zero) e alinhamento no byte.
  append(0, Math.min(4, capacityBits - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);

  // Preenchimento alternado 0xEC / 0x11, definido pela norma.
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) append(pad, 8);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits[i + j] ? 1 : 0);
    codewords.push(byte);
  }
  return codewords;
}

/** Divide em blocos, calcula a correção de erro de cada um e intercala, como manda a norma. */
function addEccAndInterleave(data: readonly number[], version: number, ecc: QrErrorCorrection): number[] {
  const numBlocks = ECC_BLOCKS[ecc][version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecc][version];
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const divisor = rsDivisor(blockEccLen);
  const blocks: number[][] = [];
  for (let i = 0, offset = 0; i < numBlocks; i += 1) {
    const length = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const block = data.slice(offset, offset + length);
    offset += length;
    const eccBytes = rsRemainder(block, divisor);
    // O bloco curto ganha um furo, para todos terem o mesmo comprimento na
    // intercalação; o furo é pulado ao remontar (o `if` do laço abaixo).
    if (i < numShortBlocks) block.push(0);
    blocks.push(block.concat(eccBytes));
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i += 1) {
    for (let j = 0; j < blocks.length; j += 1) {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(blocks[j][i]);
    }
  }
  return result;
}

/** A condição de inversão de cada uma das 8 máscaras. Tabela da norma. */
function maskCondition(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/**
 * Gera a matriz de módulos do QR Code.
 *
 * A versão é a menor em que o texto cabe no nível de correção pedido; a
 * máscara é a de menor penalidade, entre as 8, pelo critério da norma — as
 * duas escolhas são determinísticas, então a mesma entrada sempre produz a
 * mesma matriz (é isso que torna o teste contra outra implementação possível).
 */
export function buildQrMatrix(text: string, ecc: QrErrorCorrection = "M"): QrMatrix {
  const bytes = utf8Bytes(text);

  let version = 1;
  for (; version <= 40; version += 1) {
    const capacity = dataCodewords(version, ecc) * 8;
    const headerBits = 4 + (version <= 9 ? 8 : 16);
    if (headerBits + bytes.length * 8 <= capacity) break;
  }
  if (version > 40) {
    throw new Error(`Texto grande demais para um QR Code no nível ${ecc}: ${bytes.length} bytes.`);
  }

  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

  const setFunction = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };

  // --- Padrões de função -------------------------------------------------

  const drawFinder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFunction(x, y, dist !== 2 && dist !== 4);
      }
    }
  };

  const drawAlignment = (cx: number, cy: number) => {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  };

  const drawFormatBits = (mask: number) => {
    const data = (FORMAT_BITS[ecc] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;

    for (let i = 0; i <= 5; i += 1) setFunction(8, i, getBit(bits, i));
    setFunction(8, 7, getBit(bits, 6));
    setFunction(8, 8, getBit(bits, 7));
    setFunction(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i += 1) setFunction(14 - i, 8, getBit(bits, i));

    for (let i = 0; i < 8; i += 1) setFunction(size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i += 1) setFunction(8, size - 15 + i, getBit(bits, i));
    setFunction(8, size - 8, true); // Módulo sempre escuro.
  };

  for (let i = 0; i < size; i += 1) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }
  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);

  const align = alignmentPositions(version);
  for (let i = 0; i < align.length; i += 1) {
    for (let j = 0; j < align.length; j += 1) {
      const corner =
        (i === 0 && j === 0) ||
        (i === 0 && j === align.length - 1) ||
        (i === align.length - 1 && j === 0);
      if (!corner) drawAlignment(align[i], align[j]);
    }
  }

  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const bit = getBit(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(a, b, bit);
      setFunction(b, a, bit);
    }
  }

  drawFormatBits(0); // Provisório: reescrito com a máscara escolhida no fim.

  // --- Dados -------------------------------------------------------------

  const codewords = addEccAndInterleave(buildDataCodewords(bytes, version, ecc), version, ecc);
  let bitIndex = 0;
  let right = size - 1;
  while (right >= 1) {
    // A coluna 6 é o padrão de tempo vertical: o par pula para 5/4, e as
    // colunas seguintes andam a partir dali (não de 6) — sem esse desvio, um
    // par de colunas seria percorrido duas vezes.
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && bitIndex < codewords.length * 8) {
          modules[y][x] = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
          bitIndex += 1;
        }
      }
    }
    right -= 2;
  }

  // --- Máscara -----------------------------------------------------------

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (!isFunction[y][x] && maskCondition(mask, x, y)) modules[y][x] = !modules[y][x];
      }
    }
  };

  let bestMask = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    applyMask(mask);
    drawFormatBits(mask);
    const penalty = penaltyScore(modules, size);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
    }
    applyMask(mask); // Aplicar de novo desfaz (XOR é sua própria inversa).
  }
  applyMask(bestMask);
  drawFormatBits(bestMask);

  return { size, version, modules };
}

/**
 * A penalidade de uma matriz mascarada, pelos quatro critérios da norma.
 * Só serve para escolher a máscara — quanto menor, melhor.
 */
function penaltyScore(modules: readonly boolean[][], size: number): number {
  let result = 0;

  const addHistory = (runLength: number, history: number[]) => {
    // A primeira sequência ganha a borda clara imaginária que envolve o código.
    const length = history[0] === 0 ? runLength + size : runLength;
    history.pop();
    history.unshift(length);
  };

  /** Quantas vezes a sequência 1:1:3:1:1 (o padrão localizador) aparece. */
  const countPatterns = (history: readonly number[]): number => {
    const n = history[1];
    const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
    return (
      (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
      (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0)
    );
  };

  const terminateAndCount = (runColor: boolean, runLength: number, history: number[]): number => {
    let length = runLength;
    if (runColor) {
      addHistory(length, history);
      length = 0;
    }
    addHistory(length + size, history); // Borda clara final.
    return countPatterns(history);
  };

  // Critério 1 e 3, por linha e por coluna.
  for (let y = 0; y < size; y += 1) {
    let runColor = false;
    let runLength = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    for (let x = 0; x < size; x += 1) {
      if (modules[y][x] === runColor) {
        runLength += 1;
        if (runLength === 5) result += PENALTY_N1;
        else if (runLength > 5) result += 1;
      } else {
        addHistory(runLength, history);
        if (!runColor) result += countPatterns(history) * PENALTY_N3;
        runColor = modules[y][x];
        runLength = 1;
      }
    }
    result += terminateAndCount(runColor, runLength, history) * PENALTY_N3;
  }
  for (let x = 0; x < size; x += 1) {
    let runColor = false;
    let runLength = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    for (let y = 0; y < size; y += 1) {
      if (modules[y][x] === runColor) {
        runLength += 1;
        if (runLength === 5) result += PENALTY_N1;
        else if (runLength > 5) result += 1;
      } else {
        addHistory(runLength, history);
        if (!runColor) result += countPatterns(history) * PENALTY_N3;
        runColor = modules[y][x];
        runLength = 1;
      }
    }
    result += terminateAndCount(runColor, runLength, history) * PENALTY_N3;
  }

  // Critério 2: blocos 2×2 de uma cor só.
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const color = modules[y][x];
      if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) {
        result += PENALTY_N2;
      }
    }
  }

  // Critério 4: desequilíbrio entre módulos escuros e claros.
  let dark = 0;
  for (const row of modules) for (const cell of row) if (cell) dark += 1;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += k * PENALTY_N4;

  return result;
}
