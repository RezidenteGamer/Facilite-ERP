/**
 * Escritor mínimo de PDF — sem dependência externa nenhuma.
 *
 * ## Por que escrito à mão, e não `pdf-lib` (D13, 10/09/2026)
 *
 * A decisão inteira, com as alternativas medidas, está em AGENTS.md. O resumo:
 * este módulo é importado por `_shared/fiscal/simulatedArtifacts.ts`, que roda
 * **nas três bordas** — Deno (Edge Function `fiscal-emit`), Vite (build do
 * front, pelo alias `@fiscal-core`) e Node (Vitest). Uma dependência `npm:`
 * teria que resolver nas três, o que exigiria um import map novo em
 * `supabase/functions/` e um pacote de ~1,4 MB no caminho de um artefato que é
 * descartado no dia em que A12 ligar o provedor real. Um `.ts` local resolve
 * nas três bordas pelo mesmo mecanismo que todo o resto do núcleo fiscal já
 * usa: caminho relativo com extensão explícita.
 *
 * ## O que ele faz e o que não faz
 *
 * Faz: páginas A4, texto em Helvetica/Helvetica-Bold (as fontes-padrão, que
 * não precisam ser embutidas), retângulos preenchidos ou contornados, linhas.
 * É o vocabulário exato de um DANFE: quadros, tabela, texto, e retângulos
 * pretos para os módulos do QR Code e as barras do Code 128.
 *
 * Não faz: imagem, fonte embutida, compressão de fluxo, transparência,
 * anotação, formulário. Nada disso aparece num DANFE.
 *
 * ## O detalhe que faz um PDF ser válido: os offsets
 *
 * A tabela `xref` no fim do arquivo lista o **offset em bytes** de cada objeto
 * a partir do início do arquivo. Errar um offset é o que produz o clássico
 * "arquivo corrompido" que abre num leitor tolerante e falha em outro.
 *
 * Por isso o arquivo é montado como uma string em que **todo caractere tem
 * code unit entre 0 e 255** (texto já convertido para WinAnsi por
 * `toPdfLiteral`): nessa condição `string.length === bytes.length`, e o offset
 * é simplesmente o comprimento acumulado. A conversão para `Uint8Array` é a
 * última coisa que acontece, caractere a caractere, sem `TextEncoder` — que
 * reintroduziria UTF-8 e desalinharia tudo.
 */

import { measureHelvetica, toPdfLiteral, truncateHelvetica, type HelveticaFace } from "./helveticaMetrics.ts";

/** Tamanho de página em pontos PostScript (1/72 de polegada). A4 = 210 × 297 mm. */
export type PdfPageSize = { width: number; height: number };
export const A4_PORTRAIT: PdfPageSize = { width: 595.28, height: 841.89 };

/** Cor em RGB, cada componente de 0 a 1 — a forma que os operadores `rg`/`RG` esperam. */
export type PdfColor = readonly [number, number, number];
export const BLACK: PdfColor = [0, 0, 0];

export type PdfTextOptions = {
  /** Corpo em pontos. Padrão 9 — o corpo de tabela deste DANFE. */
  size?: number;
  face?: HelveticaFace;
  /** `right`/`center` usam a métrica da Helvetica; `x` passa a ser a borda/eixo. */
  align?: "left" | "right" | "center";
  color?: PdfColor;
  /** Trunca com reticências quando o texto passa desta largura. */
  maxWidth?: number;
};

export type PdfRectOptions = {
  /** Preenchimento. Sem isto, o retângulo é só contorno. */
  fill?: PdfColor;
  /** Cor do contorno. Sem `fill` e sem `stroke`, o padrão é contorno preto. */
  stroke?: PdfColor;
  lineWidth?: number;
};

/**
 * Uma página em construção.
 *
 * **A origem é o canto superior esquerdo e `y` cresce para baixo** — o
 * contrário do PDF, que mede do canto inferior esquerdo. A inversão é feita
 * aqui, num lugar só, porque descrever um documento de cima para baixo é como
 * se pensa um layout; refazer a conta em cada chamada seria convidar erro.
 */
export type PdfPage = {
  readonly size: PdfPageSize;
  /** `y` é a **linha-base** do texto, medida do topo da página. */
  text(x: number, y: number, value: string, options?: PdfTextOptions): void;
  /** `x`,`y` é o canto **superior** esquerdo. */
  rect(x: number, y: number, width: number, height: number, options?: PdfRectOptions): void;
  line(x1: number, y1: number, x2: number, y2: number, options?: { color?: PdfColor; width?: number }): void;
  /** Largura do texto em pontos — para quem precisa posicionar o que vem depois. */
  measure(value: string, size: number, face?: HelveticaFace): number;
};

export type PdfDocument = {
  addPage(size?: PdfPageSize): PdfPage;
  /** Os bytes do arquivo `.pdf`. Começa em `%PDF-` e termina em `%%EOF`. */
  toBytes(): Uint8Array;
  /** Os mesmos bytes em base64 — o formato em que `fiscal_documents.pdf_content` (`text`) guarda. */
  toBase64(): string;
};

/**
 * Número no formato que o PDF aceita: sem notação exponencial (`1e-7` não é
 * sintaxe válida lá) e sem casas decimais inúteis.
 */
function num(value: number): string {
  if (!Number.isFinite(value)) return "0";
  // Arredondar em centésimos de ponto (~2 µm) mantém o número fora da faixa em
  // que `String` recorreria a expoente, e encurta o arquivo.
  return String(Math.round(value * 100) / 100);
}

function colorOp(color: PdfColor, op: "rg" | "RG"): string {
  return `${num(color[0])} ${num(color[1])} ${num(color[2])} ${op}`;
}

const FONT_RESOURCE: Record<HelveticaFace, string> = { regular: "/F1", bold: "/F2" };

export function createPdfDocument(): PdfDocument {
  const pages: { size: PdfPageSize; ops: string[] }[] = [];

  function addPage(size: PdfPageSize = A4_PORTRAIT): PdfPage {
    const ops: string[] = [];
    pages.push({ size, ops });

    /** Converte `y` medido do topo para o `y` do PDF, medido da base. */
    const flip = (y: number) => size.height - y;

    return {
      size,
      measure(value, textSize, face = "regular") {
        return measureHelvetica(value, textSize, face);
      },
      text(x, y, value, options = {}) {
        const textSize = options.size ?? 9;
        const face = options.face ?? "regular";
        const shown =
          options.maxWidth === undefined ? value : truncateHelvetica(value, options.maxWidth, textSize, face);
        if (shown === "") return;

        let left = x;
        if (options.align === "right" || options.align === "center") {
          const width = measureHelvetica(shown, textSize, face);
          left = options.align === "right" ? x - width : x - width / 2;
        }

        ops.push(
          "BT",
          colorOp(options.color ?? BLACK, "rg"),
          `${FONT_RESOURCE[face]} ${num(textSize)} Tf`,
          `${num(left)} ${num(flip(y))} Td`,
          `(${toPdfLiteral(shown)}) Tj`,
          "ET",
        );
      },
      rect(x, y, width, height, options = {}) {
        const shape = `${num(x)} ${num(flip(y + height))} ${num(width)} ${num(height)} re`;
        if (options.fill && options.stroke) {
          ops.push(
            colorOp(options.fill, "rg"),
            colorOp(options.stroke, "RG"),
            `${num(options.lineWidth ?? 0.5)} w`,
            shape,
            "B",
          );
          return;
        }
        if (options.fill) {
          ops.push(colorOp(options.fill, "rg"), shape, "f");
          return;
        }
        ops.push(colorOp(options.stroke ?? BLACK, "RG"), `${num(options.lineWidth ?? 0.5)} w`, shape, "S");
      },
      line(x1, y1, x2, y2, options = {}) {
        ops.push(
          colorOp(options.color ?? BLACK, "RG"),
          `${num(options.width ?? 0.5)} w`,
          `${num(x1)} ${num(flip(y1))} m`,
          `${num(x2)} ${num(flip(y2))} l`,
          "S",
        );
      },
    };
  }

  /**
   * Serializa o arquivo.
   *
   * Numeração dos objetos: 1 = Catalog, 2 = Pages, 3 e 4 = as duas fontes, e
   * daí em diante um par (página, fluxo de conteúdo) por página.
   */
  function serialize(): string {
    if (pages.length === 0) addPage();

    const firstPageObject = 5;
    const pageIds = pages.map((_, index) => firstPageObject + index * 2);

    const bodies: string[] = [];
    bodies[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    bodies[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
    bodies[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    bodies[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

    pages.forEach((page, index) => {
      const pageId = pageIds[index];
      const streamId = pageId + 1;
      const content = page.ops.join("\n");
      bodies[pageId] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.size.width)} ${num(page.size.height)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`;
      // `Length` é o número de **bytes** do fluxo — e é por isso que o arquivo
      // inteiro precisa ter um byte por caractere (ver o cabeçalho deste arquivo).
      bodies[streamId] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    });

    const total = bodies.length - 1;
    let file = "%PDF-1.4\n";
    // Comentário com bytes altos: convenção do formato para que ferramentas de
    // transferência tratem o arquivo como binário e não convertam quebra de linha.
    file += "%âãÏÓ\n";

    const offsets: number[] = [];
    for (let id = 1; id <= total; id += 1) {
      offsets[id] = file.length;
      file += `${id} 0 obj\n${bodies[id]}\nendobj\n`;
    }

    const xrefOffset = file.length;
    file += `xref\n0 ${total + 1}\n`;
    file += "0000000000 65535 f \n";
    for (let id = 1; id <= total; id += 1) {
      file += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    }
    file += `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return file;
  }

  function toBytes(): Uint8Array {
    const file = serialize();
    const bytes = new Uint8Array(file.length);
    for (let i = 0; i < file.length; i += 1) bytes[i] = file.charCodeAt(i) & 0xff;
    return bytes;
  }

  return {
    addPage,
    toBytes,
    toBase64() {
      return bytesToBase64(toBytes());
    },
  };
}

/**
 * Bytes → base64, sem `Buffer` (que não existe no Deno) e sem passar o array
 * inteiro de uma vez para `String.fromCharCode` (que estoura a pilha de
 * argumentos em arquivo grande).
 *
 * `btoa`/`atob` existem nas três bordas: Deno, navegador e Node moderno.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
