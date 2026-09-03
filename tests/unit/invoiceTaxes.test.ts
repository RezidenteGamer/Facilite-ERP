import { describe, expect, it } from "vitest";

import {
  buildNfePayloadFromSale,
  type SaleForInvoice,
  type SaleForInvoiceItem,
} from "@fiscal-core/invoiceMapping.ts";
import type { MvaRuleRow } from "@fiscal-core/mvaRules.ts";
import type { TaxGroup } from "@fiscal-core/taxGroups.ts";
import type { TaxRuleRow } from "@fiscal-core/taxRules.ts";

/**
 * Bateria do cálculo de imposto por item (B1, 01/09/2026).
 *
 * Complementa `taxRules.test.ts`, que cobre a **resolução de CFOP** (a metade
 * da tributação que depende da operação). Aqui é a outra metade: o que o grupo
 * tributário do produto faz com a base do item — redução de base do ICMS, IPI,
 * e os CST/CSOSN que zeram os campos em vez de forçá-los.
 *
 * As contas estão escritas por extenso nos comentários de propósito: um teste
 * que só compara com `taxAmount(...)` reimplementa o código que deveria estar
 * conferindo.
 *
 * `buildNfePayloadFromSale` é a porta de entrada porque `resolveItemsForSale`
 * não é exportada — e não deve ser: o que interessa provar é o item que sai no
 * payload, não o formato intermediário.
 */

/**
 * MVA cadastrada para o NCM de teste, acrescentada em B2 (01/09/2026).
 *
 * B1 escreveu esta bateria quando nenhum CST exigia MVA. Depois de B2, os
 * CST 10/30/70 e os CSOSN 201/202/203 **declaram ICMS-ST**, e emitir sem MVA
 * cadastrada passou a ser recusa de cadastro — o que quebraria testes que não
 * tratam de ST nenhum. Cadastrar uma MVA aqui mantém cada teste medindo a
 * dimensão que ele veio medir (o ICMS próprio, o IPI, a redução de base); o
 * ICMS-ST em si tem bateria própria em `invoiceTaxesSt.test.ts`.
 */
const MVA_CADASTRADA: MvaRuleRow[] = [
  { id: "mva-teste", ncm: "22021000", ufDestino: "*", mvaOriginal: 40, fcpAliquota: null },
];

const REGRA_VENDA_INTERNA: TaxRuleRow = {
  id: "venda-interna",
  regime: "3",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "SP",
  tipoCliente: "contribuinte",
  cfop: "5102",
};

function taxGroup(overrides: Partial<TaxGroup> = {}): TaxGroup {
  return {
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

function sale(items: SaleForInvoiceItem[]): SaleForInvoice {
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
      regimeTributario: "3",
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
      municipio: "São Paulo",
      uf: "SP",
      cep: "01002000",
      phone: null,
    },
    items,
    payments: [],
  };
}

/**
 * Override que põe um `cst_ipi` no cadastro do produto — o campo legado, que
 * o mapeamento só consulta quando o grupo não tem CST de IPI próprio.
 */
function comCstIpiNoProduto(group: TaxGroup, cstIpi: string): Partial<SaleForInvoiceItem> {
  return { product: { ...item(group).product, cstIpi } };
}

/** Emite e devolve o primeiro item do payload, falhando alto se a montagem recusar. */
function primeiroItem(group: TaxGroup, itemOverrides: Partial<SaleForInvoiceItem> = {}) {
  const resultado = buildNfePayloadFromSale(sale([item(group, itemOverrides)]), [REGRA_VENDA_INTERNA], MVA_CADASTRADA);
  if (!resultado.ok) throw new Error(`Emissão recusada: ${resultado.errors.join(" | ")}`);
  return { item: resultado.payload.items[0], payload: resultado.payload };
}

describe("regressão: o que já funcionava antes de B1", () => {
  it("resolve o CFOP da operação e o replica em todos os itens", () => {
    const grupo = taxGroup();
    const resultado = buildNfePayloadFromSale(sale([item(grupo), item(grupo)]), [REGRA_VENDA_INTERNA]);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.cfop).toBe("5102");
    expect(resultado.payload.items.map((i) => i.cfop)).toEqual(["5102", "5102"]);
  });

  it("ICMS/PIS/COFINS sem redução continuam base cheia × alíquota", () => {
    const { item: linha } = primeiroItem(taxGroup());

    // 1000 × 18%   = 180,00
    // 1000 × 1,65% =  16,50
    // 1000 × 7,6%  =  76,00
    expect(linha.icms_base_calculo).toBe(1000);
    expect(linha.icms_aliquota).toBe(18);
    expect(linha.icms_valor).toBe(180);
    expect(linha.pis_base_calculo).toBe(1000);
    expect(linha.pis_valor).toBe(16.5);
    expect(linha.cofins_base_calculo).toBe(1000);
    expect(linha.cofins_valor).toBe(76);

    // Sem redução, `pRedBC` não vai no XML — mandar 0 seria inventar campo.
    expect(linha.icms_reducao_base_calculo).toBeUndefined();
  });

  it("alíquota zero com CST tributado declara base e valor zero — inclusive nos totais", () => {
    // O total de `vBC` tem de bater com a soma dos itens (regra W03-10): itens
    // com base e um total sem base nenhuma seria rejeição na validação.
    const { item: linha, payload } = primeiroItem(taxGroup({ aliquotaIcms: 0 }));
    expect(linha.icms_base_calculo).toBe(1000);
    expect(linha.icms_aliquota).toBe(0);
    expect(linha.icms_valor).toBe(0);
    expect(payload.icms_base_calculo).toBe(1000);
    expect(payload.icms_valor_total).toBe(0);
  });

  it("grupo sem alíquota de ICMS continua sem base/valor, e não quebra", () => {
    const { item: linha } = primeiroItem(taxGroup({ aliquotaIcms: null }));
    expect(linha.icms_situacao_tributaria).toBe("00");
    expect(linha.icms_base_calculo).toBeUndefined();
    expect(linha.icms_aliquota).toBeUndefined();
    expect(linha.icms_valor).toBeUndefined();
  });

  it("recusa o item cujo grupo não tem CST ICMS nem CSOSN", () => {
    const resultado = buildNfePayloadFromSale(
      sale([item(taxGroup({ cstIcms: null, csosn: null }))]),
      [REGRA_VENDA_INTERNA],
    );
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.errors[0]).toContain("não tem CST ICMS nem CSOSN");
  });

  it("sem IPI cadastrado, nada de IPI sai — e o total da nota é o total da venda", () => {
    const { item: linha, payload } = primeiroItem(taxGroup());
    expect(linha.ipi_situacao_tributaria).toBeUndefined();
    expect(linha.ipi_base_calculo).toBeUndefined();
    expect(linha.ipi_valor).toBeUndefined();
    expect(payload.valor_ipi).toBeUndefined();
    expect(payload.valor_total).toBe(1000);
  });
});

describe("redução de base de cálculo do ICMS", () => {
  it("reduz a base antes de aplicar a alíquota e declara o percentual", () => {
    const { item: linha, payload } = primeiroItem(taxGroup({ cstIcms: "20", reducaoBaseIcms: 41.67 }));

    // Base reduzida: 1000 × (1 − 41,67/100) = 1000 × 0,5833 = 583,30
    // ICMS:          583,30 × 18%           = 104,994        → 104,99
    expect(linha.icms_base_calculo).toBe(583.3);
    expect(linha.icms_reducao_base_calculo).toBe(41.67);
    expect(linha.icms_aliquota).toBe(18);
    expect(linha.icms_valor).toBe(104.99);

    // O total da nota traz a base **reduzida**, não a cheia.
    expect(payload.icms_base_calculo).toBe(583.3);
    expect(payload.icms_valor_total).toBe(104.99);
  });

  it("a redução é só do ICMS — PIS e COFINS continuam sobre a base cheia", () => {
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: "20", reducaoBaseIcms: 41.67 }));
    expect(linha.pis_base_calculo).toBe(1000);
    expect(linha.pis_valor).toBe(16.5);
    expect(linha.cofins_base_calculo).toBe(1000);
    expect(linha.cofins_valor).toBe(76);
  });

  it("redução de 0 é tratada como ausência de redução", () => {
    const { item: linha } = primeiroItem(taxGroup({ reducaoBaseIcms: 0 }));
    expect(linha.icms_base_calculo).toBe(1000);
    expect(linha.icms_valor).toBe(180);
    expect(linha.icms_reducao_base_calculo).toBeUndefined();
  });

  it("redução de 100% zera a base e o valor, sem produzir número negativo", () => {
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: "20", reducaoBaseIcms: 100 }));
    expect(linha.icms_base_calculo).toBe(0);
    expect(linha.icms_reducao_base_calculo).toBe(100);
    expect(linha.icms_valor).toBe(0);
  });

  it("não aplica redução quando o CST não admite valor de ICMS", () => {
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: "40", reducaoBaseIcms: 30 }));
    expect(linha.icms_base_calculo).toBeUndefined();
    expect(linha.icms_reducao_base_calculo).toBeUndefined();
    expect(linha.icms_valor).toBeUndefined();
  });
});

describe("IPI", () => {
  it("calcula com a alíquota e o CST do grupo tributário", () => {
    const { item: linha, payload } = primeiroItem(taxGroup({ cstIpi: "50", aliquotaIpi: 6.5 }));

    // IPI: 1000 × 6,5% = 65,00, sobre a base cheia (IPI não tem redução no leiaute)
    expect(linha.ipi_situacao_tributaria).toBe("50");
    expect(linha.ipi_base_calculo).toBe(1000);
    expect(linha.ipi_aliquota).toBe(6.5);
    expect(linha.ipi_valor).toBe(65);
    expect(payload.valor_ipi).toBe(65);
  });

  it("o IPI entra no total da nota (vNF), que passa a ser maior que o da venda", () => {
    const { payload } = primeiroItem(taxGroup({ cstIpi: "50", aliquotaIpi: 6.5 }));
    expect(payload.valor_produtos).toBe(1000);
    expect(payload.valor_total).toBe(1065);
  });

  it("não sofre redução de base do ICMS — os dois impostos têm bases independentes", () => {
    const { item: linha } = primeiroItem(
      taxGroup({ cstIcms: "20", reducaoBaseIcms: 41.67, cstIpi: "50", aliquotaIpi: 6.5 }),
    );
    expect(linha.icms_base_calculo).toBe(583.3);
    expect(linha.ipi_base_calculo).toBe(1000);
    expect(linha.ipi_valor).toBe(65);
  });

  it("o CST do grupo vence o do produto", () => {
    // Produto isento (53) e grupo tributado (50): quem manda é o grupo.
    const grupo = taxGroup({ cstIpi: "50", aliquotaIpi: 6.5 });
    const { item: linha } = primeiroItem(grupo, comCstIpiNoProduto(grupo, "53"));
    expect(linha.ipi_situacao_tributaria).toBe("50");
    expect(linha.ipi_valor).toBe(65);
  });

  it("cai no CST do produto quando o grupo não tem — o cadastro anterior a B1", () => {
    const grupo = taxGroup({ aliquotaIpi: 6.5 });
    const { item: linha } = primeiroItem(grupo, comCstIpiNoProduto(grupo, "50"));
    expect(linha.ipi_situacao_tributaria).toBe("50");
    expect(linha.ipi_valor).toBe(65);
  });

  it("CST de IPI sem alíquota declara só o CST — nulo é 'não calculado'", () => {
    const grupo = taxGroup();
    const { item: linha, payload } = primeiroItem(grupo, comCstIpiNoProduto(grupo, "50"));
    expect(linha.ipi_situacao_tributaria).toBe("50");
    expect(linha.ipi_base_calculo).toBeUndefined();
    expect(linha.ipi_valor).toBeUndefined();
    expect(payload.valor_total).toBe(1000);
  });

  it("recusa alíquota de IPI sem CST — cadastro que não dá para emitir", () => {
    const resultado = buildNfePayloadFromSale(sale([item(taxGroup({ aliquotaIpi: 6.5 }))]), [REGRA_VENDA_INTERNA]);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.errors[0]).toContain("alíquota de IPI mas não tem");
  });

  it.each(["01", "02", "03", "04", "05", "51", "52", "53", "54", "55"])(
    "CST de IPI %s (grupo IPINT) sai sem base, alíquota nem valor",
    (cst) => {
      const { item: linha, payload } = primeiroItem(taxGroup({ cstIpi: cst, aliquotaIpi: 6.5 }));
      expect(linha.ipi_situacao_tributaria).toBe(cst);
      expect(linha.ipi_base_calculo).toBeUndefined();
      expect(linha.ipi_aliquota).toBeUndefined();
      expect(linha.ipi_valor).toBeUndefined();
      expect(payload.valor_total).toBe(1000);
    },
  );
});

describe("CST/CSOSN sem valor próprio de ICMS", () => {
  it.each(["30", "40", "41", "50", "60"])(
    "CST %s (isenta / não tributada / suspensão / ST já retida) sai sem base, alíquota nem valor",
    (cst) => {
      const { item: linha, payload } = primeiroItem(taxGroup({ cstIcms: cst }));
      expect(linha.icms_situacao_tributaria).toBe(cst);
      expect(linha.icms_base_calculo).toBeUndefined();
      expect(linha.icms_aliquota).toBeUndefined();
      expect(linha.icms_valor).toBeUndefined();
      // Sem nenhum ICMS na nota, os totais também ficam ausentes (nunca zero).
      expect(payload.icms_base_calculo).toBeUndefined();
      expect(payload.icms_valor_total).toBeUndefined();
    },
  );

  it.each(["00", "10", "20", "51", "70", "90"])("CST %s continua declarando ICMS", (cst) => {
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: cst }));
    expect(linha.icms_base_calculo).toBe(1000);
    expect(linha.icms_valor).toBe(180);
  });

  it.each(["101", "102", "103", "201", "202", "203", "300", "400", "500"])(
    "CSOSN %s sai sem base, alíquota nem valor de ICMS próprio",
    (csosn) => {
      const grupo = taxGroup({ cstIcms: null, csosn, aliquotaIcms: 18 });
      const vendaSimples = sale([item(grupo)]);
      vendaSimples.branch.regimeTributario = "1";
      const regra: TaxRuleRow = { ...REGRA_VENDA_INTERNA, id: "simples", regime: "1" };

      const resultado = buildNfePayloadFromSale(vendaSimples, [regra], MVA_CADASTRADA);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;
      const linha = resultado.payload.items[0];
      expect(linha.icms_situacao_tributaria).toBe(csosn);
      expect(linha.icms_base_calculo).toBeUndefined();
      expect(linha.icms_aliquota).toBeUndefined();
      expect(linha.icms_valor).toBeUndefined();
    },
  );

  it("CSOSN 900 ('Outros') é o único do Simples que declara ICMS", () => {
    const grupo = taxGroup({ cstIcms: null, csosn: "900", aliquotaIcms: 18 });
    const vendaSimples = sale([item(grupo)]);
    vendaSimples.branch.regimeTributario = "1";
    const regra: TaxRuleRow = { ...REGRA_VENDA_INTERNA, id: "simples", regime: "1" };

    const resultado = buildNfePayloadFromSale(vendaSimples, [regra], MVA_CADASTRADA);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.payload.items[0].icms_base_calculo).toBe(1000);
    expect(resultado.payload.items[0].icms_valor).toBe(180);
  });
});

describe("CST de PIS/COFINS sem alíquota percentual", () => {
  it.each(["04", "05", "06", "07", "08", "09"])(
    "CST %s (grupo PISNT/COFINSNT) sai só com o CST",
    (cst) => {
      const { item: linha, payload } = primeiroItem(taxGroup({ cstPis: cst, cstCofins: cst }));
      expect(linha.pis_situacao_tributaria).toBe(cst);
      expect(linha.pis_base_calculo).toBeUndefined();
      expect(linha.pis_aliquota_porcentual).toBeUndefined();
      expect(linha.pis_valor).toBeUndefined();
      expect(linha.cofins_base_calculo).toBeUndefined();
      expect(linha.cofins_valor).toBeUndefined();
      expect(payload.valor_pis).toBeUndefined();
      expect(payload.valor_cofins).toBeUndefined();
    },
  );

  it("CST 03 (por unidade de medida) nunca vira alíquota percentual", () => {
    // Escrito em B1, quando o `03` saía sem valor nenhum; mantido em B5 com a
    // alíquota ad rem cadastrada, porque o que ele afirma continua verdadeiro e
    // é o motivo de o `03` seguir na lista de `pisCofinsCalculaValor`: o grupo
    // `PISQtde` não tem `vBC` nem `pPIS`. O cálculo por unidade em si tem
    // bateria própria em `invoiceTaxesQtde.test.ts`.
    const { item: linha } = primeiroItem(
      taxGroup({ cstPis: "03", cstCofins: "03", aliquotaPisValor: 0.0076, aliquotaCofinsValor: 0.0351 }),
    );
    expect(linha.pis_base_calculo).toBeUndefined();
    expect(linha.pis_aliquota_porcentual).toBeUndefined();
    expect(linha.cofins_base_calculo).toBeUndefined();
    expect(linha.cofins_aliquota_porcentual).toBeUndefined();
  });

  it("CST 49 (grupo PISOutr) continua calculando por percentual", () => {
    const { item: linha } = primeiroItem(taxGroup({ cstPis: "49", cstCofins: "49" }));
    expect(linha.pis_base_calculo).toBe(1000);
    expect(linha.pis_valor).toBe(16.5);
    expect(linha.cofins_valor).toBe(76);
  });
});

describe("vários itens com grupos diferentes", () => {
  it("cada item usa o próprio grupo, e os totais somam só quem declarou", () => {
    const tributado = taxGroup();
    const isento = taxGroup({ id: "grupo-2", code: "ISENTO", name: "Isento", cstIcms: "40" });
    const comIpi = taxGroup({ id: "grupo-3", code: "IPI", name: "Com IPI", cstIpi: "50", aliquotaIpi: 10 });

    const resultado = buildNfePayloadFromSale(
      sale([item(tributado), item(isento), item(comIpi)]),
      [REGRA_VENDA_INTERNA],
    );
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    const [linha1, linha2, linha3] = resultado.payload.items;

    expect(linha1.icms_valor).toBe(180);
    expect(linha2.icms_valor).toBeUndefined();
    expect(linha3.icms_valor).toBe(180);

    // ICMS total: 180 + 180 = 360, sobre base 1000 + 1000 = 2000 (o isento não entra)
    expect(resultado.payload.icms_valor_total).toBe(360);
    expect(resultado.payload.icms_base_calculo).toBe(2000);
    // IPI só do terceiro item: 1000 × 10% = 100
    expect(resultado.payload.valor_ipi).toBe(100);
    // PIS/COFINS de todos os três (nenhum CST os suprime): 3 × 16,50 e 3 × 76,00
    expect(resultado.payload.valor_pis).toBe(49.5);
    expect(resultado.payload.valor_cofins).toBe(228);
    // Total: 3000 de produto + 100 de IPI
    expect(resultado.payload.valor_total).toBe(3100);
  });
});
