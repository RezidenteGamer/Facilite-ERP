import { describe, expect, it } from "vitest";

import {
  buildNfePayloadFromSale,
  buildReturnNfePayload,
  type SaleForInvoice,
  type SaleForInvoiceItem,
  type SaleReturnForInvoice,
} from "@fiscal-core/invoiceMapping.ts";
import type { TaxGroup } from "@fiscal-core/taxGroups.ts";
import type { TaxRuleRow } from "@fiscal-core/taxRules.ts";

/**
 * Bateria do `indFinal` do cabeçalho da nota — a correção da **Rejeição 696**
 * (04/09/2026).
 *
 * As outras baterias de `invoiceMapping` medem o **item** (o ICMS próprio, o
 * ST, o ad rem, o crédito do Simples). Esta mede o **cabeçalho**, e um par de
 * campos só: `indicador_inscricao_estadual_destinatario` (`indIEDest`) e
 * `consumidor_final` (`indFinal`). Arquivo separado pelo mesmo critério de
 * sempre — é uma dimensão própria, e não é do item.
 *
 * O que se defende aqui é a regra de validação **E16a-40** do leiaute: a SEFAZ
 * rejeita com o código **696** ("Operação com não contribuinte deve indicar
 * operação com consumidor final") a nota que declara `indIEDest = 9` e
 * `indFinal ≠ 1` ao mesmo tempo, em saída (`tpNF = 1`) que não é para o
 * exterior (`idDest ≠ 3`). Antes da correção os dois campos vinham de fontes
 * diferentes e discordavam em todo cliente **CNPJ sem `indicador_ie`
 * cadastrado** — que é o cadastro da imensa maioria dos contatos.
 *
 * Cada teste afirma **os dois campos juntos**, de propósito: o que a regra
 * proíbe é a combinação, não um valor isolado. Um teste que olhasse só o
 * `indFinal` deixaria passar exatamente o defeito que esta bateria existe para
 * impedir.
 */

const REGRA_CONTRIBUINTE: TaxRuleRow = {
  id: "venda-contribuinte",
  regime: "3",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "SP",
  tipoCliente: "contribuinte",
  cfop: "5102",
};

const REGRA_NAO_CONTRIBUINTE: TaxRuleRow = {
  ...REGRA_CONTRIBUINTE,
  id: "venda-nao-contribuinte",
  tipoCliente: "nao_contribuinte",
};

const REGRA_CONSUMIDOR_FINAL: TaxRuleRow = {
  ...REGRA_CONTRIBUINTE,
  id: "venda-consumidor-final",
  tipoCliente: "consumidor_final",
};

/**
 * As três dimensões de `tipoCliente` cadastradas de uma vez. A escolha de CFOP
 * **não** faz parte desta correção — `resolveTipoCliente` continua decidindo
 * qual regra se aplica —, então a bateria cadastra as três para que nenhum
 * caso pare por falta de regra e o que sobre para medir seja só o cabeçalho.
 */
const REGRAS_VENDA: TaxRuleRow[] = [REGRA_CONTRIBUINTE, REGRA_NAO_CONTRIBUINTE, REGRA_CONSUMIDOR_FINAL];

const REGRAS_DEVOLUCAO: TaxRuleRow[] = REGRAS_VENDA.map((regra) => ({
  ...regra,
  id: `devolucao-${regra.tipoCliente}`,
  naturezaOperacao: "devolucao",
  cfop: "1202",
}));

/** Grupo tributado simples: nada aqui depende do imposto do item. */
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
  cstIbsCbs: null,
  cclasstrib: null,
};

const ITEM: SaleForInvoiceItem = {
  quantity: 1,
  unitPrice: 1000,
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

/** O que muda entre os casos é só o documento e o indicador de IE. */
const CNPJ = "11222333000181";
const CPF = "12345678909";

function sale(document: string, indicadorIe: string | null, inscricaoEstadual: string | null = null): SaleForInvoice {
  return {
    code: "V-0001",
    issueDate: "2026-09-04",
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
    contact: {
      name: "Cliente de teste",
      document,
      inscricaoEstadual,
      indicadorIe,
      regimeTributario: null,
      logradouro: "Rua Dois",
      numero: "20",
      bairro: "Centro",
      municipio: "São Paulo",
      uf: "SP",
      cep: "01002000",
      phone: null,
    },
    items: [ITEM],
    payments: [],
  };
}

/** Emite a venda e devolve o par de campos que a E16a-40 cruza. */
function cabecalhoDaVenda(document: string, indicadorIe: string | null, inscricaoEstadual: string | null = null) {
  const resultado = buildNfePayloadFromSale(sale(document, indicadorIe, inscricaoEstadual), REGRAS_VENDA);
  if (!resultado.ok) throw new Error(`Emissão recusada: ${resultado.errors.join(" | ")}`);
  return {
    tipoDocumento: resultado.payload.tipo_documento,
    localDestino: resultado.payload.local_destino,
    indIEDest: resultado.payload.indicador_inscricao_estadual_destinatario,
    indFinal: resultado.payload.consumidor_final,
  };
}

/** A devolução da mesma venda, pelo mesmo par de campos. */
function cabecalhoDaDevolucao(document: string, indicadorIe: string | null) {
  const venda = sale(document, indicadorIe);
  const devolucao: SaleReturnForInvoice = {
    code: "D-0001",
    saleCode: venda.code,
    issueDate: venda.issueDate,
    totalAmount: venda.totalAmount,
    discountAmount: 0,
    originalChave: null,
    branch: venda.branch,
    contact: venda.contact,
    items: venda.items,
  };
  const resultado = buildReturnNfePayload(devolucao, REGRAS_DEVOLUCAO);
  if (!resultado.ok) throw new Error(`Emissão recusada: ${resultado.errors.join(" | ")}`);
  return {
    tipoDocumento: resultado.payload.tipo_documento,
    indIEDest: resultado.payload.indicador_inscricao_estadual_destinatario,
    indFinal: resultado.payload.consumidor_final,
  };
}

describe("Rejeição 696 (E16a-40): o que a correção conserta na NF-e de venda", () => {
  it("CNPJ sem indicador de IE cadastrado sai consumidor final — era a rejeição garantida", () => {
    // O caso do cadastro real: `indicador_ie` é opcional e está nulo na imensa
    // maioria dos contatos. Antes da correção esta nota saía com
    // `indIEDest = 9` e `indFinal = 0` — as duas condições da 696 de uma vez.
    const { indIEDest, indFinal, tipoDocumento, localDestino } = cabecalhoDaVenda(CNPJ, null);

    expect(indIEDest).toBe(9);
    expect(indFinal).toBe(1);

    // As outras duas condições da regra continuam valendo nesta nota — é o que
    // torna o par acima a diferença entre emitir e ser rejeitado.
    expect(tipoDocumento).toBe(1);
    expect(localDestino).not.toBe(3);
  });

  it("CNPJ com indicador de IE '9' (não contribuinte declarado) sai igual", () => {
    // Mesma correção pelo caminho explícito: quem digitou "não contribuinte"
    // no cadastro caía na mesma combinação proibida que quem não digitou nada.
    const { indIEDest, indFinal } = cabecalhoDaVenda(CNPJ, "9");

    expect(indIEDest).toBe(9);
    expect(indFinal).toBe(1);
  });

  it("CNPJ contribuinte (indicador '1') não muda: indFinal segue 0", () => {
    // Regressão. A E16a-40 não alcança `indIEDest = 1`, e um contribuinte
    // comprando para revender não é consumidor final.
    const { indIEDest, indFinal } = cabecalhoDaVenda(CNPJ, "1", "987654321");

    expect(indIEDest).toBe(1);
    expect(indFinal).toBe(0);
  });

  it("CNPJ isento de inscrição (indicador '2') não muda: indFinal segue 0", () => {
    // A 696 checa `indIEDest = 9` e só. O código `2` tem regra própria e de
    // outro eixo (rejeição 791, sobre informar a IE junto do indicador de
    // isento) e nada a ver com `indFinal` — um isento é contribuinte e pode
    // comprar para revenda. Estender a correção a ele seria inventar regra.
    const { indIEDest, indFinal } = cabecalhoDaVenda(CNPJ, "2");

    expect(indIEDest).toBe(2);
    expect(indFinal).toBe(0);
  });

  it("CPF continua consumidor final — o caso que já funcionava", () => {
    // Regressão do caminho que a derivação antiga acertava por outro motivo
    // (`resolveTipoCliente` devolve `"consumidor_final"` para todo não-CNPJ).
    // A derivação nova chega no mesmo lugar: pessoa física não tem IE.
    const { indIEDest, indFinal } = cabecalhoDaVenda(CPF, null);

    expect(indIEDest).toBe(9);
    expect(indFinal).toBe(1);
  });

  it("CPF com inscrição estadual (produtor rural) sai como contribuinte, não consumidor final", () => {
    // O único caso que **muda de valor** fora do CNPJ, e de propósito: o
    // produtor rural pessoa física tem IE e é contribuinte do ICMS. Ele
    // resolve `indIEDest = 1`, a 696 não o alcança em nenhum dos dois valores,
    // e comprar insumo para industrializar não é consumo final.
    const { indIEDest, indFinal } = cabecalhoDaVenda(CPF, "1", "987654321");

    expect(indIEDest).toBe(1);
    expect(indFinal).toBe(0);
  });
});

describe("a mesma derivação na nota de devolução, onde a rejeição não chega", () => {
  // A E16a-40 vale só para `tpNF = 1`, e a devolução é nota de **entrada**.
  // Não é risco de rejeição que decide aqui: é que `indFinal` significa a
  // mesma coisa nos dois documentos, e a devolução desfaz a operação que a
  // nota original declarou, para o mesmo cliente.

  it("CNPJ sem indicador de IE: mesmo par da venda, em nota de entrada", () => {
    const { indIEDest, indFinal, tipoDocumento } = cabecalhoDaDevolucao(CNPJ, null);

    expect(tipoDocumento).toBe(0);
    expect(indIEDest).toBe(9);
    expect(indFinal).toBe(1);
  });

  it("CNPJ com indicador '9': idem", () => {
    const { indIEDest, indFinal } = cabecalhoDaDevolucao(CNPJ, "9");

    expect(indIEDest).toBe(9);
    expect(indFinal).toBe(1);
  });

  it("CNPJ contribuinte ('1') e isento ('2') continuam com indFinal 0", () => {
    expect(cabecalhoDaDevolucao(CNPJ, "1")).toMatchObject({ indIEDest: 1, indFinal: 0 });
    expect(cabecalhoDaDevolucao(CNPJ, "2")).toMatchObject({ indIEDest: 2, indFinal: 0 });
  });

  it("CPF continua consumidor final na devolução", () => {
    const { indIEDest, indFinal } = cabecalhoDaDevolucao(CPF, null);

    expect(indIEDest).toBe(9);
    expect(indFinal).toBe(1);
  });
});
