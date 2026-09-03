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
 * Bateria do Simples Nacional (B8, 03/09/2026): o crédito de ICMS do CSOSN
 * `101`/`201` (`pCredSN`/`vCredICMSSN`) e a dedução do ICMS próprio no ST dos
 * CSOSN `201`/`202`, que B2 tinha deixado registrada como limitação.
 *
 * Arquivo separado das outras três pelo mesmo critério que já separou
 * `invoiceTaxes` (o próprio), `invoiceTaxesSt` (o ST) e `invoiceTaxesQtde` (o ad
 * rem): são dimensões diferentes do mesmo item. Entra por
 * `buildNfePayloadFromSale`, como todas, e as contas continuam escritas por
 * extenso nos comentários — um teste que compara com `taxAmount(...)`
 * reimplementa o código que deveria estar conferindo.
 */

/** Venda interna de quem emite no Simples Nacional (CRT 1). */
const REGRA_SIMPLES_INTERNA: TaxRuleRow = {
  id: "venda-simples-interna",
  regime: "1",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "SP",
  tipoCliente: "contribuinte",
  cfop: "5101",
};

/** A mesma operação, SP → BA: interestadual, e sem MVA ajustada (Convênio ICMS 35/2011). */
const REGRA_SIMPLES_INTERESTADUAL: TaxRuleRow = {
  id: "venda-simples-interestadual",
  regime: "1",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "BA",
  tipoCliente: "contribuinte",
  cfop: "6102",
};

/** Regime Normal, para as regressões que provam que nada de B1/B2 mudou. */
const REGRA_NORMAL_INTERNA: TaxRuleRow = {
  id: "venda-normal-interna",
  regime: "3",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "SP",
  tipoCliente: "contribuinte",
  cfop: "5405",
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

/**
 * 1,36% — a alíquota de crédito da 1ª faixa do Anexo I da LC 123/2006
 * (4% nominais × 34% de distribuição do ICMS). Número real, e com a virgula
 * inteira: a fórmula do art. 60 da Resolução CGSN 140/2018 quase nunca dá
 * número redondo, e é por isso que a coluna guarda 4 decimais.
 */
const CREDITO_FAIXA_1 = 1.36;

function taxGroup(overrides: Partial<TaxGroup> = {}): TaxGroup {
  return {
    id: "grupo-simples",
    code: "SN101",
    name: "Simples com crédito",
    cstIcms: null,
    csosn: "101",
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

function sale(
  items: SaleForInvoiceItem[],
  options: { ufDestino?: string; regime?: string; credito?: number | null } = {},
): SaleForInvoice {
  const ufDestino = options.ufDestino ?? "SP";
  const total = items.reduce((sum, i) => sum + i.totalAmount, 0);
  return {
    code: "V-0001",
    issueDate: "2026-09-03",
    subtotalAmount: total,
    totalAmount: total,
    discountAmount: 0,
    freightAmount: 0,
    branch: {
      cnpj: "00000000000191",
      name: "Facilite Testes LTDA",
      inscricaoEstadual: "123456789",
      regimeTributario: options.regime ?? "1",
      aliquotaCreditoIcmsSimples: options.credito === undefined ? CREDITO_FAIXA_1 : options.credito,
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

type Opcoes = {
  itemOverrides?: Partial<SaleForInvoiceItem>;
  mvaRules?: MvaRuleRow[];
  regra?: TaxRuleRow;
  ufDestino?: string;
  regime?: string;
  credito?: number | null;
};

/** Emite e devolve o primeiro item do payload, falhando alto se a montagem recusar. */
function primeiroItem(group: TaxGroup, options: Opcoes = {}) {
  const regra = options.regra ?? REGRA_SIMPLES_INTERNA;
  const vendaMontada = sale([item(group, options.itemOverrides)], {
    ufDestino: options.ufDestino,
    regime: options.regime ?? regra.regime,
    credito: options.credito,
  });
  const resultado = buildNfePayloadFromSale(vendaMontada, [regra], options.mvaRules ?? [MVA_CORINGA]);
  if (!resultado.ok) throw new Error(`Emissão recusada: ${resultado.errors.join(" | ")}`);
  return { item: resultado.payload.items[0], payload: resultado.payload };
}

/** Emite esperando recusa, e devolve as mensagens. */
function errosDe(group: TaxGroup, options: Opcoes = {}): string[] {
  const regra = options.regra ?? REGRA_SIMPLES_INTERNA;
  const resultado = buildNfePayloadFromSale(
    sale([item(group, options.itemOverrides)], {
      ufDestino: options.ufDestino,
      regime: options.regime ?? regra.regime,
      credito: options.credito,
    }),
    [regra],
    options.mvaRules ?? [MVA_CORINGA],
  );
  if (resultado.ok) throw new Error("Esperava recusa, mas a emissão passou.");
  return resultado.errors;
}

describe("crédito de ICMS do Simples Nacional — o cálculo", () => {
  it("CSOSN 101 com alíquota cadastrada declara pCredSN e vCredICMSSN", () => {
    const { item: linha } = primeiroItem(taxGroup());

    // vCredICMSSN = valor da operação × pCredSN / 100 = 1000 × 1,36/100 = 13,60
    expect(linha.icms_situacao_tributaria).toBe("101");
    expect(linha.icms_aliquota_credito_simples).toBe(1.36);
    expect(linha.icms_valor_credito_simples).toBe(13.6);
  });

  it("não declara nada de ICMS próprio junto do crédito", () => {
    // O grupo `ICMSSN101` tem exatamente `orig`, `CSOSN`, `pCredSN` e
    // `vCredICMSSN` — nada de base, alíquota ou valor. É o que B1 já fazia, e
    // B8 não podia mudar.
    const { item: linha } = primeiroItem(taxGroup());

    expect(linha.icms_base_calculo).toBeUndefined();
    expect(linha.icms_aliquota).toBeUndefined();
    expect(linha.icms_valor).toBeUndefined();
  });

  it("arredonda o valor do crédito a centavos", () => {
    // 2,3987% é o tipo de número que a fórmula do art. 60 produz de verdade.
    // 1000 × 2,3987/100 = 23,987 → 23,99
    const { item: linha } = primeiroItem(taxGroup(), { credito: 2.3987 });

    expect(linha.icms_aliquota_credito_simples).toBe(2.3987);
    expect(linha.icms_valor_credito_simples).toBe(23.99);
  });

  it("calcula sobre o valor bruto do item, já líquido do desconto da linha", () => {
    // A base é o **valor da operação**: 1000 de mercadoria − 100 de desconto
    // = 900 de valor bruto. 900 × 1,36/100 = 12,24
    const { item: linha } = primeiroItem(taxGroup(), {
      itemOverrides: { unitPrice: 1000, discountAmount: 100, totalAmount: 900 },
    });

    expect(linha.valor_bruto).toBe(900);
    expect(linha.icms_valor_credito_simples).toBe(12.24);
  });

  it("ignora a redução de base do grupo — o crédito é sobre o valor da operação", () => {
    // `reducao_base_icms` só reduz a base do ICMS **próprio**, e num CSOSN não
    // há próprio nenhum desde B1. O crédito continua sobre os 1000 cheios:
    // 1000 × 1,36/100 = 13,60 (e não 583,30 × 1,36/100 = 7,93).
    const { item: linha } = primeiroItem(taxGroup({ reducaoBaseIcms: 41.67 }));

    expect(linha.icms_reducao_base_calculo).toBeUndefined();
    expect(linha.icms_valor_credito_simples).toBe(13.6);
  });

  it("declara zero quando a alíquota cadastrada é zero — não suprime o campo", () => {
    // Os dois campos são obrigatórios nos grupos `ICMSSN101`/`ICMSSN201`, então
    // zero cadastrado é zero declarado. É o mesmo critério de B1 para alíquota
    // de ICMS zero: presença do campo, nunca "resultado da soma".
    const { item: linha } = primeiroItem(taxGroup(), { credito: 0 });

    expect(linha.icms_aliquota_credito_simples).toBe(0);
    expect(linha.icms_valor_credito_simples).toBe(0);
  });

  it("calcula por item, a partir da mesma alíquota da filial", () => {
    // A alíquota é da filial e vale para toda a nota; o que varia por item é o
    // CSOSN. Aqui um item transfere crédito e o outro não.
    const comCredito = taxGroup();
    const semCredito = taxGroup({ code: "SN102", name: "Simples sem crédito", csosn: "102" });
    const vendaMontada = sale([item(comCredito), item(semCredito)]);

    const resultado = buildNfePayloadFromSale(vendaMontada, [REGRA_SIMPLES_INTERNA], [MVA_CORINGA]);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.payload.items[0].icms_valor_credito_simples).toBe(13.6);
    expect(resultado.payload.items[1].icms_valor_credito_simples).toBeUndefined();
  });
});

describe("crédito de ICMS do Simples Nacional — quais CSOSN o declaram", () => {
  it("CSOSN 201 declara o crédito **e** o ICMS-ST no mesmo item", () => {
    // O grupo `ICMSSN201` soma os campos de ST aos dois do crédito. É a metade
    // que B2 deixou de fora de propósito.
    const { item: linha } = primeiroItem(taxGroup({ code: "SN201", name: "Simples com crédito e ST", csosn: "201" }));

    expect(linha.icms_situacao_tributaria).toBe("201");
    // Crédito: 1000 × 1,36/100 = 13,60
    expect(linha.icms_aliquota_credito_simples).toBe(1.36);
    expect(linha.icms_valor_credito_simples).toBe(13.6);
    // ST: base = 1000 × 1,40 = 1400; valor = 1400 × 18% − 1000 × 18% = 72,00
    expect(linha.icms_base_calculo_st).toBe(1400);
    expect(linha.icms_valor_st).toBe(72);
  });

  it.each(["102", "103", "202", "203", "300", "400", "500"])(
    "CSOSN %s não declara crédito, mesmo com a alíquota cadastrada na filial",
    (csosn) => {
      const { item: linha } = primeiroItem(taxGroup({ csosn }));

      expect(linha.icms_situacao_tributaria).toBe(csosn);
      expect(linha.icms_aliquota_credito_simples).toBeUndefined();
      expect(linha.icms_valor_credito_simples).toBeUndefined();
    },
  );

  it("CSOSN 900 não declara crédito — o catch-all ficou fora de B8 de propósito", () => {
    // O grupo `ICMSSN900` **aceita** `pCredSN`/`vCredICMSSN`, mas como opcional
    // ("?" na tabela de campos). Como a alíquota é cadastro da filial e vale
    // para toda nota, incluí-lo faria o crédito ser declarado automaticamente em
    // operações que o contador marcou como "nenhuma das anteriores" — mesmo
    // critério com que B2 deixou o 900 fora do ST.
    const { item: linha } = primeiroItem(taxGroup({ csosn: "900" }));

    expect(linha.icms_situacao_tributaria).toBe("900");
    expect(linha.icms_aliquota_credito_simples).toBeUndefined();
    expect(linha.icms_valor_credito_simples).toBeUndefined();
    // E continua declarando ICMS próprio, como B1 fixou (é o único CSOSN que o tem).
    expect(linha.icms_base_calculo).toBe(1000);
    expect(linha.icms_valor).toBe(180);
  });

  it.each(["00", "10", "20", "40", "51", "60", "70", "90"])(
    "CST %s (Regime Normal) não declara crédito de Simples",
    (cst) => {
      // O crédito só existe no Simples: no Regime Normal o `vICMS` destacado já
      // **é** o crédito do comprador, e não há campo `pCredSN` em grupo de CST.
      const { item: linha } = primeiroItem(taxGroup({ cstIcms: cst, csosn: null }), {
        regra: REGRA_NORMAL_INTERNA,
      });

      expect(linha.icms_situacao_tributaria).toBe(cst);
      expect(linha.icms_aliquota_credito_simples).toBeUndefined();
      expect(linha.icms_valor_credito_simples).toBeUndefined();
    },
  );
});

describe("crédito de ICMS do Simples Nacional — recusas de cadastro", () => {
  it("recusa o CSOSN 101 quando a filial não tem alíquota de crédito cadastrada", () => {
    // Decisão de B8, e ela contraria a suposição do enunciado: nos grupos
    // `ICMSSN101`/`ICMSSN201` os dois campos são **obrigatórios** no leiaute
    // 4.00, então omiti-los é rejeição de schema ("o conteúdo do elemento
    // ICMSSN101 está incompleto. Esperado pCredSN"). Não há emissão que hoje
    // funcione e que esta recusa quebre — o motor nunca declarou estes campos.
    const erros = errosDe(taxGroup(), { credito: null });

    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain("CSOSN 101");
    expect(erros[0]).toContain("Facilite Testes LTDA");
    expect(erros[0]).toContain("alíquota de crédito");
    // A mensagem tem de oferecer a saída sem cadastro: o CSOSN sem crédito.
    expect(erros[0]).toContain("102");
  });

  it("recusa o CSOSN 201 pelo mesmo motivo", () => {
    const erros = errosDe(taxGroup({ csosn: "201" }), { credito: null });

    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain("CSOSN 201");
  });

  it("não recusa os CSOSN sem permissão de crédito quando a filial não tem alíquota", () => {
    // É o caso da filial do Simples que simplesmente não transfere crédito —
    // ela não precisa cadastrar nada, e nada do que funciona hoje muda.
    const { item: linha } = primeiroItem(taxGroup({ csosn: "102" }), { credito: null });

    expect(linha.icms_situacao_tributaria).toBe("102");
    expect(linha.icms_valor_credito_simples).toBeUndefined();
  });

  it.each([-1, 100.5, 150])("recusa alíquota de crédito fora da faixa de 0 a 100 (%s)", (credito) => {
    // A coluna tem `check` de 0–100, mas a recusa fica também no motor: um
    // crédito absurdo é imposto transferido a mais, e a validação dupla custa
    // duas linhas (mesma lição da `aliquota_icms` sem constraint, em B2).
    const erros = errosDe(taxGroup(), { credito });

    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain("fora da faixa aceitável de 0 a 100");
  });
});

describe("ICMS-ST do Simples — a dedução do próprio que B2 deixou pendente", () => {
  it("deduz o próprio não destacado no CSOSN 201", () => {
    // Antes de B8 o ST saía cheio: 252,00 sobre a base majorada, porque o
    // CSOSN não declara `vICMS` e a dedução chegava zero.
    //   base ST = 1000 × 1,40 = 1400,00
    //   ST      = 1400 × 18% − (1000 × 18%) = 252,00 − 180,00 = 72,00
    const { item: linha } = primeiroItem(taxGroup({ csosn: "201" }));

    expect(linha.icms_base_calculo_st).toBe(1400);
    expect(linha.icms_aliquota_st).toBe(18);
    expect(linha.icms_valor_st).toBe(72);
  });

  it("deduz o próprio não destacado no CSOSN 202", () => {
    // `202` é tributada sem permissão de crédito: a operação própria é
    // tributada do mesmo jeito, então a dedução existe igual — só o crédito
    // não sai.
    const { item: linha } = primeiroItem(taxGroup({ csosn: "202" }));

    expect(linha.icms_valor_st).toBe(72);
    expect(linha.icms_valor_credito_simples).toBeUndefined();
  });

  it("não deduz nada no CSOSN 203 — a operação própria é isenta", () => {
    // `203` é "**isenção** do ICMS no Simples Nacional para faixa de receita
    // bruta, com cobrança de ICMS por ST". Operação isenta não tem imposto
    // para deduzir — o mesmo motivo pelo qual o CST 30 já saía sem dedução.
    //   ST = 1400 × 18% = 252,00
    const { item: linha } = primeiroItem(taxGroup({ csosn: "203" }));

    expect(linha.icms_valor_st).toBe(252);
  });

  it("o próprio deduzido continua **não** aparecendo no XML", () => {
    // A dedução é nocional: existe só dentro da conta do ST. Declarar `vICMS`
    // num grupo `ICMSSN201` seria rejeição de schema.
    const { item: linha } = primeiroItem(taxGroup({ csosn: "201" }));

    expect(linha.icms_base_calculo).toBeUndefined();
    expect(linha.icms_aliquota).toBeUndefined();
    expect(linha.icms_valor).toBeUndefined();
  });

  it("deduz sobre o valor da operação, sem redução de base", () => {
    // Num CSOSN não há base própria reduzida (B1), então nem a base do ST nem a
    // dedução mudam quando o grupo tem `reducao_base_icms`:
    //   base ST = 1000 × 1,40 = 1400,00 (e não 583,30 × 1,40 = 816,62)
    //   ST      = 252,00 − 180,00 = 72,00
    const { item: linha } = primeiroItem(taxGroup({ csosn: "201", reducaoBaseIcms: 41.67 }));

    expect(linha.icms_base_calculo_st).toBe(1400);
    expect(linha.icms_valor_st).toBe(72);
  });

  it("zera em vez de deixar o ST negativo quando não há margem nenhuma", () => {
    // 1000 × 18% − 1000 × 18% = 0. Antes de B8 este item declararia 180,00 de
    // ST sem nenhuma margem agregada, que é imposto sobre nada.
    const semMargem: MvaRuleRow = { ...MVA_CORINGA, mvaOriginal: 0 };
    const { item: linha } = primeiroItem(taxGroup({ csosn: "202" }), { mvaRules: [semMargem] });

    expect(linha.icms_base_calculo_st).toBe(1000);
    expect(linha.icms_valor_st).toBe(0);
  });

  it("deduz com a alíquota interna também em operação interestadual — a limitação herdada de B1", () => {
    // O Simples não usa MVA ajustada nem interestadual (Convênio ICMS
    // 35/2011), então a base do ST é a mesma: 1000 × 1,40 = 1400,00.
    //
    // A dedução usa `group.aliquotaIcms` (18%) e **não** a interestadual (7%
    // para SP → BA). É deliberado: é exatamente o número que o caminho de
    // Regime Normal deduziria na mesma operação, e é a limitação que B2 já
    // registrou (o próprio calculado com a alíquota interna). As duas metades
    // erram junto e serão corrigidas de uma vez, quando existir tabela de
    // alíquota interna por UF × NCM.
    //   ST = 1400 × 18% − 1000 × 18% = 72,00
    const { item: linha } = primeiroItem(taxGroup({ csosn: "201" }), {
      regra: REGRA_SIMPLES_INTERESTADUAL,
      ufDestino: "BA",
    });

    expect(linha.icms_margem_valor_adicionado_st).toBe(40);
    expect(linha.icms_base_calculo_st).toBe(1400);
    expect(linha.icms_valor_st).toBe(72);
  });

  it("o ST deduzido é o que entra no total da nota", () => {
    // O ICMS-ST é imposto **por fora** (regra W16-10): 1000 de mercadoria +
    // 72,00 de ST = 1072,00. Antes de B8 seriam 1252,00.
    const { payload } = primeiroItem(taxGroup({ csosn: "201" }));

    expect(payload.icms_valor_total_st).toBe(72);
    expect(payload.valor_total).toBe(1072);
  });
});

describe("regressões do Regime Normal — nada de B1/B2 mudou", () => {
  it("CST 10 continua deduzindo o próprio que ele destaca", () => {
    //   próprio = 1000 × 18% = 180,00 (declarado)
    //   ST      = 1400 × 18% − 180,00 = 72,00
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: "10", csosn: null }), {
      regra: REGRA_NORMAL_INTERNA,
    });

    expect(linha.icms_valor).toBe(180);
    expect(linha.icms_valor_st).toBe(72);
  });

  it("CST 30 continua cobrando o ST inteiro, sem dedução", () => {
    // Isenta/não tributada com cobrança de ST: não há próprio para descontar.
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: "30", csosn: null }), {
      regra: REGRA_NORMAL_INTERNA,
    });

    expect(linha.icms_valor).toBeUndefined();
    expect(linha.icms_valor_st).toBe(252);
  });

  it("CST 70 (com redução de base) continua partindo da base reduzida", () => {
    //   base própria = 1000 × (1 − 41,67/100) = 583,30
    //   próprio      = 583,30 × 18% = 104,99
    //   base ST      = 583,30 × 1,40 = 816,62
    //   ST           = 816,62 × 18% − 104,99 = 146,99 − 104,99 = 42,00
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: "70", csosn: null, reducaoBaseIcms: 41.67 }), {
      regra: REGRA_NORMAL_INTERNA,
    });

    expect(linha.icms_base_calculo).toBe(583.3);
    expect(linha.icms_valor).toBe(104.99);
    expect(linha.icms_base_calculo_st).toBe(816.62);
    expect(linha.icms_valor_st).toBe(42);
  });
});
