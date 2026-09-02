/**
 * ICMS-ST: o cadastro de MVA por NCM × UF de destino, a alíquota interestadual
 * e a fórmula da MVA ajustada (B2, 01/09/2026).
 *
 * Este arquivo é para o ICMS-ST o que `taxRules.ts` é para o CFOP: a função
 * pura que resolve o cadastro, sem saber o que é Supabase, e a tabela de
 * conversão da linha crua. Quem aplica o resultado no item é
 * `resolveItemsForSale` (`invoiceMapping.ts`).
 *
 * ## Por que MVA é NCM × UF de destino, e não grupo tributário
 *
 * As alíquotas de PIS/COFINS/IPI/ICMS próprio moram em `tax_groups` porque são
 * do **produto**: o mesmo item tributa igual, venda para onde vender. A MVA
 * não: quem a publica é o estado **de destino**, por NCM, em protocolo ou
 * convênio ICMS-ST — o mesmo produto tem MVA diferente conforme o estado que
 * vai receber. Guardá-la em `tax_groups` obrigaria um grupo por combinação
 * produto × UF, que é o cadastro se multiplicando para representar uma
 * dimensão que ele não tem. Vale o mesmo para o FCP, e é por isso que
 * `fcp_aliquota` mora aqui e não lá.
 *
 * ## O que este arquivo deliberadamente não sabe
 *
 * **A alíquota interna do estado de destino.** Não existe, neste sistema, uma
 * tabela de alíquota interna por UF × NCM, e inventar uma de 27 UFs sem fonte
 * confiável seria pior do que a aproximação: quem chama usa
 * `tax_groups.aliquotaIcms` como proxy da interna do destino. A decisão está
 * registrada no AGENTS.md (entrada de B2) e é a limitação conhecida mais
 * relevante desta tarefa.
 */

/** Linha de `mva_rules`, já em camelCase (mesmo formato que o motor genérico expõe). */
export type MvaRuleRow = {
  id: string;
  /** NCM de 8 dígitos, sem pontuação — o mesmo formato de `products.ncm`. */
  ncm: string;
  /** Pode ser `'*'` — ver `WILDCARD_UF_DESTINO` em `taxRules.ts`, mesmo coringa. */
  ufDestino: string;
  /** `pMVAST` **original** (do protocolo/convênio), em percentual. */
  mvaOriginal: number;
  /** `pFCPST` em percentual. Nula = este NCM/UF não tem FCP — não zero. */
  fcpAliquota: number | null;
};

/** Linha crua de `mva_rules` → `MvaRuleRow`. */
export function toMvaRuleRow(row: {
  id: string;
  ncm: string;
  uf_destino: string;
  mva_original: number;
  fcp_aliquota: number | null;
}): MvaRuleRow {
  return {
    id: row.id,
    ncm: row.ncm,
    ufDestino: row.uf_destino,
    mvaOriginal: row.mva_original,
    fcpAliquota: row.fcp_aliquota,
  };
}

/** As colunas de `mva_rules` que `toMvaRuleRow` precisa — para quem monta o `select`. */
export const MVA_RULE_COLUMNS = "id, ncm, uf_destino, mva_original, fcp_aliquota";

/** Valor de `uf_destino` que significa "qualquer UF destino" — igual ao de `tax_rules`. */
export const WILDCARD_UF_DESTINO = "*";

export type MvaRuleQuery = {
  /** NCM do produto (`products.ncm`). */
  ncm: string;
  /** UF de destino da operação. */
  ufDestino: string;
};

export type MvaRuleResolution =
  | { found: true; rule: MvaRuleRow; matchedWildcard: boolean }
  | {
      found: false;
      /** Mensagem pronta para a tela ("cadastre uma MVA para este NCM"). */
      reason: string;
      /** Só no caso defensivo de empate — ver `resolveTaxRule`, mesmo desenho. */
      ambiguousRuleIds?: string[];
    };

function norm(value: string): string {
  return value.trim().toUpperCase();
}

/** Tira pontuação do NCM ("2202.10.00" → "22021000"), para o cadastro poder ser digitado dos dois jeitos. */
function normNcm(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Resolve a MVA aplicável a um item.
 *
 * Critério de desempate idêntico ao de `resolveTaxRule`: **mais específica
 * vence** — uma linha com `uf_destino` exato bate uma linha coringa (`'*'`).
 * O NCM é sempre exato (comparado só pelos dígitos): protocolos de ST listam
 * NCM de 8 dígitos, e casar por prefixo faria uma linha de `2202` capturar
 * silenciosamente todo o capítulo, que é o oposto do que "mais específico
 * vence" promete.
 */
export function resolveMvaRule(query: MvaRuleQuery, rules: MvaRuleRow[]): MvaRuleResolution {
  const ncm = normNcm(query.ncm);
  const ufDestino = norm(query.ufDestino);

  const candidates = rules.filter((rule) => {
    if (normNcm(rule.ncm) !== ncm) return false;
    const ruleUf = norm(rule.ufDestino);
    return ruleUf === ufDestino || ruleUf === WILDCARD_UF_DESTINO;
  });

  if (candidates.length === 0) {
    return {
      found: false,
      reason: `nenhuma MVA cadastrada para o NCM ${ncm} com destino ${ufDestino}. Cadastre em MVA (ICMS-ST).`,
    };
  }

  const exact = candidates.filter((rule) => norm(rule.ufDestino) !== WILDCARD_UF_DESTINO);
  const winners = exact.length > 0 ? exact : candidates;

  if (winners.length > 1) {
    return {
      found: false,
      reason: `mais de uma MVA de mesma especificidade se aplica ao NCM ${ncm} com destino ${ufDestino} — corrija o cadastro em MVA (ICMS-ST).`,
      ambiguousRuleIds: winners.map((rule) => rule.id),
    };
  }

  const rule = winners[0];
  return { found: true, rule, matchedWildcard: norm(rule.ufDestino) === WILDCARD_UF_DESTINO };
}

/* ------------------------------------------------------------------------ */
/* Alíquota interestadual do ICMS                                            */
/* ------------------------------------------------------------------------ */

/**
 * As três alíquotas interestaduais são **federais e estáveis desde 2013**, por
 * isso são tabela fixa no código e não cadastro: mudá-las exige resolução do
 * Senado, não decisão do contador que usa o sistema.
 *
 * - **4%** — Resolução do Senado nº 13/2012, para mercadoria importada ou com
 *   Conteúdo de Importação acima de 40%. Quem diz se é o caso é a **origem da
 *   mercadoria** (`products.origem_mercadoria`), que o cadastro já tem: ver
 *   `ORIGENS_IMPORTADAS_4`.
 * - **7%** — Resolução do Senado nº 22/1989, art. 1º, parágrafo único: saídas
 *   das regiões Sul e Sudeste com destino às regiões Norte, Nordeste,
 *   Centro-Oeste e ao Espírito Santo.
 * - **12%** — o resto.
 */

/** Norte, Nordeste, Centro-Oeste e o Espírito Santo — os destinos da alíquota de 7%. */
const DESTINOS_ALIQUOTA_7 = new Set([
  // Norte
  "AC",
  "AM",
  "AP",
  "PA",
  "RO",
  "RR",
  "TO",
  // Nordeste
  "AL",
  "BA",
  "CE",
  "MA",
  "PB",
  "PE",
  "PI",
  "RN",
  "SE",
  // Centro-Oeste
  "DF",
  "GO",
  "MS",
  "MT",
  // Sudeste, mas destinatário do mesmo incentivo pela Resolução 22/89
  "ES",
]);

/**
 * As UFs de origem que aplicam 7% para os destinos acima: Sul (PR, RS, SC) e
 * Sudeste (MG, RJ, SP) — **sem o Espírito Santo**.
 *
 * O ES é geograficamente Sudeste, mas a Resolução 22/89 o põe do lado de quem
 * *recebe* o incentivo, não de quem o concede: saída **do** ES é sempre 12%,
 * mesmo para o Nordeste. Isto foi conferido em duas fontes independentes antes
 * de codificar (tabelas de alíquota interestadual da Conta Azul e da TaxUp,
 * ambas com ES → BA/AM/GO = 12%), porque é o ponto da tabela que quase todo
 * resumo em prosa erra.
 */
const ORIGENS_ALIQUOTA_7 = new Set(["MG", "PR", "RJ", "RS", "SC", "SP"]);

/**
 * Códigos de `products.origem_mercadoria` que caem nos 4% da Resolução 13/2012:
 * `1` e `2` (importação integral, direta ou no mercado interno), `3` (nacional
 * com Conteúdo de Importação entre 40% e 70%) e `8` (acima de 70%).
 *
 * Ficam **de fora**, e é o detalhe que decide a alíquota: `6` e `7`
 * (estrangeira **sem similar nacional**, lista CAMEX) e `4` (processo produtivo
 * básico) são exceções expressas da própria resolução e mantêm 7%/12%; `0` e
 * `5` são nacionais.
 */
const ORIGENS_IMPORTADAS_4 = new Set(["1", "2", "3", "8"]);

/**
 * A alíquota interestadual (%) de uma operação — só faz sentido chamar quando
 * origem e destino são UFs diferentes.
 *
 * `origemMercadoria` ausente ou desconhecida cai no caminho nacional (7%/12%):
 * é o comportamento conservador, já que os 4% dependem de um cadastro
 * afirmativo de importação e não de sua falta.
 */
export function aliquotaInterestadual(
  ufOrigem: string,
  ufDestino: string,
  origemMercadoria: string | null | undefined,
): number {
  if (ORIGENS_IMPORTADAS_4.has((origemMercadoria ?? "").trim())) return 4;
  if (ORIGENS_ALIQUOTA_7.has(norm(ufOrigem)) && DESTINOS_ALIQUOTA_7.has(norm(ufDestino))) return 7;
  return 12;
}

/* ------------------------------------------------------------------------ */
/* MVA ajustada                                                              */
/* ------------------------------------------------------------------------ */

/**
 * MVA ajustada (%), a partir da MVA original e das duas alíquotas:
 *
 * ```
 * MVA ajustada = [(1 + MVA original/100) × (1 − ALQ_inter/100) / (1 − ALQ_intra/100)] − 1
 * ```
 *
 * É a fórmula publicada pelos próprios estados (SEFAZ-PE e SEFAZ-PR trazem
 * exatamente esta redação). O que ela faz é neutralizar o crédito menor que o
 * destinatário toma numa entrada interestadual: sem o ajuste, a mesma MVA
 * produziria uma carga final menor para o produto que veio de fora do que para
 * o comprado dentro do estado.
 *
 * O resultado sai em percentual com **4 casas decimais**, que é a precisão de
 * `pMVAST` no leiaute e de `mva_rules.mva_original` no banco (`numeric(7,4)`).
 *
 * `aliquotaInterna >= 100` devolve a MVA original sem ajuste: seria divisão por
 * zero ou por negativo. É defesa em profundidade — a alíquota vem de
 * `tax_groups.aliquota_icms`, coluna que nasceu em 19/08/2026 sem `check` de
 * 0–100, e este núcleo também roda com dado de teste que não passa pelo banco.
 */
export function mvaAjustada(mvaOriginal: number, aliquotaInter: number, aliquotaInterna: number): number {
  if (aliquotaInterna >= 100) return mvaOriginal;
  const ajustada = ((1 + mvaOriginal / 100) * (1 - aliquotaInter / 100)) / (1 - aliquotaInterna / 100) - 1;
  return Math.round(ajustada * 100 * 10_000) / 10_000;
}
