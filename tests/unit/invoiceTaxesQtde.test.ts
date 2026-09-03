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
 * Bateria do PIS/COFINS **por unidade de medida** (B5, 01/09/2026).
 *
 * Separada de `invoiceTaxes.test.ts` (B1, o ICMS próprio e o IPI) e de
 * `invoiceTaxesSt.test.ts` (B2, o ICMS-ST) pelo mesmo critério que separou
 * aquelas duas: são dimensões diferentes do mesmo item. Aqui a dimensão é o
 * regime **ad rem** do CST 03 — `qBCProd × vAliqProd`, o grupo XML
 * `PISQtde`/`COFINSQtde`, sem `vBC` nem alíquota percentual.
 *
 * Entra por `buildNfePayloadFromSale`, como as outras duas: `resolveItemsForSale`
 * não é exportada, e o que interessa provar é o item que sai no payload. As
 * contas continuam escritas por extenso nos comentários — um teste que compara
 * com a mesma expressão do código não confere nada.
 */

/** Ver a nota em `invoiceTaxes.test.ts`: existe para os CST com ST não recusarem por falta de MVA. */
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

/**
 * Um item de 1.000 unidades a R$ 1,00 — R$ 1.000,00 no total.
 *
 * A quantidade é o número que importa aqui (é ela que vira `qBCProd`), e 1.000
 * é o mesmo do exemplo do Manual de Orientação do Contribuinte, o que deixa a
 * conta conferível de cabeça. O total de R$ 1.000,00 é igual ao dos outros dois
 * arquivos de bateria de propósito: mantém comparável o que sai de ICMS.
 */
function item(group: TaxGroup, overrides: Partial<SaleForInvoiceItem> = {}): SaleForInvoiceItem {
  return {
    quantity: 1000,
    unitPrice: 1,
    discountAmount: 0,
    totalAmount: 1000,
    product: {
      code: "P-1",
      description: "Combustível de teste",
      ncm: "22021000",
      cest: null,
      unidadeComercial: "LT",
      unidadeTributavel: "LT",
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
      // Esta bateria não usa CSOSN nenhum; o campo existe porque
      // `SaleForInvoiceBranch` passou a exigi-lo em B8 (03/09/2026).
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
      municipio: "São Paulo",
      uf: "SP",
      cep: "01002000",
      phone: null,
    },
    items,
    payments: [],
  };
}

/** Emite e devolve o primeiro item do payload, falhando alto se a montagem recusar. */
function primeiroItem(group: TaxGroup, itemOverrides: Partial<SaleForInvoiceItem> = {}) {
  const resultado = buildNfePayloadFromSale(sale([item(group, itemOverrides)]), [REGRA_VENDA_INTERNA], MVA_CADASTRADA);
  if (!resultado.ok) throw new Error(`Emissão recusada: ${resultado.errors.join(" | ")}`);
  return { item: resultado.payload.items[0], payload: resultado.payload };
}

/** As alíquotas ad rem de refrigerante da tabela do regime especial — números reais, com 4 decimais. */
const AD_REM_PIS = 0.0076;
const AD_REM_COFINS = 0.0351;

describe("PIS/COFINS por unidade de medida (CST 03)", () => {
  it("calcula quantidade × alíquota em reais, sem base nem alíquota percentual", () => {
    const { item: linha } = primeiroItem(
      taxGroup({
        cstPis: "03",
        aliquotaPisValor: AD_REM_PIS,
        cstCofins: "03",
        aliquotaCofinsValor: AD_REM_COFINS,
      }),
    );

    // PIS:    1000 × R$ 0,0076 = R$ 7,60
    // COFINS: 1000 × R$ 0,0351 = R$ 35,10
    expect(linha.pis_situacao_tributaria).toBe("03");
    expect(linha.pis_quantidade_vendida).toBe(1000);
    expect(linha.pis_aliquota_valor).toBe(0.0076);
    expect(linha.pis_valor).toBe(7.6);

    expect(linha.cofins_situacao_tributaria).toBe("03");
    expect(linha.cofins_quantidade_vendida).toBe(1000);
    expect(linha.cofins_aliquota_valor).toBe(0.0351);
    expect(linha.cofins_valor).toBe(35.1);

    // O grupo `PISQtde` não tem `vBC` nem `pPIS` — mandá-los é rejeição de
    // schema, e é o motivo de o CST 03 continuar em `pisCofinsCalculaValor`.
    expect(linha.pis_base_calculo).toBeUndefined();
    expect(linha.pis_aliquota_porcentual).toBeUndefined();
    expect(linha.cofins_base_calculo).toBeUndefined();
    expect(linha.cofins_aliquota_porcentual).toBeUndefined();
  });

  it("a alíquota percentual cadastrada junto é ignorada — quem escolhe o caminho é o CST", () => {
    // O grupo padrão já tem `aliquotaPis: 1,65` e `aliquotaCofins: 7,6`. Com
    // CST 03 elas não valem: o cadastro serve a produtos de CSTs diferentes,
    // não é uma contradição.
    const { item: linha } = primeiroItem(
      taxGroup({
        cstPis: "03",
        aliquotaPisValor: AD_REM_PIS,
        cstCofins: "03",
        aliquotaCofinsValor: AD_REM_COFINS,
      }),
    );
    expect(linha.pis_valor).toBe(7.6);
    expect(linha.cofins_valor).toBe(35.1);
  });

  it("o valor entra nos totais da nota, pelo mesmo critério de presença do campo", () => {
    const { payload } = primeiroItem(
      taxGroup({
        cstPis: "03",
        aliquotaPisValor: AD_REM_PIS,
        cstCofins: "03",
        aliquotaCofinsValor: AD_REM_COFINS,
      }),
    );
    expect(payload.valor_pis).toBe(7.6);
    expect(payload.valor_cofins).toBe(35.1);

    // PIS e COFINS são impostos **por dentro**: já estão no preço, e não somam
    // no `vNF` (ao contrário de IPI e ICMS-ST). Comportamento inalterado.
    expect(payload.valor_total).toBe(1000);
  });

  it("arredonda a centavos, como todo valor de imposto deste motor", () => {
    // 3 unidades × R$ 0,0076 = R$ 0,0228 → R$ 0,02
    const { item: linha } = primeiroItem(taxGroup({ cstPis: "03", aliquotaPisValor: AD_REM_PIS }), {
      quantity: 3,
      unitPrice: 1,
      totalAmount: 3,
    });
    expect(linha.pis_quantidade_vendida).toBe(3);
    expect(linha.pis_valor).toBe(0.02);
  });

  it("quantidade fracionária multiplica normalmente", () => {
    // 12,5 litros × R$ 0,0351 = R$ 0,43875 → R$ 0,44
    const { item: linha } = primeiroItem(taxGroup({ cstCofins: "03", aliquotaCofinsValor: AD_REM_COFINS }), {
      quantity: 12.5,
      unitPrice: 4,
      totalAmount: 50,
    });
    expect(linha.cofins_quantidade_vendida).toBe(12.5);
    expect(linha.cofins_valor).toBe(0.44);
  });

  it("alíquota ad rem de zero declara o grupo com valor zero — não o suprime", () => {
    // Zero cadastrado é uma afirmação ("a lei fixou zero por unidade"), ao
    // contrário de nulo, que é "não cadastrado". Mesmo critério com que B1
    // trata a alíquota percentual de zero.
    const { item: linha, payload } = primeiroItem(taxGroup({ cstPis: "03", aliquotaPisValor: 0 }));
    expect(linha.pis_quantidade_vendida).toBe(1000);
    expect(linha.pis_aliquota_valor).toBe(0);
    expect(linha.pis_valor).toBe(0);
    expect(payload.valor_pis).toBe(0);
  });

  it("a quantidade é a comercial do item, não o valor bruto", () => {
    // A distinção que faz este caminho ser outro caminho: com 200 unidades a
    // R$ 5,00 (R$ 1.000,00 de item, o mesmo total dos outros testes), o PIS
    // ad rem é 200 × 0,0076 = R$ 1,52 — e não muda se o preço mudar.
    const { item: linha } = primeiroItem(taxGroup({ cstPis: "03", aliquotaPisValor: AD_REM_PIS }), {
      quantity: 200,
      unitPrice: 5,
      totalAmount: 1000,
    });
    expect(linha.pis_quantidade_vendida).toBe(200);
    expect(linha.pis_valor).toBe(1.52);
  });
});

describe("PIS e COFINS são independentes um do outro", () => {
  it("PIS ad rem e COFINS percentual no mesmo item", () => {
    const { item: linha } = primeiroItem(taxGroup({ cstPis: "03", aliquotaPisValor: AD_REM_PIS }));

    // PIS por unidade: 1000 × R$ 0,0076 = R$ 7,60
    expect(linha.pis_quantidade_vendida).toBe(1000);
    expect(linha.pis_valor).toBe(7.6);
    expect(linha.pis_base_calculo).toBeUndefined();

    // COFINS percentual (CST 01, 7,6%): 1000 × 7,6% = R$ 76,00
    expect(linha.cofins_situacao_tributaria).toBe("01");
    expect(linha.cofins_base_calculo).toBe(1000);
    expect(linha.cofins_aliquota_porcentual).toBe(7.6);
    expect(linha.cofins_valor).toBe(76);
    expect(linha.cofins_quantidade_vendida).toBeUndefined();
    expect(linha.cofins_aliquota_valor).toBeUndefined();
  });

  it("COFINS ad rem e PIS percentual no mesmo item", () => {
    const { item: linha } = primeiroItem(taxGroup({ cstCofins: "03", aliquotaCofinsValor: AD_REM_COFINS }));

    expect(linha.pis_base_calculo).toBe(1000);
    expect(linha.pis_valor).toBe(16.5);
    expect(linha.pis_quantidade_vendida).toBeUndefined();

    expect(linha.cofins_quantidade_vendida).toBe(1000);
    expect(linha.cofins_valor).toBe(35.1);
    expect(linha.cofins_base_calculo).toBeUndefined();
  });

  it("PIS ad rem e COFINS sem incidência (CST 08) no mesmo item", () => {
    const { item: linha } = primeiroItem(
      taxGroup({ cstPis: "03", aliquotaPisValor: AD_REM_PIS, cstCofins: "08" }),
    );
    expect(linha.pis_valor).toBe(7.6);
    expect(linha.cofins_situacao_tributaria).toBe("08");
    expect(linha.cofins_base_calculo).toBeUndefined();
    expect(linha.cofins_quantidade_vendida).toBeUndefined();
    expect(linha.cofins_valor).toBeUndefined();
  });

  it("recusa só o imposto cujo cadastro está incompleto, e diz qual é", () => {
    // PIS com CST 03 sem alíquota ad rem, COFINS ad rem completo: a emissão
    // cai, e a mensagem tem de apontar o PIS — não a COFINS.
    const resultado = buildNfePayloadFromSale(
      sale([item(taxGroup({ cstPis: "03", cstCofins: "03", aliquotaCofinsValor: AD_REM_COFINS }))]),
      [REGRA_VENDA_INTERNA],
      MVA_CADASTRADA,
    );
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.errors).toHaveLength(1);
    expect(resultado.errors[0]).toContain("CST de PIS 03");
    expect(resultado.errors[0]).not.toContain("CST de COFINS");
  });
});

describe("cadastro incoerente: CST 03 sem alíquota em reais", () => {
  it("recusa a emissão do PIS com mensagem própria, em vez de emitir com zero", () => {
    const resultado = buildNfePayloadFromSale(
      sale([item(taxGroup({ cstPis: "03" }))]),
      [REGRA_VENDA_INTERNA],
      MVA_CADASTRADA,
    );
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.errors[0]).toContain("Item 1");
    expect(resultado.errors[0]).toContain("alíquota de PIS em reais por unidade");
    expect(resultado.errors[0]).toContain("Grupos tributários");
  });

  it("recusa a emissão da COFINS com mensagem própria", () => {
    const resultado = buildNfePayloadFromSale(
      sale([item(taxGroup({ cstCofins: "03" }))]),
      [REGRA_VENDA_INTERNA],
      MVA_CADASTRADA,
    );
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.errors[0]).toContain("alíquota de COFINS em reais por unidade");
  });

  it("a alíquota percentual cadastrada não substitui a ad rem faltante", () => {
    // O grupo padrão tem `aliquotaPis: 1,65`. Ela existe, mas é de outra
    // unidade: cair nela seria emitir R$ 16,50 de PIS onde a lei manda
    // R$ 7,60 — nota autorizada com imposto errado, o desfecho que a recusa
    // existe para impedir.
    const resultado = buildNfePayloadFromSale(
      sale([item(taxGroup({ cstPis: "03", aliquotaPis: 1.65 }))]),
      [REGRA_VENDA_INTERNA],
      MVA_CADASTRADA,
    );
    expect(resultado.ok).toBe(false);
  });
});

describe("regressão: os outros CST de PIS/COFINS não mudaram com B5", () => {
  it.each(["04", "05", "06", "07", "08", "09"])(
    "CST %s (grupo PISNT/COFINSNT) continua saindo só com o CST, mesmo com alíquota ad rem cadastrada",
    (cst) => {
      // A alíquota ad rem cadastrada num CST que não é 03 é ignorada em
      // silêncio — o CST manda, exatamente como já acontecia com a percentual.
      const { item: linha, payload } = primeiroItem(
        taxGroup({
          cstPis: cst,
          aliquotaPisValor: AD_REM_PIS,
          cstCofins: cst,
          aliquotaCofinsValor: AD_REM_COFINS,
        }),
      );
      expect(linha.pis_situacao_tributaria).toBe(cst);
      expect(linha.pis_base_calculo).toBeUndefined();
      expect(linha.pis_aliquota_porcentual).toBeUndefined();
      expect(linha.pis_quantidade_vendida).toBeUndefined();
      expect(linha.pis_aliquota_valor).toBeUndefined();
      expect(linha.pis_valor).toBeUndefined();

      expect(linha.cofins_quantidade_vendida).toBeUndefined();
      expect(linha.cofins_aliquota_valor).toBeUndefined();
      expect(linha.cofins_valor).toBeUndefined();

      expect(payload.valor_pis).toBeUndefined();
      expect(payload.valor_cofins).toBeUndefined();
    },
  );

  it.each(["01", "02", "49", "50", "70", "98", "99"])(
    "CST %s continua calculando por percentual, sobre a base cheia",
    (cst) => {
      const { item: linha, payload } = primeiroItem(taxGroup({ cstPis: cst, cstCofins: cst }));

      // 1000 × 1,65% = 16,50 e 1000 × 7,6% = 76,00 — as contas de antes de B5.
      expect(linha.pis_base_calculo).toBe(1000);
      expect(linha.pis_aliquota_porcentual).toBe(1.65);
      expect(linha.pis_valor).toBe(16.5);
      expect(linha.cofins_base_calculo).toBe(1000);
      expect(linha.cofins_valor).toBe(76);

      // E não escorregam para o grupo por unidade.
      expect(linha.pis_quantidade_vendida).toBeUndefined();
      expect(linha.pis_aliquota_valor).toBeUndefined();
      expect(linha.cofins_quantidade_vendida).toBeUndefined();
      expect(linha.cofins_aliquota_valor).toBeUndefined();

      expect(payload.valor_pis).toBe(16.5);
      expect(payload.valor_cofins).toBe(76);
    },
  );

  it.each(["01", "02", "49", "99"])(
    "CST %s com alíquota ad rem cadastrada segue percentual — a faixa PISOutr não usa o caminho por unidade",
    (cst) => {
      // Decisão registrada em `taxSituations.ts`: o grupo `PISOutr` aceita as
      // duas formas (`xs:choice`), mas com as duas alíquotas cadastradas não há
      // como desempatar, e escolher errado é declarar o campo errado no XML.
      const { item: linha } = primeiroItem(
        taxGroup({ cstPis: cst, aliquotaPisValor: AD_REM_PIS, cstCofins: cst, aliquotaCofinsValor: AD_REM_COFINS }),
      );
      expect(linha.pis_base_calculo).toBe(1000);
      expect(linha.pis_valor).toBe(16.5);
      expect(linha.pis_quantidade_vendida).toBeUndefined();
      expect(linha.cofins_valor).toBe(76);
      expect(linha.cofins_quantidade_vendida).toBeUndefined();
    },
  );

  it("grupo sem alíquota nenhuma continua sem PIS/COFINS, e não quebra", () => {
    const { item: linha } = primeiroItem(taxGroup({ aliquotaPis: null, aliquotaCofins: null }));
    expect(linha.pis_situacao_tributaria).toBe("01");
    expect(linha.pis_base_calculo).toBeUndefined();
    expect(linha.pis_valor).toBeUndefined();
    expect(linha.cofins_valor).toBeUndefined();
  });

  it("o ICMS e o IPI do mesmo item não são afetados", () => {
    const { item: linha, payload } = primeiroItem(
      taxGroup({ cstPis: "03", aliquotaPisValor: AD_REM_PIS, cstIpi: "50", aliquotaIpi: 6.5 }),
    );
    // ICMS: 1000 × 18% = 180,00; IPI: 1000 × 6,5% = 65,00 (e o IPI soma no vNF)
    expect(linha.icms_base_calculo).toBe(1000);
    expect(linha.icms_valor).toBe(180);
    expect(linha.ipi_valor).toBe(65);
    expect(payload.valor_total).toBe(1065);
  });
});

describe("vários itens com caminhos diferentes", () => {
  it("cada item usa o do próprio grupo, e os totais somam os dois caminhos juntos", () => {
    const adRem = taxGroup({
      cstPis: "03",
      aliquotaPisValor: AD_REM_PIS,
      cstCofins: "03",
      aliquotaCofinsValor: AD_REM_COFINS,
    });
    const percentual = taxGroup({ id: "grupo-2", code: "TRIB", name: "Percentual" });
    const semIncidencia = taxGroup({ id: "grupo-3", code: "NT", name: "Sem incidência", cstPis: "08", cstCofins: "08" });

    const resultado = buildNfePayloadFromSale(
      sale([item(adRem), item(percentual), item(semIncidencia)]),
      [REGRA_VENDA_INTERNA],
      MVA_CADASTRADA,
    );
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    const [linha1, linha2, linha3] = resultado.payload.items;

    expect(linha1.pis_valor).toBe(7.6);
    expect(linha2.pis_valor).toBe(16.5);
    expect(linha3.pis_valor).toBeUndefined();

    // PIS total:    7,60 + 16,50 = 24,10
    // COFINS total: 35,10 + 76,00 = 111,10
    expect(resultado.payload.valor_pis).toBe(24.1);
    expect(resultado.payload.valor_cofins).toBe(111.1);
  });
});
