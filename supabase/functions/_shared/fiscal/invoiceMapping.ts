/**
 * Mapeamento venda → `NfePayload` (etapa 8, Notas Emitidas; etapa 8.5, NFC-e).
 *
 * O mapeamento de teste que provou o ciclo do `FiscalProvider` morava em
 * `scripts/fiscal-cycle-check.mjs`, de propósito (ver decisão da etapa F1 no
 * AGENTS.md) — não deveria virar código de produção. Esta é a versão de
 * verdade, e as funções nunca lançam exceção — devolvem `{ ok: false, errors }`
 * para a tela mostrar uma mensagem acionável, mesmo espírito de
 * `resolveTaxRule` e do `FiscalProvider`.
 *
 * ## Por que este arquivo saiu de `src/features/sales/` (A1, 01/09/2026)
 *
 * Ele morava no bundle do navegador, e era o navegador quem montava a nota
 * fiscal a partir de dados que a própria tela tinha em mãos. Depois de A1 quem
 * monta é a Edge Function `fiscal-emit`, que lê venda, itens, produto, grupo
 * tributário, cliente e filial **do banco** antes de montar — o cliente não
 * manda nem preço, nem alíquota, nem CFOP. O arquivo é o mesmo (nenhuma regra
 * de mapeamento mudou nesta tarefa); o que mudou foi de que lado da fronteira
 * ele roda. Por isso os imports relativos ganharam `.ts` explícito, exigência
 * do Deno — e **não existe mais camada de reexport em `src/`**: nada no front
 * deve conseguir montar um `NfePayload`.
 *
 * ## De onde vem cada metade da tributação (correção de 19/08/2026)
 *
 * - **CFOP vem da operação**: `resolveTaxRule` decide, a partir das cinco
 *   dimensões (regime da filial, natureza, UF origem/destino, tipo de
 *   cliente). É o mesmo para todos os itens da venda — uma venda interna tem
 *   o mesmo CFOP para qualquer produto.
 * - **CST/CSOSN e alíquota vêm do produto**, via o grupo tributário dele
 *   (`products.tax_group_id` → `tax_groups`). Isso é **por item**: dois
 *   produtos na mesma venda podem ter tributação diferente (um com
 *   substituição tributária, outro isento), e a primeira versão desta função
 *   não conseguia representar isso — lia CST/alíquota de `rule` uma vez, fora
 *   do laço, e aplicava igual a todos os itens.
 *
 * ## NF-e × NFC-e: o que é reaproveitado e o que diverge (etapa 8.5)
 *
 * `resolveItemsForSale` (abaixo) é a parte genuinamente comum às duas: CFOP
 * pela operação, CST/alíquota por item, montagem dos itens e dos totais de
 * imposto. **Cliente não é**: NF-e exige destinatário identificado (mensagem
 * de erro própria, ver `buildNfePayloadFromSale`); NFC-e é o oposto — a
 * imensa maioria das vendas de balcão não tem CPF do cliente, e isso é normal,
 * não erro de cadastro. Por isso os dois têm função própria, cada uma com sua
 * validação de cabeçalho, em vez de uma função com um parâmetro
 * `requireContact` tentando cobrir os dois: a diferença não é um detalhe, é a
 * regra de negócio central que distingue os dois modelos.
 */

import { onlyDigits } from "./accessKey.ts";
import {
  aliquotaInterestadual,
  mvaAjustada,
  resolveMvaRule,
  type MvaRuleRow,
} from "./mvaRules.ts";
import { resolveIcmsSituacaoTributaria, type TaxGroup } from "./taxGroups.ts";
import {
  icmsCalculaCreditoSimples,
  icmsCalculaSubstituicaoTributaria,
  icmsCalculaValorProprio,
  icmsProprioIgnoraAliquotaInterestadual,
  icmsStDeduzProprioNaoDestacado,
  ipiCalculaValor,
  pisCofinsCalculaValor,
  pisCofinsCalculaValorPorUnidade,
} from "./taxSituations.ts";
import type { NfePayload, NfePayloadItem, NfePayloadPagamento } from "./types.ts";
import { resolveTaxRule, type TaxRuleQuery, type TaxRuleRow } from "./taxRules.ts";

export type SaleForInvoiceBranch = {
  cnpj: string | null;
  name: string;
  inscricaoEstadual: string | null;
  regimeTributario: string | null;
  /**
   * `pCredSN` — a alíquota de ICMS **dentro** da alíquota composta do Simples
   * Nacional desta filial, em percentual (B8, 03/09/2026).
   *
   * Mora na filial, e não no grupo tributário, porque não é atributo do
   * produto: é o percentual efetivo de ICMS da faixa de receita bruta dos
   * últimos 12 meses (RBT12) em que **a filial** está enquadrada, pelo Anexo I
   * ou II da LC 123/2006, e vale igual para toda nota que ela emite no mês —
   * ver a decisão registrada em B8 no AGENTS.md.
   *
   * Nula quando ninguém a cadastrou. Aí os itens com CSOSN `101`/`201`
   * **recusam a emissão**: os dois campos são obrigatórios nesses grupos XML.
   */
  aliquotaCreditoIcmsSimples: number | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  cep: string | null;
};

export type SaleForInvoiceContact = {
  name: string;
  document: string;
  inscricaoEstadual: string | null;
  indicadorIe: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  cep: string | null;
  phone: string | null;
};

export type SaleForInvoiceProduct = {
  code: string;
  description: string;
  ncm: string | null;
  cest: string | null;
  unidadeComercial: string | null;
  unidadeTributavel: string | null;
  origemMercadoria: string | null;
  cstIpi: string | null;
  /**
   * O grupo tributário do produto — de onde saem CST/CSOSN e alíquotas deste
   * item. Nulo quando o produto ainda não foi atrelado a um grupo, o que
   * bloqueia a emissão com mensagem própria (não há grupo padrão de fallback:
   * emitir com tributação adivinhada é exatamente o erro silencioso que a
   * correção de 19/08/2026 existe para evitar).
   */
  taxGroup: TaxGroup | null;
};

export type SaleForInvoiceItem = {
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  totalAmount: number;
  product: SaleForInvoiceProduct;
};

/** `sale_payments.method`, cru — a conversão pro código da SEFAZ é de quem monta o payload de NFC-e. */
export type SaleForInvoicePayment = {
  method: string;
  amount: number;
};

export type SaleForInvoice = {
  code: string;
  issueDate: string;
  subtotalAmount: number;
  totalAmount: number;
  discountAmount: number;
  freightAmount: number;
  branch: SaleForInvoiceBranch;
  /** Nulo é o caso de venda sem cliente identificado (PDV) — NF-e exige cliente para emitir, NFC-e não. */
  contact: SaleForInvoiceContact | null;
  items: SaleForInvoiceItem[];
  payments: SaleForInvoicePayment[];
  /** Texto livre digitado pelo usuário em "Tipo de operação" — vai literal na `natureza_operacao` da nota. Não usar para casar regra fiscal. */
  operationType?: string;
};

export type BuildPayloadResult =
  | { ok: true; payload: NfePayload; cfop: string }
  | { ok: false; errors: string[] };

function isCnpj(document: string): boolean {
  return onlyDigits(document).length === 14;
}

/** Identifica o item nas mensagens de erro, para quem lê saber qual produto corrigir. */
function itemLabel(item: SaleForInvoiceItem, index: number): string {
  return `Item ${index + 1} (${item.product.code} — ${item.product.description})`;
}

/**
 * Deriva `tipo_cliente` (dimensão de `resolveTaxRule`) do documento e do
 * indicador de IE já normalizado: CPF é sempre consumidor final (pessoa
 * física não é contribuinte de ICMS); CNPJ com indicador 1 é contribuinte;
 * CNPJ com indicador 2/9/ausente é não contribuinte.
 *
 * Só usada por NF-e — NFC-e é **sempre** consumidor final, sem derivar de
 * nada (ver `buildNfcePayloadFromSale`).
 */
function resolveTipoCliente(document: string, indicadorIe: string | null): string {
  if (!isCnpj(document)) return "consumidor_final";
  return indicadorIe === "1" ? "contribuinte" : "nao_contribuinte";
}

/** `indicador_inscricao_estadual_destinatario` da SEFAZ: 1/2/9. Ausente vira 9 (o mais conservador). */
function resolveIndicadorIeCodigo(indicadorIe: string | null): number {
  if (indicadorIe === "1") return 1;
  if (indicadorIe === "2") return 2;
  return 9;
}

/** Valor de um imposto a partir da base e da alíquota (%), arredondado a centavos. */
function taxAmount(base: number, aliquota: number): number {
  return Math.round(base * (aliquota / 100) * 100) / 100;
}

/** Arredonda a centavos — o mesmo critério de `taxAmount`, isolado para reuso. */
function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Base de cálculo depois da redução (`pRedBC`), arredondada a centavos.
 *
 * Devolve a base inteira quando não há redução — inclusive quando a coluna vem
 * `0`, que é o mesmo que "sem redução" e não deve virar um `pRedBC` de zero no
 * XML. O `Math.min(…, 100)` é defesa em profundidade: a `check constraint` da
 * migration de B1 já limita a coluna a 0–100, e este núcleo também roda com
 * dado de teste que não passa pelo banco.
 */
function reducedBase(base: number, reducaoPercentual: number | null | undefined): number {
  if (!reducaoPercentual || reducaoPercentual <= 0) return base;
  return toCents(base * (1 - Math.min(reducaoPercentual, 100) / 100));
}

/**
 * A operação cruza a fronteira de um estado? É o único critério de que a
 * alíquota interestadual depende, e está isolado aqui porque **três** contas o
 * usam: o ajuste da MVA (B2), o ICMS próprio e a dedução do próprio não
 * destacado (as duas da correção de 04/09/2026).
 */
function operacaoInterestadual(query: TaxRuleQuery): boolean {
  return query.ufOrigem.trim().toUpperCase() !== query.ufDestino.trim().toUpperCase();
}

/**
 * A alíquota com que o ICMS **da operação própria** é calculado (correção de
 * 04/09/2026).
 *
 * ## O que estava errado antes
 *
 * B1 calculava o `vICMS` de todo item com `tax_groups.aliquota_icms` — a
 * alíquota **interna** cadastrada no grupo —, inclusive nas vendas
 * interestaduais. Isso não é aproximação, é conta errada: a Resolução do
 * Senado 22/1989 (e a 13/2012, para importado) fixa alíquotas próprias de
 * 4%, 7% e 12% para a operação que cruza a fronteira do estado, e é por elas
 * que o Regime Normal destaca `pICMS`/`vICMS` na nota. Como a interna é
 * tipicamente maior que a interestadual, toda venda interestadual saía com
 * imposto destacado **a maior** numa nota autorizada.
 *
 * O motor já sabia calcular a alíquota certa desde B2 — `aliquotaInterestadual`
 * era usada para ajustar a MVA do ICMS-ST —, só nunca a aplicava ao próprio.
 *
 * ## Os dois pontos que chamam esta função
 *
 * 1. `resolveItemsForSale`, para o `vICMS` (e o `pICMS`) do item de Regime
 *    Normal;
 * 2. `resolveSubstituicaoTributaria`, no ramo `deduzProprioNaoDestacado`, para
 *    a dedução implícita do Simples Nacional (CSOSN `201`/`202`) — que existe
 *    justamente para reproduzir "a alíquota utilizada na operação pelos
 *    contribuintes do regime normal". Se a operação é interestadual, a
 *    alíquota que esses contribuintes usariam ali é a interestadual.
 *
 * As duas metades passam pela mesma função de propósito: era a divergência
 * entre elas que B8 documentou como limitação herdada, e mantê-las num único
 * lugar é o que impede a divergência de voltar.
 *
 * **Intraestadual não muda nada**: devolve a alíquota interna do grupo, que é
 * o que o sistema sempre fez.
 */
function icmsProprioAliquota(
  aliquotaInterna: number,
  interestadual: boolean,
  ufOrigem: string,
  ufDestino: string,
  origemMercadoria: string | null | undefined,
): number {
  return interestadual ? aliquotaInterestadual(ufOrigem, ufDestino, origemMercadoria) : aliquotaInterna;
}

type ResolvedItems = {
  cfop: string;
  items: NfePayloadItem[];
  icmsBaseCalculoTotal?: number;
  icmsValorTotal?: number;
  icmsStBaseCalculoTotal?: number;
  icmsStValorTotal?: number;
  fcpStValorTotal?: number;
  ipiValorTotal?: number;
  pisValorTotal?: number;
  cofinsValorTotal?: number;
};

type ItemsResolution = { ok: true; data: ResolvedItems } | { ok: false; errors: string[] };

/**
 * A parte genuinamente comum a NF-e e NFC-e: resolve o CFOP da operação
 * (`resolveTaxRule`) e, por item, o CST/CSOSN e as alíquotas a partir do
 * grupo tributário do produto. Não sabe nada sobre cliente/destinatário —
 * isso é responsabilidade de quem chama (a exigência diverge entre os dois
 * modelos).
 *
 * ## O cálculo por item depois de B1 (01/09/2026)
 *
 * Antes de B1 esta função fazia `valor = base × alíquota / 100` para ICMS, PIS
 * e COFINS, sempre que houvesse alíquota, e não calculava IPI nenhum. Três
 * coisas mudaram, e todas na mesma direção — **declarar só o que o grupo XML
 * daquele CST aceita**:
 *
 * 1. **Redução de base do ICMS.** Com `tax_groups.reducao_base_icms`
 *    preenchida, a base do item vira `valor × (1 − reducao/100)` e o item
 *    carrega também o percentual em `icms_reducao_base_calculo` (`pRedBC`) —
 *    o leiaute pede os dois, a base já reduzida e o percentual que a reduziu.
 * 2. **IPI passou a ser calculado**, do mesmo jeito que os outros três, com
 *    alíquota e CST vindos do grupo tributário.
 * 3. **CST/CSOSN de isenção, não tributação ou ST já retida zeram os campos**
 *    em vez de forçá-los: `undefined` em base/alíquota/valor, exatamente o
 *    espírito com que o código já tratava alíquota ausente. Quem decide isso é
 *    `taxSituations.ts`, que documenta código a código o porquê.
 *
 * Redução de base só existe para ICMS porque só o ICMS tem `pRedBC` no leiaute
 * — ver o campo `reducaoBaseIcms` em `taxGroups.ts`.
 *
 * ## PIS/COFINS por unidade de medida depois de B5 (01/09/2026)
 *
 * O CST `03` tributa **ad rem**: um valor em reais por unidade vendida, no
 * grupo XML `PISQtde`/`COFINSQtde` (`qBCProd` × `vAliqProd`), sem `vBC` nem
 * alíquota percentual. B1 tinha deixado esses itens sem PIS/COFINS nenhum
 * — não errado (não declarava percentual no grupo errado), mas incompleto.
 * Quem resolve os dois caminhos, e escolhe entre eles pelo CST, é
 * `resolvePisCofins`. PIS e COFINS passam por lá **separadamente**: nada
 * impede um grupo com PIS ad rem e COFINS percentual.
 *
 * ## O ICMS-ST depois de B2 (01/09/2026)
 *
 * Para os CST/CSOSN que declaram ST (`icmsCalculaSubstituicaoTributaria`), o
 * cálculo do próprio acima ganha uma segunda camada, resolvida em
 * `resolveSubstituicaoTributaria`: MVA vinda de `mva_rules` por NCM × UF de
 * destino, ajustada quando a operação é interestadual, base majorada e o valor
 * do ST descontado do ICMS próprio que o mesmo item já destacou. Item sem ST
 * no CST não consulta `mva_rules` e sai exatamente como saía em B1.
 *
 * ## O Simples Nacional depois de B8 (03/09/2026)
 *
 * Duas coisas, e as duas só valem para CSOSN:
 *
 * 1. **O crédito de ICMS** (`pCredSN`/`vCredICMSSN`) passou a ser declarado nos
 *    CSOSN `101` e `201`, com a alíquota vinda da **filial** —
 *    `resolveCreditoSimples`. É a única grandeza deste motor que não sai do
 *    grupo tributário nem do cadastro do produto, e o porquê está lá.
 * 2. **A dedução do ICMS próprio no ST** passou a existir para os CSOSN `201` e
 *    `202`, que tributam a operação própria sem destacá-la — ver
 *    `resolveSubstituicaoTributaria`. Antes de B8 o ST desses itens saía cheio
 *    sobre a base majorada.
 *
 * ## A alíquota interestadual no ICMS próprio (correção de 04/09/2026)
 *
 * B1, B2 e B8 registraram a mesma lacuna: o `vICMS` do item usava sempre a
 * alíquota **interna** do grupo, mesmo quando a venda cruzava a fronteira do
 * estado. Numa venda interestadual de Regime Normal a alíquota é a da
 * Resolução do Senado 22/1989 (7% ou 12%) ou a da 13/2012 (4%, para
 * importado) — as mesmas que `aliquotaInterestadual` já calculava desde B2
 * para ajustar a MVA. Quem decide agora é `icmsProprioAliquota`, e o
 * `icms_aliquota` do item carrega a alíquota **efetivamente usada**, para o
 * `pICMS` do XML bater com o `vICMS` que ele gerou.
 *
 * A NFC-e não muda: `buildNfcePayloadFromSale` força `ufDestino = branch.uf`,
 * então nunca é interestadual por construção.
 */
function resolveItemsForSale(
  sale: SaleForInvoice,
  rules: TaxRuleRow[],
  query: TaxRuleQuery,
  mvaRules: MvaRuleRow[],
): ItemsResolution {
  const errors: string[] = [];
  if (sale.items.length === 0) errors.push("Venda sem itens.");

  sale.items.forEach((item, index) => {
    if (!item.product.ncm?.trim()) {
      errors.push(`${itemLabel(item, index)}: NCM não cadastrado. Cadastre o NCM em Produtos.`);
    }
    if (!item.product.taxGroup) {
      errors.push(
        `${itemLabel(item, index)}: sem grupo tributário. Atrele o produto a um grupo em Produtos ` +
          `(cadastre os grupos em Grupos tributários).`,
      );
    }
  });

  if (errors.length > 0) return { ok: false, errors };

  const resolution = resolveTaxRule(query, rules);
  if (!resolution.found) {
    return { ok: false, errors: [resolution.reason] };
  }
  const cfop = resolution.cfop;

  const cadastroErrors: string[] = [];
  const items: NfePayloadItem[] = sale.items.map((item, index) => {
    const group = item.product.taxGroup!;
    const base = item.totalAmount;

    // Por item, e a partir do grupo daquele produto: é isto que faz dois
    // produtos da mesma venda saírem com tributação diferente.
    const icmsSituacaoTributaria = resolveIcmsSituacaoTributaria(group, query.regime);
    if (!icmsSituacaoTributaria) {
      cadastroErrors.push(
        `${itemLabel(item, index)}: o grupo tributário "${group.name}" não tem CST ICMS nem CSOSN ` +
          `cadastrado. Complete o cadastro em Grupos tributários.`,
      );
    }

    // ICMS — a alíquota só vira base/valor se o CST/CSOSN tiver onde escrevê-los.
    const icmsDeclara = group.aliquotaIcms !== null && icmsCalculaValorProprio(icmsSituacaoTributaria);
    /**
     * Interestadual **e** de Regime Normal: são as duas condições da alíquota
     * da Resolução 22/89 no ICMS próprio (correção de 04/09/2026).
     *
     * O regime importa porque só o Regime Normal apura o ICMS por operação —
     * o optante pelo Simples recolhe pelo DAS, sobre a receita bruta do mês, e
     * a alíquota da operação não descreve o que ele paga. Na prática o gate de
     * regime já basta: os CSOSN não declaram `pICMS`, com a única exceção do
     * `900`. A exceção está tratada explicitamente porque
     * `resolveIcmsSituacaoTributaria` cai no CSOSN também quando a filial é
     * CRT 3 e o grupo não tem CST de ICMS — ver
     * `icmsProprioIgnoraAliquotaInterestadual`, que documenta por que o `900`
     * fica de fora desta correção.
     */
    const icmsProprioInterestadual =
      operacaoInterestadual(query) &&
      query.regime.trim() === "3" &&
      !icmsProprioIgnoraAliquotaInterestadual(icmsSituacaoTributaria);
    const icmsAliquota = icmsDeclara
      ? icmsProprioAliquota(
          group.aliquotaIcms!,
          icmsProprioInterestadual,
          query.ufOrigem,
          query.ufDestino,
          item.product.origemMercadoria,
        )
      : undefined;
    const icmsReducao = icmsDeclara && group.reducaoBaseIcms ? group.reducaoBaseIcms : undefined;
    const icmsBase = icmsDeclara ? reducedBase(base, icmsReducao) : undefined;
    const icmsValor = icmsBase !== undefined ? taxAmount(icmsBase, icmsAliquota!) : undefined;

    // ICMS-ST — a segunda camada, só para os CST/CSOSN que a têm.
    const st = icmsCalculaSubstituicaoTributaria(icmsSituacaoTributaria)
      ? resolveSubstituicaoTributaria({
          group,
          query,
          mvaRules,
          ncm: item.product.ncm!,
          origemMercadoria: item.product.origemMercadoria,
          basePropria: icmsBase ?? base,
          icmsProprio: icmsValor ?? 0,
          deduzProprioNaoDestacado: icmsStDeduzProprioNaoDestacado(icmsSituacaoTributaria),
        })
      : null;
    if (st && !st.ok) cadastroErrors.push(`${itemLabel(item, index)}: ${st.reason}`);
    const stDeclarado = st?.ok ? st : null;

    // Crédito de ICMS do Simples Nacional — a terceira camada, só para os
    // CSOSN que a declaram (`101` e `201`). A alíquota vem da **filial**, não
    // do grupo tributário: ver `resolveCreditoSimples`.
    const credito = icmsCalculaCreditoSimples(icmsSituacaoTributaria)
      ? resolveCreditoSimples({
          group,
          branch: sale.branch,
          situacaoTributaria: icmsSituacaoTributaria,
          base,
        })
      : null;
    if (credito && !credito.ok) cadastroErrors.push(`${itemLabel(item, index)}: ${credito.reason}`);
    const creditoDeclarado = credito?.ok ? credito : null;

    /**
     * CST de IPI: o grupo tributário manda, o cadastro do produto é fallback
     * para os produtos que já tinham `cst_ipi` antes de B1 (ver AGENTS.md).
     * String vazia no banco conta como ausente — `''` não é um CST.
     */
    const cstIpi = group.cstIpi?.trim() || item.product.cstIpi?.trim() || undefined;
    if (group.aliquotaIpi !== null && !cstIpi) {
      cadastroErrors.push(
        `${itemLabel(item, index)}: o grupo tributário "${group.name}" tem alíquota de IPI mas não tem ` +
          `CST de IPI. Complete o cadastro em Grupos tributários.`,
      );
    }
    // O inverso (CST sem alíquota) **não** é erro: é o estado de todo produto
    // cadastrado antes de B1, quando só existia `products.cst_ipi`. Nesse caso
    // o item declara o CST e deixa base/alíquota/valor nulos — "não calculado".
    const ipiDeclara = group.aliquotaIpi !== null && ipiCalculaValor(cstIpi);
    const ipiBase = ipiDeclara ? base : undefined;

    // PIS e COFINS, cada um pelo caminho que o CST dele manda — percentual
    // (`PISAliq`/`PISOutr`) ou por unidade de medida (`PISQtde`). São duas
    // chamadas independentes de propósito: o grupo tributário pode ter um dos
    // dois ad rem e o outro percentual, e o XML os declara separadamente.
    const pis = resolvePisCofins({
      group,
      imposto: "PIS",
      cst: group.cstPis,
      aliquotaPorcentual: group.aliquotaPis,
      aliquotaPorUnidade: group.aliquotaPisValor,
      base,
      quantidade: item.quantity,
    });
    if (!pis.ok) cadastroErrors.push(`${itemLabel(item, index)}: ${pis.reason}`);
    const pisDeclarado = pis.ok ? pis : null;

    const cofins = resolvePisCofins({
      group,
      imposto: "COFINS",
      cst: group.cstCofins,
      aliquotaPorcentual: group.aliquotaCofins,
      aliquotaPorUnidade: group.aliquotaCofinsValor,
      base,
      quantidade: item.quantity,
    });
    if (!cofins.ok) cadastroErrors.push(`${itemLabel(item, index)}: ${cofins.reason}`);
    const cofinsDeclarado = cofins.ok ? cofins : null;

    return {
      numero_item: index + 1,
      codigo_produto: item.product.code,
      descricao: item.product.description,
      cfop,
      codigo_ncm: item.product.ncm!,
      codigo_cest: item.product.cest ?? undefined,
      quantidade_comercial: item.quantity,
      valor_unitario_comercial: item.unitPrice,
      valor_bruto: item.totalAmount,
      unidade_comercial: item.product.unidadeComercial ?? undefined,
      unidade_tributavel: item.product.unidadeTributavel ?? undefined,
      valor_desconto: item.discountAmount || undefined,
      inclui_no_total: 1,

      // Campo obrigatório no schema da SEFAZ (não opcional em NfePayloadItem);
      // "" quando o cadastro do produto ainda não tem origem preenchida.
      icms_origem: item.product.origemMercadoria ?? "",
      icms_situacao_tributaria: icmsSituacaoTributaria ?? "",
      icms_base_calculo: icmsBase,
      icms_reducao_base_calculo: icmsReducao,
      icms_aliquota: icmsAliquota,
      icms_valor: icmsValor,

      icms_modalidade_base_calculo_st: stDeclarado?.modalidadeBaseCalculo,
      icms_margem_valor_adicionado_st: stDeclarado?.mva,
      icms_base_calculo_st: stDeclarado?.base,
      icms_aliquota_st: stDeclarado?.aliquota,
      icms_valor_st: stDeclarado?.valor,

      fcp_base_calculo_st: stDeclarado?.fcpBase,
      fcp_percentual_st: stDeclarado?.fcpAliquota,
      fcp_valor_st: stDeclarado?.fcpValor,

      icms_aliquota_credito_simples: creditoDeclarado?.aliquota,
      icms_valor_credito_simples: creditoDeclarado?.valor,

      ipi_situacao_tributaria: cstIpi,
      ipi_base_calculo: ipiBase,
      ipi_aliquota: ipiDeclara ? group.aliquotaIpi! : undefined,
      ipi_valor: ipiBase !== undefined ? taxAmount(ipiBase, group.aliquotaIpi!) : undefined,

      pis_situacao_tributaria: group.cstPis ?? undefined,
      pis_base_calculo: pisDeclarado?.base,
      pis_aliquota_porcentual: pisDeclarado?.aliquotaPorcentual,
      pis_quantidade_vendida: pisDeclarado?.quantidadeVendida,
      pis_aliquota_valor: pisDeclarado?.aliquotaValor,
      pis_valor: pisDeclarado?.valor,

      cofins_situacao_tributaria: group.cstCofins ?? undefined,
      cofins_base_calculo: cofinsDeclarado?.base,
      cofins_aliquota_porcentual: cofinsDeclarado?.aliquotaPorcentual,
      cofins_quantidade_vendida: cofinsDeclarado?.quantidadeVendida,
      cofins_aliquota_valor: cofinsDeclarado?.aliquotaValor,
      cofins_valor: cofinsDeclarado?.valor,
    };
  });

  if (cadastroErrors.length > 0) return { ok: false, errors: cadastroErrors };

  const icmsBaseCalculoTotal = totalDeclarado(items, (item) => item.icms_base_calculo);
  const icmsValorTotal = totalDeclarado(items, (item) => item.icms_valor);
  const icmsStBaseCalculoTotal = totalDeclarado(items, (item) => item.icms_base_calculo_st);
  const icmsStValorTotal = totalDeclarado(items, (item) => item.icms_valor_st);
  const fcpStValorTotal = totalDeclarado(items, (item) => item.fcp_valor_st);
  const ipiValorTotal = totalDeclarado(items, (item) => item.ipi_valor);
  const pisValorTotal = totalDeclarado(items, (item) => item.pis_valor);
  const cofinsValorTotal = totalDeclarado(items, (item) => item.cofins_valor);

  return {
    ok: true,
    data: {
      cfop,
      items,
      icmsBaseCalculoTotal,
      icmsValorTotal,
      icmsStBaseCalculoTotal,
      icmsStValorTotal,
      fcpStValorTotal,
      ipiValorTotal,
      pisValorTotal,
      cofinsValorTotal,
    },
  };
}

/** O maior valor que `fiscal_document_items.icms_st_mva` (`numeric(7,4)`) guarda. */
const MVA_MAXIMA_PERSISTIVEL = 999.9999;

/**
 * O que um item declara de ICMS-ST, ou o motivo de a emissão não poder sair.
 *
 * Recusa em vez de calcular errado, e a recusa é do mesmo tipo que B1 criou
 * para "CST de IPI sem alíquota": **inconsistência de cadastro**, não falha de
 * sistema. O CST do item afirma que há ST; se a MVA não está cadastrada, o
 * cadastro se contradiz, e emitir sem ST produziria uma nota autorizada com
 * imposto a menos — o desfecho pior. Mercadoria **sem** ST não passa por aqui:
 * o CST dela não está em `icmsCalculaSubstituicaoTributaria`.
 */
type SubstituicaoTributaria =
  | {
      ok: true;
      modalidadeBaseCalculo: string;
      mva: number;
      base: number;
      aliquota: number;
      valor: number;
      fcpBase?: number;
      fcpAliquota?: number;
      fcpValor?: number;
    }
  | { ok: false; reason: string };

/**
 * As quatro contas do ICMS-ST, na ordem em que os estados as publicam.
 *
 * 1. **Alíquota interna do destino.** Aproximada por `group.aliquotaIcms` —
 *    ver a decisão registrada no AGENTS.md (B2) e o cabeçalho de `mvaRules.ts`.
 *    Sem ela não há como calcular nada, e a recusa é explícita.
 * 2. **MVA efetiva.** Interestadual usa a ajustada; interna usa a original.
 *    A exceção que quase todo mundo esquece: o **Simples Nacional na condição
 *    de substituto não aplica MVA ajustada nem em operação interestadual**
 *    (Convênio ICMS 35/2011, cláusula primeira) — usa sempre a original. Por
 *    isso o ajuste depende do regime de quem emite, não só das UFs.
 * 3. **Base do ST** = base do próprio (já reduzida, quando há redução)
 *    × (1 + MVA/100).
 * 4. **Valor do ST** = base do ST × alíquota interna − **o ICMS próprio já
 *    destacado neste item**. A subtração é o ponto do cálculo: o ICMS-ST é o
 *    imposto de toda a cadeia menos o que a operação própria já cobrou, não o
 *    valor cheio sobre a base majorada.
 *
 * ## A dedução quando o próprio não é destacado — o Simples (B8, 03/09/2026)
 *
 * B2 registrou como limitação conhecida que "**Simples Nacional: não há
 * dedução nenhuma**": os CSOSN `201`/`202`/`203` não declaram `vICMS` no XML
 * (o ICMS próprio é pago no DAS), então `icmsProprio` chegava zero e o ST saía
 * cheio sobre a base majorada — várias vezes o devido. B8 fecha isso.
 *
 * Quando `deduzProprioNaoDestacado` é verdadeiro (CSOSN `201`/`202`, decidido
 * por `icmsStDeduzProprioNaoDestacado`), a dedução é calculada aqui em vez de
 * vir de fora: `basePropria × alíquota da operação própria` — o mesmo número
 * que um item de Regime Normal na mesma operação teria destacado e deduzido
 * (interna quando o trajeto é interno, interestadual quando cruza a fronteira
 * — ver `icmsProprioAliquota`). É o que a
 * pesquisa de B8 encontrou convergente nas fontes: para o optante substituto,
 * "apenas para cálculo da retenção, o ICMS da operação própria deve ser
 * calculado aplicando-se a alíquota utilizada na operação pelos contribuintes
 * do regime normal sobre o valor total da operação". A base legal do arranjo é
 * o art. 13, §1º, XIII, "a", da LC 123/2006 (o ICMS-ST sai do recolhimento
 * unificado e se observa "a legislação aplicável às demais pessoas
 * jurídicas"); a única especialidade do optante é não usar MVA ajustada
 * (Convênio ICMS 35/2011), que já está tratada acima.
 *
 * Calcular a dedução **aqui**, e não em `resolveItemsForSale`, é de propósito:
 * no trajeto interno ela usa a mesma `aliquotaInterna` que já foi validada
 * logo abaixo (não nula, dentro de 0–100). Fazê-la fora duplicaria a validação
 * ou usaria um número não validado.
 *
 * ## A limitação que B2 e B8 registraram aqui, e que a correção de 04/09/2026
 * fechou
 *
 * Até 03/09/2026 as duas deduções usavam a alíquota **interna** mesmo em
 * operação interestadual, porque `resolveItemsForSale` calculava o `vICMS` de
 * qualquer operação com `group.aliquotaIcms` — B1 nunca aplicou alíquota
 * interestadual ao próprio, e B8 fez a dedução implícita do Simples espelhar
 * esse número **de propósito**, para as duas metades errarem junto. Numa venda
 * SP→BA de 1.000 com grupo de 18%, o item destacava 180 (o correto são 70, a
 * 7%) e deduzia os mesmos 180: **ICMS próprio a maior e ST a menos**.
 *
 * As duas passaram a usar `icmsProprioAliquota` — ver o cabeçalho dela. O
 * espelhamento continua de pé, e agora reflete a conta certa: o Regime Normal
 * destaca pela alíquota do trajeto, e a dedução do Simples reproduz esse mesmo
 * número.
 *
 * **A alíquota interna do destino continua aproximada por `group.aliquotaIcms`**
 * — essa limitação é de B2, é outra dimensão (falta uma tabela por UF × NCM) e
 * não foi tocada. Ela vale para a base do ST e para a alíquota aplicada sobre
 * ela, que por lei são mesmo as do estado de destino, independentemente de a
 * operação ser interestadual.
 */
function resolveSubstituicaoTributaria(input: {
  group: TaxGroup;
  query: TaxRuleQuery;
  mvaRules: MvaRuleRow[];
  ncm: string;
  origemMercadoria: string | null;
  /** Base do ICMS próprio já reduzida; o valor bruto do item quando o CST não declara próprio (ex.: CST 30). */
  basePropria: number;
  /** O `vICMS` deste item; zero quando o CST não declara ICMS próprio. */
  icmsProprio: number;
  /**
   * O CSOSN tributa a operação própria **sem destacá-la** no XML (Simples
   * Nacional, CSOSN `201`/`202`)? Então a dedução é calculada aqui a partir da
   * alíquota da operação própria, em vez de vir em `icmsProprio` — ver o
   * cabeçalho.
   */
  deduzProprioNaoDestacado: boolean;
}): SubstituicaoTributaria {
  const { group, query, mvaRules, ncm, origemMercadoria, basePropria, icmsProprio } = input;

  const aliquotaInterna = group.aliquotaIcms;
  if (aliquotaInterna === null) {
    return {
      ok: false,
      reason:
        `o CST/CSOSN do grupo tributário "${group.name}" declara ICMS-ST, mas o grupo não tem alíquota de ` +
        `ICMS cadastrada — é ela que o cálculo usa como alíquota interna do destino. ` +
        `Complete o cadastro em Grupos tributários.`,
    };
  }
  // `aliquota_icms` nasceu em 19/08/2026 **sem** check de 0–100 (B1 registrou
  // que pôr constraint retroativa em coluna com dado em produção é mudança de
  // outra natureza). Aqui isso importa mais do que no ICMS próprio: a alíquota
  // interna é o **divisor** da MVA ajustada, e um cadastro tipo `90` no lugar
  // de `9,0` produz uma MVA de milhares por cento — que estoura
  // `fiscal_document_items.icms_st_mva numeric(7,4)` **depois** de a SEFAZ ter
  // autorizado a nota. Recusar antes de emitir é a única correção barata.
  if (aliquotaInterna < 0 || aliquotaInterna >= 100) {
    return {
      ok: false,
      reason:
        `o CST/CSOSN do grupo tributário "${group.name}" declara ICMS-ST, mas a alíquota de ICMS ` +
        `cadastrada (${aliquotaInterna}%) está fora da faixa aceitável de 0 a 100 — ela é usada como ` +
        `alíquota interna do destino e como divisor do ajuste da MVA. Corrija em Grupos tributários.`,
    };
  }

  const resolucao = resolveMvaRule({ ncm, ufDestino: query.ufDestino }, mvaRules);
  if (!resolucao.found) {
    return {
      ok: false,
      reason: `o CST/CSOSN do grupo tributário "${group.name}" declara ICMS-ST, mas ${resolucao.reason}`,
    };
  }
  const rule = resolucao.rule;

  const interestadual = operacaoInterestadual(query);
  // Regime 3 é o Normal; 1 e 2 são Simples Nacional (mesmo código de `branches.regime_tributario`).
  const ajusta = interestadual && query.regime.trim() === "3";
  const mva = ajusta
    ? mvaAjustada(
        rule.mvaOriginal,
        aliquotaInterestadual(query.ufOrigem, query.ufDestino, origemMercadoria),
        aliquotaInterna,
      )
    : rule.mvaOriginal;

  // `icms_st_mva` é `numeric(7,4)`: 999,9999 é o maior valor que a coluna
  // guarda. Uma alíquota interna alta (mas dentro de 0–100) ainda consegue
  // levar a MVA ajustada além disso — com 300% de MVA original e 95% de
  // interna, o ajuste passa de 1.700%. Mesmo motivo da checagem acima: sem esta
  // recusa a nota é autorizada e só então a gravação falha.
  if (mva > MVA_MAXIMA_PERSISTIVEL) {
    return {
      ok: false,
      reason:
        `o ajuste da MVA para esta operação resultou em ${mva}%, acima do máximo que o sistema registra ` +
        `(${MVA_MAXIMA_PERSISTIVEL}%). Confira a MVA cadastrada em MVA (ICMS-ST) e a alíquota de ICMS ` +
        `do grupo tributário "${group.name}".`,
    };
  }

  const base = toCents(basePropria * (1 + mva / 100));
  // A dedução: o `vICMS` destacado no item (Regime Normal) ou, quando o CSOSN
  // tributa a operação própria sem destacá-la (Simples `201`/`202`), o valor
  // que um item de Regime Normal na mesma operação teria destacado — ver o
  // cabeçalho desta função.
  //
  // "Na mesma operação" inclui o trajeto: numa venda interestadual o
  // contribuinte de Regime Normal destacaria pela alíquota da Resolução 22/89,
  // não pela interna do estado dele, então é ela que a dedução implícita usa
  // (correção de 04/09/2026). O `interestadual` daqui é só das UFs, sem gate de
  // regime, e isso é o certo: quem está no Simples é **o emitente**, e o que
  // esta linha reproduz é o que o *outro* regime faria no mesmo trajeto.
  const deducao = input.deduzProprioNaoDestacado
    ? taxAmount(
        basePropria,
        icmsProprioAliquota(aliquotaInterna, interestadual, query.ufOrigem, query.ufDestino, origemMercadoria),
      )
    : icmsProprio;
  // `Math.max(0, …)`: um ST negativo não existe no leiaute. Só acontece com
  // cadastro incoerente (MVA zero e alíquota interna menor que a do próprio),
  // e zerar é o resultado correto — nada a recolher — em vez de um campo que a
  // SEFAZ rejeita.
  const valor = Math.max(0, toCents(taxAmount(base, aliquotaInterna) - deducao));

  const fcp = rule.fcpAliquota;
  return {
    ok: true,
    // Sempre "4" (Margem de Valor Agregado) — ver `icms_modalidade_base_calculo_st` em `types.ts`.
    modalidadeBaseCalculo: "4",
    mva,
    base,
    aliquota: aliquotaInterna,
    valor,
    // Base do FCP-ST é a mesma do ICMS-ST (confirmado antes de decidir; é como
    // os emissores de referência preenchem `vBCFCPST`). Nula quando o NCM/UF
    // não tem FCP cadastrado — nula é "não calculado", nunca zero.
    fcpBase: fcp !== null ? base : undefined,
    fcpAliquota: fcp ?? undefined,
    fcpValor: fcp !== null ? taxAmount(base, fcp) : undefined,
  };
}

/**
 * O que um item declara de crédito de ICMS do Simples Nacional, ou o motivo de
 * a emissão não poder sair (B8, 03/09/2026).
 */
type CreditoSimples =
  | { ok: true; aliquota: number; valor: number }
  | { ok: false; reason: string };

/**
 * `pCredSN` e `vCredICMSSN` — o crédito de ICMS que o destinatário pode
 * aproveitar nos termos do art. 23 da LC 123/2006.
 *
 * ## O que este cálculo é
 *
 * O optante pelo Simples Nacional paga o ICMS embutido no DAS e **não destaca
 * `vICMS`** na nota. Sem mais nada, o comprador de Regime Normal não teria
 * crédito de nada — e é para isso que existe este par de campos: o vendedor
 * informa quanto da alíquota composta que ele recolhe foi ICMS, e o comprador
 * credita-se desse valor.
 *
 *     vCredICMSSN = valor da operação × pCredSN / 100
 *
 * A base é o **valor da operação** (o valor bruto do item), e não uma "base de
 * cálculo de ICMS": o grupo `ICMSSN101` não tem `vBC` nenhum — os quatro
 * campos dele são `orig`, `CSOSN`, `pCredSN` e `vCredICMSSN`. Consequência
 * prática que vale registrar: `tax_groups.reducao_base_icms` **não alcança o
 * crédito**, porque num CSOSN não há base própria a reduzir (desde B1
 * `icmsCalculaValorProprio` é falso para todos eles menos o `900`).
 *
 * O limite legal do art. 23, §1º, *in fine* — o crédito não pode passar do
 * "ICMS efetivamente devido pelas optantes em relação a essas aquisições" — é
 * satisfeito por construção: `pCredSN` **é** o percentual efetivo de ICMS da
 * faixa da filial, então o produto dele pelo valor da operação é exatamente o
 * imposto devido naquela operação. Este motor não tem como conferir isso de
 * outra forma (não conhece o DAS), e não precisa.
 *
 * ## De onde vem a alíquota, e por que da filial
 *
 * De `branches.aliquota_credito_icms_simples`. Ela é o percentual efetivo de
 * ICMS calculado sobre a faixa de RBT12 em que a filial estava no **mês
 * anterior** ao da operação (Resolução CGSN 140/2018, art. 60: `{[(RBT12 ×
 * alíquota nominal) − parcela a deduzir] / RBT12} × percentual de distribuição
 * do ICMS`). Não depende do produto — depende de quem emite e de quanto ele
 * faturou. O cálculo automático do RBT12 e do enquadramento está fora de
 * escopo por decisão registrada em B8: o número é cadastrado à mão.
 *
 * ## Sem a alíquota cadastrada, **recusa** — e é o ponto que a pesquisa mudou
 *
 * O enunciado de B8 supunha que a ausência devia sair como campo ausente ("não
 * calculado", como o CST de IPI sem alíquota em B1). A tabela de campos do
 * leiaute 4.00 diz o contrário: nos grupos `ICMSSN101` e `ICMSSN201` os dois
 * campos são **obrigatórios** (`S`), e omiti-los é a rejeição de schema "o
 * conteúdo do elemento ICMSSN101 está incompleto. Esperado pCredSN".
 *
 * Ou seja, não existe a emissão que hoje funciona e que a recusa quebraria:
 * como o motor nunca declarou estes campos, **toda** nota com CSOSN `101` ou
 * `201` já era XML inválido. Recusar antes de emitir, com mensagem que diz
 * onde cadastrar, é estritamente melhor do que uma rejeição de schema. É a
 * mesma família de recusa de B2 ("CST com ST sem MVA") e B5 ("CST 03 sem
 * alíquota ad rem").
 *
 * A filial que **não** quer transferir crédito não precisa cadastrar nada: ela
 * usa CSOSN `102` ("sem permissão de crédito") ou `202`, que não passam por
 * aqui. A escolha é do CSOSN, como todo o resto deste motor — e é coerente com
 * o art. 23, §4º, II, da LC 123/2006, que trata "não informar a alíquota" como
 * uma decisão legítima do remetente, não como um erro.
 *
 * ## Duas consequências que este cálculo não trata, e por quê
 *
 * 1. **NFC-e também declara o crédito.** `buildNfcePayloadFromSale` passa pelo
 *    mesmo `resolveItemsForSale`, então uma venda de PDV com CSOSN `101` sai
 *    com `pCredSN`/`vCredICMSSN` — e o consumidor final nunca pode aproveitar
 *    crédito (o art. 23, §1º, exige destino a comercialização ou
 *    industrialização). Não há caso especial aqui porque a alternativa seria
 *    emitir `ICMSSN101` **sem** os campos, que é rejeição de schema: o que está
 *    errado nesse cenário é o CSOSN do cadastro (deveria ser `102`), e o motor
 *    honra o CSOSN como honra em todo o resto.
 * 2. **A nota de devolução recalcula o crédito com a alíquota de hoje.**
 *    `buildReturnNfePayload` também reaproveita `resolveItemsForSale`, e a
 *    alíquota da filial muda a cada virada de faixa de RBT12 — na prática, todo
 *    mês. Uma devolução em novembro de uma venda de setembro reverte um crédito
 *    calculado com o percentual de novembro, diferente do que a nota original
 *    declarou. É **a mesma limitação** que B2 registrou para a MVA e B1 para o
 *    IPI, com a mesma correção certa: fazer a devolução ler
 *    `fiscal_document_items` (onde o percentual declarado está gravado desde
 *    B8) em vez de recalcular. É tarefa própria, e vale para os três de uma vez.
 */
function resolveCreditoSimples(input: {
  group: TaxGroup;
  branch: SaleForInvoiceBranch;
  situacaoTributaria: string | null;
  /** Valor bruto do item — o "valor da operação" sobre o qual o crédito incide. */
  base: number;
}): CreditoSimples {
  const { group, branch, situacaoTributaria, base } = input;
  const aliquota = branch.aliquotaCreditoIcmsSimples;

  if (aliquota === null) {
    return {
      ok: false,
      reason:
        `o CSOSN ${situacaoTributaria} do grupo tributário "${group.name}" transfere crédito de ICMS do ` +
        `Simples Nacional, mas a filial "${branch.name}" não tem a alíquota de crédito cadastrada — o ` +
        `leiaute da NF-e exige pCredSN e vCredICMSSN nesse CSOSN. Cadastre a alíquota em Configurações, ` +
        `ou use um CSOSN sem permissão de crédito (102 ou 202).`,
    };
  }
  // `pCredSN` é `Decimal[3.2-4]` no leiaute: no máximo 999,9999, e um
  // percentual acima de 100 já é cadastro errado. A coluna tem `check` de
  // 0–100, mas a recusa fica aqui também porque o número pode ter sido gravado
  // antes da constraint — e um crédito absurdo é imposto transferido a mais.
  if (aliquota < 0 || aliquota > 100) {
    return {
      ok: false,
      reason:
        `a alíquota de crédito do Simples Nacional cadastrada na filial "${branch.name}" ` +
        `(${aliquota}%) está fora da faixa aceitável de 0 a 100. Corrija em Configurações.`,
    };
  }

  return { ok: true, aliquota, valor: taxAmount(base, aliquota) };
}

/**
 * O que um item declara de PIS **ou** de COFINS, ou o motivo de a emissão não
 * poder sair (B5, 01/09/2026).
 *
 * Os dois impostos têm exatamente a mesma estrutura no leiaute — mesmos grupos,
 * mesmos campos, só as tags mudam de nome —, então uma função só serve aos
 * dois; `imposto` existe apenas para a mensagem de erro dizer qual deles está
 * com o cadastro incompleto.
 *
 * Os campos são mutuamente exclusivos por construção: ou vêm `base` +
 * `aliquotaPorcentual` (grupos `PISAliq`/`PISOutr`), ou vêm `quantidadeVendida`
 * + `aliquotaValor` (grupo `PISQtde`), ou não vem nada (grupo `PISNT`, ou
 * alíquota não cadastrada). Misturar os dois pares é rejeição de schema — o
 * `PISOutr` trata as duas formas como `xs:choice`.
 */
type PisCofinsDeclarado =
  | {
      ok: true;
      /** `vBC` — só no caminho percentual. */
      base?: number;
      /** `pPIS`/`pCOFINS`, em porcentagem — só no caminho percentual. */
      aliquotaPorcentual?: number;
      /** `qBCProd` — só no caminho por unidade de medida. */
      quantidadeVendida?: number;
      /** `vAliqProd`, em reais por unidade — só no caminho por unidade de medida. */
      aliquotaValor?: number;
      /** `vPIS`/`vCOFINS`. Ausente quando nada é declarado. */
      valor?: number;
    }
  | { ok: false; reason: string };

/**
 * Qual dos dois caminhos de PIS/COFINS este item segue, e com que valores.
 *
 * A decisão é do **CST**, não do que está cadastrado: `taxSituations.ts`
 * responde, para cada código, qual grupo XML ele usa e o que aquele grupo tem
 * onde escrever. Os três desfechos, na ordem em que são testados:
 *
 * 1. **Por unidade de medida** (CST `03`, grupo `PISQtde`). A conta é
 *    `vPIS = qBCProd × vAliqProd` — quantidade vendida vezes a alíquota em
 *    reais por unidade —, arredondada a centavos como todo valor de imposto
 *    deste motor. Confirmado contra o MOC (leiaute 4.00) e a tabela de campos
 *    da Focus antes de implementar.
 *
 *    `qBCProd` sai na **quantidade comercial** do item. A rigor o leiaute pede
 *    a quantidade na unidade a que a lei prende a alíquota específica (o litro,
 *    a unidade), que é a `unidade_tributavel` do cadastro quando ela difere da
 *    comercial — mas este sistema não guarda **fator de conversão** entre as
 *    duas: `products` tem `unidade_comercial` e `unidade_tributavel`, e
 *    `SaleForInvoiceItem` carrega uma quantidade só. Inventar a conversão sem
 *    fonte seria decidir por conta própria um número que muda o imposto. Está
 *    documentado como limitação na entrada de B5 do AGENTS.md; enquanto as duas
 *    unidades forem iguais — o caso de todo cadastro de hoje — a quantidade é a
 *    mesma pelos dois critérios.
 *
 *    **Sem a alíquota em reais cadastrada, recusa.** Mesma família de recusa
 *    que B1 criou para "CST de IPI sem alíquota" e B2 para "CST com ST sem
 *    MVA": o CST afirma que o item é tributado ad rem; se o valor por unidade
 *    não está no cadastro, o cadastro se contradiz, e emitir com zero — ou sem
 *    o grupo — produziria nota autorizada com imposto a menos.
 *
 * 2. **Percentual** (`01`/`02` e a faixa `49`–`99`), exatamente como antes de
 *    B5: `vPIS = vBC × pPIS`, sobre a base cheia do item. A redução de base do
 *    ICMS não alcança PIS/COFINS — o leiaute não tem `pRedBC` para eles (ver
 *    `reducaoBaseIcms` em `taxGroups.ts`).
 *
 * 3. **Nada** — CST `04`–`09` (grupo `PISNT`, só o CST), ou alíquota
 *    percentual não cadastrada. Campos ausentes, que é "não calculado".
 *
 * A alíquota em reais cadastrada num CST que **não** é `03` é ignorada em
 * silêncio, pelo mesmo critério com que a percentual já era ignorada num CST
 * `04`: o CST manda, e um cadastro com as duas alíquotas preenchidas descreve
 * um grupo que serve a produtos de CSTs diferentes, não uma contradição.
 */
function resolvePisCofins(input: {
  group: TaxGroup;
  imposto: "PIS" | "COFINS";
  cst: string | null;
  aliquotaPorcentual: number | null;
  aliquotaPorUnidade: number | null;
  /** Valor bruto do item — a base do caminho percentual. */
  base: number;
  /** Quantidade comercial do item — o `qBCProd` do caminho por unidade. */
  quantidade: number;
}): PisCofinsDeclarado {
  const { group, imposto, cst, aliquotaPorcentual, aliquotaPorUnidade, base, quantidade } = input;

  if (pisCofinsCalculaValorPorUnidade(cst)) {
    if (aliquotaPorUnidade === null) {
      return {
        ok: false,
        reason:
          `o grupo tributário "${group.name}" tem CST de ${imposto} ${cst} (alíquota por unidade de ` +
          `medida), mas não tem a alíquota de ${imposto} em reais por unidade cadastrada — é ela que ` +
          `o cálculo multiplica pela quantidade vendida. Complete o cadastro em Grupos tributários.`,
      };
    }
    return {
      ok: true,
      quantidadeVendida: quantidade,
      aliquotaValor: aliquotaPorUnidade,
      valor: toCents(quantidade * aliquotaPorUnidade),
    };
  }

  if (aliquotaPorcentual !== null && pisCofinsCalculaValor(cst)) {
    return {
      ok: true,
      base,
      aliquotaPorcentual,
      valor: taxAmount(base, aliquotaPorcentual),
    };
  }

  return { ok: true };
}

/**
 * Soma um campo de valor pelos itens que o **declararam**, a centavos.
 * Devolve `undefined` só quando nenhum item declarou — "nulo = não calculado",
 * a mesma convenção que A3 fixou para as colunas de `fiscal_document_items`.
 *
 * O critério é a presença do campo, e não o resultado da soma, porque os dois
 * divergem num caso real: um item com CST tributado e alíquota **zero**
 * declara `vBC` e `vICMS` de zero, e o total tem de acompanhar — o validador
 * da SEFAZ exige que o `vBC` do grupo `total` seja a soma dos `vBC` dos itens
 * (regra W03-10). Somar e depois converter zero em ausente, como o código
 * fazia antes de B1, mandava itens com base e um total sem base nenhuma.
 */
function totalDeclarado(
  items: NfePayloadItem[],
  pick: (item: NfePayloadItem) => number | undefined,
): number | undefined {
  const declarados = items.map(pick).filter((valor): valor is number => valor !== undefined);
  if (declarados.length === 0) return undefined;
  return toCents(declarados.reduce((soma, valor) => soma + valor, 0));
}

/**
 * Total da nota com os impostos **por fora** somados.
 *
 * A regra W16-10 do validador da SEFAZ define `vNF` como
 * `vProd − vDesc − vICMSDeson + vST + vFCPST + vFrete + vSeg + vOutro + vII +
 * vIPI + …`. Três dessas parcelas este motor calcula: **IPI** (desde B1),
 * **ICMS-ST** e **FCP-ST** (B2). Nenhuma delas está no preço da venda — são
 * acrescidas ao documento —, então declará-las nos itens sem somá-las no total
 * é rejeição garantida.
 *
 * Nasceu em B1 como `totalComIpi`, com um parâmetro só; virou variádica em B2,
 * quando deixou de existir um único imposto por fora. Enquanto nenhum grupo
 * tiver IPI e nenhum item tiver ST — o estado de hoje, já que as colunas
 * nascem nulas —, devolve exatamente `sale.totalAmount` e nada muda. Quando
 * passar a haver, **o total da nota fica maior que o total da venda**: correto
 * pelo leiaute, e a diferença mais visível que B1 e B2 introduzem.
 */
function totalComImpostosPorFora(total: number, ...porFora: (number | undefined)[]): number {
  const declarados = porFora.filter((valor): valor is number => valor !== undefined);
  if (declarados.length === 0) return total;
  return toCents(declarados.reduce((soma, valor) => soma + valor, total));
}

/**
 * `mvaRules` é opcional e vazio por padrão (B2): **não ter MVA cadastrada não
 * é erro** — a imensa maioria das mercadorias não tem ST, e o cadastro só é
 * consultado para os CST/CSOSN que a declaram. Quem passa a lista é a Edge
 * Function (`readMvaRules`, em `data.ts`); os testes que não tratam de ST
 * simplesmente a omitem.
 */
export function buildNfePayloadFromSale(
  sale: SaleForInvoice,
  rules: TaxRuleRow[],
  mvaRules: MvaRuleRow[] = [],
): BuildPayloadResult {
  const errors: string[] = [];

  if (!sale.contact) {
    errors.push("Venda sem cliente identificado — não é possível emitir NF-e sem destinatário.");
  }
  if (!sale.branch.cnpj) errors.push("Filial sem CNPJ cadastrado.");
  if (!sale.branch.uf) errors.push("Filial sem UF cadastrada (cadastro de filial é só por SQL, por enquanto).");
  if (!sale.branch.regimeTributario) errors.push("Filial sem regime tributário cadastrado.");
  if (sale.contact && !sale.contact.uf) errors.push("Cliente sem UF cadastrada — edite o endereço do cliente.");

  if (errors.length > 0) return { ok: false, errors };

  // A partir daqui as validações acima garantem que branch/contact têm o essencial.
  const branch = sale.branch;
  const contact = sale.contact!;
  const regime = branch.regimeTributario!;
  const document = onlyDigits(contact.document);
  const tipoCliente = resolveTipoCliente(contact.document, contact.indicadorIe);

  const query: TaxRuleQuery = {
    regime,
    naturezaOperacao: "venda",
    ufOrigem: branch.uf!,
    ufDestino: contact.uf!,
    tipoCliente,
  };

  const resolved = resolveItemsForSale(sale, rules, query, mvaRules);
  if (!resolved.ok) return resolved;
  const {
    cfop,
    items,
    icmsBaseCalculoTotal,
    icmsValorTotal,
    icmsStBaseCalculoTotal,
    icmsStValorTotal,
    fcpStValorTotal,
    ipiValorTotal,
    pisValorTotal,
    cofinsValorTotal,
  } = resolved.data;

  const localDestino = branch.uf === contact.uf ? 1 : 2;

  const payload: NfePayload = {
    natureza_operacao: sale.operationType?.trim() || "Venda de mercadoria",
    data_emissao: new Date(`${sale.issueDate}T12:00:00-03:00`).toISOString(),
    tipo_documento: 1,
    finalidade_emissao: 1,
    consumidor_final: tipoCliente === "consumidor_final" ? 1 : 0,
    presenca_comprador: 1,
    local_destino: localDestino,

    cnpj_emitente: branch.cnpj!,
    nome_emitente: branch.name,
    logradouro_emitente: branch.logradouro ?? undefined,
    numero_emitente: branch.numero ?? undefined,
    bairro_emitente: branch.bairro ?? undefined,
    municipio_emitente: branch.municipio ?? undefined,
    uf_emitente: branch.uf ?? undefined,
    cep_emitente: branch.cep ?? undefined,
    inscricao_estadual_emitente: branch.inscricaoEstadual ?? undefined,
    regime_tributario_emitente: Number.parseInt(regime, 10),

    nome_destinatario: contact.name,
    cnpj_destinatario: isCnpj(contact.document) ? document : undefined,
    cpf_destinatario: !isCnpj(contact.document) ? document : undefined,
    inscricao_estadual_destinatario: contact.inscricaoEstadual ?? undefined,
    indicador_inscricao_estadual_destinatario: resolveIndicadorIeCodigo(contact.indicadorIe),
    logradouro_destinatario: contact.logradouro ?? undefined,
    numero_destinatario: contact.numero ?? undefined,
    bairro_destinatario: contact.bairro ?? undefined,
    municipio_destinatario: contact.municipio ?? undefined,
    uf_destinatario: contact.uf ?? undefined,
    cep_destinatario: contact.cep ?? undefined,
    pais_destinatario: "Brasil",
    telefone_destinatario: contact.phone ?? undefined,

    valor_produtos: sale.subtotalAmount,
    valor_total: totalComImpostosPorFora(sale.totalAmount, ipiValorTotal, icmsStValorTotal, fcpStValorTotal),
    valor_desconto: sale.discountAmount || undefined,
    valor_frete: sale.freightAmount || undefined,
    icms_base_calculo: icmsBaseCalculoTotal,
    icms_valor_total: icmsValorTotal,
    icms_base_calculo_st: icmsStBaseCalculoTotal,
    icms_valor_total_st: icmsStValorTotal,
    fcp_valor_total_st: fcpStValorTotal,
    valor_ipi: ipiValorTotal,
    valor_pis: pisValorTotal,
    valor_cofins: cofinsValorTotal,
    modalidade_frete: sale.freightAmount > 0 ? 0 : 9,

    items,
    informacoes_adicionais_contribuinte: `Venda ${sale.code}`,
  };

  return { ok: true, payload, cfop };
}

/** `sale_payments.method` → código de forma de pagamento da SEFAZ (grupo `pag`, obrigatório na NFC-e). */
const FORMA_PAGAMENTO_CODIGO: Record<string, string> = {
  dinheiro: "01",
  debito: "04",
  credito: "03",
  pix: "17",
  boleto: "15",
  outro: "99",
};

function buildFormasPagamento(payments: SaleForInvoicePayment[]): NfePayloadPagamento[] | undefined {
  if (payments.length === 0) return undefined;
  return payments.map((payment) => ({
    forma_pagamento: FORMA_PAGAMENTO_CODIGO[payment.method] ?? "99",
    valor_pagamento: payment.amount,
  }));
}

/**
 * Campos de destinatário para NFC-e — deliberadamente mais enxutos que os de
 * NF-e (`buildNfePayloadFromSale` acima): sem cliente, o grupo inteiro sai do
 * payload (não força nenhum campo vazio — não existe, no schema da Focus/
 * SEFAZ, um indicador de "operação sem identificação do destinatário": a
 * ausência do grupo `dest` já significa isso). Com cliente, manda só o que
 * identifica (nome + CPF/CNPJ, telefone se tiver) — sem exigir endereço
 * completo, que não se pede num balcão. IE só faz sentido para CNPJ.
 */
function buildNfceDestinatarioFields(contact: SaleForInvoiceContact | null): Partial<NfePayload> {
  if (!contact) return {};
  const document = onlyDigits(contact.document);
  const cnpj = isCnpj(contact.document);
  return {
    nome_destinatario: contact.name,
    cnpj_destinatario: cnpj ? document : undefined,
    cpf_destinatario: !cnpj ? document : undefined,
    telefone_destinatario: contact.phone ?? undefined,
    inscricao_estadual_destinatario: cnpj ? (contact.inscricaoEstadual ?? undefined) : undefined,
    indicador_inscricao_estadual_destinatario: cnpj ? resolveIndicadorIeCodigo(contact.indicadorIe) : undefined,
    pais_destinatario: "Brasil",
  };
}

/**
 * NFC-e (modelo 65) — etapa 8.5. Reaproveita `resolveItemsForSale` (CFOP +
 * CST/alíquota por item, idêntico à NF-e); diverge no cabeçalho:
 *
 * - **Cliente é opcional.** A maioria das vendas de balcão não identifica o
 *   comprador — isso é normal, não falta de cadastro, então (ao contrário de
 *   `buildNfePayloadFromSale`) a ausência de `sale.contact` não é erro aqui.
 * - **`consumidor_final` é sempre 1**, sem derivar de CPF/CNPJ/indicador de
 *   IE: NFC-e é por definição venda a consumidor final. Mesmo um cliente
 *   identificado com CNPJ compra como consumidor final no balcão.
 * - **`presenca_comprador` é sempre 1** (presencial — é venda de balcão).
 * - **UF de destino é sempre a UF da própria filial**, identificado ou não o
 *   cliente: a operação é presencial e interna por natureza (o comprador está
 *   fisicamente na loja), então não faz sentido usar a UF cadastrada de um
 *   cliente que mora em outro estado para decidir CFOP/local_destino — quem
 *   decide é onde a venda aconteceu, não onde o cliente mora.
 */
export function buildNfcePayloadFromSale(
  sale: SaleForInvoice,
  rules: TaxRuleRow[],
  mvaRules: MvaRuleRow[] = [],
): BuildPayloadResult {
  const errors: string[] = [];
  if (!sale.branch.cnpj) errors.push("Filial sem CNPJ cadastrado.");
  if (!sale.branch.uf) errors.push("Filial sem UF cadastrada (cadastro de filial é só por SQL, por enquanto).");
  if (!sale.branch.regimeTributario) errors.push("Filial sem regime tributário cadastrado.");

  if (errors.length > 0) return { ok: false, errors };

  const branch = sale.branch;
  const regime = branch.regimeTributario!;

  const query: TaxRuleQuery = {
    regime,
    naturezaOperacao: "venda",
    ufOrigem: branch.uf!,
    ufDestino: branch.uf!,
    tipoCliente: "consumidor_final",
  };

  const resolved = resolveItemsForSale(sale, rules, query, mvaRules);
  if (!resolved.ok) return resolved;
  const {
    cfop,
    items,
    icmsBaseCalculoTotal,
    icmsValorTotal,
    icmsStBaseCalculoTotal,
    icmsStValorTotal,
    fcpStValorTotal,
    ipiValorTotal,
    pisValorTotal,
    cofinsValorTotal,
  } = resolved.data;

  const payload: NfePayload = {
    natureza_operacao: sale.operationType?.trim() || "Venda de mercadoria",
    data_emissao: new Date(`${sale.issueDate}T12:00:00-03:00`).toISOString(),
    tipo_documento: 1,
    finalidade_emissao: 1,
    consumidor_final: 1,
    presenca_comprador: 1,
    local_destino: 1,

    cnpj_emitente: branch.cnpj!,
    nome_emitente: branch.name,
    logradouro_emitente: branch.logradouro ?? undefined,
    numero_emitente: branch.numero ?? undefined,
    bairro_emitente: branch.bairro ?? undefined,
    municipio_emitente: branch.municipio ?? undefined,
    uf_emitente: branch.uf ?? undefined,
    cep_emitente: branch.cep ?? undefined,
    inscricao_estadual_emitente: branch.inscricaoEstadual ?? undefined,
    regime_tributario_emitente: Number.parseInt(regime, 10),

    ...buildNfceDestinatarioFields(sale.contact),

    valor_produtos: sale.subtotalAmount,
    valor_total: totalComImpostosPorFora(sale.totalAmount, ipiValorTotal, icmsStValorTotal, fcpStValorTotal),
    valor_desconto: sale.discountAmount || undefined,
    valor_frete: sale.freightAmount || undefined,
    icms_base_calculo: icmsBaseCalculoTotal,
    icms_valor_total: icmsValorTotal,
    icms_base_calculo_st: icmsStBaseCalculoTotal,
    icms_valor_total_st: icmsStValorTotal,
    fcp_valor_total_st: fcpStValorTotal,
    valor_ipi: ipiValorTotal,
    valor_pis: pisValorTotal,
    valor_cofins: cofinsValorTotal,
    modalidade_frete: sale.freightAmount > 0 ? 0 : 9,

    items,
    formas_pagamento: buildFormasPagamento(sale.payments),
    informacoes_adicionais_contribuinte: `Venda ${sale.code}`,
  };

  return { ok: true, payload, cfop };
}

/* ------------------------------------------------------------------------ */
/* Nota de devolução (etapa 9)                                               */
/* ------------------------------------------------------------------------ */

export type SaleReturnForInvoice = {
  /** Código da devolução (`sale_returns.code`) — vai nas informações adicionais. */
  code: string;
  /** Código da venda original — idem. */
  saleCode: string;
  issueDate: string;
  /** Soma dos itens devolvidos, já com o desconto proporcional descontado. */
  totalAmount: number;
  discountAmount: number;
  /**
   * Chave de acesso da nota da venda original, quando existe e está
   * autorizada. **Nula é caso legítimo** — uma venda que nunca teve nota
   * (ou cuja nota foi recusada) pode ser devolvida do mesmo jeito; o que a
   * ausência impede é *referenciar* a original, e quem decide o que fazer com
   * isso é a tela, não este mapeamento.
   */
  originalChave: string | null;
  branch: SaleForInvoiceBranch;
  contact: SaleForInvoiceContact | null;
  items: SaleForInvoiceItem[];
};

/**
 * NF-e de **devolução** (modelo 55, `finalidade_emissao: 4`) — etapa 9.
 *
 * Reaproveita `resolveItemsForSale` inteiro (CFOP pela operação, CST/alíquota
 * por item via grupo tributário do produto), trocando só a dimensão
 * `natureza_operacao` de `'venda'` para `'devolucao'`: é isso que faz o CFOP
 * sair da(s) regra(s) de devolução cadastradas em Tributações (CFOP de
 * **entrada**, 1202/2202 e afins) em vez do CFOP de venda. Sem regra
 * cadastrada, `resolveTaxRule` devolve `found: false` e a emissão para com a
 * mensagem acionável de sempre — comportamento esperado, não quebra.
 *
 * O que diverge de uma NF-e de venda, e por quê:
 *
 * - **`tipo_documento: 0`** (nota de entrada): a mercadoria está voltando para
 *   a loja. Numa venda é `1` (saída).
 * - **`finalidade_emissao: 4`** (devolução), contra `1` (normal) da venda.
 * - **`notas_referenciadas`** com a chave da nota original — é o que liga o
 *   documento de devolução ao que ele desfaz. Quando a venda não tem nota
 *   autorizada, o grupo simplesmente não vai (não se inventa uma chave).
 * - **`presenca_comprador: 0`** ("não se aplica"): quem emite é a loja, o
 *   comprador não está comprando nada nesta operação.
 *
 * Pesquisado contra a documentação da Focus NFe antes de desenhar (mesmo
 * procedimento das etapas F1/8/8.5) — ver `NfePayloadNotaReferenciada`.
 */
export function buildReturnNfePayload(
  saleReturn: SaleReturnForInvoice,
  rules: TaxRuleRow[],
  mvaRules: MvaRuleRow[] = [],
): BuildPayloadResult {
  const errors: string[] = [];

  if (!saleReturn.contact) {
    errors.push(
      "A venda devolvida não tem cliente identificado — a NF-e de devolução exige destinatário. " +
        "Se a venda saiu por NFC-e sem cliente, o caminho é cancelar a nota original (dentro do prazo).",
    );
  }
  if (!saleReturn.branch.cnpj) errors.push("Filial sem CNPJ cadastrado.");
  if (!saleReturn.branch.uf) errors.push("Filial sem UF cadastrada (cadastro de filial é só por SQL, por enquanto).");
  if (!saleReturn.branch.regimeTributario) errors.push("Filial sem regime tributário cadastrado.");
  if (saleReturn.contact && !saleReturn.contact.uf) {
    errors.push("Cliente sem UF cadastrada — edite o endereço do cliente.");
  }

  if (errors.length > 0) return { ok: false, errors };

  const branch = saleReturn.branch;
  const contact = saleReturn.contact!;
  const regime = branch.regimeTributario!;
  const document = onlyDigits(contact.document);
  const tipoCliente = resolveTipoCliente(contact.document, contact.indicadorIe);

  const query: TaxRuleQuery = {
    regime,
    naturezaOperacao: "devolucao",
    ufOrigem: branch.uf!,
    ufDestino: contact.uf!,
    tipoCliente,
  };

  // O "sale" que `resolveItemsForSale` recebe é a devolução vestida do mesmo
  // formato: os itens são os devolvidos, com a quantidade devolvida. Nenhuma
  // linha de tributação é reimplementada aqui.
  const asSale: SaleForInvoice = {
    code: saleReturn.code,
    issueDate: saleReturn.issueDate,
    subtotalAmount: saleReturn.totalAmount,
    totalAmount: saleReturn.totalAmount,
    discountAmount: saleReturn.discountAmount,
    freightAmount: 0,
    branch,
    contact,
    items: saleReturn.items,
    payments: [],
  };

  const resolved = resolveItemsForSale(asSale, rules, query, mvaRules);
  if (!resolved.ok) return resolved;
  const {
    cfop,
    items,
    icmsBaseCalculoTotal,
    icmsValorTotal,
    icmsStBaseCalculoTotal,
    icmsStValorTotal,
    fcpStValorTotal,
    ipiValorTotal,
    pisValorTotal,
    cofinsValorTotal,
  } = resolved.data;

  const payload: NfePayload = {
    natureza_operacao: "Devolução de venda",
    data_emissao: new Date(`${saleReturn.issueDate}T12:00:00-03:00`).toISOString(),
    tipo_documento: 0,
    finalidade_emissao: 4,
    consumidor_final: tipoCliente === "consumidor_final" ? 1 : 0,
    presenca_comprador: 0,
    local_destino: branch.uf === contact.uf ? 1 : 2,

    cnpj_emitente: branch.cnpj!,
    nome_emitente: branch.name,
    logradouro_emitente: branch.logradouro ?? undefined,
    numero_emitente: branch.numero ?? undefined,
    bairro_emitente: branch.bairro ?? undefined,
    municipio_emitente: branch.municipio ?? undefined,
    uf_emitente: branch.uf ?? undefined,
    cep_emitente: branch.cep ?? undefined,
    inscricao_estadual_emitente: branch.inscricaoEstadual ?? undefined,
    regime_tributario_emitente: Number.parseInt(regime, 10),

    nome_destinatario: contact.name,
    cnpj_destinatario: isCnpj(contact.document) ? document : undefined,
    cpf_destinatario: !isCnpj(contact.document) ? document : undefined,
    inscricao_estadual_destinatario: contact.inscricaoEstadual ?? undefined,
    indicador_inscricao_estadual_destinatario: resolveIndicadorIeCodigo(contact.indicadorIe),
    logradouro_destinatario: contact.logradouro ?? undefined,
    numero_destinatario: contact.numero ?? undefined,
    bairro_destinatario: contact.bairro ?? undefined,
    municipio_destinatario: contact.municipio ?? undefined,
    uf_destinatario: contact.uf ?? undefined,
    cep_destinatario: contact.cep ?? undefined,
    pais_destinatario: "Brasil",
    telefone_destinatario: contact.phone ?? undefined,

    valor_produtos: saleReturn.totalAmount,
    valor_total: totalComImpostosPorFora(
      saleReturn.totalAmount,
      ipiValorTotal,
      icmsStValorTotal,
      fcpStValorTotal,
    ),
    valor_desconto: saleReturn.discountAmount || undefined,
    icms_base_calculo: icmsBaseCalculoTotal,
    icms_valor_total: icmsValorTotal,
    icms_base_calculo_st: icmsStBaseCalculoTotal,
    icms_valor_total_st: icmsStValorTotal,
    fcp_valor_total_st: fcpStValorTotal,
    valor_ipi: ipiValorTotal,
    valor_pis: pisValorTotal,
    valor_cofins: cofinsValorTotal,
    modalidade_frete: 9,

    notas_referenciadas: saleReturn.originalChave ? [{ chave_nfe: saleReturn.originalChave }] : undefined,

    items,
    informacoes_adicionais_contribuinte: `Devolução ${saleReturn.code} referente à venda ${saleReturn.saleCode}`,
  };

  return { ok: true, payload, cfop };
}
