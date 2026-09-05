import { describe, expect, it } from "vitest";

import {
  buildNfcePayloadFromSale,
  buildNfePayloadFromSale,
  buildReturnNfePayload,
  type SaleForInvoice,
  type SaleForInvoiceItem,
  type SaleReturnForInvoice,
} from "@fiscal-core/invoiceMapping.ts";
import {
  aliquotaEfetivaIbsCbs,
  resolveAliquotasPadraoIbsCbs,
  resolveIbsCbs,
} from "@fiscal-core/ibsCbs.ts";
import type { TaxGroup } from "@fiscal-core/taxGroups.ts";
import type { TaxRuleRow } from "@fiscal-core/taxRules.ts";

/**
 * Bateria do **IBS e da CBS** — o grupo `UB` da NT 2025.002-RTC no ano de teste
 * da Reforma Tributária (B10, 05/09/2026).
 *
 * Arquivo separado pelo critério de sempre, e o que ela defende é o inverso
 * exato da bateria vizinha (`invoiceIbpt.test.ts`): lá a falta de cadastro
 * deixa o campo de fora e a nota sai; aqui ela **recusa a emissão**, porque
 * desde 03/08/2026 a regra `UB12-10` rejeita (1115) a NF-e/NFC-e de Regime
 * Normal sem este grupo. Boa parte dos testes existe para fixar essa recusa
 * caso a caso.
 *
 * As contas continuam escritas por extenso nos comentários, pelo mesmo motivo
 * de B1: um teste que compara com `taxAmount(...)` reimplementa o código que
 * deveria estar conferindo.
 *
 * As alíquotas do ano são as dos arts. 343 e 346 da LC 214/2025, conferidas
 * pelas regras `UB18-10` (0,1% estadual), `UB37-10` (0% municipal) e `UB56-10`
 * (0,9% de CBS).
 */

const REGRA_INTERNA: TaxRuleRow = {
  id: "venda-interna",
  regime: "3",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "SP",
  tipoCliente: "consumidor_final",
  cfop: "5102",
};

/** A mesma venda saindo de uma filial optante pelo Simples Nacional (CRT 1). */
const REGRA_SIMPLES: TaxRuleRow = { ...REGRA_INTERNA, id: "venda-simples", regime: "1" };

const REGRA_DEVOLUCAO: TaxRuleRow = {
  id: "devolucao-interna",
  regime: "3",
  naturezaOperacao: "devolucao",
  ufOrigem: "SP",
  ufDestino: "SP",
  tipoCliente: "consumidor_final",
  cfop: "1202",
};

/**
 * As alíquotas nominais de 2026, repetidas aqui como número literal de
 * propósito: se o motor mudar de opinião sobre elas, é aqui que tem de doer.
 */
const P_IBS_UF = 0.1;
const P_IBS_MUN = 0;
const P_CBS = 0.9;

/** Grupo tributário de CST 00 (ICMS 18%) com o IBS/CBS de tributação integral. */
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
    // CST 000 / cClassTrib 000001 — "Situações tributadas integralmente pelo
    // IBS e CBS", o par que a imensa maioria do varejo usa.
    cstIbsCbs: "000",
    cclasstrib: "000001",
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
      ncm: "22021000",
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

function sale(
  items: SaleForInvoiceItem[],
  options: { regime?: string; issueDate?: string } = {},
): SaleForInvoice {
  const total = items.reduce((soma, linha) => soma + linha.totalAmount, 0);
  return {
    code: "V-0001",
    issueDate: options.issueDate ?? "2026-09-05",
    subtotalAmount: total,
    totalAmount: total,
    discountAmount: 0,
    freightAmount: 0,
    branch: {
      cnpj: "00000000000191",
      name: "Facilite Testes LTDA",
      inscricaoEstadual: "123456789",
      regimeTributario: options.regime ?? "3",
      aliquotaCreditoIcmsSimples: 1.36,
      logradouro: "Rua Um",
      numero: "10",
      bairro: "Centro",
      municipio: "São Paulo",
      uf: "SP",
      cep: "01001000",
    },
    contact: {
      name: "Cliente de teste",
      document: "39053344705",
      inscricaoEstadual: null,
      indicadorIe: null,
      regimeTributario: null,
      logradouro: "Rua Dois",
      numero: "20",
      bairro: "Centro",
      municipio: "São Paulo",
      uf: "SP",
      cep: "01002000",
      phone: null,
    },
    items,
    payments: [],
  };
}

/** Emite uma NF-e e devolve o primeiro item, falhando alto se a montagem recusar. */
function primeiroItem(group: TaxGroup, options: { issueDate?: string } = {}) {
  const resultado = buildNfePayloadFromSale(sale([item(group)], options), [REGRA_INTERNA]);
  if (!resultado.ok) throw new Error(`Emissão recusada: ${resultado.errors.join(" | ")}`);
  return { item: resultado.payload.items[0], payload: resultado.payload };
}

/** Emite e devolve os erros, falhando alto se a montagem **não** recusar. */
function errosDaEmissao(group: TaxGroup, options: { issueDate?: string } = {}): string[] {
  const resultado = buildNfePayloadFromSale(sale([item(group)], options), [REGRA_INTERNA]);
  if (resultado.ok) throw new Error("Esperava recusa, mas a emissão passou.");
  return resultado.errors;
}

describe("resolveAliquotasPadraoIbsCbs — as duas dimensões do documento", () => {
  it("2026 e Regime Normal declaram, com 0,1% estadual, 0% municipal e 0,9% de CBS", () => {
    const resolucao = resolveAliquotasPadraoIbsCbs("2026-09-05", "3");

    expect(resolucao.situacao).toBe("declara");
    if (resolucao.situacao !== "declara") return;
    expect(resolucao.aliquotas).toEqual({ ibsUf: 0.1, ibsMun: 0, cbs: 0.9 });
  });

  it("2025 também declara — as regras UB18-10/UB37-10/UB56-10 citam 'o ano de 2025 e 2026'", () => {
    const resolucao = resolveAliquotasPadraoIbsCbs("2025-12-31", "3");

    expect(resolucao.situacao).toBe("declara");
  });

  it.each(["1", "2", "4"])(
    "CRT %s (Simples Nacional / MEI) não declara — art. 348, III, 'c', da LC 214/2025",
    (regime) => {
      expect(resolveAliquotasPadraoIbsCbs("2026-09-05", regime).situacao).toBe("simples_nacional");
    },
  );

  it("documento anterior a 2025 não declara, e isso não é erro — o grupo nem existia no leiaute", () => {
    expect(resolveAliquotasPadraoIbsCbs("2024-12-31", "3").situacao).toBe("anterior_ao_grupo");
  });

  it("2027 recusa: o art. 344 dá o IBS (0,05% + 0,05%), mas a CBS depende de resolução do Senado", () => {
    const resolucao = resolveAliquotasPadraoIbsCbs("2027-01-04", "3");

    expect(resolucao.situacao).toBe("sem_aliquota_publicada");
    if (resolucao.situacao !== "sem_aliquota_publicada") return;
    expect(resolucao.reason).toContain("2027");
    expect(resolucao.reason).toContain("art. 347");
  });
});

describe("aliquotaEfetivaIbsCbs — a conta da UB28-10", () => {
  it("redução de 60% sobre 0,1% dá 0,04% — 0,1 × (1 − 0,6)", () => {
    expect(aliquotaEfetivaIbsCbs(0.1, 60)).toBe(0.04);
  });

  it("redução de 60% sobre 0,9% dá 0,36% — 0,9 × 0,4", () => {
    expect(aliquotaEfetivaIbsCbs(0.9, 60)).toBe(0.36);
  });

  it("redução de 100% zera a alíquota", () => {
    expect(aliquotaEfetivaIbsCbs(0.9, 100)).toBe(0);
  });

  it("redução de zero devolve a alíquota inteira", () => {
    expect(aliquotaEfetivaIbsCbs(0.1, 0)).toBe(0.1);
  });

  it("arredonda na quarta casa decimal, como a observação da UB28-10 manda", () => {
    // 0,9 × (1 − 0,3/100 × 100)… o caso real é a redução de 30%: 0,9 × 0,7 = 0,63.
    expect(aliquotaEfetivaIbsCbs(0.9, 30)).toBe(0.63);
    // Um caso que só fecha com arredondamento: 0,1 × (1 − 0,7) = 0,03 (e não 0,030000000000000006).
    expect(aliquotaEfetivaIbsCbs(0.1, 70)).toBe(0.03);
  });
});

describe("resolveIbsCbs — o cadastro isolado, e as recusas da tabela oficial", () => {
  const aliquotas = { ibsUf: P_IBS_UF, ibsMun: P_IBS_MUN, cbs: P_CBS };
  const entrada = { nomeDoGrupo: "Tributada 18%", aliquotas, modelo: "55" as const };

  it("CST 000 com cClassTrib 000001 declara o grupo, com as três alíquotas nominais", () => {
    const resolucao = resolveIbsCbs({ ...entrada, cst: "000", cclasstrib: "000001" });

    expect(resolucao.ok).toBe(true);
    if (!resolucao.ok) return;
    expect(resolucao.declarado.declaraGrupo).toBe(true);
    expect(resolucao.declarado.aliquotaIbsUf).toBe(0.1);
    expect(resolucao.declarado.aliquotaIbsMun).toBe(0);
    expect(resolucao.declarado.aliquotaCbs).toBe(0.9);
    // CST 000 tem `ind_gRed = 0`: mandar `gRed` nele é a rejeição 1032.
    expect(resolucao.declarado.reducaoIbs).toBeUndefined();
    expect(resolucao.declarado.aliquotaEfetivaIbsUf).toBeUndefined();
  });

  it("CST 200 traz a redução do cClassTrib nos três grupos — inclusive o municipal, de alíquota zero", () => {
    // 200034 — "Fornecimento dos alimentos destinados ao consumo humano
    // (Anexo VII)", redução de 60% no IBS e na CBS.
    const resolucao = resolveIbsCbs({ ...entrada, cst: "200", cclasstrib: "200034" });

    expect(resolucao.ok).toBe(true);
    if (!resolucao.ok) return;
    expect(resolucao.declarado.reducaoIbs).toBe(60);
    expect(resolucao.declarado.reducaoCbs).toBe(60);
    expect(resolucao.declarado.aliquotaEfetivaIbsUf).toBe(0.04);
    // A `UB45-20` exige o `gRed` municipal mesmo com `pIBSMun = 0` — a versão
    // 1.34 da NT desabilitou a regra que dispensava alíquota zero.
    expect(resolucao.declarado.aliquotaEfetivaIbsMun).toBe(0);
    expect(resolucao.declarado.aliquotaEfetivaCbs).toBe(0.36);
  });

  it("CST 410 (imunidade) declara só CST e cClassTrib — `ind_gIBSCBS = 0`", () => {
    const resolucao = resolveIbsCbs({ ...entrada, cst: "410", cclasstrib: "410001" });

    expect(resolucao.ok).toBe(true);
    if (!resolucao.ok) return;
    expect(resolucao.declarado.declaraGrupo).toBe(false);
    expect(resolucao.declarado.situacaoTributaria).toBe("410");
    expect(resolucao.declarado.classificacaoTributaria).toBe("410001");
    expect(resolucao.declarado.aliquotaIbsUf).toBeUndefined();
  });

  it("CST vazio recusa citando a rejeição 1115 e o cadastro que resolve", () => {
    const resolucao = resolveIbsCbs({ ...entrada, cst: null, cclasstrib: "000001" });

    expect(resolucao.ok).toBe(false);
    if (resolucao.ok) return;
    expect(resolucao.reason).toContain("1115");
    expect(resolucao.reason).toContain("Grupos tributários");
  });

  it("CST inexistente na tabela oficial recusa (rejeição 1020)", () => {
    const resolucao = resolveIbsCbs({ ...entrada, cst: "999", cclasstrib: "000001" });

    expect(resolucao.ok).toBe(false);
    if (resolucao.ok) return;
    expect(resolucao.reason).toContain("1020");
  });

  it("cClassTrib vazio recusa — ele é obrigatório junto do CST", () => {
    const resolucao = resolveIbsCbs({ ...entrada, cst: "000", cclasstrib: "  " });

    expect(resolucao.ok).toBe(false);
    if (resolucao.ok) return;
    expect(resolucao.reason).toContain("cClassTrib");
  });

  it("cClassTrib inexistente recusa (rejeição 1023)", () => {
    const resolucao = resolveIbsCbs({ ...entrada, cst: "000", cclasstrib: "000999" });

    expect(resolucao.ok).toBe(false);
    if (resolucao.ok) return;
    expect(resolucao.reason).toContain("1023");
  });

  it("cClassTrib de outro CST recusa (rejeição 1024) — o CST são os três primeiros dígitos", () => {
    const resolucao = resolveIbsCbs({ ...entrada, cst: "000", cclasstrib: "200034" });

    expect(resolucao.ok).toBe(false);
    if (resolucao.ok) return;
    expect(resolucao.reason).toContain("1024");
    expect(resolucao.reason).toContain("200");
  });

  it("cClassTrib válido só em NF-e recusa na NFC-e (rejeição 1025)", () => {
    // 410004 — "Exportações de bens e serviços": `indNFe = 1`, `indNFCe = 0`.
    const naNfe = resolveIbsCbs({ ...entrada, cst: "410", cclasstrib: "410004" });
    const naNfce = resolveIbsCbs({ ...entrada, cst: "410", cclasstrib: "410004", modelo: "65" });

    expect(naNfe.ok).toBe(true);
    expect(naNfce.ok).toBe(false);
    if (naNfce.ok) return;
    expect(naNfce.reason).toContain("1025");
    expect(naNfce.reason).toContain("NFC-e");
  });

  it("cClassTrib que não vale em DF-e nenhum destes dois recusa nos dois modelos", () => {
    // 200025 é o **único** código da tabela em que `pRedIBS` (60) difere de
    // `pRedCBS` (100) — e ele não vale nem para NF-e nem para NFC-e, o que é
    // o motivo de as duas colunas não terem teste de divergência no payload.
    for (const modelo of ["55", "65"] as const) {
      const resolucao = resolveIbsCbs({ ...entrada, cst: "200", cclasstrib: "200025", modelo });
      expect(resolucao.ok).toBe(false);
    }
  });

  it("cClassTrib com indicador de Tributação Regular recusa — o gTribRegular não é emitido", () => {
    // 550001 — "Exportações de bens materiais", CST 550 (suspensão).
    const resolucao = resolveIbsCbs({ ...entrada, cst: "550", cclasstrib: "550001" });

    expect(resolucao.ok).toBe(false);
    if (resolucao.ok) return;
    expect(resolucao.reason).toContain("gTribRegular");
  });

  it.each([
    ["620", "620001", "gIBSCBSMono"],
    ["510", "510001", "gDif"],
    ["800", "800001", "gTransfCred"],
    ["810", "810001", "gCredPresIBSZFM"],
    ["811", "811001", "gAjusteCompet"],
  ])("CST %s recusa porque exige o grupo %s, que este motor não monta", (cst, cclasstrib, grupo) => {
    const resolucao = resolveIbsCbs({ ...entrada, cst, cclasstrib });

    expect(resolucao.ok).toBe(false);
    if (resolucao.ok) return;
    expect(resolucao.reason).toContain(grupo);
  });

  it("espaço em volta do código não atrapalha — o cadastro é digitado à mão", () => {
    const resolucao = resolveIbsCbs({ ...entrada, cst: " 000 ", cclasstrib: " 000001 " });

    expect(resolucao.ok).toBe(true);
  });
});

describe("o item da NF-e — a conta do ano de teste", () => {
  it("R$ 1.000,00 com CST 000 declara 0,1% de IBS estadual e 0,9% de CBS", () => {
    const { item: linha } = primeiroItem(taxGroup());

    expect(linha.ibs_cbs_situacao_tributaria).toBe("000");
    expect(linha.ibs_cbs_classificacao_tributaria).toBe("000001");
    // Base única, compartilhada pelos dois tributos.
    expect(linha.ibs_cbs_base_calculo).toBe(1000);
    expect(linha.ibs_uf_aliquota).toBe(P_IBS_UF);
    // 1000 × 0,1 / 100 = 1,00
    expect(linha.ibs_uf_valor).toBe(1);
    expect(linha.ibs_mun_aliquota).toBe(P_IBS_MUN);
    // 1000 × 0 / 100 = 0,00 — zero, e não ausente: o grupo gIBSMun é obrigatório.
    expect(linha.ibs_mun_valor).toBe(0);
    // vIBS = vIBSUF + vIBSMun = 1,00 + 0,00
    expect(linha.ibs_valor_total).toBe(1);
    expect(linha.cbs_aliquota).toBe(P_CBS);
    // 1000 × 0,9 / 100 = 9,00
    expect(linha.cbs_valor).toBe(9);
  });

  it("CST 000 não manda gRed — nem percentual, nem alíquota efetiva", () => {
    const { item: linha } = primeiroItem(taxGroup());

    expect(linha.ibs_uf_percentual_reducao_aliquota).toBeUndefined();
    expect(linha.ibs_uf_aliquota_efetiva).toBeUndefined();
    expect(linha.ibs_mun_percentual_reducao_aliquota).toBeUndefined();
    expect(linha.ibs_mun_aliquota_efetiva).toBeUndefined();
    expect(linha.cbs_percentual_reducao_aliquota).toBeUndefined();
    expect(linha.cbs_aliquota_efetiva).toBeUndefined();
  });

  it("redução de 60% (alimentos do Anexo VII) usa a alíquota efetiva na conta", () => {
    const { item: linha } = primeiroItem(taxGroup({ cstIbsCbs: "200", cclasstrib: "200034" }));

    expect(linha.ibs_uf_aliquota).toBe(0.1);
    expect(linha.ibs_uf_percentual_reducao_aliquota).toBe(60);
    // 0,1 × (1 − 60/100) = 0,04
    expect(linha.ibs_uf_aliquota_efetiva).toBe(0.04);
    // 1000 × 0,04 / 100 = 0,40 — e não 1,00, que é o erro que a rejeição 1041 pega
    expect(linha.ibs_uf_valor).toBe(0.4);
    expect(linha.ibs_valor_total).toBe(0.4);
    expect(linha.cbs_aliquota).toBe(0.9);
    expect(linha.cbs_percentual_reducao_aliquota).toBe(60);
    // 0,9 × 0,4 = 0,36 → 1000 × 0,36 / 100 = 3,60
    expect(linha.cbs_aliquota_efetiva).toBe(0.36);
    expect(linha.cbs_valor).toBe(3.6);
  });

  it("redução de 100% (cesta básica) declara zero, e não campo ausente", () => {
    const { item: linha } = primeiroItem(taxGroup({ cstIbsCbs: "200", cclasstrib: "200003" }));

    expect(linha.ibs_uf_percentual_reducao_aliquota).toBe(100);
    expect(linha.ibs_uf_aliquota_efetiva).toBe(0);
    expect(linha.ibs_uf_valor).toBe(0);
    expect(linha.ibs_valor_total).toBe(0);
    expect(linha.cbs_aliquota_efetiva).toBe(0);
    expect(linha.cbs_valor).toBe(0);
    // A base continua sendo declarada: o que é zero é o imposto, não a operação.
    expect(linha.ibs_cbs_base_calculo).toBe(1000);
  });

  it("CST 410 (imunidade) manda os dois códigos e nada mais — gIBSCBS ali é rejeição 1021", () => {
    const { item: linha } = primeiroItem(taxGroup({ cstIbsCbs: "410", cclasstrib: "410001" }));

    expect(linha.ibs_cbs_situacao_tributaria).toBe("410");
    expect(linha.ibs_cbs_classificacao_tributaria).toBe("410001");
    expect(linha.ibs_cbs_base_calculo).toBeUndefined();
    expect(linha.ibs_uf_aliquota).toBeUndefined();
    expect(linha.ibs_uf_valor).toBeUndefined();
    expect(linha.ibs_mun_valor).toBeUndefined();
    expect(linha.ibs_valor_total).toBeUndefined();
    expect(linha.cbs_aliquota).toBeUndefined();
    expect(linha.cbs_valor).toBeUndefined();
  });
});

describe("a falta de cadastro recusa — a inversão em relação ao vTotTrib de B9", () => {
  it("grupo tributário sem CST de IBS/CBS recusa a emissão, com o item identificado", () => {
    const erros = errosDaEmissao(taxGroup({ cstIbsCbs: null }));

    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain("Item 1");
    expect(erros[0]).toContain("Tributada 18%");
    expect(erros[0]).toContain("1115");
  });

  it("grupo tributário sem cClassTrib recusa do mesmo jeito", () => {
    const erros = errosDaEmissao(taxGroup({ cclasstrib: null }));

    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain("cClassTrib");
  });

  it("recusa também na NFC-e — a UB12-10 vale para os modelos 55 e 65", () => {
    const resultado = buildNfcePayloadFromSale(sale([item(taxGroup({ cstIbsCbs: null }))]), [
      { ...REGRA_INTERNA, id: "venda-nfce" },
    ]);

    expect(resultado.ok).toBe(false);
  });

  it("ano sem alíquota publicada recusa o documento inteiro, não um item", () => {
    const resultado = buildNfePayloadFromSale(
      sale([item(taxGroup()), item(taxGroup())], { issueDate: "2027-03-10" }),
      [REGRA_INTERNA],
    );

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    // Um erro só, e sem "Item 1"/"Item 2": não é cadastro de ninguém que está
    // faltando, é o motor que precisa ser atualizado.
    expect(resultado.errors).toHaveLength(1);
    expect(resultado.errors[0]).toContain("2027");
    expect(resultado.errors[0]).not.toContain("Item ");
  });
});

describe("o escopo por documento", () => {
  it("a NFC-e declara IBS/CBS como a NF-e", () => {
    const resultado = buildNfcePayloadFromSale(sale([item(taxGroup())]), [
      { ...REGRA_INTERNA, id: "venda-nfce" },
    ]);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.payload.items[0].ibs_uf_valor).toBe(1);
    expect(resultado.payload.items[0].cbs_valor).toBe(9);
    expect(resultado.payload.cbs_valor_total).toBe(9);
  });

  it("a devolução declara — a UB12-10 não distingue venda de devolução", () => {
    const venda = sale([item(taxGroup())]);
    const devolucao: SaleReturnForInvoice = {
      code: "D-0001",
      saleCode: "V-0001",
      issueDate: "2026-09-05",
      totalAmount: 1000,
      discountAmount: 0,
      originalChave: null,
      branch: venda.branch,
      contact: venda.contact,
      items: [item(taxGroup())],
    };
    const resultado = buildReturnNfePayload(devolucao, [REGRA_DEVOLUCAO]);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.payload.items[0].ibs_valor_total).toBe(1);
    expect(resultado.payload.ibs_valor_total).toBe(1);
    // E continua sem `vTotTrib`, que é a decisão oposta de B9 no mesmo documento.
    expect(resultado.payload.valor_total_tributos).toBeUndefined();
  });

  it("filial optante pelo Simples Nacional não declara nada, e não recusa", () => {
    const resultado = buildNfePayloadFromSale(
      sale([item(taxGroup({ cstIbsCbs: null, cclasstrib: null }))], { regime: "1" }),
      [REGRA_SIMPLES],
    );

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    const linha = resultado.payload.items[0];
    expect(linha.ibs_cbs_situacao_tributaria).toBeUndefined();
    expect(linha.ibs_cbs_base_calculo).toBeUndefined();
    expect(linha.cbs_valor).toBeUndefined();
    // E o grupo de totais some inteiro — mandá-lo sem item é a rejeição 1118.
    expect(resultado.payload.ibs_cbs_base_calculo).toBeUndefined();
    expect(resultado.payload.ibs_valor_total).toBeUndefined();
    expect(resultado.payload.cbs_valor_total).toBeUndefined();
  });
});

describe("o grupo IBSCBSTot do cabeçalho", () => {
  it("os totais são a soma dos itens, e os campos que o motor não calcula vão zerados", () => {
    const { payload } = primeiroItem(taxGroup());

    expect(payload.ibs_cbs_base_calculo).toBe(1000);
    expect(payload.ibs_uf_valor_total).toBe(1);
    expect(payload.ibs_mun_valor_total).toBe(0);
    expect(payload.ibs_valor_total).toBe(1);
    expect(payload.cbs_valor_total).toBe(9);
    // Ocorrência 1-1 no leiaute: omitir seria erro de schema, e este motor
    // nunca difere nem devolve tributo nenhum.
    expect(payload.ibs_uf_valor_total_diferimento).toBe(0);
    expect(payload.ibs_uf_valor_total_devolucao).toBe(0);
    expect(payload.ibs_mun_valor_total_diferimento).toBe(0);
    expect(payload.ibs_mun_valor_total_devolucao).toBe(0);
    expect(payload.ibs_valor_total_credito_presumido).toBe(0);
    expect(payload.ibs_valor_total_condicao_suspensiva).toBe(0);
    expect(payload.cbs_valor_total_diferimento).toBe(0);
    expect(payload.cbs_valor_total_devolucao).toBe(0);
    expect(payload.cbs_valor_total_credito_presumido).toBe(0);
    expect(payload.cbs_valor_total_condicao_suspensiva).toBe(0);
  });

  it("soma os valores JÁ ARREDONDADOS dos itens — recalcular sobre o total dá outro número", () => {
    const linha = item(taxGroup(), { unitPrice: 333.33, totalAmount: 333.33 });
    const resultado = buildNfePayloadFromSale(sale([linha, { ...linha }]), [REGRA_INTERNA]);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    // Por item: 333,33 × 0,1 / 100 = 0,33333 → 0,33.
    expect(resultado.payload.items[0].ibs_uf_valor).toBe(0.33);
    expect(resultado.payload.items[1].ibs_uf_valor).toBe(0.33);
    // Total: 0,33 + 0,33 = 0,66. Recalcular sobre 666,66 daria 0,66666 → 0,67,
    // que é a rejeição 1080 ("Total de IBS UF difere da soma dos itens").
    expect(resultado.payload.ibs_uf_valor_total).toBe(0.66);
    expect(resultado.payload.ibs_valor_total).toBe(0.66);
    expect(resultado.payload.ibs_cbs_base_calculo).toBe(666.66);
  });

  it("nota inteiramente isenta/imune de NFC-e também manda o total com base zero", () => {
    const resultado = buildNfcePayloadFromSale(
      sale([item(taxGroup({ cstIbsCbs: "410", cclasstrib: "410001" }))]),
      [{ ...REGRA_INTERNA, id: "venda-nfce" }],
    );

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.payload.ibs_cbs_base_calculo).toBe(0);
    expect(resultado.payload.cbs_valor_total).toBeUndefined();
  });

  it("item imune convive com item tributado: só o tributado entra nas somas", () => {
    const tributado = item(taxGroup());
    const imune = item(taxGroup({ id: "grupo-imune", name: "Imune", cstIbsCbs: "410", cclasstrib: "410001" }));
    const resultado = buildNfePayloadFromSale(sale([tributado, imune]), [REGRA_INTERNA]);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.payload.items[1].ibs_cbs_situacao_tributaria).toBe("410");
    expect(resultado.payload.items[1].ibs_cbs_base_calculo).toBeUndefined();
    // A base total é a do item tributado só — o imune não tem `vBC` a somar.
    expect(resultado.payload.ibs_cbs_base_calculo).toBe(1000);
    expect(resultado.payload.ibs_valor_total).toBe(1);
    expect(resultado.payload.cbs_valor_total).toBe(9);
  });

  it("nota inteira de itens imunes AINDA manda o grupo de totais, com base zero", () => {
    // O gatilho da `W34-20` é o grupo **externo** (`UB12`, tag `IBSCBS`), que o
    // item imune tem — e não o `gIBSCBS` (`UB15`), que ele não tem. Omitir o
    // total aqui seria a rejeição 1119.
    const { payload } = primeiroItem(taxGroup({ cstIbsCbs: "410", cclasstrib: "410001" }));

    expect(payload.ibs_cbs_base_calculo).toBe(0);
    // `gIBS` e `gCBS` são `0-1` dentro de `IBSCBSTot`: sem valor a totalizar,
    // eles não saem — e sem eles não há campo `1-1` a zerar.
    expect(payload.ibs_valor_total).toBeUndefined();
    expect(payload.cbs_valor_total).toBeUndefined();
    expect(payload.ibs_uf_valor_total).toBeUndefined();
    expect(payload.ibs_uf_valor_total_diferimento).toBeUndefined();
  });
});

describe("B10 é aditivo para os outros impostos — regressões", () => {
  it("nenhuma outra grandeza do item muda com o IBS/CBS declarado", () => {
    const { item: linha } = primeiroItem(taxGroup());

    // ICMS 18% sobre 1000 = 180,00; PIS 1,65% = 16,50; COFINS 7,6% = 76,00.
    expect(linha.icms_base_calculo).toBe(1000);
    expect(linha.icms_aliquota).toBe(18);
    expect(linha.icms_valor).toBe(180);
    expect(linha.pis_valor).toBe(16.5);
    expect(linha.cofins_valor).toBe(76);
    expect(linha.valor_bruto).toBe(1000);
  });

  it("o IBS e a CBS NÃO entram no valor_total — em 2026 o vNF é o que já era", () => {
    const { payload } = primeiroItem(taxGroup());

    // 1.000,00 de mercadoria, sem IPI nem ST: o total é o total da venda, e não
    // 1.010,00 (o `vNFTot` do id W60 é campo próprio e regra futura).
    expect(payload.valor_total).toBe(1000);
    expect(payload.valor_produtos).toBe(1000);
  });

  it("as Informações Complementares não mudam — o IBS/CBS não escreve texto nenhum", () => {
    const { payload } = primeiroItem(taxGroup());

    expect(payload.informacoes_adicionais_contribuinte).toBe("Venda V-0001");
  });
});
