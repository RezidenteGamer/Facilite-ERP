import { describe, expect, it } from "vitest";

import {
  buildNfePayloadFromSale,
  type SaleForInvoice,
  type SaleForInvoiceItem,
} from "@fiscal-core/invoiceMapping.ts";
import { aliquotaInterestadual, mvaAjustada, type MvaRuleRow } from "@fiscal-core/mvaRules.ts";
import type { TaxGroup } from "@fiscal-core/taxGroups.ts";
import type { TaxRuleRow } from "@fiscal-core/taxRules.ts";

/**
 * Bateria do ICMS-ST (B2, 01/09/2026).
 *
 * Arquivo separado de `invoiceTaxes.test.ts` de propósito: aquele prova o ICMS
 * **próprio** por item (B1), este prova a camada de ST que se soma a ele. São
 * duas dimensões diferentes do mesmo item — misturá-las num arquivo só
 * dificultaria ler qual regra cada teste está defendendo.
 *
 * As contas continuam escritas por extenso nos comentários, pelo mesmo motivo
 * de B1: um teste que compara com `mvaAjustada(...)` reimplementa o código que
 * deveria estar conferindo.
 */

const REGRA_VENDA_INTERNA: TaxRuleRow = {
  id: "venda-interna",
  regime: "3",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "SP",
  tipoCliente: "contribuinte",
  cfop: "5405",
};

/** A mesma operação, mas SP → BA: interestadual, e por isso com MVA ajustada. */
const REGRA_VENDA_INTERESTADUAL: TaxRuleRow = {
  id: "venda-interestadual",
  regime: "3",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "BA",
  tipoCliente: "contribuinte",
  cfop: "6404",
};

/** Interna, mas com quem emite no Simples Nacional (CRT 1) — Convênio ICMS 35/2011. */
const REGRA_SIMPLES_INTERESTADUAL: TaxRuleRow = {
  id: "venda-simples-interestadual",
  regime: "1",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "BA",
  tipoCliente: "contribuinte",
  cfop: "6404",
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

function taxGroup(overrides: Partial<TaxGroup> = {}): TaxGroup {
  return {
    id: "grupo-st",
    code: "ST18",
    name: "Substituição tributária 18%",
    cstIcms: "10",
    csosn: null,
    aliquotaIcms: 18,
    reducaoBaseIcms: null,
    cstPis: "01",
    aliquotaPis: 1.65,
    cstCofins: "01",
    aliquotaCofins: 7.6,
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

function sale(items: SaleForInvoiceItem[], ufDestino = "SP", regime = "3"): SaleForInvoice {
  const total = items.reduce((sum, i) => sum + i.totalAmount, 0);
  return {
    code: "V-0001",
    issueDate: "2026-09-01",
    subtotalAmount: total,
    totalAmount: total,
    discountAmount: 0,
    freightAmount: 0,
    branch: {
      cnpj: "00000000000191",
      name: "Facilite Testes LTDA",
      inscricaoEstadual: "123456789",
      regimeTributario: regime,
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
      municipio: ufDestino === "SP" ? "São Paulo" : "Salvador",
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
  const regra = options.regra ?? REGRA_VENDA_INTERNA;
  const vendaMontada = sale([item(group, options.itemOverrides)], options.ufDestino ?? "SP", options.regime ?? "3");
  const resultado = buildNfePayloadFromSale(vendaMontada, [regra], options.mvaRules ?? [MVA_CORINGA]);
  if (!resultado.ok) throw new Error(`Emissão recusada: ${resultado.errors.join(" | ")}`);
  return { item: resultado.payload.items[0], payload: resultado.payload };
}

/** Emite esperando recusa, e devolve as mensagens. */
function errosDe(
  group: TaxGroup,
  options: { mvaRules?: MvaRuleRow[]; regra?: TaxRuleRow; ufDestino?: string } = {},
): string[] {
  const regra = options.regra ?? REGRA_VENDA_INTERNA;
  const resultado = buildNfePayloadFromSale(
    sale([item(group)], options.ufDestino ?? "SP"),
    [regra],
    options.mvaRules ?? [],
  );
  if (resultado.ok) throw new Error("Esperava recusa, mas a emissão passou.");
  return resultado.errors;
}

describe("MVA ajustada — a fórmula isolada", () => {
  it("ajusta a MVA de uma operação interestadual com 12% de saída e 18% interna", () => {
    // (1 + 40/100) × (1 − 12/100) / (1 − 18/100) − 1
    //   = 1,40 × 0,88 / 0,82 − 1
    //   = 1,232 / 0,82 − 1
    //   = 1,502439… − 1 = 0,502439… → 50,2439%
    expect(mvaAjustada(40, 12, 18)).toBe(50.2439);
  });

  it("ajusta com a alíquota de 7% (Sul/Sudeste → Nordeste)", () => {
    // 1,40 × 0,93 / 0,82 − 1 = 1,302 / 0,82 − 1 = 1,587804… − 1 → 58,7805%
    expect(mvaAjustada(40, 7, 18)).toBe(58.7805);
  });

  it("ajusta com a alíquota de 4% de mercadoria importada", () => {
    // 1,40 × 0,96 / 0,82 − 1 = 1,344 / 0,82 − 1 = 1,639024… − 1 → 63,9024%
    expect(mvaAjustada(40, 4, 18)).toBe(63.9024);
  });

  it("devolve a MVA original quando as duas alíquotas são iguais (não há o que neutralizar)", () => {
    expect(mvaAjustada(40, 18, 18)).toBe(40);
  });

  it("devolve a MVA original, sem dividir por zero, quando a alíquota interna é 100%", () => {
    expect(mvaAjustada(40, 12, 100)).toBe(40);
  });
});

describe("alíquota interestadual — a tabela da Resolução 22/89 e da 13/2012", () => {
  it("7% quando sai do Sul/Sudeste para o Norte/Nordeste/Centro-Oeste ou para o ES", () => {
    expect(aliquotaInterestadual("SP", "BA", "0")).toBe(7);
    expect(aliquotaInterestadual("RS", "AM", "0")).toBe(7);
    expect(aliquotaInterestadual("MG", "GO", "0")).toBe(7);
    expect(aliquotaInterestadual("PR", "ES", "0")).toBe(7);
  });

  it("12% entre estados do Sul/Sudeste", () => {
    expect(aliquotaInterestadual("SP", "RJ", "0")).toBe(12);
    expect(aliquotaInterestadual("SC", "MG", "0")).toBe(12);
  });

  it("12% quando a saída é DO Espírito Santo, mesmo para o Nordeste", () => {
    // O ES é Sudeste geograficamente, mas a Resolução 22/89 o põe do lado de
    // quem recebe o incentivo, não de quem o concede. É o ponto que quase todo
    // resumo em prosa erra, e por isso tem teste próprio.
    expect(aliquotaInterestadual("ES", "BA", "0")).toBe(12);
    expect(aliquotaInterestadual("ES", "AM", "0")).toBe(12);
    expect(aliquotaInterestadual("ES", "GO", "0")).toBe(12);
  });

  it("12% quando a saída é do Norte/Nordeste/Centro-Oeste, para qualquer destino", () => {
    expect(aliquotaInterestadual("BA", "SP", "0")).toBe(12);
    expect(aliquotaInterestadual("GO", "AM", "0")).toBe(12);
  });

  it("4% para as origens de mercadoria importada (1, 2, 3 e 8), em qualquer trajeto", () => {
    expect(aliquotaInterestadual("SP", "BA", "1")).toBe(4);
    expect(aliquotaInterestadual("SP", "RJ", "2")).toBe(4);
    expect(aliquotaInterestadual("BA", "SP", "3")).toBe(4);
    expect(aliquotaInterestadual("SP", "BA", "8")).toBe(4);
  });

  it("mantém 7%/12% nas origens que a Resolução 13/2012 excetua (4, 6 e 7) e nas nacionais (0 e 5)", () => {
    expect(aliquotaInterestadual("SP", "BA", "4")).toBe(7);
    expect(aliquotaInterestadual("SP", "BA", "6")).toBe(7);
    expect(aliquotaInterestadual("SP", "RJ", "7")).toBe(12);
    expect(aliquotaInterestadual("SP", "BA", "5")).toBe(7);
    expect(aliquotaInterestadual("SP", "BA", null)).toBe(7);
  });
});

describe("ICMS-ST no item", () => {
  it("usa a MVA original direto numa operação interna", () => {
    const { item: linha } = primeiroItem(taxGroup());

    // Interna: sem ajuste, MVA = 40%.
    expect(linha.icms_margem_valor_adicionado_st).toBe(40);
    expect(linha.icms_modalidade_base_calculo_st).toBe("4");
    // Base ST = 1000 × 1,40 = 1400,00
    expect(linha.icms_base_calculo_st).toBe(1400);
    expect(linha.icms_aliquota_st).toBe(18);
    // ICMS próprio = 1000 × 18% = 180,00
    expect(linha.icms_valor).toBe(180);
    // ST = 1400 × 18% − 180 = 252,00 − 180,00 = 72,00
    expect(linha.icms_valor_st).toBe(72);
  });

  it("usa a MVA ajustada numa operação interestadual", () => {
    const { item: linha } = primeiroItem(taxGroup(), {
      regra: REGRA_VENDA_INTERESTADUAL,
      ufDestino: "BA",
    });

    // SP → BA com mercadoria nacional: 7%.
    // MVA ajustada = 1,40 × 0,93 / 0,82 − 1 = 58,7805%
    expect(linha.icms_margem_valor_adicionado_st).toBe(58.7805);
    // Base ST = 1000 × 1,587805 = 1587,805 → 1587,80.
    // O meio centavo cai para baixo porque 1587,805 não é representável em
    // binário (o valor mais próximo é 1587,80499…), e `Math.round` decide pelo
    // que o número realmente vale. Está anotado aqui em vez de "arrumado": é o
    // mesmo arredondamento de `taxAmount`, usado pelo motor inteiro desde a
    // etapa 8, e trocá-lo por causa de um teste mudaria o valor de toda nota.
    expect(linha.icms_base_calculo_st).toBe(1587.8);
    // ST = 1587,80 × 18% − 180 = 285,804 → 285,80 − 180,00 = 105,80
    expect(linha.icms_valor_st).toBe(105.8);
  });

  it("usa a alíquota de 4% no ajuste quando a mercadoria é importada", () => {
    const { item: linha } = primeiroItem(taxGroup(), {
      regra: REGRA_VENDA_INTERESTADUAL,
      ufDestino: "BA",
      itemOverrides: comOrigem(taxGroup(), "1"),
    });

    // MVA ajustada = 1,40 × 0,96 / 0,82 − 1 = 63,9024%
    expect(linha.icms_margem_valor_adicionado_st).toBe(63.9024);
  });

  it("não ajusta a MVA quando quem emite é do Simples Nacional, mesmo interestadual", () => {
    // Convênio ICMS 35/2011, cláusula primeira: o optante pelo Simples, na
    // condição de substituto tributário, não aplica MVA ajustada.
    const grupo = taxGroup({ cstIcms: null, csosn: "202" });
    const { item: linha } = primeiroItem(grupo, {
      regra: REGRA_SIMPLES_INTERESTADUAL,
      ufDestino: "BA",
      regime: "1",
    });

    expect(linha.icms_situacao_tributaria).toBe("202");
    expect(linha.icms_margem_valor_adicionado_st).toBe(40);
    expect(linha.icms_base_calculo_st).toBe(1400);
  });

  it("desconta o ICMS próprio já destacado — não cobra o valor cheio sobre a base majorada", () => {
    const { item: linha } = primeiroItem(taxGroup());

    const cheio = Math.round(linha.icms_base_calculo_st! * 0.18 * 100) / 100;
    expect(cheio).toBe(252);
    expect(linha.icms_valor_st).toBe(cheio - linha.icms_valor!);
  });

  it("parte da base já reduzida quando o grupo tem redução de base do próprio", () => {
    const { item: linha } = primeiroItem(taxGroup({ reducaoBaseIcms: 41.67 }));

    // Base própria = 1000 × (1 − 41,67/100) = 583,30
    expect(linha.icms_base_calculo).toBe(583.3);
    // ICMS próprio = 583,30 × 18% = 104,99 (104,994 arredondado)
    expect(linha.icms_valor).toBe(104.99);
    // Base ST = 583,30 × 1,40 = 816,62
    expect(linha.icms_base_calculo_st).toBe(816.62);
    // ST = 816,62 × 18% − 104,99 = 146,99 − 104,99 = 42,00
    expect(linha.icms_valor_st).toBe(42);
  });

  it("cobra o ST inteiro, sem desconto, quando o CST não declara ICMS próprio (CST 30)", () => {
    // CST 30 é isenta/não tributada **com** cobrança de ST: não há próprio para
    // descontar, e o ST é o valor cheio sobre a base majorada.
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: "30" }));

    expect(linha.icms_base_calculo).toBeUndefined();
    expect(linha.icms_valor).toBeUndefined();
    // Base ST = 1000 × 1,40 = 1400,00; ST = 1400 × 18% = 252,00
    expect(linha.icms_base_calculo_st).toBe(1400);
    expect(linha.icms_valor_st).toBe(252);
  });

  it("zera o ST em vez de deixá-lo negativo quando o cadastro não tem margem nenhuma", () => {
    const semMargem: MvaRuleRow = { ...MVA_CORINGA, mvaOriginal: 0 };
    const { item: linha } = primeiroItem(taxGroup(), { mvaRules: [semMargem] });

    // 1000 × 18% − 180 = 0
    expect(linha.icms_base_calculo_st).toBe(1000);
    expect(linha.icms_valor_st).toBe(0);
  });

  it("prefere a linha com UF exata à linha coringa", () => {
    const coringa: MvaRuleRow = { ...MVA_CORINGA, mvaOriginal: 40 };
    const exata: MvaRuleRow = { id: "mva-sp", ncm: NCM, ufDestino: "SP", mvaOriginal: 55, fcpAliquota: null };
    const { item: linha } = primeiroItem(taxGroup(), { mvaRules: [coringa, exata] });

    expect(linha.icms_margem_valor_adicionado_st).toBe(55);
    // Base ST = 1000 × 1,55 = 1550,00
    expect(linha.icms_base_calculo_st).toBe(1550);
  });

  it("casa o NCM ignorando pontuação no cadastro", () => {
    const pontuado: MvaRuleRow = { ...MVA_CORINGA, ncm: "2202.10.00" };
    const { item: linha } = primeiroItem(taxGroup(), { mvaRules: [pontuado] });

    expect(linha.icms_margem_valor_adicionado_st).toBe(40);
  });

  it("não escreve `pRedBCST` — a redução de base do ST ficou fora de B2", () => {
    const { item: linha } = primeiroItem(taxGroup({ reducaoBaseIcms: 41.67 }));
    expect(linha.icms_reducao_base_calculo_st).toBeUndefined();
  });
});

describe("os CST/CSOSN que têm ST, e os que não têm", () => {
  it.each(["10", "30", "70"])("CST %s (Regime Normal) declara ST", (cst) => {
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: cst }));
    expect(linha.icms_valor_st).toBeDefined();
    expect(linha.icms_base_calculo_st).toBeDefined();
    expect(linha.icms_margem_valor_adicionado_st).toBeDefined();
  });

  it.each(["201", "202", "203"])("CSOSN %s (Simples) declara ST", (csosn) => {
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: null, csosn }), { regime: "3" });
    expect(linha.icms_valor_st).toBeDefined();
  });

  it.each(["60", "500"])("CST/CSOSN %s (ICMS já retido) não declara nada de ST", (codigo) => {
    // Fora do escopo de B2: o dado que estes códigos precisam ("quanto de ST
    // veio embutido no custo da compra") este sistema não guarda. O
    // comportamento tem de continuar exatamente o de B1.
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: codigo, csosn: codigo }), { mvaRules: [] });
    expect(linha.icms_modalidade_base_calculo_st).toBeUndefined();
    expect(linha.icms_margem_valor_adicionado_st).toBeUndefined();
    expect(linha.icms_base_calculo_st).toBeUndefined();
    expect(linha.icms_aliquota_st).toBeUndefined();
    expect(linha.icms_valor_st).toBeUndefined();
  });

  it.each(["00", "20", "40", "90", "900"])("CST/CSOSN %s não declara ST", (codigo) => {
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: codigo, csosn: codigo }), { mvaRules: [] });
    expect(linha.icms_valor_st).toBeUndefined();
  });
});

describe("recusas de cadastro", () => {
  it("recusa a emissão quando o CST declara ST e não há MVA cadastrada", () => {
    const erros = errosDe(taxGroup(), { mvaRules: [] });
    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain("declara ICMS-ST");
    expect(erros[0]).toContain("nenhuma MVA cadastrada para o NCM 22021000 com destino SP");
    expect(erros[0]).toContain("MVA (ICMS-ST)");
  });

  it("recusa quando existe MVA para o NCM, mas só para outro destino", () => {
    const outraUf: MvaRuleRow = { id: "mva-rj", ncm: NCM, ufDestino: "RJ", mvaOriginal: 40, fcpAliquota: null };
    const erros = errosDe(taxGroup(), { mvaRules: [outraUf] });
    expect(erros[0]).toContain("nenhuma MVA cadastrada");
  });

  it("recusa quando o grupo com ST não tem alíquota de ICMS (a proxy da interna do destino)", () => {
    const erros = errosDe(taxGroup({ aliquotaIcms: null }), { mvaRules: [MVA_CORINGA] });
    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain("não tem alíquota de ICMS cadastrada");
  });

  it("recusa quando a alíquota de ICMS do grupo está fora de 0–100", () => {
    // `tax_groups.aliquota_icms` não tem check de 0–100 no banco (B1 deixou as
    // colunas antigas como estavam). Aqui a alíquota é o divisor do ajuste da
    // MVA, então cadastro fora da faixa tem de parar antes de emitir.
    const erros = errosDe(taxGroup({ aliquotaIcms: 100 }), { mvaRules: [MVA_CORINGA] });
    expect(erros[0]).toContain("fora da faixa aceitável de 0 a 100");
  });

  it("recusa quando o ajuste produz uma MVA maior do que o sistema registra", () => {
    // Alíquota interna de 95% (digitação errada) com MVA original de 300%:
    // 4,00 × 0,93 / 0,05 − 1 = 7340%, muito além de numeric(7,4). Sem esta
    // recusa a nota seria autorizada e só então a gravação do item falharia.
    const mvaAlta: MvaRuleRow = { ...MVA_CORINGA, mvaOriginal: 300 };
    const erros = errosDe(taxGroup({ aliquotaIcms: 95 }), {
      mvaRules: [mvaAlta],
      regra: REGRA_VENDA_INTERESTADUAL,
      ufDestino: "BA",
    });
    expect(erros[0]).toContain("acima do máximo que o sistema registra");
  });

  it("recusa quando duas MVAs de mesma especificidade se aplicam", () => {
    const a: MvaRuleRow = { id: "a", ncm: NCM, ufDestino: "SP", mvaOriginal: 40, fcpAliquota: null };
    const b: MvaRuleRow = { id: "b", ncm: NCM, ufDestino: "SP", mvaOriginal: 55, fcpAliquota: null };
    const erros = errosDe(taxGroup(), { mvaRules: [a, b] });
    expect(erros[0]).toContain("mais de uma MVA de mesma especificidade");
  });

  it("identifica o item na mensagem, como as demais recusas de cadastro", () => {
    const erros = errosDe(taxGroup(), { mvaRules: [] });
    expect(erros[0]).toMatch(/^Item 1 \(P-1 — Produto de teste\)/);
  });
});

describe("FCP retido por ST", () => {
  it("calcula o FCP sobre a mesma base do ICMS-ST quando a alíquota está cadastrada", () => {
    const comFcp: MvaRuleRow = { ...MVA_CORINGA, fcpAliquota: 2 };
    const { item: linha } = primeiroItem(taxGroup(), { mvaRules: [comFcp] });

    // Base ST = 1400,00; FCP = 1400 × 2% = 28,00
    expect(linha.fcp_base_calculo_st).toBe(1400);
    expect(linha.fcp_percentual_st).toBe(2);
    expect(linha.fcp_valor_st).toBe(28);
  });

  it("não declara FCP nenhum quando a alíquota é nula no cadastro", () => {
    const { item: linha } = primeiroItem(taxGroup(), { mvaRules: [MVA_CORINGA] });

    expect(linha.fcp_base_calculo_st).toBeUndefined();
    expect(linha.fcp_percentual_st).toBeUndefined();
    expect(linha.fcp_valor_st).toBeUndefined();
  });

  it("declara FCP de zero quando a alíquota cadastrada é zero (zero é cadastro, nulo é ausência)", () => {
    const fcpZero: MvaRuleRow = { ...MVA_CORINGA, fcpAliquota: 0 };
    const { item: linha } = primeiroItem(taxGroup(), { mvaRules: [fcpZero] });

    expect(linha.fcp_base_calculo_st).toBe(1400);
    expect(linha.fcp_percentual_st).toBe(0);
    expect(linha.fcp_valor_st).toBe(0);
  });
});

describe("totais da nota", () => {
  it("soma os totais de ST e FCP e os acrescenta ao valor total da nota", () => {
    const comFcp: MvaRuleRow = { ...MVA_CORINGA, fcpAliquota: 2 };
    const grupo = taxGroup();
    const resultado = buildNfePayloadFromSale(sale([item(grupo), item(grupo)]), [REGRA_VENDA_INTERNA], [comFcp]);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    const { payload } = resultado;
    // Dois itens de 1000: base ST 1400 cada, ST 72 cada, FCP 28 cada.
    expect(payload.icms_base_calculo_st).toBe(2800);
    expect(payload.icms_valor_total_st).toBe(144);
    expect(payload.fcp_valor_total_st).toBe(56);
    // vNF = 2000 (produtos) + 144 (vST) + 56 (vFCPST) = 2200,00
    expect(payload.valor_total).toBe(2200);
  });

  it("soma ST, FCP e IPI juntos no total da nota", () => {
    const comFcp: MvaRuleRow = { ...MVA_CORINGA, fcpAliquota: 2 };
    const grupo = taxGroup({ cstIpi: "50", aliquotaIpi: 5 });
    const resultado = buildNfePayloadFromSale(sale([item(grupo)]), [REGRA_VENDA_INTERNA], [comFcp]);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    // IPI = 1000 × 5% = 50,00; ST = 72,00; FCP = 28,00
    expect(resultado.payload.valor_ipi).toBe(50);
    // vNF = 1000 + 50 + 72 + 28 = 1150,00
    expect(resultado.payload.valor_total).toBe(1150);
  });

  it("deixa os totais de ST e FCP ausentes quando nenhum item tem ST", () => {
    const grupo = taxGroup({ cstIcms: "00" });
    const resultado = buildNfePayloadFromSale(sale([item(grupo)]), [REGRA_VENDA_INTERNA], []);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.payload.icms_base_calculo_st).toBeUndefined();
    expect(resultado.payload.icms_valor_total_st).toBeUndefined();
    expect(resultado.payload.fcp_valor_total_st).toBeUndefined();
    // Sem imposto por fora, o total da nota continua o total da venda.
    expect(resultado.payload.valor_total).toBe(1000);
  });

  it("soma o ST pela presença do campo no item, não pelo resultado da soma", () => {
    // Mesmo critério que B1 fixou em `totalDeclarado`: um item que declara
    // `vICMSST` de zero tem de aparecer no `vBCST` do total.
    const semMargem: MvaRuleRow = { ...MVA_CORINGA, mvaOriginal: 0 };
    const resultado = buildNfePayloadFromSale(sale([item(taxGroup())]), [REGRA_VENDA_INTERNA], [semMargem]);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.payload.icms_valor_total_st).toBe(0);
    expect(resultado.payload.icms_base_calculo_st).toBe(1000);
  });
});

describe("regressão: itens sem ST não mudaram com B2", () => {
  it("não consulta MVA nenhuma e sai idêntico ao que B1 produzia", () => {
    const grupo = taxGroup({ cstIcms: "00" });
    // `mvaRules` nem é passado — o parâmetro é opcional justamente porque não
    // ter MVA cadastrada é o caso normal.
    const resultado = buildNfePayloadFromSale(sale([item(grupo)]), [REGRA_VENDA_INTERNA]);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    const linha = resultado.payload.items[0];
    expect(linha.icms_base_calculo).toBe(1000);
    expect(linha.icms_valor).toBe(180);
    expect(linha.icms_valor_st).toBeUndefined();
    expect(linha.pis_valor).toBe(16.5);
    expect(linha.cofins_valor).toBe(76);
  });
});
