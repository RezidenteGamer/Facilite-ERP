import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DANFE_CONTENT_TYPE,
  XML_CONTENT_TYPE,
  base64ToBytes,
  decodeArtifactContent,
  isBinaryArtifact,
} from "@fiscal-core/artifactContentTypes.ts";
import { buildSimulatedDanfe, buildSimulatedXml, type SimulatedIssue } from "@fiscal-core/simulatedArtifacts.ts";
import { fiscalArtifactBlob } from "../../src/features/sales/invoices";
import { toInvoiceDocument } from "../../src/lib/repositories/fiscalDocumentsRepository";
import type { NfePayload } from "@fiscal-core/types.ts";

const CHAVE = "35250912345678000199650010000000011000000017";

function issue(overrides: Partial<SimulatedIssue> = {}): SimulatedIssue {
  const payload: NfePayload = {
    natureza_operacao: "Venda de mercadoria",
    data_emissao: "2026-09-10T14:03:00-03:00",
    tipo_documento: 1,
    finalidade_emissao: 1,
    cnpj_emitente: "12345678000199",
    nome_emitente: "Comércio Simulado São João Ltda",
    nome_fantasia_emitente: "Simulado Store",
    logradouro_emitente: "Rua das Acácias",
    numero_emitente: "1500",
    bairro_emitente: "Centro",
    municipio_emitente: "São Paulo",
    uf_emitente: "SP",
    cep_emitente: "01310000",
    inscricao_estadual_emitente: "110042490114",
    nome_destinatario: "Maria da Conceição Ferrão",
    cpf_destinatario: "12345678909",
    logradouro_destinatario: "Avenida Paulista",
    numero_destinatario: "900",
    bairro_destinatario: "Bela Vista",
    municipio_destinatario: "São Paulo",
    uf_destinatario: "SP",
    cep_destinatario: "01311000",
    valor_produtos: 1234.5,
    valor_total: 1234.5,
    icms_base_calculo: 1234.5,
    icms_valor_total: 222.21,
    items: [
      {
        numero_item: 1,
        codigo_produto: "PRD-001",
        descricao: "Camiseta algodão penteado — manga curta, tamanho M",
        cfop: "5102",
        codigo_ncm: "61091000",
        unidade_comercial: "UN",
        quantidade_comercial: 3,
        valor_unitario_comercial: 249.9,
        valor_bruto: 749.7,
      },
      {
        numero_item: 2,
        codigo_produto: "PRD-002",
        descricao: "Calça jeans",
        cfop: "5102",
        codigo_ncm: "62034200",
        unidade_comercial: "UN",
        quantidade_comercial: 1,
        valor_unitario_comercial: 484.8,
        valor_bruto: 484.8,
      },
    ],
  } as NfePayload;

  return {
    chave: CHAVE,
    protocolo: "135260000000000001",
    model: "nfe",
    serie: 1,
    numero: 42,
    authorizedAt: new Date("2026-09-10T17:03:05Z"),
    payload,
    qrCodeUrl: null,
    ...overrides,
  };
}

/** Os primeiros bytes de um arquivo, como texto ASCII — para conferir assinatura. */
function ascii(bytes: Uint8Array, length: number): string {
  return String.fromCharCode(...bytes.subarray(0, length));
}

describe("buildSimulatedDanfe — o PDF de verdade (D13)", () => {
  it("declara application/pdf e devolve o conteúdo em base64", () => {
    const artifact = buildSimulatedDanfe(issue());
    expect(artifact.contentType).toBe("application/pdf");
    expect(artifact.path).toBeNull();
    expect(artifact.content).toBeTruthy();
    expect(artifact.content).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it("os bytes decodificados são um PDF: assinatura %PDF- no começo e %%EOF no fim", () => {
    const artifact = buildSimulatedDanfe(issue());
    const bytes = base64ToBytes(artifact.content as string);
    expect(ascii(bytes, 5)).toBe("%PDF-");
    const fim = String.fromCharCode(...bytes.subarray(bytes.length - 32));
    expect(fim).toContain("%%EOF");
    // Um DANFE com dois itens não cabe em meia dúzia de bytes; o piso pega o
    // caso degenerado de um PDF "vazio" que ainda começaria com %PDF-.
    expect(bytes.length).toBeGreaterThan(3000);
  });

  it("a tabela xref aponta offsets que realmente existem no arquivo", () => {
    // É o erro clássico de gerar PDF à mão, e o que um leitor rigoroso recusa:
    // cada entrada da xref precisa cair exatamente no início de um objeto.
    const bytes = base64ToBytes(buildSimulatedDanfe(issue()).content as string);
    const file = String.fromCharCode(...bytes);

    const startxref = /startxref\s+(\d+)/.exec(file);
    expect(startxref).not.toBeNull();
    expect(file.slice(Number(startxref![1]), Number(startxref![1]) + 4)).toBe("xref");

    const tabela = file.slice(Number(startxref![1]));
    const cabecalho = /xref\s+0 (\d+)/.exec(tabela);
    const total = Number(cabecalho![1]);
    const entradas = [...tabela.matchAll(/^(\d{10}) \d{5} n\s*$/gm)].map((m) => Number(m[1]));
    expect(entradas).toHaveLength(total - 1); // A entrada 0 é a livre (`f`).
    entradas.forEach((offset, index) => {
      expect({ objeto: index + 1, inicio: file.slice(offset, offset + 7) }).toEqual({
        objeto: index + 1,
        inicio: `${index + 1} 0 obj`.slice(0, 7),
      });
    });
  });

  it("o texto acentuado do payload chega ao PDF em WinAnsi, não em UTF-8", () => {
    // "São" em UTF-8 seriam 4 bytes (0x53 0xC3 0xA3 0x6F); em WinAnsi são 3
    // (0x53 0xE3 0x6F). Escrever UTF-8 aqui desalinharia todos os offsets.
    const bytes = base64ToBytes(buildSimulatedDanfe(issue()).content as string);
    const file = String.fromCharCode(...bytes);
    expect(file).toContain("São Paulo");
    expect(file).not.toContain("SÃ£o Paulo");
  });

  it("quebra de linha em campo livre não vira glifo vazio dentro do PDF", () => {
    // `informacoes_adicionais_contribuinte` é texto livre do operador. Um
    // `Tj` desenha uma linha só: o byte 0x0A não quebraria linha, desenharia o
    // glifo vazio da fonte no meio da frase.
    const caso = issue();
    caso.payload.informacoes_adicionais_contribuinte = "Primeira linha\nSegunda\tterceira";
    const file = String.fromCharCode(...base64ToBytes(buildSimulatedDanfe(caso).content as string));
    expect(file).toContain("Primeira linha Segunda terceira");
  });

  it("a NFC-e desenha o QR Code e a NF-e não", () => {
    const nfe = base64ToBytes(buildSimulatedDanfe(issue()).content as string);
    const nfce = base64ToBytes(
      buildSimulatedDanfe(
        issue({ model: "nfce", qrCodeUrl: "https://homologacao.exemplo.invalid/qrcode?p=" + CHAVE }),
      ).content as string,
    );
    // O QR são centenas de retângulos preenchidos a mais — o arquivo cresce.
    expect(nfce.length).toBeGreaterThan(nfe.length + 5000);
    expect(String.fromCharCode(...nfce)).toContain("DANFE NFC-e");
    expect(String.fromCharCode(...nfe)).not.toContain("DANFE NFC-e");
  });

  it("o bloco final nunca desce por cima do rodapé, em nenhuma contagem de itens", () => {
    // A quebra de página do bloco final precisa contar o bloco **inteiro** (o
    // respiro e a faixa de título, não só a caixa). Antes da correção havia uma
    // faixa estreita de contagens em que ele não pedia página nova e mesmo
    // assim invadia o rodapé — numa NFC-e com 21 ou 22 itens, em ~12 pt.
    const RODAPE_Y_NO_PDF = 841.89 - (841.89 - 28 - 24); // `FOOTER_TOP` medido da base.
    for (const model of ["nfe", "nfce"] as const) {
      for (const total of [20, 21, 22, 26, 27, 28, 30, 31, 32]) {
        const caso = issue({
          model,
          qrCodeUrl: model === "nfce" ? "https://exemplo.invalid/qrcode?p=" + CHAVE : null,
        });
        caso.payload.items = Array.from({ length: total }, (_, index) => ({
          ...caso.payload.items[0],
          numero_item: index + 1,
        }));
        const file = String.fromCharCode(...base64ToBytes(buildSimulatedDanfe(caso).content as string));
        // O `y` de todo retângulo é medido da base; o menor é o que desce mais.
        const menorY = Math.min(
          ...[...file.matchAll(/^-?[\d.]+ (-?[\d.]+) [\d.]+ [\d.]+ re$/gm)].map((m) => Number(m[1])),
        );
        expect({ model, total, invade: menorY < RODAPE_Y_NO_PDF }).toEqual({ model, total, invade: false });
      }
    }
  });

  it("pagina quando a lista de itens não cabe numa página só", () => {
    const muitos = issue();
    muitos.payload.items = Array.from({ length: 120 }, (_, index) => ({
      ...muitos.payload.items[0],
      numero_item: index + 1,
      codigo_produto: `PRD-${String(index + 1).padStart(3, "0")}`,
    }));
    const file = String.fromCharCode(...base64ToBytes(buildSimulatedDanfe(muitos).content as string));
    expect(file).toContain("continuação");
    expect(/\/Type \/Pages \/Count (\d+)/.exec(file)![1]).not.toBe("1");
  });
});

describe("os três pontos que declaram o contentType do DANFE", () => {
  it("1) onde o artefato nasce", () => {
    expect(buildSimulatedDanfe(issue()).contentType).toBe(DANFE_CONTENT_TYPE);
    expect(buildSimulatedXml(issue()).contentType).toBe(XML_CONTENT_TYPE);
  });

  /*
   * O ponto 2 mora numa Edge Function (Deno): `reconcile.ts` importa
   * `jsr:@supabase/supabase-js` e usa `Deno.env`, que não existem no Vitest —
   * importá-lo aqui quebraria `tsc -b`, não porque o código esteja errado, mas
   * porque ele é de outro runtime.
   *
   * A conferência então é de código-fonte, e é a que interessa: desde D13 não
   * existe mais um tipo escrito à mão em lugar nenhum — os três leem a mesma
   * constante. É exatamente o convite ao bug que a constante veio fechar (um
   * documento nasceria PDF e voltaria a ser rotulado HTML depois de qualquer
   * reconciliação), e um teste que só olhasse o comportamento de um dos três
   * não o pegaria.
   */
  const OS_TRES_ARQUIVOS = [
    "supabase/functions/_shared/fiscal/simulatedArtifacts.ts",
    "supabase/functions/fiscal-emit/reconcile.ts",
    "src/lib/repositories/fiscalDocumentsRepository.ts",
  ];

  it("2) nenhum dos três escreve o tipo à mão — os três importam a constante", () => {
    for (const arquivo of OS_TRES_ARQUIVOS) {
      const fonte = readFileSync(new URL(`../../${arquivo}`, import.meta.url), "utf8");
      // Fora de comentário, nenhum literal de media type do DANFE/XML.
      const codigo = fonte
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect({ arquivo, literais: codigo.match(/"(application\/pdf|application\/xml|text\/html)"/g) }).toEqual({
        arquivo,
        literais: null,
      });
      expect({ arquivo, importa: /artifactContentTypes/.test(codigo) }).toEqual({ arquivo, importa: true });
      expect({ arquivo, usaDanfe: /DANFE_CONTENT_TYPE/.test(codigo) }).toEqual({ arquivo, usaDanfe: true });
    }
  });

  it("3) a releitura do front, que é o que a tela usa para abrir o arquivo", () => {
    const document = toInvoiceDocument({
      id: "doc-1",
      sale_id: "venda-1",
      sale_return_id: null,
      branch_id: "filial-1",
      model: "nfe",
      ref: "venda-1",
      status: "autorizado",
      chave: CHAVE,
      numero: "42",
      serie: "1",
      protocolo: "135260000000000001",
      status_sefaz: "100",
      mensagem_sefaz: "Autorizado",
      xml_content: "<xml/>",
      xml_path: null,
      pdf_content: "JVBERi0=",
      pdf_path: null,
      qr_code_url: null,
      created_at: "2026-09-10T17:03:05Z",
      updated_at: "2026-09-10T17:03:05Z",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(document.pdf?.contentType).toBe("application/pdf");
    expect(document.xml?.contentType).toBe("application/xml");
  });
});

describe("decodeArtifactContent / fiscalArtifactBlob", () => {
  it("reconhece só o tipo binário, inclusive com parâmetro no cabeçalho", () => {
    expect(isBinaryArtifact("application/pdf")).toBe(true);
    expect(isBinaryArtifact("application/pdf; charset=binary")).toBe(true);
    expect(isBinaryArtifact("APPLICATION/PDF")).toBe(true);
    expect(isBinaryArtifact("application/xml")).toBe(false);
    expect(isBinaryArtifact("text/html")).toBe(false);
  });

  it("decodifica base64 para os bytes originais quando o tipo é binário", () => {
    // "%PDF-1.4\n" em base64.
    const base64 = "JVBERi0xLjQK";
    const decoded = decodeArtifactContent(base64, DANFE_CONTENT_TYPE);
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect([...(decoded as Uint8Array)]).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
  });

  it("deixa o XML passar como texto — ele não viaja em base64", () => {
    const xml = "<nfeProc/>";
    expect(decodeArtifactContent(xml, XML_CONTENT_TYPE)).toBe(xml);
  });

  it("o Blob do DANFE tem os bytes do PDF, e não os caracteres do base64", async () => {
    // Este é o teste que o bug silencioso exigia: sem a decodificação, o Blob
    // teria 12 bytes ("JVBERi0xLjQK" como texto) em vez dos 9 do PDF, e a tela
    // abriria uma aba sem erro nenhum com um arquivo corrompido.
    const blob = fiscalArtifactBlob({
      content: "JVBERi0xLjQK",
      path: null,
      contentType: DANFE_CONTENT_TYPE,
    });
    expect(blob.type).toBe("application/pdf");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes).toHaveLength(9);
    expect(ascii(bytes, 5)).toBe("%PDF-");
    expect(ascii(bytes, 5)).not.toBe("JVBER");
  });

  it("o Blob do DANFE gerado de verdade abre como PDF válido", async () => {
    const artifact = buildSimulatedDanfe(issue());
    const blob = fiscalArtifactBlob({ ...artifact, content: artifact.content as string });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(ascii(bytes, 5)).toBe("%PDF-");
    // O tamanho do Blob é o do PDF, não o da string base64 (que é ~4/3 maior).
    expect(bytes.length).toBeLessThan((artifact.content as string).length);
  });

  it("o DANFE em HTML de uma nota anterior a D13 abre como HTML, sem exceção", async () => {
    // `pdf_content` das notas já emitidas guarda HTML, e a leitura passou a
    // rotular toda linha como `application/pdf`. Sem tratamento, `atob`
    // levantaria `InvalidCharacterError` no `<` — dentro do `onClick` de
    // "Visualizar", onde `ErrorBoundary` não pega: o botão não faria nada.
    const legado = "<!doctype html><html><body>DANFE antigo</body></html>";
    expect(decodeArtifactContent(legado, DANFE_CONTENT_TYPE)).toBe(legado);

    const blob = fiscalArtifactBlob({ content: legado, path: null, contentType: DANFE_CONTENT_TYPE });
    expect(blob.type).toBe("text/html");
    expect(await blob.text()).toBe(legado);
  });

  it("o Blob do XML continua sendo o texto do XML", async () => {
    const artifact = buildSimulatedXml(issue());
    const blob = fiscalArtifactBlob({ ...artifact, content: artifact.content as string });
    expect(blob.type).toBe("application/xml");
    expect(await blob.text()).toContain("<nfeProc");
  });
});
