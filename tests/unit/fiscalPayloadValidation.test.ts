import { describe, expect, it } from "vitest";

import {
  buildNfcePayloadFromSale,
  buildNfePayloadFromSale,
  buildReturnNfePayload,
  type SaleForInvoice,
  type SaleForInvoiceItem,
  type SaleReturnForInvoice,
} from "@fiscal-core/invoiceMapping.ts";
import { validarPayloadFiscal } from "@fiscal-core/payloadValidation.ts";
import type { TaxGroup } from "@fiscal-core/taxGroups.ts";
import type { TaxRuleRow } from "@fiscal-core/taxRules.ts";
import type { NfePayload, NfePayloadItem } from "@fiscal-core/types.ts";

/**
 * O validador estrutural de A9 (09/09/2026), que saiu de dentro do provedor
 * simulado e passou a rodar em `handleEmit`, antes de qualquer provedor.
 *
 * A bateria é de asserção direta, no padrão das outras baterias fiscais: monta
 * o payload completo uma vez e, por caso, quebra **um** campo — a lista de
 * problemas é o resultado observável, e cada teste confere a mensagem daquele
 * campo (`toContain`), não a lista inteira, para um erro novo em outro grupo
 * não derrubar o caso errado.
 *
 * O limite do que se testa aqui é o limite do próprio validador: presença,
 * formato e vocabulário. Nada de aritmética de imposto — isso é B1–B10.
 */

/** CNPJ do Banco do Brasil: válido, e com os zeros à esquerda que quebram `Number`. */
const CNPJ_EMITENTE = "00.000.000/0001-91";
const CNPJ_DESTINATARIO = "11222333000181";
const CPF_DESTINATARIO = "39053344705";

function item(overrides: Partial<NfePayloadItem> = {}): NfePayloadItem {
  return {
    numero_item: 1,
    codigo_produto: "001",
    descricao: "Produto de teste",
    cfop: "5102",
    codigo_ncm: "19059090",
    quantidade_comercial: 2,
    valor_unitario_comercial: 5,
    valor_bruto: 10,
    unidade_comercial: "UN",
    unidade_tributavel: "UN",
    quantidade_tributavel: 2,
    valor_unitario_tributavel: 5,
    icms_origem: "0",
    icms_situacao_tributaria: "00",
    ...overrides,
  };
}

/** Uma NF-e estruturalmente completa — o ponto de partida de todos os casos. */
function payload(overrides: Partial<NfePayload> = {}): NfePayload {
  return {
    natureza_operacao: "Venda de mercadoria",
    data_emissao: "2026-09-09T12:00:00-03:00",
    tipo_documento: 1,
    finalidade_emissao: 1,

    cnpj_emitente: CNPJ_EMITENTE,
    nome_emitente: "Facilite Testes LTDA",
    inscricao_estadual_emitente: "123456789",
    logradouro_emitente: "Rua Um",
    numero_emitente: "10",
    bairro_emitente: "Centro",
    municipio_emitente: "São Paulo",
    uf_emitente: "SP",
    cep_emitente: "01001-000",
    regime_tributario_emitente: 3,

    nome_destinatario: "Cliente de teste",
    cnpj_destinatario: CNPJ_DESTINATARIO,
    inscricao_estadual_destinatario: "987654321",
    indicador_inscricao_estadual_destinatario: 1,
    logradouro_destinatario: "Rua Dois",
    numero_destinatario: "20",
    bairro_destinatario: "Centro",
    municipio_destinatario: "Campinas",
    uf_destinatario: "SP",
    cep_destinatario: "13010000",

    valor_produtos: 10,
    valor_total: 10,

    items: [item()],
    ...overrides,
  };
}

describe("validarPayloadFiscal — a nota completa passa", () => {
  it("não acha problema nenhum numa NF-e estruturalmente completa", () => {
    expect(validarPayloadFiscal(payload(), "nfe")).toEqual([]);
  });

  it("aceita a mesma nota como NFC-e", () => {
    expect(validarPayloadFiscal(payload(), "nfce")).toEqual([]);
  });

  it("aceita CPF no lugar de CNPJ no destinatário", () => {
    const comCpf = payload({
      cnpj_destinatario: undefined,
      cpf_destinatario: CPF_DESTINATARIO,
      // Pessoa física é não contribuinte: sem IE, e com o indicador 9.
      inscricao_estadual_destinatario: undefined,
      indicador_inscricao_estadual_destinatario: 9,
    });
    expect(validarPayloadFiscal(comCpf, "nfe")).toEqual([]);
  });
});

describe("validarPayloadFiscal — emitente", () => {
  it("recusa CNPJ com dígito verificador errado, e não só pelo comprimento", () => {
    // 14 dígitos, o que a versão anterior do validador (dentro do provedor
    // simulado) bastava para aceitar. O DV é que não fecha.
    const problemas = validarPayloadFiscal(payload({ cnpj_emitente: "00000000000192" }), "nfe");
    expect(problemas).toContain("CNPJ do emitente inválido (dígito verificador não confere)");
  });

  it("recusa CNPJ de sequência repetida, que fecha o módulo 11", () => {
    const problemas = validarPayloadFiscal(payload({ cnpj_emitente: "00000000000000" }), "nfe");
    expect(problemas).toContain("CNPJ do emitente inválido (dígito verificador não confere)");
  });

  it("recusa CNPJ ausente com mensagem própria", () => {
    expect(validarPayloadFiscal(payload({ cnpj_emitente: "" }), "nfe")).toContain(
      "CNPJ do emitente ausente",
    );
  });

  it("exige inscrição estadual do emitente", () => {
    expect(validarPayloadFiscal(payload({ inscricao_estadual_emitente: undefined }), "nfe")).toContain(
      "Inscrição estadual do emitente ausente",
    );
  });

  it("exige o endereço completo do emitente", () => {
    const semEndereco = payload({
      logradouro_emitente: undefined,
      numero_emitente: undefined,
      bairro_emitente: undefined,
      municipio_emitente: undefined,
      uf_emitente: undefined,
      cep_emitente: undefined,
    });
    expect(validarPayloadFiscal(semEndereco, "nfe")).toEqual(
      expect.arrayContaining([
        "Endereço do emitente: logradouro ausente",
        "Endereço do emitente: número ausente",
        "Endereço do emitente: bairro ausente",
        "Endereço do emitente: município ausente",
        "Endereço do emitente: UF ausente",
        "Endereço do emitente: CEP ausente",
      ]),
    );
  });

  it("recusa UF que não é sigla de unidade federativa", () => {
    expect(validarPayloadFiscal(payload({ uf_emitente: "XX" }), "nfe")).toContain(
      'Endereço do emitente: UF "XX" não é uma sigla de unidade federativa',
    );
  });

  it("recusa CEP fora dos 8 dígitos, e aceita o CEP com hífen do cadastro", () => {
    expect(validarPayloadFiscal(payload({ cep_emitente: "0100100" }), "nfe")).toContain(
      "Endereço do emitente: CEP fora do formato de 8 dígitos",
    );
    expect(validarPayloadFiscal(payload({ cep_emitente: "01001-000" }), "nfe")).toEqual([]);
  });

  it("recusa CRT fora do vocabulário 1/2/3/4 e exige o campo", () => {
    expect(validarPayloadFiscal(payload({ regime_tributario_emitente: 5 }), "nfe")).toContain(
      "Regime tributário do emitente (CRT) inválido: 5 — os válidos são 1, 2, 3 e 4",
    );
    expect(validarPayloadFiscal(payload({ regime_tributario_emitente: undefined }), "nfe")).toContain(
      "Regime tributário do emitente (CRT) ausente",
    );
    // Os quatro válidos passam — inclusive o `4` (MEI), que entrou pela NT
    // 2024.001 e já está em `taxSituations.ts`.
    for (const crt of [1, 2, 3, 4]) {
      expect(validarPayloadFiscal(payload({ regime_tributario_emitente: crt }), "nfe")).toEqual([]);
    }
  });
});

describe("validarPayloadFiscal — destinatário", () => {
  it("recusa CNPJ e CPF ao mesmo tempo", () => {
    const doisDocumentos = payload({
      cnpj_destinatario: CNPJ_DESTINATARIO,
      cpf_destinatario: CPF_DESTINATARIO,
    });
    expect(validarPayloadFiscal(doisDocumentos, "nfe")).toContain(
      "Destinatário com CNPJ e CPF ao mesmo tempo — informe só um dos dois",
    );
  });

  it("recusa dígito verificador errado no CNPJ e no CPF do destinatário", () => {
    expect(validarPayloadFiscal(payload({ cnpj_destinatario: "11222333000182" }), "nfe")).toContain(
      "CNPJ do destinatário inválido (dígito verificador não confere)",
    );

    const cpfTorto = payload({
      cnpj_destinatario: undefined,
      cpf_destinatario: "39053344704",
      inscricao_estadual_destinatario: undefined,
      indicador_inscricao_estadual_destinatario: 9,
    });
    expect(validarPayloadFiscal(cpfTorto, "nfe")).toContain(
      "CPF do destinatário inválido (dígito verificador não confere)",
    );
  });

  it("exige destinatário identificado na NF-e", () => {
    const semDocumento = payload({ cnpj_destinatario: undefined });
    expect(validarPayloadFiscal(semDocumento, "nfe")).toContain(
      "NF-e sem destinatário identificado: informe o CNPJ ou o CPF",
    );
  });

  it("aceita NFC-e sem destinatário nenhum — é a venda de balcão", () => {
    const balcao = payload({
      nome_destinatario: undefined,
      cnpj_destinatario: undefined,
      cpf_destinatario: undefined,
      inscricao_estadual_destinatario: undefined,
      indicador_inscricao_estadual_destinatario: undefined,
      logradouro_destinatario: undefined,
      numero_destinatario: undefined,
      bairro_destinatario: undefined,
      municipio_destinatario: undefined,
      uf_destinatario: undefined,
      cep_destinatario: undefined,
    });
    expect(validarPayloadFiscal(balcao, "nfce")).toEqual([]);
    // A mesma nota como NF-e é recusada: lá o destinatário é obrigatório.
    expect(validarPayloadFiscal(balcao, "nfe")).toContain(
      "NF-e sem destinatário identificado: informe o CNPJ ou o CPF",
    );
  });

  it("aceita NFC-e com CPF e sem endereço — não se pede endereço num balcão", () => {
    const balcaoComCpf = payload({
      cnpj_destinatario: undefined,
      cpf_destinatario: CPF_DESTINATARIO,
      inscricao_estadual_destinatario: undefined,
      indicador_inscricao_estadual_destinatario: undefined,
      logradouro_destinatario: undefined,
      numero_destinatario: undefined,
      bairro_destinatario: undefined,
      municipio_destinatario: undefined,
      uf_destinatario: undefined,
      cep_destinatario: undefined,
    });
    expect(validarPayloadFiscal(balcaoComCpf, "nfce")).toEqual([]);
  });

  it("exige o endereço do destinatário na NF-e, menos o CEP", () => {
    const semEndereco = payload({
      logradouro_destinatario: undefined,
      numero_destinatario: undefined,
      bairro_destinatario: undefined,
      municipio_destinatario: undefined,
      uf_destinatario: undefined,
      cep_destinatario: undefined,
    });
    const problemas = validarPayloadFiscal(semEndereco, "nfe");
    expect(problemas).toEqual(
      expect.arrayContaining([
        "Endereço do destinatário: logradouro ausente",
        "Endereço do destinatário: número ausente",
        "Endereço do destinatário: bairro ausente",
        "Endereço do destinatário: município ausente",
        "Endereço do destinatário: UF ausente",
      ]),
    );
    // `E13` (CEP do `enderDest`) é `0-1` no leiaute, ao contrário do `C13` do
    // emitente — o validador não inventa uma obrigação que a regra não tem.
    expect(problemas).not.toContain("Endereço do destinatário: CEP ausente");
  });

  it("confere o formato do CEP e da UF do destinatário mesmo na NFC-e, quando eles vêm", () => {
    const torto = payload({ uf_destinatario: "ZZ", cep_destinatario: "130100" });
    expect(validarPayloadFiscal(torto, "nfce")).toEqual(
      expect.arrayContaining([
        'Endereço do destinatário: UF "ZZ" não é uma sigla de unidade federativa',
        "Endereço do destinatário: CEP fora do formato de 8 dígitos",
      ]),
    );
  });

  it("exige IE quando o destinatário é contribuinte (indIEDest = 1)", () => {
    expect(
      validarPayloadFiscal(payload({ inscricao_estadual_destinatario: undefined }), "nfe"),
    ).toContain("Destinatário declarado contribuinte de ICMS (indIEDest = 1) e sem inscrição estadual");
  });

  it("recusa IE informada com indIEDest diferente de 1 — a rejeição 791", () => {
    for (const indicador of [2, 9]) {
      const problemas = validarPayloadFiscal(
        payload({ indicador_inscricao_estadual_destinatario: indicador }),
        "nfe",
      );
      expect(problemas).toContain(
        `Inscrição estadual do destinatário informada com indIEDest = ${indicador} — ela só é informada quando o destinatário é contribuinte (1)`,
      );
    }
  });

  it("recusa indIEDest fora do vocabulário 1/2/9 e exige o campo na NF-e", () => {
    expect(
      validarPayloadFiscal(payload({ indicador_inscricao_estadual_destinatario: 3 }), "nfe"),
    ).toContain(
      "Indicador de inscrição estadual do destinatário (indIEDest) inválido: 3 — os válidos são 1, 2 e 9",
    );
    expect(
      validarPayloadFiscal(
        payload({
          indicador_inscricao_estadual_destinatario: undefined,
          inscricao_estadual_destinatario: undefined,
        }),
        "nfe",
      ),
    ).toContain("Indicador de inscrição estadual do destinatário (indIEDest) ausente");
  });

  it("exige o nome do destinatário na NF-e", () => {
    expect(validarPayloadFiscal(payload({ nome_destinatario: "  " }), "nfe")).toContain(
      "Nome do destinatário ausente",
    );
  });
});

describe("validarPayloadFiscal — itens, unidades e valores", () => {
  it("mantém as recusas que já existiam antes de A9", () => {
    const buracos = payload({
      natureza_operacao: "",
      data_emissao: "",
      nome_emitente: "",
      items: [item({ descricao: "", cfop: "", codigo_ncm: "", icms_situacao_tributaria: "" })],
    });
    expect(validarPayloadFiscal(buracos, "nfe")).toEqual(
      expect.arrayContaining([
        "Natureza da operação ausente",
        "Data de emissão ausente",
        "Nome do emitente ausente",
        "item 1: descrição ausente",
        "item 1: CFOP ausente",
        "item 1: NCM ausente",
        "item 1: situação tributária do ICMS (CST/CSOSN) ausente",
      ]),
    );
  });

  it("recusa nota sem itens", () => {
    expect(validarPayloadFiscal(payload({ items: [] }), "nfe")).toContain("Nota sem itens");
  });

  it("exige as duas unidades do item", () => {
    const semUnidades = payload({
      items: [item({ unidade_comercial: undefined, unidade_tributavel: undefined })],
    });
    expect(validarPayloadFiscal(semUnidades, "nfe")).toEqual(
      expect.arrayContaining(["item 1: unidade comercial ausente", "item 1: unidade tributável ausente"]),
    );
  });

  it("exige quantidade comercial e tributável maiores que zero", () => {
    expect(validarPayloadFiscal(payload({ items: [item({ quantidade_comercial: 0 })] }), "nfe")).toContain(
      "item 1: quantidade deve ser maior que zero",
    );
    expect(
      validarPayloadFiscal(payload({ items: [item({ quantidade_tributavel: 0 })] }), "nfe"),
    ).toContain("item 1: quantidade tributável deve ser maior que zero");
  });

  it("recusa valor negativo, NaN e Infinity no item", () => {
    expect(
      validarPayloadFiscal(payload({ items: [item({ valor_unitario_comercial: -5 })] }), "nfe"),
    ).toContain("item 1: valor unitário comercial deve ser um número não negativo");
    expect(validarPayloadFiscal(payload({ items: [item({ valor_bruto: Number.NaN })] }), "nfe")).toContain(
      "item 1: valor bruto deve ser um número não negativo",
    );
    expect(
      validarPayloadFiscal(payload({ items: [item({ valor_desconto: Number.POSITIVE_INFINITY })] }), "nfe"),
    ).toContain("item 1: valor de desconto deve ser um número não negativo");
  });

  it("aceita zero — um item pode ser brinde, e desconto zero é desconto", () => {
    const zerado = payload({
      items: [item({ valor_unitario_comercial: 0, valor_bruto: 0, valor_desconto: 0 })],
      valor_produtos: 0,
      valor_total: 0,
    });
    expect(validarPayloadFiscal(zerado, "nfe")).toEqual([]);
  });

  it("recusa valor negativo nos totais da nota", () => {
    expect(validarPayloadFiscal(payload({ valor_total: -1 }), "nfe")).toContain(
      "Valor total da nota deve ser um número não negativo",
    );
    expect(validarPayloadFiscal(payload({ valor_frete: -1 }), "nfe")).toContain(
      "Valor do frete deve ser um número não negativo",
    );
  });

  it("não opina sobre imposto: a soma dos itens pode não bater com o total", () => {
    // O total não bate com o item de propósito. Conferir isso é o motor de
    // B1–B10; este validador não tem opinião sobre aritmética tributária.
    const incoerente = payload({ valor_produtos: 999, valor_total: 999 });
    expect(validarPayloadFiscal(incoerente, "nfe")).toEqual([]);
  });

  it("numera os itens pelo `numero_item` do payload, não pela posição", () => {
    const segundoItem = payload({ items: [item({ numero_item: 2, descricao: "" })] });
    expect(validarPayloadFiscal(segundoItem, "nfe")).toContain("item 2: descrição ausente");
  });
});

/**
 * O contrário do resto da bateria: em vez de quebrar campos à mão, aqui a nota
 * vem de `invoiceMapping` — o mesmo caminho que `buildPayload` percorre em
 * `handleEmit`, com o mesmo cadastro completo que as baterias de B1–B10 usam.
 *
 * **É o teste que impede A9 de virar um bloqueio.** Um validador que recusa a
 * nota que o próprio motor monta não protege ninguém: só troca uma recusa da
 * SEFAZ por uma recusa nossa, mais cedo e sem saída. Os três documentos que
 * este sistema emite passam por ele aqui.
 */

const GRUPO: TaxGroup = {
  id: "grupo-1",
  code: "TRIB18",
  name: "Tributado 18%",
  cstIcms: "00",
  csosn: null,
  aliquotaIcms: 18,
  reducaoBaseIcms: null,
  cstPis: "01",
  aliquotaPis: 1.65,
  aliquotaPisValor: null,
  cstCofins: "01",
  aliquotaCofins: 7.6,
  aliquotaCofinsValor: null,
  cstIpi: null,
  aliquotaIpi: null,
  cstIbsCbs: "000",
  cclasstrib: "000001",
};

const ITEM_DE_VENDA: SaleForInvoiceItem = {
  quantity: 2,
  unitPrice: 500,
  discountAmount: 0,
  totalAmount: 1000,
  product: {
    code: "P-1",
    description: "Produto de teste",
    ncm: "22021000",
    cest: null,
    unidadeComercial: "UN",
    unidadeTributavel: "UN",
    origemMercadoria: "0",
    cstIpi: null,
    taxGroup: GRUPO,
  },
};

function regra(naturezaOperacao: string, tipoCliente: string, cfop: string): TaxRuleRow {
  return {
    id: `${naturezaOperacao}-${tipoCliente}`,
    regime: "3",
    naturezaOperacao,
    ufOrigem: "SP",
    ufDestino: "SP",
    tipoCliente,
    cfop,
  };
}

const REGRAS_VENDA = ["contribuinte", "nao_contribuinte", "consumidor_final"].map((tipo) =>
  regra("venda", tipo, "5102"),
);
const REGRAS_DEVOLUCAO = ["contribuinte", "nao_contribuinte", "consumidor_final"].map((tipo) =>
  regra("devolucao", tipo, "1202"),
);

/**
 * Uma venda com o cadastro **completo**: filial com endereço, IE e regime;
 * cliente com endereço e documento. É o cadastro que A9 passa a exigir, e o
 * mesmo que as baterias fiscais anteriores já usavam.
 */
function venda(contact: SaleForInvoice["contact"]): SaleForInvoice {
  return {
    code: "V-0001",
    issueDate: "2026-09-09",
    subtotalAmount: 1000,
    totalAmount: 1000,
    discountAmount: 0,
    freightAmount: 0,
    branch: {
      cnpj: "00000000000191",
      name: "Facilite Testes LTDA",
      inscricaoEstadual: "123456789",
      regimeTributario: "3",
      aliquotaCreditoIcmsSimples: null,
      logradouro: "Rua Um",
      numero: "10",
      bairro: "Centro",
      municipio: "São Paulo",
      uf: "SP",
      cep: "01001000",
    },
    contact,
    items: [ITEM_DE_VENDA],
    payments: [],
  };
}

function cliente(overrides: Partial<NonNullable<SaleForInvoice["contact"]>> = {}) {
  return {
    name: "Cliente de teste",
    document: CNPJ_DESTINATARIO,
    inscricaoEstadual: "987654321",
    indicadorIe: "1",
    regimeTributario: null,
    logradouro: "Rua Dois",
    numero: "20",
    bairro: "Centro",
    municipio: "Campinas",
    uf: "SP",
    cep: "13010000",
    phone: null,
    ...overrides,
  };
}

function emitida(resultado: ReturnType<typeof buildNfePayloadFromSale>): NfePayload {
  if (!resultado.ok) throw new Error(`Mapeamento recusou antes do validador: ${resultado.errors.join(" | ")}`);
  return resultado.payload;
}

describe("validarPayloadFiscal — a nota que o próprio motor monta passa", () => {
  it("NF-e de venda para contribuinte com IE", () => {
    const payloadDoMotor = emitida(buildNfePayloadFromSale(venda(cliente()), REGRAS_VENDA));
    expect(validarPayloadFiscal(payloadDoMotor, "nfe")).toEqual([]);
  });

  it("NF-e de venda para pessoa física — CPF, sem IE, indIEDest 9", () => {
    const pessoaFisica = cliente({
      document: CPF_DESTINATARIO,
      inscricaoEstadual: null,
      indicadorIe: null,
    });
    const payloadDoMotor = emitida(buildNfePayloadFromSale(venda(pessoaFisica), REGRAS_VENDA));

    expect(payloadDoMotor.cpf_destinatario).toBe(CPF_DESTINATARIO);
    expect(payloadDoMotor.cnpj_destinatario).toBeUndefined();
    expect(validarPayloadFiscal(payloadDoMotor, "nfe")).toEqual([]);
  });

  it("NF-e de venda para CNPJ **com IE cadastrada e sem indicador** — o caso que era rejeição 791", () => {
    // O cadastro real da imensa maioria dos contatos: IE preenchida,
    // `indicador_ie` nulo. Antes da correção de A9 o mapeamento copiava a IE
    // para o payload junto de `indIEDest = 9`, e a nota levava as duas coisas
    // que a regra `E17` proíbe juntas.
    const semIndicador = cliente({ indicadorIe: null });
    const payloadDoMotor = emitida(buildNfePayloadFromSale(venda(semIndicador), REGRAS_VENDA));

    expect(payloadDoMotor.indicador_inscricao_estadual_destinatario).toBe(9);
    expect(payloadDoMotor.inscricao_estadual_destinatario).toBeUndefined();
    expect(validarPayloadFiscal(payloadDoMotor, "nfe")).toEqual([]);
  });

  it("NFC-e de balcão, sem cliente nenhum", () => {
    const payloadDoMotor = emitida(buildNfcePayloadFromSale(venda(null), REGRAS_VENDA));
    expect(validarPayloadFiscal(payloadDoMotor, "nfce")).toEqual([]);
  });

  it("NFC-e com cliente cadastrado **sem documento** — `contacts.document` é NOT NULL DEFAULT ''", () => {
    // O campo vazio não vira `cpf_destinatario: ""` no payload: some. Sem a
    // correção de A9 no mapeamento, esta nota seria recusada pelo validador
    // por causa de um CPF vazio que o cadastro nunca informou.
    const semDocumento = cliente({ document: "", inscricaoEstadual: null, indicadorIe: null });
    const payloadDoMotor = emitida(buildNfcePayloadFromSale(venda(semDocumento), REGRAS_VENDA));

    expect(payloadDoMotor.cpf_destinatario).toBeUndefined();
    expect(payloadDoMotor.cnpj_destinatario).toBeUndefined();
    expect(validarPayloadFiscal(payloadDoMotor, "nfce")).toEqual([]);
  });

  it("NF-e de devolução", () => {
    const original = venda(cliente());
    const devolucao: SaleReturnForInvoice = {
      code: "D-0001",
      saleCode: original.code,
      issueDate: original.issueDate,
      totalAmount: original.totalAmount,
      discountAmount: 0,
      originalChave: null,
      branch: original.branch,
      contact: original.contact,
      items: original.items,
    };
    const payloadDoMotor = emitida(buildReturnNfePayload(devolucao, REGRAS_DEVOLUCAO));
    expect(validarPayloadFiscal(payloadDoMotor, "nfe")).toEqual([]);
  });
});
