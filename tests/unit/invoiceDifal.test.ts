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
 * Bateria do **DIFAL da EC 87/2015** — o grupo `ICMSUFDest` (B4, 04/09/2026).
 *
 * Arquivo separado pelo mesmo critério de sempre: é uma dimensão própria do
 * mesmo item, como o próprio (B1), o ST (B2), o ad rem (B5), o Simples (B8) e
 * a alíquota interestadual (04/09/2026) já foram.
 *
 * O que ela defende é a segunda metade da conta que aquela última correção
 * deixou aberta de propósito: a partir do momento em que a venda interestadual
 * destaca a alíquota **interestadual**, existe a diferença até a alíquota
 * interna do destino, e o art. 155, §2º, VII, da Constituição (EC 87/2015) dá
 * essa diferença ao estado de destino. No XML é o grupo `ICMSUFDest`, exigido
 * pela regra `NA01-20` sempre que `idDest = 2`, `indFinal = 1` e
 * `indIEDest = 9` valem juntos — a combinação que a correção da Rejeição 696
 * fez virar rotina, trocando a rejeição 696 pela 694.
 *
 * As contas continuam escritas por extenso nos comentários, pelo mesmo motivo
 * de B1: um teste que compara com `taxAmount(...)` reimplementa o código que
 * deveria estar conferindo.
 */

/** SP → BA: Sudeste para Nordeste, a faixa dos 7% (Resolução do Senado 22/89). */
const REGRA_BA: TaxRuleRow = {
  id: "venda-ba",
  regime: "3",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "BA",
  tipoCliente: "nao_contribuinte",
  cfop: "6108",
};

/** A mesma SP → BA, para o cliente que o CFOP trata como contribuinte. */
const REGRA_BA_CONTRIBUINTE: TaxRuleRow = {
  id: "venda-ba-contribuinte",
  regime: "3",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "BA",
  tipoCliente: "contribuinte",
  cfop: "6102",
};

/** SP → BA, mas o CPF: `resolveTipoCliente` devolve `consumidor_final` para não-CNPJ. */
const REGRA_BA_CONSUMIDOR: TaxRuleRow = {
  id: "venda-ba-consumidor",
  regime: "3",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "BA",
  tipoCliente: "consumidor_final",
  cfop: "6108",
};

/** SP → SP: a operação interna, onde o DIFAL não existe. */
const REGRA_INTERNA: TaxRuleRow = {
  id: "venda-interna",
  regime: "3",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "SP",
  tipoCliente: "nao_contribuinte",
  cfop: "5102",
};

/** SP → BA de quem emite no Simples Nacional (CRT 1) — a exceção 12 da `NA01-20`. */
const REGRA_SIMPLES_BA: TaxRuleRow = {
  id: "venda-simples-ba",
  regime: "1",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "BA",
  tipoCliente: "nao_contribuinte",
  cfop: "6108",
};

/** SP → BA de quem está no Simples com excesso de sublimite (CRT 2) — **não** é exceção. */
const REGRA_SUBLIMITE_BA: TaxRuleRow = {
  ...REGRA_SIMPLES_BA,
  id: "venda-sublimite-ba",
  regime: "2",
};

/** SP → BA de MEI (CRT 4) — exceção desde a NT 2024.001. */
const REGRA_MEI_BA: TaxRuleRow = {
  ...REGRA_SIMPLES_BA,
  id: "venda-mei-ba",
  regime: "4",
};

/** NFC-e: sempre interna, sempre consumidor final — ver `buildNfcePayloadFromSale`. */
const REGRA_NFCE: TaxRuleRow = {
  id: "venda-nfce",
  regime: "3",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "SP",
  tipoCliente: "consumidor_final",
  cfop: "5102",
};

/** A devolução tem `natureza_operacao` própria — CFOP de entrada. */
const REGRA_DEVOLUCAO_BA: TaxRuleRow = {
  id: "devolucao-ba",
  regime: "3",
  naturezaOperacao: "devolucao",
  ufOrigem: "SP",
  ufDestino: "BA",
  tipoCliente: "nao_contribuinte",
  cfop: "2202",
};

const NCM = "22021000";

/** NCM × UF **sem** FCP cadastrado — `fcp_aliquota` nula é "este estado não cobra". */
const MVA_SEM_FCP: MvaRuleRow = {
  id: "mva-sem-fcp",
  ncm: NCM,
  ufDestino: "*",
  mvaOriginal: 40,
  fcpAliquota: null,
};

/** A mesma linha, com os 2% de FCP que a Bahia cobra — `pFCPUFDest` sai daqui. */
const MVA_COM_FCP: MvaRuleRow = {
  ...MVA_SEM_FCP,
  id: "mva-com-fcp",
  fcpAliquota: 2,
};

/** Grupo de CST 00 (tributada integralmente, sem ST) a 18% — a "interna do destino". */
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

const MUNICIPIOS: Record<string, string> = { SP: "São Paulo", BA: "Salvador" };

/**
 * O destinatário é a variável central desta bateria: é dele que saem as duas
 * condições de destinatário da `NA01-20`, e desde a correção da Rejeição 696
 * as duas vêm do mesmo lugar (`indIEDest = 9` ⟺ `indFinal = 1`).
 */
type Destinatario = { document: string; indicadorIe: string | null; inscricaoEstadual: string | null };

/** CNPJ sem IE cadastrada: `indIEDest = 9`, `indFinal = 1` — o caso central do DIFAL. */
const CNPJ_NAO_CONTRIBUINTE: Destinatario = {
  document: "11222333000181",
  indicadorIe: null,
  inscricaoEstadual: null,
};

/** CNPJ contribuinte (`indicador_ie = "1"`): `indIEDest = 1`, e o grupo é **proibido**. */
const CNPJ_CONTRIBUINTE: Destinatario = {
  document: "11222333000181",
  indicadorIe: "1",
  inscricaoEstadual: "987654321",
};

/** CPF sem IE: também `indIEDest = 9` — a pessoa física é o caso mais comum. */
const CPF: Destinatario = { document: "39053344705", indicadorIe: null, inscricaoEstadual: null };

function sale(
  items: SaleForInvoiceItem[],
  options: { ufDestino?: string; regime?: string; destinatario?: Destinatario } = {},
): SaleForInvoice {
  const ufDestino = options.ufDestino ?? "BA";
  const destinatario = options.destinatario ?? CNPJ_NAO_CONTRIBUINTE;
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
      document: destinatario.document,
      inscricaoEstadual: destinatario.inscricaoEstadual,
      indicadorIe: destinatario.indicadorIe,
      // Regime do cliente não cadastrado: nulo é "não sei" e não recusa nada.
      regimeTributario: null,
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
    destinatario?: Destinatario;
  } = {},
) {
  const regra = options.regra ?? REGRA_BA;
  const vendaMontada = sale([item(group, options.itemOverrides)], {
    ufDestino: regra.ufDestino,
    regime: regra.regime,
    destinatario: options.destinatario,
  });
  const resultado = buildNfePayloadFromSale(vendaMontada, [regra], options.mvaRules ?? []);
  if (!resultado.ok) throw new Error(`Emissão recusada: ${resultado.errors.join(" | ")}`);
  return { item: resultado.payload.items[0], payload: resultado.payload };
}

/** Os nove campos do grupo `ICMSUFDest`, para as regressões afirmarem a ausência de todos. */
const CAMPOS_DIFAL = [
  "icms_base_calculo_uf_destino",
  "fcp_base_calculo_uf_destino",
  "fcp_percentual_uf_destino",
  "icms_aliquota_interna_uf_destino",
  "icms_aliquota_interestadual",
  "icms_percentual_partilha",
  "fcp_valor_uf_destino",
  "icms_valor_uf_destino",
  "icms_valor_uf_remetente",
] as const;

function esperaSemDifal(linha: Record<string, unknown>) {
  for (const campo of CAMPOS_DIFAL) expect(linha[campo]).toBeUndefined();
}

describe("DIFAL da EC 87/2015 — o caso central", () => {
  it("venda interestadual a CNPJ não contribuinte, com FCP cadastrado: o grupo completo", () => {
    // SP → BA, item de 1.000,00, interna do destino 18% (aproximada pelo
    // grupo), interestadual 7%, FCP da Bahia 2%.
    //   vBCUFDest      = 1.000,00 (base única, Convênio ICMS 236/2021)
    //   pICMSUFDest    = 18%   pICMSInter = 7%   pICMSInterPart = 100
    //   vICMSUFDest    = 1.000 × (18 − 7)% × 100% = 110,00
    //   vICMSUFRemet   = 1.000 × (18 − 7)% ×   0% =   0,00
    //   vFCPUFDest     = 1.000 × 2% = 20,00
    const { item: linha } = primeiroItem(taxGroup(), { mvaRules: [MVA_COM_FCP] });

    expect(linha.icms_base_calculo_uf_destino).toBe(1000);
    expect(linha.icms_aliquota_interna_uf_destino).toBe(18);
    expect(linha.icms_aliquota_interestadual).toBe(7);
    expect(linha.icms_percentual_partilha).toBe(100);
    expect(linha.icms_valor_uf_destino).toBe(110);
    expect(linha.icms_valor_uf_remetente).toBe(0);

    expect(linha.fcp_base_calculo_uf_destino).toBe(1000);
    expect(linha.fcp_percentual_uf_destino).toBe(2);
    expect(linha.fcp_valor_uf_destino).toBe(20);
  });

  it("a soma das duas metades é o imposto pela alíquota interna do destino", () => {
    // A leitura que dá sentido à conta: o vendedor destaca 7% para a origem, o
    // destino fica com os 11 pontos que faltam, e a carga total da mercadoria é
    // a mesma que ela teria se fosse comprada dentro da Bahia.
    //   próprio (origem) = 1.000 × 7%  =  70,00
    //   DIFAL  (destino) = 1.000 × 11% = 110,00
    //   soma             =               180,00 = 1.000 × 18%
    const { item: linha } = primeiroItem(taxGroup());

    expect(linha.icms_valor).toBe(70);
    expect(linha.icms_valor_uf_destino).toBe(110);
    expect(linha.icms_valor! + linha.icms_valor_uf_destino!).toBe(180);
  });

  it("sem FCP cadastrado para o NCM × UF, o grupo sai sem os três campos de FCP", () => {
    // `fcp_aliquota` nula em `mva_rules` significa "este estado não cobra FCP
    // neste NCM" — não zero. E **não ter linha nenhuma** significa o mesmo: ao
    // contrário do ICMS-ST, a ausência de cadastro não recusa aqui.
    const { item: comLinhaSemFcp } = primeiroItem(taxGroup(), { mvaRules: [MVA_SEM_FCP] });
    const { item: semLinhaNenhuma } = primeiroItem(taxGroup(), { mvaRules: [] });

    for (const linha of [comLinhaSemFcp, semLinhaNenhuma]) {
      // O DIFAL sai inteiro...
      expect(linha.icms_valor_uf_destino).toBe(110);
      // ...e o FCP não sai de jeito nenhum.
      expect(linha.fcp_base_calculo_uf_destino).toBeUndefined();
      expect(linha.fcp_percentual_uf_destino).toBeUndefined();
      expect(linha.fcp_valor_uf_destino).toBeUndefined();
    }
  });

  it("venda interestadual a CPF: mesmo cálculo, pelo mesmo `indIEDest = 9`", () => {
    // A pessoa física é o caso mais comum do DIFAL (e-commerce), e chega aqui
    // pelo mesmo caminho do CNPJ sem IE — `resolveConsumidorFinal` deriva o
    // `indFinal` do código do `indIEDest`, e um CPF sem IE resolve 9.
    const { item: linha, payload } = primeiroItem(taxGroup(), {
      regra: REGRA_BA_CONSUMIDOR,
      destinatario: CPF,
      mvaRules: [MVA_COM_FCP],
    });

    expect(payload.indicador_inscricao_estadual_destinatario).toBe(9);
    expect(payload.consumidor_final).toBe(1);
    expect(linha.icms_valor_uf_destino).toBe(110);
    expect(linha.fcp_valor_uf_destino).toBe(20);
  });

  it("a alíquota interestadual do grupo é a mesma que o item destacou", () => {
    // Ponto de schema: `pICMSInter` sai duas vezes na mesma nota (uma no
    // `ICMS00`, outra no `ICMSUFDest`) e o fisco confere cada grupo por si. Se
    // divergissem, a nota não fecharia consigo mesma.
    const { item: linha } = primeiroItem(taxGroup(), {
      itemOverrides: comOrigem(taxGroup(), "1"),
    });

    // Origem `1` (importada) → 4% pela Resolução 13/2012, nos dois campos.
    expect(linha.icms_aliquota).toBe(4);
    expect(linha.icms_aliquota_interestadual).toBe(4);
    //   DIFAL = 1.000 × (18 − 4)% = 140,00
    expect(linha.icms_valor_uf_destino).toBe(140);
  });

  it("o `vICMSUFDest` fecha a fórmula da regra NA15-10", () => {
    // `vBCUFDest × (pICMSUFDest − pICMSInter) × pICMSInterPart`, conferida com
    // os campos do próprio item — é o que a rejeição 815 recalcula.
    const { item: linha } = primeiroItem(taxGroup({ aliquotaIcms: 20.5 }));

    const esperado =
      Math.round(
        linha.icms_base_calculo_uf_destino! *
          ((linha.icms_aliquota_interna_uf_destino! - linha.icms_aliquota_interestadual!) / 100) *
          (linha.icms_percentual_partilha! / 100) *
          100,
      ) / 100;
    expect(linha.icms_valor_uf_destino).toBe(esperado);
  });

  it("a redução de base do ICMS alcança o DIFAL (Convênio ICMS 153/2015)", () => {
    // Base única: a mesma base do próprio, já reduzida.
    //   base  = 1.000 × (1 − 41,67/100) = 583,30
    //   DIFAL = 583,30 × (18 − 7)% = 64,16 (64,163 arredondado)
    const { item: linha } = primeiroItem(taxGroup({ reducaoBaseIcms: 41.67 }));

    expect(linha.icms_base_calculo).toBe(583.3);
    expect(linha.icms_base_calculo_uf_destino).toBe(583.3);
    expect(linha.icms_valor_uf_destino).toBe(64.16);
  });

  it("zera em vez de sair negativo quando a interna do destino é menor que a interestadual", () => {
    // Só acontece com a aproximação de `group.aliquotaIcms` abaixo da alíquota
    // do trajeto — cadastro incoerente com a operação, não caso legal. Um DIFAL
    // negativo não existe no leiaute, e é o mesmo critério do ICMS-ST.
    const { item: linha } = primeiroItem(taxGroup({ aliquotaIcms: 4 }));

    expect(linha.icms_aliquota_interestadual).toBe(7);
    expect(linha.icms_valor_uf_destino).toBe(0);
    expect(linha.icms_valor_uf_remetente).toBe(0);
  });
});

describe("os totais do DIFAL no cabeçalho", () => {
  it("somam os itens e **não** entram no `valor_total` da nota", () => {
    // A diferença que separa o DIFAL do IPI e do ICMS-ST: a regra W16-10 não o
    // lista entre as parcelas de `vNF`. Ele já está no preço da mercadoria —
    // é o que a base única do Convênio ICMS 236/2021 significa.
    const grupo = taxGroup();
    const resultado = buildNfePayloadFromSale(sale([item(grupo), item(grupo)]), [REGRA_BA], [MVA_COM_FCP]);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    // Dois itens de 1.000: DIFAL 110 cada, FCP 20 cada.
    expect(resultado.payload.icms_valor_total_uf_destino).toBe(220);
    expect(resultado.payload.fcp_valor_total_uf_destino).toBe(40);
    expect(resultado.payload.icms_valor_total_uf_remetente).toBe(0);
    // 2.000 e não 2.220 nem 2.260.
    expect(resultado.payload.valor_total).toBe(2000);
  });

  it("ficam ausentes quando nenhum item declarou DIFAL", () => {
    const resultado = buildNfePayloadFromSale(
      sale([item(taxGroup())], { ufDestino: "SP" }),
      [REGRA_INTERNA],
      [MVA_COM_FCP],
    );
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.payload.icms_valor_total_uf_destino).toBeUndefined();
    expect(resultado.payload.icms_valor_total_uf_remetente).toBeUndefined();
    expect(resultado.payload.fcp_valor_total_uf_destino).toBeUndefined();
  });

  it("`total` de FCP-ST e `total` de FCP da UF de destino são campos distintos", () => {
    // Um item com CST 10 e FCP cadastrado tem os **dois** FCP: o retido por ST
    // (B2, no `vFCPST`) e o da operação própria (B4, no `vFCPUFDest`). Somá-los
    // num campo só apagaria a distinção que o XML faz.
    const resultado = buildNfePayloadFromSale(
      sale([item(taxGroup({ cstIcms: "10" }))]),
      [REGRA_BA],
      [MVA_COM_FCP],
    );
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.payload.fcp_valor_total_st).toBeDefined();
    expect(resultado.payload.fcp_valor_total_uf_destino).toBe(20);
    expect(resultado.payload.fcp_valor_total_st).not.toBe(resultado.payload.fcp_valor_total_uf_destino);
  });
});

describe("quando o grupo ICMSUFDest **não** sai", () => {
  it("a UF do cliente em minúsculas continua sendo operação interna", () => {
    // `local_destino` e o gatilho do DIFAL saem da **mesma** normalização de
    // UF (correção da revisão de B4). Antes, a comparação crua do cabeçalho
    // declarava `idDest = 2` enquanto `operacaoInterestadual` dizia "interna" —
    // e uma nota com `idDest = 2`, `indFinal = 1` e `indIEDest = 9` sem o grupo
    // `ICMSUFDest` é justamente a rejeição 694 que B4 fecha.
    const vendaMontada = sale([item(taxGroup())], { ufDestino: "sp" });
    const resultado = buildNfePayloadFromSale(vendaMontada, [REGRA_INTERNA], [MVA_COM_FCP]);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.payload.local_destino).toBe(1);
    esperaSemDifal(resultado.payload.items[0]);
  });

  it("venda interna: nenhum campo de DIFAL — regressão", () => {
    // A metade que não podia mudar. `idDest = 1` derruba a `NA01-20` sozinho, e
    // a `NA01-30` (rejeição 695) proíbe o grupo aqui.
    const { item: linha, payload } = primeiroItem(taxGroup(), {
      regra: REGRA_INTERNA,
      mvaRules: [MVA_COM_FCP],
    });

    expect(payload.local_destino).toBe(1);
    expect(linha.icms_valor).toBe(180);
    esperaSemDifal(linha);
  });

  it("venda interestadual a CNPJ contribuinte: sem DIFAL — a lacuna conhecida", () => {
    // `indicador_ie = "1"` → `indIEDest = 1` → `indFinal = 0`, e a `NA01-30`
    // **proíbe** o grupo. Não há rejeição a temer.
    //
    // O que fica de fora é o contribuinte que compra para **uso e consumo**:
    // ele também é consumidor final para efeito de DIFAL, e continua sem. Isso
    // não é bug desta tarefa e nem lacuna que ela pudesse fechar — a pesquisa
    // do art. 23, §1º (04/09/2026) já decidiu, com fonte, que a destinação da
    // mercadoria é atributo da **aquisição** e não do cadastro do cliente. A
    // correção certa é a mesma que aquela entrada apontou: um indicador de
    // finalidade da aquisição por venda.
    const { item: linha, payload } = primeiroItem(taxGroup(), {
      regra: REGRA_BA_CONTRIBUINTE,
      destinatario: CNPJ_CONTRIBUINTE,
      mvaRules: [MVA_COM_FCP],
    });

    expect(payload.indicador_inscricao_estadual_destinatario).toBe(1);
    expect(payload.consumidor_final).toBe(0);
    // O ICMS próprio continua saindo pela interestadual — isto não mudou.
    expect(linha.icms_valor).toBe(70);
    esperaSemDifal(linha);
  });

  it.each([
    ["40", "isenta"],
    ["41", "não tributada"],
  ])("CST %s (%s): exceção 10 da NA01-20 — regressão", (cst) => {
    // Operação sem imposto não tem diferença a repartir, e a regra dispensa o
    // grupo nominalmente. Estes CST também não declaram ICMS próprio (B1).
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: cst }), { mvaRules: [MVA_COM_FCP] });

    expect(linha.icms_valor).toBeUndefined();
    esperaSemDifal(linha);
  });

  it.each(["103", "300", "400"])("CSOSN %s: exceção 10 da NA01-20 — regressão", (csosn) => {
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: null, csosn }), {
      regra: REGRA_SUBLIMITE_BA,
      mvaRules: [MVA_COM_FCP],
    });

    esperaSemDifal(linha);
  });

  it("NFC-e nunca gera DIFAL, nem com cliente de outro estado — regressão", () => {
    // `buildNfcePayloadFromSale` força `ufDestino = branch.uf`, então a
    // operação nunca é interestadual. A rejeição 807 existe justamente para o
    // modelo 65 nunca declarar este grupo.
    const resultado = buildNfcePayloadFromSale(sale([item(taxGroup())]), [REGRA_NFCE], [MVA_COM_FCP]);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.payload.consumidor_final).toBe(1);
    esperaSemDifal(resultado.payload.items[0]);
    expect(resultado.payload.icms_valor_total_uf_destino).toBeUndefined();
  });

  it("a devolução não declara o grupo — exceção da NA01-20 para NF-e de entrada", () => {
    // A regra exige `tpNF = 1`; a devolução é nota de **entrada**
    // (`tipo_documento: 0`), e declarar o grupo aqui seria a rejeição 695.
    //
    // Fica de fora, e documentada, a pergunta substantiva: reverter o DIFAL
    // recolhido na venda original não se faz no XML da devolução — o mecanismo
    // é de apuração no estado de destino, fora do documento.
    const devolucao: SaleReturnForInvoice = {
      code: "D-0001",
      saleCode: "V-0001",
      issueDate: "2026-09-04",
      totalAmount: 1000,
      discountAmount: 0,
      originalChave: null,
      branch: sale([item(taxGroup())]).branch,
      contact: sale([item(taxGroup())]).contact,
      items: [item(taxGroup())],
    };
    const resultado = buildReturnNfePayload(devolucao, [REGRA_DEVOLUCAO_BA], [MVA_COM_FCP]);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.payload.tipo_documento).toBe(0);
    expect(resultado.payload.consumidor_final).toBe(1);
    esperaSemDifal(resultado.payload.items[0]);
    expect(resultado.payload.icms_valor_total_uf_destino).toBeUndefined();
  });
});

describe("o regime de quem emite — a pesquisa do Simples Nacional", () => {
  it("emitente do Simples (CRT 1) não declara o grupo, e não é só schema", () => {
    // Exceção 12 da `NA01-20` — mas a dispensa de schema é consequência, não
    // causa: o STF suspendeu a cláusula nona do Convênio ICMS 93/2015 na ADI
    // 5464 (cautelar de 02/2016) e a declarou inconstitucional no mérito
    // (ADI 5469, 2021). A SEFAZ/SP repete na RC 23730/2021: "não há
    // obrigatoriedade de a empresa optante pelo Simples Nacional recolher, em
    // operação interestadual, o DIFAL". O optante não deve o imposto.
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: null, csosn: "102" }), {
      regra: REGRA_SIMPLES_BA,
      mvaRules: [MVA_COM_FCP],
    });

    esperaSemDifal(linha);
  });

  it("MEI (CRT 4) também não declara — exceção estendida pela NT 2024.001", () => {
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: null, csosn: "102" }), {
      regra: REGRA_MEI_BA,
      mvaRules: [MVA_COM_FCP],
    });

    esperaSemDifal(linha);
  });

  it("CRT 2 (Simples com excesso de sublimite) **declara** o grupo", () => {
    // A exceção 12 nomeia `1` e `4`, nunca `2` — e faz sentido substantivo: o
    // CRT 2 está impedido de recolher o ICMS dentro do DAS (LC 123/2006, art.
    // 20, §1º) e o apura pelas regras do Regime Normal, então o fundamento da
    // dispensa não o alcança.
    //
    // O CSOSN `900` é o único que declara ICMS próprio, mas o grupo
    // `ICMSUFDest` não depende disso: ele sai para qualquer código fora da
    // exceção 10.
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: null, csosn: "102" }), {
      regra: REGRA_SUBLIMITE_BA,
      mvaRules: [MVA_COM_FCP],
    });

    expect(linha.icms_valor_uf_destino).toBe(110);
    expect(linha.fcp_valor_uf_destino).toBe(20);
    // O CSOSN `102` não declara ICMS próprio — e o DIFAL sai do mesmo jeito.
    expect(linha.icms_valor).toBeUndefined();
    expect(linha.icms_base_calculo_uf_destino).toBe(1000);
  });
});

describe("a convivência com o ICMS-ST no mesmo item", () => {
  it.each(["10", "70"])("CST %s: o item declara ST **e** o grupo ICMSUFDest", (cst) => {
    // A resposta da terceira pergunta de pesquisa. A `NA01-20` olha só
    // `idDest`/`indFinal`/`indIEDest` — nenhuma das doze exceções dela é de CST
    // de substituição tributária —, e a `NA01-30` (rejeição 695) também não
    // veda o grupo por CST. Suprimir o ST nem seria possível sem quebrar o
    // schema: os grupos `ICMS10`/`ICMS70` exigem `vBCST`/`pICMSST`/`vICMSST`.
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: cst }), { mvaRules: [MVA_COM_FCP] });

    // A camada de ST continua igual ao que B2 e a correção de 04/09 deixaram.
    expect(linha.icms_base_calculo_st).toBeDefined();
    expect(linha.icms_valor_st).toBeDefined();
    expect(linha.fcp_valor_st).toBeDefined();
    // E a camada de DIFAL sai ao lado dela, inteira.
    expect(linha.icms_valor_uf_destino).toBeDefined();
    expect(linha.fcp_valor_uf_destino).toBe(20);
  });

  it("CST 60 (ICMS retido anteriormente por ST): o grupo sai sobre o valor bruto", () => {
    // O `60` não está na exceção 10 da `NA01-20`, logo o grupo é exigido — e o
    // item não declara base própria (grupo `ICMS60`), então a base única do
    // DIFAL é o valor bruto.
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: "60" }), { mvaRules: [MVA_COM_FCP] });

    expect(linha.icms_base_calculo).toBeUndefined();
    expect(linha.icms_base_calculo_uf_destino).toBe(1000);
    expect(linha.icms_valor_uf_destino).toBe(110);
  });

  it("o FCP-ST e o FCP da UF de destino saem em campos separados no mesmo item", () => {
    // Os dois vêm da **mesma** `mva_rules.fcp_aliquota` (é o mesmo percentual
    // do mesmo estado), mas são impostos distintos em tags distintas: `pFCPST`
    // sobre a base majorada pela MVA, `pFCPUFDest` sobre a base da operação.
    const { item: linha } = primeiroItem(taxGroup({ cstIcms: "10" }), { mvaRules: [MVA_COM_FCP] });

    expect(linha.fcp_percentual_st).toBe(2);
    expect(linha.fcp_percentual_uf_destino).toBe(2);
    // Base do FCP-ST é a majorada; a do FCP da UF de destino é a da operação.
    expect(linha.fcp_base_calculo_st).toBe(linha.icms_base_calculo_st);
    expect(linha.fcp_base_calculo_uf_destino).toBe(1000);
    expect(linha.fcp_valor_st).not.toBe(linha.fcp_valor_uf_destino);
  });
});

describe("recusas por cadastro incompleto", () => {
  it("recusa quando o grupo tributário não tem alíquota de ICMS", () => {
    // Sem a alíquota interna do destino não há diferença a apurar. A recusa é
    // da mesma família de B1/B2/B5/B8, e não quebra emissão que hoje funciona:
    // sem o grupo, essa nota já era rejeitada com a 694.
    const vendaMontada = sale([item(taxGroup({ aliquotaIcms: null, cstIcms: "90" }))]);
    const resultado = buildNfePayloadFromSale(vendaMontada, [REGRA_BA], [MVA_COM_FCP]);

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.errors[0]).toContain("UF de destino");
    expect(resultado.errors[0]).toContain("Grupos tributários");
  });

  it("recusa quando a alíquota de ICMS está fora de 0 a 100", () => {
    // `tax_groups.aliquota_icms` nasceu sem `check` de faixa (19/08/2026), e um
    // cadastro tipo `180` no lugar de `18,0` produziria DIFAL absurdo numa nota
    // autorizada — imposto declarado a mais.
    const vendaMontada = sale([item(taxGroup({ aliquotaIcms: 180 }))]);
    const resultado = buildNfePayloadFromSale(vendaMontada, [REGRA_BA], []);

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.errors[0]).toContain("fora da faixa aceitável");
  });

  it("recusa a alíquota de exatamente 100%, com o mesmo limite do ICMS-ST", () => {
    // A faixa é a mesma dos dois lados (`>= 100` recusa). Com limites
    // diferentes, o mesmo cadastro absurdo recusaria num item de CST 10 e
    // passaria num de CST 00 — o desfecho dependeria do CST do produto.
    const vendaMontada = sale([item(taxGroup({ aliquotaIcms: 100 }))]);
    const resultado = buildNfePayloadFromSale(vendaMontada, [REGRA_BA], []);

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.errors[0]).toContain("fora da faixa aceitável");
  });

  it("recusa quando duas linhas de `mva_rules` disputam o mesmo NCM × UF", () => {
    // `mva_rules_dimensions_unique` é sobre o texto cru e não impede o par
    // "22021000" / "2202.10.00" — que `normNcm` colapsa na mesma chave. Sem
    // esta recusa o DIFAL sairia sem FCP em silêncio, enquanto o mesmo cadastro
    // recusaria a emissão num item com ICMS-ST.
    const pontuado: MvaRuleRow = { ...MVA_COM_FCP, id: "mva-pontuado", ncm: "2202.10.00", ufDestino: "BA" };
    const semPontuacao: MvaRuleRow = { ...MVA_COM_FCP, id: "mva-limpo", ufDestino: "BA" };
    const vendaMontada = sale([item(taxGroup())]);
    const resultado = buildNfePayloadFromSale(vendaMontada, [REGRA_BA], [pontuado, semPontuacao]);

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.errors[0]).toContain("mais de uma MVA");
  });

  it("a mesma alíquota nula não recusa numa venda interna — a recusa é da operação", () => {
    // Prova que o portão novo é da operação interestadual a não contribuinte, e
    // não do cadastro em si: o mesmo grupo emite normalmente dentro do estado.
    const vendaMontada = sale([item(taxGroup({ aliquotaIcms: null, cstIcms: "90" }))], {
      ufDestino: "SP",
    });
    const resultado = buildNfePayloadFromSale(vendaMontada, [REGRA_INTERNA], []);

    expect(resultado.ok).toBe(true);
  });
});
