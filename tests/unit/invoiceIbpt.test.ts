import { describe, expect, it } from "vitest";

import {
  buildNfcePayloadFromSale,
  buildNfePayloadFromSale,
  buildReturnNfePayload,
  type SaleForInvoice,
  type SaleForInvoiceItem,
  type SaleReturnForInvoice,
} from "@fiscal-core/invoiceMapping.ts";
import { resolveIbptRate, type IbptRateRow } from "@fiscal-core/ibptRates.ts";
import type { MvaRuleRow } from "@fiscal-core/mvaRules.ts";
import type { TaxGroup } from "@fiscal-core/taxGroups.ts";
import type { TaxRuleRow } from "@fiscal-core/taxRules.ts";

/**
 * Bateria da **Lei da Transparência Fiscal** — o `vTotTrib` da Lei 12.741/2012
 * (B9, 05/09/2026).
 *
 * Arquivo separado pelo mesmo critério de sempre (dimensão própria do mesmo
 * item), mas o que ela defende é diferente de tudo que veio antes: este campo
 * **não é imposto**. Ele não muda nenhuma outra grandeza, não entra em base
 * nenhuma, não soma no `vNF` — e, principalmente, **a falta de cadastro não
 * recusa a emissão**. Metade dos testes aqui existe para fixar essa inversão,
 * porque ela é o oposto do que rege todo o resto deste motor.
 *
 * As contas continuam escritas por extenso nos comentários, pelo mesmo motivo
 * de B1: um teste que compara com `taxAmount(...)` reimplementa o código que
 * deveria estar conferindo.
 */

/** SP → SP, venda interna a consumidor final. */
const REGRA_INTERNA: TaxRuleRow = {
  id: "venda-interna",
  regime: "3",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "SP",
  tipoCliente: "consumidor_final",
  cfop: "5102",
};

/** SP → SP para o CNPJ contribuinte — `consumidor_final = 0`, fora do alcance da lei. */
const REGRA_INTERNA_CONTRIBUINTE: TaxRuleRow = {
  ...REGRA_INTERNA,
  id: "venda-interna-contribuinte",
  tipoCliente: "contribuinte",
};

/** SP → RJ: interestadual, para provar que a UF que importa é a de **origem**. */
const REGRA_RJ: TaxRuleRow = {
  id: "venda-rj",
  regime: "3",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "RJ",
  tipoCliente: "consumidor_final",
  cfop: "6108",
};

/** MG → SP: a mesma venda, de uma filial de outro estado. */
const REGRA_MG: TaxRuleRow = {
  id: "venda-mg",
  regime: "3",
  naturezaOperacao: "venda",
  ufOrigem: "MG",
  ufDestino: "SP",
  tipoCliente: "consumidor_final",
  cfop: "6108",
};

/** NFC-e: sempre interna, sempre consumidor final — ver `buildNfcePayloadFromSale`. */
const REGRA_NFCE: TaxRuleRow = {
  ...REGRA_INTERNA,
  id: "venda-nfce",
};

/** A devolução tem `natureza_operacao` própria — CFOP de entrada. */
const REGRA_DEVOLUCAO: TaxRuleRow = {
  id: "devolucao-interna",
  regime: "3",
  naturezaOperacao: "devolucao",
  ufOrigem: "SP",
  ufDestino: "SP",
  tipoCliente: "consumidor_final",
  cfop: "1202",
};

const NCM = "22021000";
/** Um segundo NCM, para os testes de nota com dois itens e de item sem cadastro. */
const NCM_SEM_CADASTRO = "84713012";

/**
 * A linha central: percentuais **reais** de refrigerante na tabela do IBPT
 * (versão de referência), com os 4 decimais que o arquivo admite.
 *
 * Federal nacional 12,45%, federal importado 15,32%, estadual 18%, municipal 0%
 * — a municipal é zero na imensa maioria das mercadorias, porque o ISS não
 * incide sobre circulação de mercadoria; ela existe no arquivo por causa dos
 * serviços (NBS/LC 116).
 */
const TAXA_SP: IbptRateRow = {
  id: "ibpt-sp",
  ncm: NCM,
  uf: "SP",
  aliquotaNacionalFederal: 12.45,
  aliquotaImportadoFederal: 15.32,
  aliquotaEstadual: 18,
  aliquotaMunicipal: 0,
  fonte: "IBPT",
  versao: "26.2.A",
  vigenciaInicio: "2026-07-01",
};

/** A mesma linha em coringa — "vale para qualquer UF da empresa". */
const TAXA_CORINGA: IbptRateRow = {
  ...TAXA_SP,
  id: "ibpt-coringa",
  uf: "*",
  aliquotaNacionalFederal: 9,
  aliquotaEstadual: 12,
};

/** Linha com municipal diferente de zero, para os três entes aparecerem separados. */
const TAXA_COM_MUNICIPAL: IbptRateRow = {
  ...TAXA_SP,
  id: "ibpt-municipal",
  aliquotaMunicipal: 2.5,
};

const MVA: MvaRuleRow = {
  id: "mva-1",
  ncm: NCM,
  ufDestino: "*",
  mvaOriginal: 40,
  fcpAliquota: null,
};

/** Grupo de CST 00 (tributada integralmente) a 18%. */
function taxGroup(overrides: Partial<TaxGroup> = {}): TaxGroup {
  return {
    id: "grupo-normal",
    code: "ICMS18",
    name: "Tributada 18%",
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
    ...overrides,
  };
}

/** Um item de R$ 1.000,00 — número redondo para a conta caber na cabeça de quem lê. */
function item(group: TaxGroup, overrides: Partial<SaleForInvoiceItem> = {}): SaleForInvoiceItem {
  return {
    quantity: 1,
    unitPrice: 1000,
    discountAmount: 0,
    totalAmount: 1000,
    product: {
      code: "P-1",
      description: "Produto de teste",
      ncm: NCM,
      cest: null,
      unidadeComercial: "UN",
      unidadeTributavel: "UN",
      origemMercadoria: "0",
      cstIpi: null,
      taxGroup: group,
    },
    ...overrides,
  };
}

/** Override que troca a origem da mercadoria — o que escolhe entre as duas colunas federais. */
function comOrigem(group: TaxGroup, origemMercadoria: string): Partial<SaleForInvoiceItem> {
  return { product: { ...item(group).product, origemMercadoria } };
}

/** Override que troca o NCM do produto. */
function comNcm(group: TaxGroup, ncm: string): Partial<SaleForInvoiceItem> {
  return { product: { ...item(group).product, ncm } };
}

const MUNICIPIOS: Record<string, string> = { SP: "São Paulo", RJ: "Rio de Janeiro" };

type Destinatario = { document: string; indicadorIe: string | null; inscricaoEstadual: string | null };

/** CPF sem IE: `indIEDest = 9`, `indFinal = 1` — o consumidor da Lei da Transparência. */
const CPF: Destinatario = { document: "39053344705", indicadorIe: null, inscricaoEstadual: null };

/** CNPJ contribuinte: `indFinal = 0` — compra para revender, fora do alcance da lei. */
const CNPJ_CONTRIBUINTE: Destinatario = {
  document: "11222333000181",
  indicadorIe: "1",
  inscricaoEstadual: "987654321",
};

function sale(
  items: SaleForInvoiceItem[],
  options: { ufDestino?: string; ufOrigem?: string; destinatario?: Destinatario } = {},
): SaleForInvoice {
  const ufDestino = options.ufDestino ?? "SP";
  const destinatario = options.destinatario ?? CPF;
  const total = items.reduce((sum, i) => sum + i.totalAmount, 0);
  return {
    code: "V-0001",
    issueDate: "2026-09-05",
    subtotalAmount: total,
    totalAmount: total,
    discountAmount: 0,
    freightAmount: 0,
    branch: {
      cnpj: "00000000000191",
      name: "Facilite Testes LTDA",
      inscricaoEstadual: "123456789",
      regimeTributario: "3",
      aliquotaCreditoIcmsSimples: 1.36,
      logradouro: "Rua Um",
      numero: "10",
      bairro: "Centro",
      municipio: MUNICIPIOS[options.ufOrigem ?? "SP"] ?? "São Paulo",
      uf: options.ufOrigem ?? "SP",
      cep: "01001000",
    },
    contact: {
      name: "Cliente de teste",
      document: destinatario.document,
      inscricaoEstadual: destinatario.inscricaoEstadual,
      indicadorIe: destinatario.indicadorIe,
      regimeTributario: null,
      logradouro: "Rua Dois",
      numero: "20",
      bairro: "Centro",
      municipio: MUNICIPIOS[ufDestino] ?? "São Paulo",
      uf: ufDestino,
      cep: "01002000",
      phone: null,
    },
    items,
    payments: [],
  };
}

/** Emite e devolve o primeiro item do payload, falhando alto se a montagem recusar. */
function primeiroItem(
  group: TaxGroup,
  options: {
    itemOverrides?: Partial<SaleForInvoiceItem>;
    ibptRates?: IbptRateRow[];
    regra?: TaxRuleRow;
    destinatario?: Destinatario;
    ufOrigem?: string;
  } = {},
) {
  const regra = options.regra ?? REGRA_INTERNA;
  const vendaMontada = sale([item(group, options.itemOverrides)], {
    ufDestino: regra.ufDestino,
    ufOrigem: options.ufOrigem ?? regra.ufOrigem,
    destinatario: options.destinatario,
  });
  const resultado = buildNfePayloadFromSale(vendaMontada, [regra], [], options.ibptRates ?? []);
  if (!resultado.ok) throw new Error(`Emissão recusada: ${resultado.errors.join(" | ")}`);
  return { item: resultado.payload.items[0], payload: resultado.payload };
}

describe("resolveIbptRate — o cadastro isolado", () => {
  it("acha a linha da UF exata", () => {
    const resolucao = resolveIbptRate({ ncm: NCM, uf: "SP" }, [TAXA_SP]);

    expect(resolucao.found).toBe(true);
    if (!resolucao.found) return;
    expect(resolucao.rule.id).toBe("ibpt-sp");
    expect(resolucao.matchedWildcard).toBe(false);
  });

  it("a UF exata vence o coringa — mais específico vence, como em tax_rules e mva_rules", () => {
    const resolucao = resolveIbptRate({ ncm: NCM, uf: "SP" }, [TAXA_CORINGA, TAXA_SP]);

    expect(resolucao.found).toBe(true);
    if (!resolucao.found) return;
    expect(resolucao.rule.id).toBe("ibpt-sp");
  });

  it("cai no coringa quando não há linha para aquela UF", () => {
    const resolucao = resolveIbptRate({ ncm: NCM, uf: "MG" }, [TAXA_CORINGA, TAXA_SP]);

    expect(resolucao.found).toBe(true);
    if (!resolucao.found) return;
    expect(resolucao.rule.id).toBe("ibpt-coringa");
    expect(resolucao.matchedWildcard).toBe(true);
  });

  it("NCM com pontuação casa com o cadastrado sem — só os dígitos contam", () => {
    const comPontuacao: IbptRateRow = { ...TAXA_SP, ncm: "2202.10.00" };
    const resolucao = resolveIbptRate({ ncm: NCM, uf: "SP" }, [comPontuacao]);

    expect(resolucao.found).toBe(true);
  });

  it("NCM não cadastrado devolve found: false — e isso não é erro", () => {
    const resolucao = resolveIbptRate({ ncm: NCM_SEM_CADASTRO, uf: "SP" }, [TAXA_SP]);

    expect(resolucao.found).toBe(false);
  });

  it("empate de especificidade devolve found: false, e não recusa", () => {
    // Impossível no banco (a unique `(ncm, uf)` da migration impede), possível
    // aqui. `resolveMvaRule` trataria isto como recusa de emissão; este não,
    // porque o campo é informativo — mas também não sorteia um dos dois.
    const gemea: IbptRateRow = { ...TAXA_SP, id: "ibpt-sp-2" };
    const resolucao = resolveIbptRate({ ncm: NCM, uf: "SP" }, [TAXA_SP, gemea]);

    expect(resolucao.found).toBe(false);
    if (resolucao.found) return;
    expect(resolucao.ambiguousRuleIds).toEqual(["ibpt-sp", "ibpt-sp-2"]);
  });
});

describe("vTotTrib — o cálculo por item", () => {
  it("item nacional com NCM cadastrado: federal nacional + estadual + municipal", () => {
    const { item: linha } = primeiroItem(taxGroup(), { ibptRates: [TAXA_SP] });

    // Federal:   1000,00 × 12,45% = 124,50
    // Estadual:  1000,00 × 18,00% = 180,00
    // Municipal: 1000,00 ×  0,00% =   0,00
    //                              --------
    //                                304,50
    expect(linha.valor_total_tributos).toBe(304.5);
  });

  it("item importado usa a coluna federal de importado — a estadual não muda", () => {
    const { item: linha } = primeiroItem(taxGroup(), {
      itemOverrides: comOrigem(taxGroup(), "1"),
      ibptRates: [TAXA_SP],
    });

    // Federal importado: 1000,00 × 15,32% = 153,20
    // Estadual:          1000,00 × 18,00% = 180,00 (a mesma — o arquivo do IBPT
    //                                       não desdobra estadual por origem)
    //                                      --------
    //                                        333,20
    expect(linha.valor_total_tributos).toBe(333.2);
  });

  it.each([
    ["1", 333.2],
    ["2", 333.2],
    ["3", 333.2],
    ["6", 333.2],
    ["7", 333.2],
    ["8", 333.2],
  ])("origem %s é importada para o IBPT", (origem, esperado) => {
    const { item: linha } = primeiroItem(taxGroup(), {
      itemOverrides: comOrigem(taxGroup(), origem),
      ibptRates: [TAXA_SP],
    });

    expect(linha.valor_total_tributos).toBe(esperado);
  });

  it.each([
    ["0", 304.5],
    ["4", 304.5],
    ["5", 304.5],
  ])("origem %s é nacional para o IBPT", (origem, esperado) => {
    // O `5` é o caso que exigiu critério: "nacional com Conteúdo de Importação
    // **até 40%**" pode estar dos dois lados dos 20% do Decreto 8.264, art. 3º,
    // §2º, e a origem não diz de qual. Fica no caminho nacional porque o
    // cadastro afirma "nacional" e o gatilho do decreto é afirmativo. Repare
    // que este conjunto **não** é o dos 4% da Resolução 13/2012, que exclui o
    // `6` e o `7` — são perguntas diferentes.
    const { item: linha } = primeiroItem(taxGroup(), {
      itemOverrides: comOrigem(taxGroup(), origem),
      ibptRates: [TAXA_SP],
    });

    expect(linha.valor_total_tributos).toBe(esperado);
  });

  it("origem ausente cai no caminho nacional — conservador, como a alíquota interestadual", () => {
    const { item: linha } = primeiroItem(taxGroup(), {
      itemOverrides: comOrigem(taxGroup(), ""),
      ibptRates: [TAXA_SP],
    });

    expect(linha.valor_total_tributos).toBe(304.5);
  });

  it("a UF que resolve o cadastro é a da FILIAL, não a do cliente", () => {
    // Venda SP → RJ com cadastro só para SP. Se o motor usasse a UF de destino
    // (como `mva_rules` faz), esta linha não seria encontrada e o campo sumiria.
    // A tabela do IBPT é baixada por UF da empresa emitente.
    const { item: linha } = primeiroItem(taxGroup(), {
      regra: REGRA_RJ,
      ibptRates: [TAXA_SP],
    });

    expect(linha.valor_total_tributos).toBe(304.5);
  });

  it("cadastro de outra UF de origem não é usado", () => {
    // A mesma venda, mas a filial agora é de MG: a linha de SP não vale, e não
    // há coringa. Campo ausente, emissão normal.
    const { item: linha } = primeiroItem(taxGroup(), { regra: REGRA_MG, ibptRates: [TAXA_SP] });

    expect(linha.valor_total_tributos).toBeUndefined();
  });

  it("arredonda a centavos, parcela a parcela", () => {
    // Item de R$ 33,33 com federal 12,45%: 4,1495... → 4,15
    //                       estadual 18,00%: 5,9994  → 6,00
    //                                                 ------
    //                                                  10,15
    const { item: linha } = primeiroItem(taxGroup(), {
      itemOverrides: { quantity: 1, unitPrice: 33.33, discountAmount: 0, totalAmount: 33.33 },
      ibptRates: [TAXA_SP],
    });

    expect(linha.valor_total_tributos).toBe(10.15);
  });

  it("percentuais zerados declaram zero, não campo ausente", () => {
    // Zero cadastrado é uma afirmação ("este NCM não tem carga a informar"), e
    // é diferente de não haver linha. Mesmo critério que B5 usou para a
    // alíquota ad rem de zero.
    const zerada: IbptRateRow = {
      ...TAXA_SP,
      aliquotaNacionalFederal: 0,
      aliquotaImportadoFederal: 0,
      aliquotaEstadual: 0,
      aliquotaMunicipal: 0,
    };
    const { item: linha } = primeiroItem(taxGroup(), { ibptRates: [zerada] });

    expect(linha.valor_total_tributos).toBe(0);
  });
});

describe("vTotTrib — a inversão de filosofia: campo ausente, nunca recusa", () => {
  it("NCM sem linha cadastrada emite normalmente, sem o campo", () => {
    const { item: linha, payload } = primeiroItem(taxGroup(), {
      itemOverrides: comNcm(taxGroup(), NCM_SEM_CADASTRO),
      ibptRates: [TAXA_SP],
    });

    expect(linha.valor_total_tributos).toBeUndefined();
    // E o resto do item continua inteiro — o ICMS foi calculado como sempre.
    expect(linha.icms_valor).toBe(180);
    expect(payload.valor_total_tributos).toBeUndefined();
  });

  it("cadastro inteiramente vazio emite normalmente — o estado de quem ainda não cadastrou", () => {
    const resultado = buildNfePayloadFromSale(sale([item(taxGroup())]), [REGRA_INTERNA], [], []);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.payload.items[0].valor_total_tributos).toBeUndefined();
    expect(resultado.payload.valor_total_tributos).toBeUndefined();
    expect(resultado.payload.informacoes_adicionais_contribuinte).toBe("Venda V-0001");
  });

  it("um item cadastrado e outro não: o cadastrado declara, o outro não, e a nota sai", () => {
    const venda = sale([
      item(taxGroup()),
      item(taxGroup(), comNcm(taxGroup(), NCM_SEM_CADASTRO)),
    ]);
    const resultado = buildNfePayloadFromSale(venda, [REGRA_INTERNA], [], [TAXA_SP]);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.payload.items[0].valor_total_tributos).toBe(304.5);
    expect(resultado.payload.items[1].valor_total_tributos).toBeUndefined();
    // O total soma só quem declarou — é a mesma convenção de `totalDeclarado`.
    expect(resultado.payload.valor_total_tributos).toBe(304.5);
  });

  it("empate de cadastro faz o campo sumir, e não recusa a emissão", () => {
    const gemea: IbptRateRow = { ...TAXA_SP, id: "ibpt-sp-2" };
    const resultado = buildNfePayloadFromSale(sale([item(taxGroup())]), [REGRA_INTERNA], [], [TAXA_SP, gemea]);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.payload.items[0].valor_total_tributos).toBeUndefined();
  });
});

describe("vTotTrib — o total do cabeçalho (rejeição 685)", () => {
  it("o total é exatamente a soma dos itens", () => {
    // A regra de validação não tem tolerância: `vTotTrib` do `total` (W16a)
    // diferente da soma dos `vTotTrib` dos itens (M02) é rejeição 685.
    const venda = sale([item(taxGroup()), item(taxGroup())]);
    const resultado = buildNfePayloadFromSale(venda, [REGRA_INTERNA], [], [TAXA_SP]);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    const soma = resultado.payload.items.reduce((total, linha) => total + (linha.valor_total_tributos ?? 0), 0);
    expect(resultado.payload.valor_total_tributos).toBe(soma);
    expect(resultado.payload.valor_total_tributos).toBe(609);
  });

  it("o total é a soma dos valores JÁ arredondados dos itens", () => {
    // Dois itens de 33,33 declaram 10,15 cada (ver o teste de arredondamento).
    // 10,15 + 10,15 = 20,30. Recalcular sobre 66,66 daria 20,29 — e seria
    // rejeição 685, porque o item já foi para o XML com 10,15.
    const linha = { quantity: 1, unitPrice: 33.33, discountAmount: 0, totalAmount: 33.33 };
    const venda = sale([item(taxGroup(), linha), item(taxGroup(), linha)]);
    const resultado = buildNfePayloadFromSale(venda, [REGRA_INTERNA], [], [TAXA_SP]);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.payload.valor_total_tributos).toBe(20.3);
  });

  it("o vTotTrib NÃO entra no valor_total da nota", () => {
    // Ao contrário do IPI e do ICMS-ST, e pelo mesmo motivo do DIFAL: a regra
    // W16-10 não o lista entre as parcelas de `vNF`. Ele é estimativa do que já
    // está no preço (Decreto 8.264/2014, art. 6º), não imposto acrescido.
    const { payload } = primeiroItem(taxGroup(), { ibptRates: [TAXA_SP] });

    expect(payload.valor_total_tributos).toBe(304.5);
    expect(payload.valor_total).toBe(1000);
  });

  it("convive com o ICMS-ST: o ST soma no valor_total, o vTotTrib não", () => {
    // CST 10 com MVA cadastrada — os dois campos saem no mesmo item, e cada um
    // se comporta como o seu leiaute manda. É o teste que separa "imposto por
    // fora" (entra em `vNF`) de "estimativa informativa" (não entra).
    const resultado = buildNfePayloadFromSale(
      sale([item(taxGroup({ cstIcms: "10" }))]),
      [REGRA_INTERNA],
      [MVA],
      [TAXA_SP],
    );

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    const linha = resultado.payload.items[0];
    expect(linha.valor_total_tributos).toBe(304.5);
    expect(linha.icms_valor_st).toBeGreaterThan(0);
    // O ST entrou no total da nota; o vTotTrib, não.
    expect(resultado.payload.valor_total).toBe(1000 + resultado.payload.icms_valor_total_st!);
    expect(resultado.payload.valor_total_tributos).toBe(304.5);
  });
});

describe("Informações Complementares — os três resultados segregados do Decreto 8.264", () => {
  it("escreve o total, as três parcelas e a fonte", () => {
    // Decreto 8.264/2014, art. 2º: a informação "constará de três resultados
    // segregados para cada ente tributante", em campo próprio **ou** nas
    // Informações Complementares. O `vTotTrib` do leiaute é um número só —
    // não há onde escrever as três parcelas separadas no XML.
    const { payload } = primeiroItem(taxGroup(), { ibptRates: [TAXA_COM_MUNICIPAL] });

    // Federal 124,50 + Estadual 180,00 + Municipal 25,00 = 329,50
    expect(payload.informacoes_adicionais_contribuinte).toBe(
      "Venda V-0001. Trib aprox R$ 329,50 (Federal R$ 124,50, Estadual R$ 180,00, " +
        "Municipal R$ 25,00) - Lei 12.741/2012. Fonte: IBPT 26.2.A.",
    );
  });

  it("as três parcelas somam exatamente o vTotTrib do total", () => {
    const { payload } = primeiroItem(taxGroup(), { ibptRates: [TAXA_COM_MUNICIPAL] });

    expect(payload.valor_total_tributos).toBe(329.5);
    expect(payload.informacoes_adicionais_contribuinte).toContain("Trib aprox R$ 329,50");
  });

  it("sem fonte cadastrada, o trecho da fonte não aparece — não se inventa 'IBPT'", () => {
    // A citação da fonte não é exigida por lei nenhuma: nem a Lei 12.741/2012
    // nem o Decreto 8.264/2014 a mandam constar do documento fiscal. É prática
    // de mercado, e o cadastro pode deixá-la em branco.
    const semFonte: IbptRateRow = { ...TAXA_SP, fonte: null, versao: null };
    const { payload } = primeiroItem(taxGroup(), { ibptRates: [semFonte] });

    expect(payload.informacoes_adicionais_contribuinte).toBe(
      "Venda V-0001. Trib aprox R$ 304,50 (Federal R$ 124,50, Estadual R$ 180,00, " +
        "Municipal R$ 0,00) - Lei 12.741/2012.",
    );
  });

  it("com fonte e sem versão, cita só a fonte", () => {
    const semVersao: IbptRateRow = { ...TAXA_SP, versao: null };
    const { payload } = primeiroItem(taxGroup(), { ibptRates: [semVersao] });

    expect(payload.informacoes_adicionais_contribuinte).toContain("Fonte: IBPT.");
  });

  it("versão sem fonte não vira fonte — o trecho inteiro some", () => {
    // "Fonte: 26.2.A" leria como se a versão fosse quem publicou os números.
    const soVersao: IbptRateRow = { ...TAXA_SP, fonte: null };
    const { payload } = primeiroItem(taxGroup(), { ibptRates: [soVersao] });

    expect(payload.informacoes_adicionais_contribuinte).not.toContain("Fonte");
    expect(payload.informacoes_adicionais_contribuinte).toContain("Lei 12.741/2012.");
  });

  it("sem vTotTrib nenhum, o texto não aparece — nem meia frase sobre tributos", () => {
    const { payload } = primeiroItem(taxGroup(), { ibptRates: [] });

    expect(payload.informacoes_adicionais_contribuinte).toBe("Venda V-0001");
  });
});

describe("Escopo por documento — quem declara vTotTrib e quem não", () => {
  it("NF-e a consumidor final declara", () => {
    const { item: linha } = primeiroItem(taxGroup(), { destinatario: CPF, ibptRates: [TAXA_SP] });

    expect(linha.valor_total_tributos).toBe(304.5);
  });

  it("NF-e a contribuinte (consumidor_final = 0) NÃO declara", () => {
    // A Lei 12.741 alcança a "venda ao consumidor" (art. 1º, caput). Venda a
    // contribuinte que vai revender não é essa venda — e a Focus NFe chega à
    // mesma conclusão por conta própria: ela deixa de calcular o campo sozinha
    // exatamente quando `consumidor_final = 0`.
    const venda = sale([item(taxGroup())], { destinatario: CNPJ_CONTRIBUINTE });
    const resultado = buildNfePayloadFromSale(venda, [REGRA_INTERNA_CONTRIBUINTE], [], [TAXA_SP]);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.payload.consumidor_final).toBe(0);
    expect(resultado.payload.items[0].valor_total_tributos).toBeUndefined();
    expect(resultado.payload.valor_total_tributos).toBeUndefined();
    expect(resultado.payload.informacoes_adicionais_contribuinte).toBe("Venda V-0001");
  });

  it("NFC-e declara sempre — é onde a lei mais importa na prática", () => {
    const resultado = buildNfcePayloadFromSale(sale([item(taxGroup())]), [REGRA_NFCE], [], [TAXA_SP]);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.payload.items[0].valor_total_tributos).toBe(304.5);
    expect(resultado.payload.valor_total_tributos).toBe(304.5);
    expect(resultado.payload.informacoes_adicionais_contribuinte).toContain("Trib aprox R$ 304,50");
    // E continua sem somar no total, como na NF-e.
    expect(resultado.payload.valor_total).toBe(1000);
  });

  it("devolução NÃO declara — não é venda ao consumidor", () => {
    // Aqui, ao contrário do DIFAL, **não é regra de validação** que decide: o
    // `vTotTrib` é opcional em qualquer documento e declará-lo não seria
    // rejeitado. É o alcance da lei — nota de entrada que desfaz uma venda não
    // é "venda ao consumidor". A Focus concorda sozinha: ela para de calcular
    // o campo quando `natureza_operacao` contém DEVOLUCAO.
    const devolucao: SaleReturnForInvoice = {
      code: "D-0001",
      saleCode: "V-0001",
      issueDate: "2026-09-05",
      totalAmount: 1000,
      discountAmount: 0,
      originalChave: null,
      branch: sale([item(taxGroup())]).branch,
      contact: sale([item(taxGroup())]).contact,
      items: [item(taxGroup())],
    };
    const resultado = buildReturnNfePayload(devolucao, [REGRA_DEVOLUCAO], [], [TAXA_SP]);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.payload.items[0].valor_total_tributos).toBeUndefined();
    expect(resultado.payload.valor_total_tributos).toBeUndefined();
    expect(resultado.payload.informacoes_adicionais_contribuinte).toBe(
      "Devolução D-0001 referente à venda V-0001",
    );
  });
});

describe("B9 é aditivo — regressões dos impostos que ele não toca", () => {
  it("nenhuma outra grandeza do item muda com o cadastro do IBPT presente", () => {
    const semIbpt = primeiroItem(taxGroup(), { ibptRates: [] }).item;
    const comIbpt = primeiroItem(taxGroup(), { ibptRates: [TAXA_SP] }).item;

    const { valor_total_tributos: _semCampo, ...restoSem } = semIbpt;
    const { valor_total_tributos: _comCampo, ...restoCom } = comIbpt;
    expect(restoCom).toEqual(restoSem);
  });

  it("nenhum total do cabeçalho muda, exceto o vTotTrib e o texto adicional", () => {
    const semIbpt = primeiroItem(taxGroup(), { ibptRates: [] }).payload;
    const comIbpt = primeiroItem(taxGroup(), { ibptRates: [TAXA_SP] }).payload;

    const {
      valor_total_tributos: _semCampo,
      informacoes_adicionais_contribuinte: _semTexto,
      items: _semItens,
      ...restoSem
    } = semIbpt;
    const {
      valor_total_tributos: _comCampo,
      informacoes_adicionais_contribuinte: _comTexto,
      items: _comItens,
      ...restoCom
    } = comIbpt;
    expect(restoCom).toEqual(restoSem);
  });

  it("o vTotTrib não depende do CST — item isento também declara", () => {
    // Decisão registrada: o Decreto 8.264, art. 3º, §1º, manda não computar o
    // que foi eximido por isenção, mas a tabela do IBPT publica **um**
    // percentual por NCM, sem dimensão de CST, e desdobrar qual das três
    // parcelas zerar por código exigiria um mapa que nenhuma fonte publica.
    // Fica como aproximação conhecida, e o teste fixa o comportamento.
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: "40" }), { ibptRates: [TAXA_SP] });

    expect(linha.icms_valor).toBeUndefined();
    expect(linha.valor_total_tributos).toBe(304.5);
  });
});
