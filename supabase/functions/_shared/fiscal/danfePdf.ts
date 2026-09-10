/**
 * O DANFE / DANFE NFC-e do provedor simulado, em **PDF de verdade** (D13,
 * 10/09/2026).
 *
 * ## O que mudou e por quê
 *
 * Até D13 este artefato era uma página HTML. O comentário que justificava
 * aquilo ("gerar PDF de verdade exigiria uma biblioteca só para um arquivo
 * descartável") caiu junto com a premissa: `_shared/pdf/` escreve PDF sem
 * biblioteca nenhuma. O que a tela mostra ao operador passa a ser o formato em
 * que uma nota fiscal realmente circula — e é o mesmo formato que o provedor
 * real (Focus, tarefa A12) vai devolver em `caminho_danfe`, então a troca
 * deixa de mudar o tipo do arquivo.
 *
 * ## Um layout A4 só, para os dois modelos
 *
 * NF-e e NFC-e saem no mesmo A4, mudando rótulo e a presença de dois blocos
 * (o quadro de entrada/saída, que só a NF-e tem; o QR Code, que só a NFC-e
 * tem). **Não** existe aqui o formato estreito de bobina de 80 mm que uma
 * NFC-e ganha numa impressora térmica: impressão térmica é ESC/POS por
 * WebUSB/WebSerial, tecnologia sem relação nenhuma com gerar PDF, e é a
 * tarefa E1. Enquanto E1 não existir, qualquer "cupom" seria visualizado no
 * navegador como qualquer outro PDF — um papel de 80 mm de largura não
 * entregaria nada além de uma página estranha.
 *
 * ## Fidelidade ao MOC: o formato geral, não o milímetro
 *
 * A ordem e o conteúdo dos quadros seguem o DANFE do Manual de Orientação do
 * Contribuinte — emitente, chave de acesso com código de barras, natureza da
 * operação e protocolo, destinatário, cálculo do imposto, produtos. As
 * posições em milímetro e as regras tipográficas da norma **não** são
 * perseguidas, por duas razões que não mudam com esforço: este documento não é
 * o documento fiscal de ninguém (o provedor real devolve o dele, homologado), e
 * ele deixa de existir no dia em que A12 ligar.
 */

import { encodeCode128C } from "../pdf/code128.ts";
import { A4_PORTRAIT, BLACK, createPdfDocument, type PdfColor, type PdfPage } from "../pdf/pdfDocument.ts";
import { buildQrMatrix } from "../pdf/qrMatrix.ts";
import { onlyDigits } from "./accessKey.ts";
import type { NfePayload } from "./types.ts";
import type { SimulatedIssue } from "./simulatedArtifacts.ts";

const MARGIN = 28;
const PAGE = A4_PORTRAIT;
const CONTENT_LEFT = MARGIN;
const CONTENT_RIGHT = PAGE.width - MARGIN;
const CONTENT_WIDTH = CONTENT_RIGHT - CONTENT_LEFT;
const FOOTER_TOP = PAGE.height - MARGIN - 24;

const GREY: PdfColor = [0.42, 0.42, 0.42];
const HAIRLINE: PdfColor = [0.62, 0.62, 0.62];
const BANNER_FILL: PdfColor = [1, 0.96, 0.9];
const BANNER_STROKE: PdfColor = [0.86, 0.65, 0.28];
const HEADER_FILL: PdfColor = [0.93, 0.93, 0.93];

/** `1.234,56` — o formato monetário do Brasil, escrito à mão para não depender de ICU. */
function money(value: number | undefined): string {
  const fixed = Math.abs(value ?? 0).toFixed(2);
  const [inteiro, centavos] = fixed.split(".");
  const comPontos = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${(value ?? 0) < 0 ? "-" : ""}${comPontos},${centavos}`;
}

/** Quantidade com até 4 casas, sem zeros à toa — `2`, `1,5`, `0,3333`. */
function quantity(value: number): string {
  const fixed = value.toFixed(4).replace(/0+$/, "").replace(/[.,]$/, "");
  return fixed.replace(".", ",");
}

/** `2026-09-10T14:03:00-03:00` → `10/09/2026 14:03`. Texto que não casa volta inteiro. */
function dateTime(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso);
  if (!match) return iso;
  const [, ano, mes, dia, hora, minuto] = match;
  const data = `${dia}/${mes}/${ano}`;
  return hora ? `${data} ${hora}:${minuto}` : data;
}

/** Agrupa a chave de 44 dígitos de 4 em 4, como o DANFE imprime. */
function formatKey(chave: string): string {
  return chave.replace(/(\d{4})(?=\d)/g, "$1 ");
}

function formatCnpjCpf(value: string | undefined): string {
  const digits = onlyDigits(value ?? "");
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  return value ?? "";
}

function formatCep(value: string | undefined): string {
  const digits = onlyDigits(value ?? "");
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : (value ?? "");
}

function enderecoEmitente(payload: NfePayload): string {
  const partes = [
    [payload.logradouro_emitente, payload.numero_emitente].filter(Boolean).join(", "),
    payload.bairro_emitente,
    [payload.municipio_emitente, payload.uf_emitente].filter(Boolean).join("/"),
    formatCep(payload.cep_emitente),
  ];
  return partes.filter((parte) => parte && parte.length > 0).join(" — ");
}

function enderecoDestinatario(payload: NfePayload): string {
  const partes = [
    [payload.logradouro_destinatario, payload.numero_destinatario].filter(Boolean).join(", "),
    payload.bairro_destinatario,
    [payload.municipio_destinatario, payload.uf_destinatario].filter(Boolean).join("/"),
    formatCep(payload.cep_destinatario),
  ];
  const texto = partes.filter((parte) => parte && parte.length > 0).join(" — ");
  return texto.length > 0 ? texto : "Endereço não informado";
}

/**
 * Um quadro com rótulo pequeno em cima e o valor embaixo — a unidade visual de
 * que o DANFE inteiro é feito.
 */
function field(
  page: PdfPage,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  value: string,
  options: { align?: "left" | "right"; valueSize?: number; bold?: boolean } = {},
): void {
  page.rect(x, y, width, height, { stroke: HAIRLINE, lineWidth: 0.5 });
  page.text(x + 3, y + 8, label.toUpperCase(), { size: 5.5, color: GREY });
  const valueSize = options.valueSize ?? 8;
  const textX = options.align === "right" ? x + width - 3 : x + 3;
  page.text(textX, y + height - 4, value, {
    size: valueSize,
    align: options.align,
    face: options.bold ? "bold" : "regular",
    maxWidth: width - 6,
  });
}

/** Altura da faixa de título de seção. Exportada como constante porque quem
 *  decide quebrar página precisa contá-la — ver o bloco final de `buildDanfePdfBytes`. */
const SECTION_TITLE_HEIGHT = 12;

/** Título de seção — a faixa cinza que separa os blocos do DANFE. */
function sectionTitle(page: PdfPage, y: number, text: string): number {
  page.rect(CONTENT_LEFT, y, CONTENT_WIDTH, SECTION_TITLE_HEIGHT, {
    fill: HEADER_FILL,
    stroke: HAIRLINE,
    lineWidth: 0.5,
  });
  page.text(CONTENT_LEFT + 3, y + SECTION_TITLE_HEIGHT - 3.5, text.toUpperCase(), { size: 6.5, face: "bold" });
  return y + SECTION_TITLE_HEIGHT;
}

/** A faixa que diz, em todo lugar onde este arquivo aparecer, que ele não vale nada. */
function warningBanner(page: PdfPage, y: number): number {
  const height = 22;
  page.rect(CONTENT_LEFT, y, CONTENT_WIDTH, height, { fill: BANNER_FILL, stroke: BANNER_STROKE, lineWidth: 0.7 });
  page.text(CONTENT_LEFT + 6, y + 9.5, "DOCUMENTO SIMULADO — SEM VALOR FISCAL", { size: 7.5, face: "bold" });
  page.text(CONTENT_LEFT + 6, y + 18, "Gerado localmente pelo Facilite ERP, sem assinatura digital e sem envio à SEFAZ.", {
    size: 6.5,
    color: GREY,
  });
  return y + height;
}

/**
 * Zona de silêncio do Code 128, em módulos, de cada lado das barras.
 *
 * **Não é margem estética.** A norma exige no mínimo 10 módulos de branco antes
 * do padrão de início e depois do de parada, e leitores de verdade recusam o
 * símbolo sem ela. Foi assim que este número apareceu: com as barras ocupando a
 * largura toda do quadro, o `Code128Reader` do ZXing **não decodificava** o
 * código de barras do PDF em resolução nenhuma (nem a 11 pixels por módulo),
 * enquanto decodificava o mesmo símbolo desenhado com folga. Ver a seção de
 * verificação de D13 no AGENTS.md.
 */
const CODE128_QUIET_MODULES = 10;

/**
 * O código de barras da chave de acesso, desenhado barra a barra.
 *
 * `width` é a largura **total** reservada, zona de silêncio inclusa — quem
 * chama passa o espaço disponível e não precisa saber da regra dos 10 módulos.
 */
function drawBarcode(page: PdfPage, chave: string, x: number, y: number, width: number, height: number): void {
  const digits = onlyDigits(chave);
  // A chave tem 44 dígitos (par, como o Code 128C exige). Se algum dia vier
  // diferente, o quadro fica sem barras em vez de derrubar a emissão inteira —
  // o PDF é ilustrativo, a nota não.
  if (digits.length === 0 || digits.length % 2 !== 0) return;
  const symbol = encodeCode128C(digits);
  const moduleWidth = width / (symbol.modules + CODE128_QUIET_MODULES * 2);
  const barsLeft = x + CODE128_QUIET_MODULES * moduleWidth;
  for (const bar of symbol.bars) {
    page.rect(barsLeft + bar.start * moduleWidth, y, bar.width * moduleWidth, height, { fill: BLACK });
  }
}

/** O QR Code da NFC-e, um retângulo preto por módulo escuro. */
function drawQrCode(page: PdfPage, text: string, x: number, y: number, size: number): void {
  const matrix = buildQrMatrix(text, "M");
  const moduleSize = size / matrix.size;
  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      if (matrix.modules[row][column]) {
        // +0.02 de folga fecha a fresta de antialiasing entre módulos vizinhos
        // que alguns leitores de PDF desenham; sem isso o QR fica "listrado".
        page.rect(x + column * moduleSize, y + row * moduleSize, moduleSize + 0.02, moduleSize + 0.02, {
          fill: BLACK,
        });
      }
    }
  }
}

type Column = { label: string; width: number; align?: "left" | "right" };

/** Colunas da tabela de produtos. As larguras somam `CONTENT_WIDTH`. */
const ITEM_COLUMNS: Column[] = [
  { label: "Código", width: 62 },
  { label: "Descrição", width: 195 },
  { label: "NCM", width: 48 },
  { label: "CFOP", width: 32, align: "right" },
  { label: "Un", width: 26 },
  { label: "Qtd.", width: 46, align: "right" },
  { label: "Vl. unit.", width: 60, align: "right" },
  { label: "Vl. total", width: 70.28, align: "right" },
];

const ROW_HEIGHT = 12;

function drawItemsHeader(page: PdfPage, y: number): number {
  page.rect(CONTENT_LEFT, y, CONTENT_WIDTH, ROW_HEIGHT, { fill: HEADER_FILL, stroke: HAIRLINE, lineWidth: 0.5 });
  let x = CONTENT_LEFT;
  for (const column of ITEM_COLUMNS) {
    const textX = column.align === "right" ? x + column.width - 3 : x + 3;
    page.text(textX, y + ROW_HEIGHT - 3.5, column.label.toUpperCase(), {
      size: 6,
      face: "bold",
      align: column.align,
    });
    x += column.width;
    if (x < CONTENT_RIGHT - 0.5) page.line(x, y, x, y + ROW_HEIGHT, { color: HAIRLINE, width: 0.4 });
  }
  return y + ROW_HEIGHT;
}

function drawItemRow(page: PdfPage, y: number, cells: string[]): number {
  page.rect(CONTENT_LEFT, y, CONTENT_WIDTH, ROW_HEIGHT, { stroke: HAIRLINE, lineWidth: 0.4 });
  let x = CONTENT_LEFT;
  ITEM_COLUMNS.forEach((column, index) => {
    const textX = column.align === "right" ? x + column.width - 3 : x + 3;
    page.text(textX, y + ROW_HEIGHT - 3.5, cells[index] ?? "", {
      size: 6.8,
      align: column.align,
      maxWidth: column.width - 6,
    });
    x += column.width;
    if (x < CONTENT_RIGHT - 0.5) page.line(x, y, x, y + ROW_HEIGHT, { color: HAIRLINE, width: 0.4 });
  });
  return y + ROW_HEIGHT;
}

function drawFooter(page: PdfPage, issue: SimulatedIssue, pageNumber: number): void {
  page.line(CONTENT_LEFT, FOOTER_TOP, CONTENT_RIGHT, FOOTER_TOP, { color: HAIRLINE, width: 0.5 });
  page.text(CONTENT_LEFT, FOOTER_TOP + 10, "Documento simulado gerado pelo Facilite ERP — não substitui documento fiscal.", {
    size: 6.5,
    color: GREY,
  });
  page.text(CONTENT_RIGHT, FOOTER_TOP + 10, `Página ${pageNumber} · Nº ${issue.numero} · Série ${issue.serie}`, {
    size: 6.5,
    color: GREY,
    align: "right",
  });
}

/**
 * Monta o PDF do DANFE/DANFE NFC-e e devolve os **bytes** do arquivo.
 *
 * Devolve bytes, e não base64, porque quem chama decide o transporte:
 * `simulatedArtifacts.ts` codifica em base64 para caber na coluna `text` do
 * banco, e um script de conferência local grava os mesmos bytes direto num
 * `.pdf` para abrir e olhar.
 */
export function buildDanfePdfBytes(issue: SimulatedIssue): Uint8Array {
  const { payload } = issue;
  const isNfce = issue.model === "nfce";
  const titulo = isNfce ? "DANFE NFC-e" : "DANFE";
  const subtitulo = isNfce
    ? "Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica"
    : "Documento Auxiliar da Nota Fiscal Eletrônica";

  const doc = createPdfDocument();
  let page = doc.addPage(PAGE);
  let pageNumber = 1;

  let y = warningBanner(page, MARGIN) + 6;

  // --- Emitente + identificação do documento -----------------------------

  const emitenteWidth = CONTENT_WIDTH * 0.62;
  const identWidth = CONTENT_WIDTH - emitenteWidth;
  const headerHeight = 74;

  page.rect(CONTENT_LEFT, y, emitenteWidth, headerHeight, { stroke: HAIRLINE, lineWidth: 0.5 });
  page.text(CONTENT_LEFT + 6, y + 12, "IDENTIFICAÇÃO DO EMITENTE", { size: 5.5, color: GREY });
  page.text(CONTENT_LEFT + 6, y + 25, payload.nome_emitente, {
    size: 10,
    face: "bold",
    maxWidth: emitenteWidth - 12,
  });
  if (payload.nome_fantasia_emitente) {
    page.text(CONTENT_LEFT + 6, y + 36, payload.nome_fantasia_emitente, {
      size: 7.5,
      color: GREY,
      maxWidth: emitenteWidth - 12,
    });
  }
  page.text(CONTENT_LEFT + 6, y + 48, enderecoEmitente(payload), { size: 7, maxWidth: emitenteWidth - 12 });
  page.text(
    CONTENT_LEFT + 6,
    y + 60,
    `CNPJ ${formatCnpjCpf(payload.cnpj_emitente)}    IE ${payload.inscricao_estadual_emitente ?? "Isento"}`,
    { size: 7, maxWidth: emitenteWidth - 12 },
  );

  const identLeft = CONTENT_LEFT + emitenteWidth;
  page.rect(identLeft, y, identWidth, headerHeight, { stroke: HAIRLINE, lineWidth: 0.5 });
  const identCenter = identLeft + identWidth / 2;
  page.text(identCenter, y + 14, titulo, { size: 12, face: "bold", align: "center" });
  page.text(identCenter, y + 24, subtitulo, { size: 5.5, color: GREY, align: "center", maxWidth: identWidth - 8 });
  if (!isNfce) {
    // O quadro de entrada/saída é da NF-e: a NFC-e é sempre saída ao consumidor.
    page.text(identCenter, y + 36, "0 - ENTRADA    1 - SAÍDA", { size: 6, align: "center" });
    page.rect(identCenter + 44, y + 29, 12, 10, { stroke: HAIRLINE, lineWidth: 0.5 });
    page.text(identCenter + 50, y + 37, String(payload.tipo_documento), { size: 7, align: "center", face: "bold" });
  }
  page.text(identCenter, y + 52, `Nº ${String(issue.numero).padStart(9, "0")}`, {
    size: 9,
    face: "bold",
    align: "center",
  });
  page.text(identCenter, y + 63, `Série ${issue.serie}    Folha 1`, { size: 7, align: "center" });

  y += headerHeight;

  // --- Chave de acesso ---------------------------------------------------

  const chaveHeight = 56;
  page.rect(CONTENT_LEFT, y, CONTENT_WIDTH, chaveHeight, { stroke: HAIRLINE, lineWidth: 0.5 });
  page.text(CONTENT_LEFT + 3, y + 8, "CHAVE DE ACESSO", { size: 5.5, color: GREY });
  drawBarcode(page, issue.chave, CONTENT_LEFT + 10, y + 12, CONTENT_WIDTH - 20, 24);
  page.text(CONTENT_LEFT + CONTENT_WIDTH / 2, y + 47, formatKey(issue.chave), {
    size: 8,
    face: "bold",
    align: "center",
  });
  y += chaveHeight;

  // --- Natureza da operação + protocolo ----------------------------------

  const linhaHeight = 26;
  const naturezaWidth = CONTENT_WIDTH * 0.5;
  field(page, CONTENT_LEFT, y, naturezaWidth, linhaHeight, "Natureza da operação", payload.natureza_operacao);
  field(
    page,
    CONTENT_LEFT + naturezaWidth,
    y,
    CONTENT_WIDTH - naturezaWidth,
    linhaHeight,
    "Protocolo de autorização de uso",
    `${issue.protocolo} — ${dateTime(issue.authorizedAt.toISOString())}`,
  );
  y += linhaHeight;

  const emissaoWidth = CONTENT_WIDTH / 3;
  field(page, CONTENT_LEFT, y, emissaoWidth, linhaHeight, "Data e hora de emissão", dateTime(payload.data_emissao));
  field(page, CONTENT_LEFT + emissaoWidth, y, emissaoWidth, linhaHeight, "Inscrição estadual do emitente", payload.inscricao_estadual_emitente ?? "Isento");
  field(
    page,
    CONTENT_LEFT + emissaoWidth * 2,
    y,
    CONTENT_WIDTH - emissaoWidth * 2,
    linhaHeight,
    "Modelo / ambiente",
    `${isNfce ? "65 (NFC-e)" : "55 (NF-e)"} — homologação simulada`,
  );
  y += linhaHeight + 6;

  // --- Destinatário ------------------------------------------------------

  y = sectionTitle(page, y, "Destinatário / Remetente");
  const documentoDestinatario = payload.cnpj_destinatario ?? payload.cpf_destinatario;
  const nomeWidth = CONTENT_WIDTH * 0.58;
  const docWidth = CONTENT_WIDTH * 0.24;
  field(page, CONTENT_LEFT, y, nomeWidth, linhaHeight, "Nome / razão social", payload.nome_destinatario ?? "Consumidor não identificado");
  field(page, CONTENT_LEFT + nomeWidth, y, docWidth, linhaHeight, "CNPJ / CPF", documentoDestinatario ? formatCnpjCpf(documentoDestinatario) : "—");
  field(
    page,
    CONTENT_LEFT + nomeWidth + docWidth,
    y,
    CONTENT_WIDTH - nomeWidth - docWidth,
    linhaHeight,
    "Inscrição estadual",
    payload.inscricao_estadual_destinatario ?? "—",
  );
  y += linhaHeight;
  field(page, CONTENT_LEFT, y, CONTENT_WIDTH, linhaHeight, "Endereço", enderecoDestinatario(payload));
  y += linhaHeight + 6;

  // --- Cálculo do imposto ------------------------------------------------

  y = sectionTitle(page, y, "Cálculo do imposto");
  const totalsRow = (entries: { label: string; value: string }[], top: number): number => {
    const width = CONTENT_WIDTH / entries.length;
    entries.forEach((entry, index) => {
      const isLast = index === entries.length - 1;
      field(
        page,
        CONTENT_LEFT + width * index,
        top,
        isLast ? CONTENT_WIDTH - width * index : width,
        linhaHeight,
        entry.label,
        entry.value,
        { align: "right" },
      );
    });
    return top + linhaHeight;
  };

  y = totalsRow(
    [
      { label: "Base de cálculo do ICMS", value: money(payload.icms_base_calculo) },
      { label: "Valor do ICMS", value: money(payload.icms_valor_total) },
      { label: "Base de cálculo do ICMS-ST", value: money(payload.icms_base_calculo_st) },
      { label: "Valor do ICMS-ST", value: money(payload.icms_valor_total_st) },
      { label: "Valor total dos produtos", value: money(payload.valor_produtos) },
    ],
    y,
  );
  y = totalsRow(
    [
      { label: "Valor do frete", value: money(payload.valor_frete) },
      { label: "Desconto", value: money(payload.valor_desconto) },
      { label: "Valor do IPI", value: money(payload.valor_ipi) },
      { label: "PIS / COFINS", value: `${money(payload.valor_pis)} / ${money(payload.valor_cofins)}` },
      { label: "Valor total da nota", value: money(payload.valor_total) },
    ],
    y,
  );
  if (payload.valor_total_tributos !== undefined) {
    // Lei da Transparência Fiscal (B9) — o valor já vem calculado no payload.
    field(
      page,
      CONTENT_LEFT,
      y,
      CONTENT_WIDTH,
      linhaHeight,
      "Valor aproximado dos tributos (Lei 12.741/2012)",
      money(payload.valor_total_tributos),
      { align: "right" },
    );
    y += linhaHeight;
  }
  y += 6;

  // --- Produtos ----------------------------------------------------------

  y = sectionTitle(page, y, "Dados dos produtos / serviços");
  y = drawItemsHeader(page, y);

  for (const item of payload.items) {
    if (y + ROW_HEIGHT > FOOTER_TOP - 4) {
      drawFooter(page, issue, pageNumber);
      page = doc.addPage(PAGE);
      pageNumber += 1;
      y = MARGIN;
      page.text(CONTENT_LEFT, y + 8, `${titulo} nº ${issue.numero} — continuação`, { size: 7.5, face: "bold" });
      y += 14;
      y = drawItemsHeader(page, y);
    }
    y = drawItemRow(page, y, [
      item.codigo_produto,
      item.descricao,
      item.codigo_ncm,
      item.cfop,
      item.unidade_comercial ?? "",
      quantity(item.quantidade_comercial),
      money(item.valor_unitario_comercial),
      money(item.valor_bruto),
    ]);
  }

  // --- QR Code (NFC-e) e informações adicionais --------------------------

  const qrSize = 96;
  const infoHeight = isNfce ? qrSize + 16 : 42;
  // A conta tem que ser do bloco **inteiro** — o respiro de 6 pt e a faixa de
  // título entram nele. Medir só `infoHeight` deixava uma faixa estreita de
  // alturas em que o bloco não pedia página nova e mesmo assim descia por cima
  // do rodapé: numa NFC-e com 21 ou 22 itens, o quadro do QR Code invadia a
  // linha do rodapé em ~12 pt.
  const infoBlockHeight = 6 + SECTION_TITLE_HEIGHT + infoHeight;
  if (y + infoBlockHeight > FOOTER_TOP - 4) {
    drawFooter(page, issue, pageNumber);
    page = doc.addPage(PAGE);
    pageNumber += 1;
    y = MARGIN;
  }
  y += 6;
  y = sectionTitle(page, y, isNfce ? "Consulta pela chave de acesso" : "Informações complementares");
  page.rect(CONTENT_LEFT, y, CONTENT_WIDTH, infoHeight, { stroke: HAIRLINE, lineWidth: 0.5 });

  if (isNfce && issue.qrCodeUrl) {
    drawQrCode(page, issue.qrCodeUrl, CONTENT_LEFT + 8, y + 8, qrSize);
    const textLeft = CONTENT_LEFT + qrSize + 20;
    page.text(textLeft, y + 20, "Consulte pela chave de acesso em:", { size: 7.5, face: "bold" });
    page.text(textLeft, y + 32, issue.qrCodeUrl, { size: 6, color: GREY, maxWidth: CONTENT_RIGHT - textLeft - 8 });
    page.text(textLeft, y + 48, `Consumidor: ${payload.nome_destinatario ?? "não identificado"}`, { size: 7 });
    page.text(textLeft, y + 60, `Total a pagar: R$ ${money(payload.valor_total)}`, { size: 9, face: "bold" });
    page.text(textLeft, y + 76, "Endereço de consulta simulado — não é um serviço real da SEFAZ.", {
      size: 6,
      color: GREY,
      maxWidth: CONTENT_RIGHT - textLeft - 8,
    });
  } else {
    const adicional =
      payload.informacoes_adicionais_contribuinte ??
      "Sem informações complementares.";
    page.text(CONTENT_LEFT + 6, y + 14, adicional, { size: 7, maxWidth: CONTENT_WIDTH - 12 });
    page.text(CONTENT_LEFT + 6, y + 28, `Total da nota: R$ ${money(payload.valor_total)}`, { size: 9, face: "bold" });
  }

  drawFooter(page, issue, pageNumber);
  return doc.toBytes();
}
