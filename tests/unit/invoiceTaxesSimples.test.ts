import { describe, expect, it } from "vitest";

import {
  buildNfcePayloadFromSale,
  buildNfePayloadFromSale,
  buildReturnNfePayload,
  type SaleForInvoice,
  type SaleForInvoiceItem,
  type SaleReturnForInvoice,
} from "@fiscal-core/invoiceMapping.ts";
import type { MvaRuleRow } from "@fiscal-core/mvaRules.ts";
import type { TaxGroup } from "@fiscal-core/taxGroups.ts";
import type { TaxRuleRow } from "@fiscal-core/taxRules.ts";

/**
 * Bateria do Simples Nacional (B8, 03/09/2026): o crédito de ICMS do CSOSN
 * `101`/`201` (`pCredSN`/`vCredICMSSN`) e a dedução do ICMS próprio no ST dos
 * CSOSN `201`/`202`, que B2 tinha deixado registrada como limitação.
 *
 * Em 04/09/2026 ganhou o último bloco: a **elegibilidade do destinatário** ao
 * crédito. O art. 23 da LC 123/2006 só dá o direito a quem **não** é optante
 * pelo Simples, e B8 declarava o crédito sem olhar o cliente — o achado
 * adjacente que ela própria registrou para tarefa própria.
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
  options: {
    ufDestino?: string;
    regime?: string;
    credito?: number | null;
    /**
     * CRT do **cliente**. `undefined` deixa o cadastro como estava antes de
     * 04/09/2026 (nulo = "não sei"); os testes que tratam da elegibilidade do
     * destinatário passam `"1"`, `"2"`, `"3"` ou `"4"` explicitamente.
     */
    regimeCliente?: string | null;
  } = {},
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
      regimeTributario: options.regimeCliente ?? null,
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
  regimeCliente?: string | null;
};

/** Emite e devolve o primeiro item do payload, falhando alto se a montagem recusar. */
function primeiroItem(group: TaxGroup, options: Opcoes = {}) {
  const regra = options.regra ?? REGRA_SIMPLES_INTERNA;
  const vendaMontada = sale([item(group, options.itemOverrides)], {
    ufDestino: options.ufDestino,
    regime: options.regime ?? regra.regime,
    credito: options.credito,
    regimeCliente: options.regimeCliente,
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
      regimeCliente: options.regimeCliente,
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

  it("deduz com a alíquota interestadual quando a operação cruza a fronteira", () => {
    // Este teste existia ao contrário até 03/09/2026: ele afirmava que a
    // dedução usava a interna (18%) mesmo interestadual, documentando a
    // limitação que B8 herdou de B1 de propósito para "as duas metades errarem
    // junto". A correção de 04/09/2026 arruma as duas metades, e o
    // espelhamento continua de pé — só que agora reflete a conta certa.
    //
    // A dedução implícita existe para reproduzir "a alíquota utilizada na
    // operação pelos contribuintes do regime normal": numa venda SP → BA esse
    // contribuinte destacaria 7% (Resolução 22/89), não a interna do estado
    // dele. O Simples continua sem MVA ajustada (Convênio ICMS 35/2011), então
    // a base do ST não muda: 1000 × 1,40 = 1400,00.
    //   dedução = 1000 × 7%  =  70,00
    //   ST      = 1400 × 18% − 70,00 = 252,00 − 70,00 = 182,00
    const { item: linha } = primeiroItem(taxGroup({ csosn: "201" }), {
      regra: REGRA_SIMPLES_INTERESTADUAL,
      ufDestino: "BA",
    });

    expect(linha.icms_margem_valor_adicionado_st).toBe(40);
    expect(linha.icms_base_calculo_st).toBe(1400);
    expect(linha.icms_valor_st).toBe(182);
  });

  it("deduz com a alíquota interestadual também no CSOSN 202", () => {
    // A dedução implícita vale para os dois CSOSN que a têm, e a correção de
    // 04/09/2026 alcança os dois — não só o `201` do teste acima.
    //   ST = 1400 × 18% − 1000 × 7% = 252,00 − 70,00 = 182,00
    const { item: linha } = primeiroItem(taxGroup({ csosn: "202" }), {
      regra: REGRA_SIMPLES_INTERESTADUAL,
      ufDestino: "BA",
    });

    expect(linha.icms_valor_st).toBe(182);
  });

  it("usa a alíquota de 4% na dedução quando a mercadoria é importada", () => {
    // A dedução passa pela mesma tabela do ICMS próprio, inclusive a Resolução
    // 13/2012: origem `1` (importação direta) é 4%, não 7%.
    //   ST = 1400 × 18% − 1000 × 4% = 252,00 − 40,00 = 212,00
    const grupo = taxGroup({ csosn: "201" });
    const { item: linha } = primeiroItem(grupo, {
      regra: REGRA_SIMPLES_INTERESTADUAL,
      ufDestino: "BA",
      itemOverrides: { product: { ...item(grupo).product, origemMercadoria: "1" } },
    });

    expect(linha.icms_valor_st).toBe(212);
  });

  it("continua deduzindo pela alíquota interna quando a operação é interna", () => {
    // Regressão da correção de 04/09/2026: intraestadual não mudou nada.
    //   ST = 1400 × 18% − 1000 × 18% = 252,00 − 180,00 = 72,00
    const { item: linha } = primeiroItem(taxGroup({ csosn: "201" }));

    expect(linha.icms_valor_st).toBe(72);
  });

  it("o CSOSN 900 fica fora da correção — o Simples não apura ICMS por operação", () => {
    // Exclusão deliberada, documentada em `icmsProprioIgnoraAliquotaInterestadual`:
    // o `900` é o único CSOSN que declara `vBC`/`pICMS`/`vICMS`, e se ele
    // deveria distinguir operação interna de interestadual é pergunta legal
    // própria — o optante recolhe o ICMS pelo DAS, sobre a receita bruta do
    // mês, não por alíquota-por-operação. Mesmo critério com que B2 o deixou
    // fora do ST e B8 fora do crédito de Simples.
    //   próprio = 1000 × 18% (a interna do grupo), e não 7%
    const { item: linha } = primeiroItem(taxGroup({ csosn: "900" }), {
      regra: REGRA_SIMPLES_INTERESTADUAL,
      ufDestino: "BA",
    });

    expect(linha.icms_situacao_tributaria).toBe("900");
    expect(linha.icms_aliquota).toBe(18);
    expect(linha.icms_valor).toBe(180);
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

/**
 * A elegibilidade do destinatário (correção de 04/09/2026).
 *
 * LC 123/2006, art. 23: o *caput* veda ao optante "a apropriação" de créditos
 * do Simples, e o §1º dá o direito só às pessoas jurídicas "não optantes". Uma
 * NF-e com CSOSN `101`/`201` para um cliente optante declararia um benefício
 * que não existe naquela operação — e é isso que passa a ser recusado.
 */
describe("crédito de ICMS do Simples Nacional — o direito do destinatário", () => {
  it("recusa CSOSN 101 quando o cliente está cadastrado como optante (CRT 1)", () => {
    const [erro] = errosDe(taxGroup(), { regimeCliente: "1" });

    expect(erro).toContain("Cliente Contribuinte LTDA");
    expect(erro).toContain("Simples com crédito");
    expect(erro).toContain("CSOSN 101");
    expect(erro).toContain("optante pelo Simples");
    // A base legal na própria mensagem, como nas recusas de B1/B2/B5/B8.
    expect(erro).toContain("art. 23");
    expect(erro).toContain("LC 123/2006");
    // E o que fazer: os dois caminhos de saída.
    expect(erro).toContain("CSOSN 102 ou 202");
    expect(erro).toContain("Clientes e Fornecedores");
  });

  it("recusa CSOSN 201 pelo mesmo motivo — o crédito é a dimensão, não o ST", () => {
    const [erro] = errosDe(taxGroup({ csosn: "201" }), { regimeCliente: "1" });

    expect(erro).toContain("CSOSN 201");
    expect(erro).toContain("optante pelo Simples");
  });

  it("recusa também o CRT 2 (Simples com excesso de sublimite)", () => {
    // Continua sendo optante: o excesso de sublimite muda o recolhimento do
    // ICMS, não a condição de optante do art. 23.
    expect(errosDe(taxGroup(), { regimeCliente: "2" })[0]).toContain("optante pelo Simples");
  });

  it("recusa também o CRT 4 (MEI)", () => {
    // O `4` entrou no leiaute pela NT 2024.001. O MEI é microempresa optante
    // por definição, então está tão fora do §1º quanto um CRT 1.
    expect(errosDe(taxGroup(), { regimeCliente: "4" })[0]).toContain("optante pelo Simples");
  });

  it("cliente sem regime cadastrado continua emitindo — nulo é 'não sei', não recusa", () => {
    // A regressão central da correção: é o estado de TODO contato no dia em que
    // a migration roda. Recusar aqui quebraria toda emissão 101/201 que hoje
    // funciona.
    const { item: linha } = primeiroItem(taxGroup(), { regimeCliente: null });

    expect(linha.icms_aliquota_credito_simples).toBe(1.36);
    expect(linha.icms_valor_credito_simples).toBe(13.6);
  });

  it("cliente de Regime Normal (CRT 3) emite o crédito normalmente", () => {
    // É exatamente o destinatário do §1º: "pessoas jurídicas (…) não optantes
    // pelo Simples Nacional terão direito a crédito".
    const { item: linha } = primeiroItem(taxGroup(), { regimeCliente: "3" });

    expect(linha.icms_aliquota_credito_simples).toBe(1.36);
    expect(linha.icms_valor_credito_simples).toBe(13.6);
  });

  it("regime desconhecido não recusa — lista de inclusão, como as demais", () => {
    // Código que este motor não conhece (cadastro digitado errado, tabela nova)
    // segue o comportamento anterior à correção, em vez de recusar por engano.
    const { item: linha } = primeiroItem(taxGroup(), { regimeCliente: "7" });

    expect(linha.icms_valor_credito_simples).toBe(13.6);
  });

  it("CSOSN 102 vendido a cliente optante nunca recusa por este motivo", () => {
    // Não transferir crédito a quem não pode aproveitá-lo é o cadastro certo,
    // não uma lacuna — art. 23, §4º, II.
    const { item: linha } = primeiroItem(taxGroup({ csosn: "102", name: "Simples sem crédito" }), {
      regimeCliente: "1",
    });

    expect(linha.icms_situacao_tributaria).toBe("102");
    expect(linha.icms_aliquota_credito_simples).toBeUndefined();
    expect(linha.icms_valor_credito_simples).toBeUndefined();
  });

  it("CSOSN 202 vendido a cliente optante emite, com o ST intacto", () => {
    const { item: linha } = primeiroItem(taxGroup({ csosn: "202", name: "Simples ST sem crédito" }), {
      regimeCliente: "1",
    });

    expect(linha.icms_valor_credito_simples).toBeUndefined();
    // A dedução do próprio não destacado (B8) segue valendo: 1400 × 18% − 180.
    expect(linha.icms_valor_st).toBe(72);
  });

  it("a recusa vem antes da alíquota da filial, e é a que o operador lê", () => {
    // Com os dois cadastros errados ao mesmo tempo, a mensagem útil é a da
    // elegibilidade: cadastrar a alíquota não faria a nota sair.
    const erros = errosDe(taxGroup(), { regimeCliente: "1", credito: null });

    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain("optante pelo Simples");
    expect(erros[0]).not.toContain("Configurações");
  });

  it("nomeia o item quando só um dos dois produtos da nota tem CSOSN com crédito", () => {
    const vendaMontada = sale(
      [
        item(taxGroup({ csosn: "102", name: "Sem crédito" })),
        item(taxGroup({ id: "g2", name: "Com crédito" })),
      ],
      { regimeCliente: "1" },
    );
    const resultado = buildNfePayloadFromSale(vendaMontada, [REGRA_SIMPLES_INTERNA], [MVA_CORINGA]);

    if (resultado.ok) throw new Error("Esperava recusa, mas a emissão passou.");
    expect(resultado.errors).toHaveLength(1);
    expect(resultado.errors[0]).toContain("Com crédito");
    expect(resultado.errors[0]).not.toContain("Sem crédito");
  });
});

describe("crédito de ICMS do Simples Nacional — quem faz a checagem e quem não faz", () => {
  /** NFC-e: sempre interna, sempre consumidor final — ver `buildNfcePayloadFromSale`. */
  const REGRA_NFCE: TaxRuleRow = {
    id: "venda-nfce",
    regime: "1",
    naturezaOperacao: "venda",
    ufOrigem: "SP",
    ufDestino: "SP",
    tipoCliente: "consumidor_final",
    cfop: "5102",
  };

  /** A devolução da mesma venda: CFOP de entrada. */
  const REGRA_DEVOLUCAO: TaxRuleRow = {
    id: "devolucao-simples-interna",
    regime: "1",
    naturezaOperacao: "devolucao",
    ufOrigem: "SP",
    ufDestino: "SP",
    tipoCliente: "contribuinte",
    cfop: "1202",
  };

  /** A devolução da venda montada, com o mesmo cliente e os mesmos itens. */
  function devolucaoDe(vendaMontada: SaleForInvoice): SaleReturnForInvoice {
    return {
      code: "D-0001",
      saleCode: vendaMontada.code,
      issueDate: vendaMontada.issueDate,
      totalAmount: vendaMontada.totalAmount,
      discountAmount: 0,
      originalChave: null,
      branch: vendaMontada.branch,
      contact: vendaMontada.contact,
      items: vendaMontada.items,
    };
  }

  it("NFC-e com cliente optante e CSOSN 101 continua emitindo — decisão de escopo", () => {
    // O modelo 65 declara `consumidor_final: 1` sempre, é presencial e não
    // exige cliente identificado; ligar a checagem nele contradiria a decisão
    // de design já tomada para ele. A consequência que B8 registrou (o crédito
    // sai numa nota que ninguém aproveita) segue sendo do CSOSN do cadastro.
    const resultado = buildNfcePayloadFromSale(
      sale([item(taxGroup())], { regimeCliente: "1" }),
      [REGRA_NFCE],
      [MVA_CORINGA],
    );

    if (!resultado.ok) throw new Error(`Emissão recusada: ${resultado.errors.join(" | ")}`);
    expect(resultado.payload.items[0].icms_valor_credito_simples).toBe(13.6);
  });

  it("devolução herda a checagem: cliente optante recusa também na nota de entrada", () => {
    // Mesmo cliente identificado da venda original — se aquela venda não podia
    // transferir crédito, esta nota não pode reverter o que não existiu.
    const resultado = buildReturnNfePayload(
      devolucaoDe(sale([item(taxGroup())], { regimeCliente: "1" })),
      [REGRA_DEVOLUCAO],
      [MVA_CORINGA],
    );

    if (resultado.ok) throw new Error("Esperava recusa, mas a emissão passou.");
    expect(resultado.errors[0]).toContain("optante pelo Simples");
    expect(resultado.errors[0]).toContain("art. 23");
  });

  it("devolução de cliente de Regime Normal continua revertendo o crédito", () => {
    const resultado = buildReturnNfePayload(
      devolucaoDe(sale([item(taxGroup())], { regimeCliente: "3" })),
      [REGRA_DEVOLUCAO],
      [MVA_CORINGA],
    );

    if (!resultado.ok) throw new Error(`Emissão recusada: ${resultado.errors.join(" | ")}`);
    expect(resultado.payload.finalidade_emissao).toBe(4);
    expect(resultado.payload.items[0].icms_valor_credito_simples).toBe(13.6);
  });
});
