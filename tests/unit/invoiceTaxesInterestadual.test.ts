import { describe, expect, it } from "vitest";

import {
  buildNfcePayloadFromSale,
  buildNfePayloadFromSale,
  type SaleForInvoice,
  type SaleForInvoiceItem,
} from "@fiscal-core/invoiceMapping.ts";
import type { MvaRuleRow } from "@fiscal-core/mvaRules.ts";
import type { TaxGroup } from "@fiscal-core/taxGroups.ts";
import type { TaxRuleRow } from "@fiscal-core/taxRules.ts";

/**
 * Bateria da alíquota interestadual no ICMS **próprio** (correção de
 * 04/09/2026).
 *
 * Arquivo separado pelo mesmo critério que já separou o próprio (B1), o ST
 * (B2), o ad rem (B5) e o Simples (B8): é uma dimensão própria do mesmo item.
 * O que ela defende é a lacuna que B1, B2 e B8 registraram e nenhuma corrigiu —
 * o `vICMS` de toda venda saía pela alíquota **interna** cadastrada no grupo,
 * inclusive quando a operação cruzava a fronteira do estado.
 *
 * A Resolução do Senado 22/1989 fixa 7% (Sul/Sudeste → Norte/Nordeste/
 * Centro-Oeste e ES) e 12% (o resto) para a operação interestadual, e a
 * 13/2012 fixa 4% para mercadoria importada. A tabela em si já tinha teste
 * desde B2 (`invoiceTaxesSt.test.ts`, `aliquotaInterestadual`); o que se prova
 * aqui é que ela chega ao `pICMS`/`vICMS` do item.
 *
 * As contas continuam escritas por extenso nos comentários, pelo mesmo motivo
 * de B1: um teste que compara com `taxAmount(...)` reimplementa o código que
 * deveria estar conferindo.
 */

/** SP → SP: a operação interna, que a correção **não** pode ter mudado. */
const REGRA_INTERNA: TaxRuleRow = {
  id: "venda-interna",
  regime: "3",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "SP",
  tipoCliente: "contribuinte",
  cfop: "5102",
};

/** SP → BA: Sudeste para Nordeste, a faixa dos 7%. */
const REGRA_BA: TaxRuleRow = {
  id: "venda-ba",
  regime: "3",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "BA",
  tipoCliente: "contribuinte",
  cfop: "6102",
};

/** SP → RJ: Sudeste para Sudeste, a faixa dos 12%. */
const REGRA_RJ: TaxRuleRow = {
  id: "venda-rj",
  regime: "3",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "RJ",
  tipoCliente: "contribuinte",
  cfop: "6102",
};

/** A mesma SP → BA, mas de quem emite no Simples Nacional (CRT 1). */
const REGRA_SIMPLES_BA: TaxRuleRow = {
  id: "venda-simples-ba",
  regime: "1",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "BA",
  tipoCliente: "contribuinte",
  cfop: "6102",
};

/** NFC-e é sempre consumidor final, e sempre interna — ver `buildNfcePayloadFromSale`. */
const REGRA_NFCE: TaxRuleRow = {
  id: "venda-nfce",
  regime: "3",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "SP",
  tipoCliente: "consumidor_final",
  cfop: "5102",
};

const NCM = "22021000";

/** MVA original de 40% para o NCM de teste, em qualquer destino. */
const MVA_CORINGA: MvaRuleRow = {
  id: "mva-coringa",
  ncm: NCM,
  ufDestino: "*",
  mvaOriginal: 40,
  fcpAliquota: null,
};

/** Grupo de CST 00 (tributada integralmente, sem ST) a 18% — a alíquota interna. */
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

/** Override que troca a origem da mercadoria (o que decide os 4% da Resolução 13/2012). */
function comOrigem(group: TaxGroup, origemMercadoria: string): Partial<SaleForInvoiceItem> {
  return { product: { ...item(group).product, origemMercadoria } };
}

const MUNICIPIOS: Record<string, string> = { SP: "São Paulo", BA: "Salvador", RJ: "Rio de Janeiro" };

function sale(items: SaleForInvoiceItem[], ufDestino = "SP", regime = "3"): SaleForInvoice {
  const total = items.reduce((sum, i) => sum + i.totalAmount, 0);
  return {
    code: "V-0001",
    issueDate: "2026-09-04",
    subtotalAmount: total,
    totalAmount: total,
    discountAmount: 0,
    freightAmount: 0,
    branch: {
      cnpj: "00000000000191",
      name: "Facilite Testes LTDA",
      inscricaoEstadual: "123456789",
      regimeTributario: regime,
      // Os CSOSN desta bateria (`900`) não declaram crédito de Simples, mas a
      // fixture carrega a alíquota como as demais baterias fazem desde B8.
      aliquotaCreditoIcmsSimples: 1.36,
      logradouro: "Rua Um",
      numero: "10",
      bairro: "Centro",
      municipio: "São Paulo",
      uf: "SP",
      cep: "01001000",
    },
    contact: {
      name: "Cliente Contribuinte LTDA",
      document: "11222333000181",
      inscricaoEstadual: "987654321",
      indicadorIe: "1",
      logradouro: "Rua Dois",
      numero: "20",
      bairro: "Centro",
      municipio: MUNICIPIOS[ufDestino] ?? "Salvador",
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
    mvaRules?: MvaRuleRow[];
    regra?: TaxRuleRow;
    ufDestino?: string;
    regime?: string;
  } = {},
) {
  const regra = options.regra ?? REGRA_INTERNA;
  const vendaMontada = sale(
    [item(group, options.itemOverrides)],
    options.ufDestino ?? regra.ufDestino,
    options.regime ?? regra.regime,
  );
  const resultado = buildNfePayloadFromSale(vendaMontada, [regra], options.mvaRules ?? [MVA_CORINGA]);
  if (!resultado.ok) throw new Error(`Emissão recusada: ${resultado.errors.join(" | ")}`);
  return { item: resultado.payload.items[0], payload: resultado.payload };
}

describe("ICMS próprio — a alíquota da operação interestadual", () => {
  it("destaca pela alíquota de 7% numa venda SP → BA (Resolução 22/89)", () => {
    // Este é o caso que a correção existe para arrumar. Até 03/09/2026 o item
    // destacava 1000 × 18% = 180,00 — a interna do grupo —, o que é imposto a
    // maior numa nota autorizada, em **toda** venda interestadual.
    //   próprio = 1000 × 7% = 70,00
    const { item: linha } = primeiroItem(taxGroup(), { regra: REGRA_BA });

    expect(linha.icms_aliquota).toBe(7);
    expect(linha.icms_base_calculo).toBe(1000);
    expect(linha.icms_valor).toBe(70);
  });

  it("destaca pela alíquota de 12% numa venda SP → RJ (Sudeste para Sudeste)", () => {
    //   próprio = 1000 × 12% = 120,00
    const { item: linha } = primeiroItem(taxGroup(), { regra: REGRA_RJ });

    expect(linha.icms_aliquota).toBe(12);
    expect(linha.icms_valor).toBe(120);
  });

  it("destaca pela alíquota de 4% quando a mercadoria é importada (Resolução 13/2012)", () => {
    // Quem diz que é o caso é `products.origem_mercadoria`, o mesmo cadastro
    // que B2 já usava para o ajuste da MVA: `1` é importação direta.
    //   próprio = 1000 × 4% = 40,00
    const { item: linha } = primeiroItem(taxGroup(), {
      regra: REGRA_BA,
      itemOverrides: comOrigem(taxGroup(), "1"),
    });

    expect(linha.icms_aliquota).toBe(4);
    expect(linha.icms_valor).toBe(40);
  });

  it("continua usando a alíquota interna do grupo numa operação interna — regressão", () => {
    // A metade que **não** podia mudar: intraestadual sai exatamente como saía
    // antes da correção.
    //   próprio = 1000 × 18% = 180,00
    const { item: linha } = primeiroItem(taxGroup());

    expect(linha.icms_aliquota).toBe(18);
    expect(linha.icms_valor).toBe(180);
  });

  it("aplica a alíquota interestadual sobre a base já reduzida", () => {
    // As duas dimensões compõem: a redução de base (B1) decide a base, a
    // alíquota da operação decide o percentual.
    //   base    = 1000 × (1 − 41,67/100) = 583,30
    //   próprio = 583,30 × 7% = 40,83 (40,831 arredondado)
    const { item: linha } = primeiroItem(taxGroup({ reducaoBaseIcms: 41.67 }), { regra: REGRA_BA });

    expect(linha.icms_base_calculo).toBe(583.3);
    expect(linha.icms_reducao_base_calculo).toBe(41.67);
    expect(linha.icms_aliquota).toBe(7);
    expect(linha.icms_valor).toBe(40.83);
  });

  it("o `pICMS` declarado é o que gerou o `vICMS`, não o cadastrado no grupo", () => {
    // O ponto de schema da correção: `icms_aliquota` vira `pICMS` no XML, e o
    // fisco refaz `vBC × pICMS = vICMS`. Declarar a interna com um valor
    // calculado pela interestadual seria uma nota que não fecha consigo mesma.
    const { item: linha } = primeiroItem(taxGroup(), { regra: REGRA_BA });

    expect(linha.icms_valor).toBe(
      Math.round(linha.icms_base_calculo! * (linha.icms_aliquota! / 100) * 100) / 100,
    );
    expect(linha.icms_aliquota).not.toBe(18);
  });

  it.each(["00", "20", "51", "90"])(
    "vale para o CST %s, que declara próprio sem ST",
    (cst) => {
      // Todos os CST de Regime Normal que passam em `icmsCalculaValorProprio` e
      // não têm ST. O `10` e o `70` (que têm ST) estão logo abaixo.
      const { item: linha } = primeiroItem(taxGroup({ cstIcms: cst }), { regra: REGRA_BA });
      expect(linha.icms_aliquota).toBe(7);
      expect(linha.icms_valor).toBe(70);
    },
  );

  it("os totais da nota acompanham a alíquota efetivamente usada", () => {
    const grupo = taxGroup();
    const resultado = buildNfePayloadFromSale(sale([item(grupo), item(grupo)], "BA"), [REGRA_BA], []);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    // Dois itens de 1000: base 1000 cada, próprio 70 cada.
    expect(resultado.payload.icms_base_calculo).toBe(2000);
    expect(resultado.payload.icms_valor_total).toBe(140);
    // O ICMS próprio é imposto **por dentro**: não entra no `vNF`.
    expect(resultado.payload.valor_total).toBe(2000);
  });
});

describe("o efeito em cascata no ICMS-ST", () => {
  it("CST 10: a dedução do ST cai junto, e o ST sobe na mesma medida", () => {
    // O ST deduz o próprio que o item destaca. Com o próprio menor (70 em vez
    // de 180), a dedução é menor e o **ST fica maior** — o mesmo imposto,
    // repartido corretamente entre as duas linhas.
    //   MVA ajustada = 1,40 × 0,93 / 0,82 − 1 = 58,7805%
    //   base ST = 1000 × 1,587805 = 1587,805 → 1587,80
    //   próprio = 1000 × 7% = 70,00        (era 180,00)
    //   ST      = 1587,80 × 18% − 70,00 = 285,80 − 70,00 = 215,80  (era 105,80)
    const { item: linha, payload } = primeiroItem(taxGroup({ cstIcms: "10" }), { regra: REGRA_BA });

    expect(linha.icms_aliquota).toBe(7);
    expect(linha.icms_valor).toBe(70);
    expect(linha.icms_margem_valor_adicionado_st).toBe(58.7805);
    expect(linha.icms_base_calculo_st).toBe(1587.8);
    expect(linha.icms_valor_st).toBe(215.8);

    // A soma das duas linhas não mudou: 180,00 + 105,80 = 285,80 = 70,00 +
    // 215,80. O que estava errado era a **repartição** — próprio a maior e ST
    // a menos, cada um numa linha diferente do XML.
    expect(linha.icms_valor! + linha.icms_valor_st!).toBe(285.8);
    // O ST é imposto por fora (regra W16-10): 1000 + 215,80.
    expect(payload.valor_total).toBe(1215.8);
  });

  it("CST 70: a base reduzida e a alíquota interestadual compõem no próprio e no ST", () => {
    //   base própria = 1000 × (1 − 41,67/100) = 583,30
    //   próprio      = 583,30 × 7% = 40,83
    //   base ST      = 583,30 × 1,587805 = 926,17
    //   ST           = 926,17 × 18% − 40,83 = 166,71 − 40,83 = 125,88
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: "70", reducaoBaseIcms: 41.67 }), {
      regra: REGRA_BA,
    });

    expect(linha.icms_base_calculo).toBe(583.3);
    expect(linha.icms_valor).toBe(40.83);
    expect(linha.icms_base_calculo_st).toBe(926.17);
    expect(linha.icms_valor_st).toBe(125.88);
  });

  it("a alíquota do ST continua sendo a interna do destino, não a interestadual", () => {
    // Fora do escopo da correção, e correto pela lei: o ST simula o imposto
    // devido no estado de destino, então usa a alíquota interna de lá
    // (aproximada por `group.aliquotaIcms` desde B2 — limitação registrada
    // naquela entrada). Só a **dedução** do próprio muda com o trajeto.
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: "10" }), { regra: REGRA_BA });

    expect(linha.icms_aliquota_st).toBe(18);
  });

  it("CST 10 interno: dedução e ST seguem exatamente como em B2 — regressão", () => {
    //   próprio = 1000 × 18% = 180,00; base ST = 1000 × 1,40 = 1400,00
    //   ST      = 1400 × 18% − 180,00 = 72,00
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: "10" }));

    expect(linha.icms_valor).toBe(180);
    expect(linha.icms_margem_valor_adicionado_st).toBe(40);
    expect(linha.icms_valor_st).toBe(72);
  });
});

describe("o que a correção deliberadamente não alcança", () => {
  it("CSOSN 900 emitido por filial do Simples: continua na alíquota interna", () => {
    // O gate da correção é o regime de quem emite: o optante recolhe o ICMS
    // pelo DAS, sobre a receita bruta do mês, e não por alíquota-por-operação.
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: null, csosn: "900" }), {
      regra: REGRA_SIMPLES_BA,
    });

    expect(linha.icms_situacao_tributaria).toBe("900");
    expect(linha.icms_aliquota).toBe(18);
    expect(linha.icms_valor).toBe(180);
  });

  it("CSOSN 900 num grupo sem CST, com filial de Regime Normal: também fica fora", () => {
    // O caminho que o gate de regime sozinho **não** cobriria:
    // `resolveIcmsSituacaoTributaria` cai no CSOSN quando a filial é CRT 3 e o
    // grupo não tem CST de ICMS. É para este caso que existe
    // `icmsProprioIgnoraAliquotaInterestadual` — se o `900` deve ou não
    // distinguir interna de interestadual é pergunta legal própria, e esta
    // correção não a decide (mesmo critério de B2 e B8 com o `900`).
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: null, csosn: "900" }), {
      regra: REGRA_BA,
      regime: "3",
    });

    expect(linha.icms_situacao_tributaria).toBe("900");
    expect(linha.icms_aliquota).toBe(18);
    expect(linha.icms_valor).toBe(180);
  });

  it("NFC-e nunca é interestadual, mesmo com o cliente de outro estado", () => {
    // Checagem de sanidade, não correção: `buildNfcePayloadFromSale` força
    // `ufDestino = branch.uf`, então a venda de balcão é interna por
    // construção — o endereço do cliente não a torna interestadual.
    const resultado = buildNfcePayloadFromSale(sale([item(taxGroup())], "BA"), [REGRA_NFCE], []);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    const linha = resultado.payload.items[0];
    expect(linha.icms_aliquota).toBe(18);
    expect(linha.icms_valor).toBe(180);
  });
});
