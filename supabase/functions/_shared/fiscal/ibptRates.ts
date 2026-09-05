/**
 * Lei da Transparência Fiscal (Lei 12.741/2012): o cadastro de percentuais
 * aproximados de tributos por NCM × UF, e a composição do `vTotTrib` (B9,
 * 05/09/2026).
 *
 * Este arquivo é para o `vTotTrib` o que `mvaRules.ts` é para o ICMS-ST: a
 * função pura que resolve o cadastro, sem saber o que é Supabase, e a tabela de
 * conversão da linha crua. Quem aplica o resultado no item é
 * `resolveItemsForSale` (`invoiceMapping.ts`).
 *
 * ## O que a lei manda, em uma frase
 *
 * > Emitidos por ocasião da venda ao consumidor de mercadorias e serviços [...]
 * > deverá constar, dos documentos fiscais [...] a informação do valor
 * > aproximado correspondente à totalidade dos tributos federais, estaduais e
 * > municipais, cuja incidência influi na formação dos respectivos preços de
 * > venda.
 * >
 * > — Lei 12.741/2012, art. 1º, *caput*
 *
 * No leiaute 4.00 isso é o campo **`vTotTrib`**, que existe em dois lugares:
 * `det/imposto/vTotTrib` (id `M02`) por item e `total/ICMSTot/vTotTrib`
 * (id `W16a`) no cabeçalho. Os dois são **opcionais** — e é essa a diferença
 * de filosofia que B9 introduz neste motor; ver `resolveIbptRate` abaixo.
 *
 * ## Por que cadastro manual, e não importação em massa da tabela do IBPT
 *
 * A fonte de mercado dos percentuais é a tabela "De Olho no Imposto", do IBPT,
 * que o Decreto 8.264/2014 (art. 5º) autoriza expressamente: os valores "poderão
 * ser calculados e fornecidos, semestralmente, por instituição de âmbito
 * nacional reconhecidamente idônea". Ela **não** entra aqui como semente, e o
 * motivo não é técnico:
 *
 * - O **termo de uso** do IBPT libera o download **mediante cadastro** da
 *   pessoa física ou jurídica usuária e veda a comercialização pelo usuário.
 *   É uma licença de uso concedida a quem se cadastra, não um dado público de
 *   uso livre — o oposto de CFOP e NCM, que este sistema importou em massa por
 *   migration (`import_cfop_codes_from_source`,
 *   `import_ncm_codes_from_siscomex`) exatamente porque são catálogos oficiais
 *   sem restrição.
 * - A tabela é **trimestral** (versões novas o ano inteiro). Uma cópia semeada
 *   por migration nasceria desatualizada e envelheceria em silêncio.
 *
 * Então o padrão certo é o segundo padrão deste motor, o de `tax_rules` e
 * `mva_rules`: **tabela vazia, alimentada pelo contador**, que tem o cadastro
 * dele no IBPT (ou a assinatura da API do instituto) e transcreve as linhas dos
 * NCM que a loja realmente vende. É o mesmo argumento com que `mva_rules`
 * nasceu vazia: o número certo depende de uma fonte que muda e que este sistema
 * não tem — nem deveria fabricar — uma cópia de verdade.
 *
 * ## Por que NCM × UF **de origem**, e não de destino
 *
 * Aqui a chave diverge de `mva_rules`, e a divergência é o ponto:
 *
 * - A MVA é publicada pelo estado **que recebe** a mercadoria, então
 *   `mva_rules` é NCM × `uf_destino`.
 * - A tabela do IBPT é baixada **por UF da empresa emitente** — o site pede a
 *   unidade federativa da empresa cadastrada e entrega um CSV por estado. A
 *   coluna `estadual` daquele arquivo é a carga de ICMS **do estado em que a
 *   empresa está**, não do estado do comprador.
 *
 * Por isso a coluna se chama `uf` e quem a alimenta, no motor, é
 * `TaxRuleQuery.ufOrigem` (a UF da filial). Uma loja de um estado só cadastra
 * uma linha por NCM, com a UF dela ou com o coringa `'*'`.
 *
 * ## As quatro colunas de percentual espelham o arquivo do IBPT
 *
 * O CSV do IBPT (`TabelaIBPTax`) tem, entre outras, as colunas
 * `nacionalfederal`, `importadosfederal`, `estadual` e `municipal` — quatro
 * percentuais por linha, com a **federal** desdobrada em nacional e importada e
 * as outras duas valendo para os dois casos. O cadastro tem exatamente essas
 * quatro, com os mesmos nomes traduzidos, para a transcrição ser cópia direta e
 * não interpretação.
 *
 * A escolha entre a federal nacional e a importada sai de
 * `products.origem_mercadoria`, que este motor já usa para a alíquota
 * interestadual de 4% — ver `origemMercadoriaImportadaParaIbpt`, que documenta
 * por que o conjunto de origens **não** é o mesmo dos 4%.
 *
 * ## O que este arquivo deliberadamente não sabe
 *
 * - **A coluna `ex` (exceção fiscal do NCM)** do arquivo do IBPT. `products`
 *   não guarda "EX" nenhum, então não há como casá-la; o cadastro é por NCM
 *   puro. Cadastrar a linha do NCM sem exceção é o comportamento correto para
 *   todo produto deste sistema hoje.
 * - **Serviços (NBS e LC 116)**. O arquivo do IBPT também os traz (coluna
 *   `tipo`), mas este motor emite NF-e/NFC-e de mercadoria; ISS não passa por
 *   aqui.
 * - **A vigência não filtra a busca.** Ver `IbptRateRow.vigenciaInicio`.
 */

/** Linha de `ibpt_rates`, já em camelCase (mesmo formato que o motor genérico expõe). */
export type IbptRateRow = {
  id: string;
  /** NCM de 8 dígitos, sem pontuação — o mesmo formato de `products.ncm`. */
  ncm: string;
  /**
   * UF da **empresa emitente** (a filial que vende), ou o coringa `'*'`.
   * Ver `WILDCARD_UF` e a nota sobre origem × destino no topo do arquivo.
   */
  uf: string;
  /** Coluna `nacionalfederal` do arquivo do IBPT, em percentual. */
  aliquotaNacionalFederal: number;
  /** Coluna `importadosfederal` do arquivo do IBPT, em percentual. */
  aliquotaImportadoFederal: number;
  /** Coluna `estadual` do arquivo do IBPT, em percentual. */
  aliquotaEstadual: number;
  /** Coluna `municipal` do arquivo do IBPT, em percentual. */
  aliquotaMunicipal: number;
  /**
   * De onde vieram os percentuais (coluna `fonte` do arquivo; na prática,
   * "IBPT"). **Não vai para o XML** — ver `resolveIbptRate`.
   */
  fonte: string | null;
  /** Versão da tabela do IBPT transcrita (coluna `versao`). Rastro de auditoria. */
  versao: string | null;
  /**
   * Início da vigência da versão transcrita (coluna `vigenciainicio`).
   *
   * **Não filtra a busca**, e é decisão: nenhum cadastro deste motor
   * (`tax_rules`, `tax_groups`, `mva_rules`) tem dimensão temporal, e este
   * seria o único a ter. A consequência fica registrada: uma linha vencida
   * continua produzindo `vTotTrib` com o percentual antigo, em vez de o campo
   * sumir da nota sem ninguém perceber. Entre um valor aproximado desatualizado
   * e um campo que some sozinho, o primeiro é o desfecho menos surpreendente —
   * a lei já chama esse número de aproximado. A coluna existe para a
   * fiscalização (e o contador) saberem qual versão foi transcrita.
   */
  vigenciaInicio: string | null;
};

/** Linha crua de `ibpt_rates` → `IbptRateRow`. */
export function toIbptRateRow(row: {
  id: string;
  ncm: string;
  uf: string;
  aliquota_nacional_federal: number;
  aliquota_importado_federal: number;
  aliquota_estadual: number;
  aliquota_municipal: number;
  fonte: string | null;
  versao: string | null;
  vigencia_inicio: string | null;
}): IbptRateRow {
  return {
    id: row.id,
    ncm: row.ncm,
    uf: row.uf,
    aliquotaNacionalFederal: row.aliquota_nacional_federal,
    aliquotaImportadoFederal: row.aliquota_importado_federal,
    aliquotaEstadual: row.aliquota_estadual,
    aliquotaMunicipal: row.aliquota_municipal,
    fonte: row.fonte,
    versao: row.versao,
    vigenciaInicio: row.vigencia_inicio,
  };
}

/** As colunas de `ibpt_rates` que `toIbptRateRow` precisa — para quem monta o `select`. */
export const IBPT_RATE_COLUMNS =
  "id, ncm, uf, aliquota_nacional_federal, aliquota_importado_federal, " +
  "aliquota_estadual, aliquota_municipal, fonte, versao, vigencia_inicio";

/** Valor de `uf` que significa "qualquer UF" — o mesmo coringa de `tax_rules`/`mva_rules`. */
export const WILDCARD_UF = "*";

export type IbptRateQuery = {
  /** NCM do produto (`products.ncm`). */
  ncm: string;
  /** UF da filial que emite (`TaxRuleQuery.ufOrigem`). */
  uf: string;
};

export type IbptRateResolution =
  | { found: true; rule: IbptRateRow; matchedWildcard: boolean }
  /**
   * **`found: false` não é erro de emissão.** É a diferença de filosofia que
   * B9 introduz — ver a nota grande em `resolveIbptRate`. A `reason` existe
   * para teste e diagnóstico, não para virar mensagem de recusa.
   */
  | { found: false; reason: string; ambiguousRuleIds?: string[] };

function norm(value: string): string {
  return value.trim().toUpperCase();
}

/** Tira pontuação do NCM ("2202.10.00" → "22021000") — idêntico ao de `mvaRules.ts`. */
function normNcm(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Resolve o percentual aproximado de tributos aplicável a um item.
 *
 * O critério de desempate é o mesmo de `resolveTaxRule` e `resolveMvaRule`:
 * **mais específico vence** — uma linha com a UF exata bate uma linha coringa
 * (`'*'`) —, e o NCM é comparado exato (só os dígitos), pelo mesmo motivo já
 * registrado em `mvaRules.ts`: casar por prefixo faria uma linha de `2202`
 * capturar todo o capítulo em silêncio.
 *
 * ## A inversão de filosofia: aqui, "não sei" é campo ausente, não recusa
 *
 * Todo o resto deste motor **recusa a emissão** quando o cadastro não responde:
 * sem regra em `tax_rules` não há CFOP; sem MVA em `mva_rules` um CST com ST se
 * contradiz; sem alíquota ad rem um CST `03` sairia com imposto a menos. Em
 * todos esses casos o cadastro incompleto produziria uma **nota autorizada com
 * imposto errado**, que é o desfecho pior — daí a recusa.
 *
 * O `vTotTrib` é o primeiro campo deste motor em que isso se inverte, por três
 * razões que se somam:
 *
 * 1. **Ele não determina imposto devido.** O Decreto 8.264/2014, art. 6º, é
 *    literal: os valores "têm caráter meramente informativo, visando somente ao
 *    esclarecimento dos consumidores". Nenhum tributo é recolhido a mais ou a
 *    menos por causa dele.
 * 2. **O leiaute o declara opcional**, nos dois lugares em que ele aparece
 *    (`M02` e `W16a`), com "considerar valor = 0 se não informado". Uma nota
 *    sem `vTotTrib` é uma nota válida, autorizada normalmente.
 * 3. **Recusar seria o oposto do que a lei quer.** Uma loja que ainda não
 *    cadastrou os percentuais deixaria de faturar — a Lei da Transparência
 *    passaria a impedir a venda que ela existe para informar.
 *
 * Por isso: **sem linha cadastrada, o campo simplesmente não vai**, e a emissão
 * segue. Quem chama não empurra nada para `cadastroErrors`.
 *
 * ## Empate de especificidade também devolve `found: false`
 *
 * `resolveMvaRule` trata o empate como recusa; aqui ele é mais um caso de
 * "campo ausente", pela mesma razão acima. Na prática ele não acontece: a
 * unique `(ncm, uf)` da migration torna impossível duas linhas exatas ou duas
 * coringas para o mesmo NCM. O ramo existe porque este núcleo também roda com
 * dado de teste que não passa pelo banco, e escolher uma das duas em silêncio
 * seria decidir por sorteio qual percentual o consumidor vê.
 */
export function resolveIbptRate(query: IbptRateQuery, rules: IbptRateRow[]): IbptRateResolution {
  const ncm = normNcm(query.ncm);
  const uf = norm(query.uf);

  const candidates = rules.filter((rule) => {
    if (normNcm(rule.ncm) !== ncm) return false;
    const ruleUf = norm(rule.uf);
    return ruleUf === uf || ruleUf === WILDCARD_UF;
  });

  if (candidates.length === 0) {
    return {
      found: false,
      reason: `nenhum percentual de tributos aproximados cadastrado para o NCM ${ncm} na UF ${uf}.`,
    };
  }

  const exact = candidates.filter((rule) => norm(rule.uf) !== WILDCARD_UF);
  const winners = exact.length > 0 ? exact : candidates;

  if (winners.length > 1) {
    return {
      found: false,
      reason: `mais de um percentual de mesma especificidade se aplica ao NCM ${ncm} na UF ${uf}.`,
      ambiguousRuleIds: winners.map((rule) => rule.id),
    };
  }

  const rule = winners[0];
  return { found: true, rule, matchedWildcard: norm(rule.uf) === WILDCARD_UF };
}

/**
 * Códigos de `products.origem_mercadoria` que usam a coluna **`importadosfederal`**
 * do IBPT: `1`, `2`, `6` e `7` (estrangeira, importada direto ou adquirida no
 * mercado interno, com ou sem similar nacional) e `3` e `8` (nacional com
 * Conteúdo de Importação acima de 40% e acima de 70%).
 *
 * Ficam de fora `0` e `4` (nacionais) e — o único caso que exige critério — o
 * `5`, "nacional com Conteúdo de Importação **igual ou inferior a 40%**".
 *
 * ## Por que este conjunto não é o mesmo dos 4% da Resolução 13/2012
 *
 * `mvaRules.ts` tem uma lista parecida, `ORIGENS_IMPORTADAS_4` = `{1,2,3,8}`, e
 * as duas **não** coincidem de propósito: aquela transcreve as exceções
 * expressas de uma resolução do Senado (que exclui `6` e `7`, sem similar
 * nacional, e `4`, processo produtivo básico); esta responde a outra pergunta,
 * "este produto carrega tributos de importação no preço?". `6` e `7` são
 * estrangeiras e carregam — não haveria por que excluí-las aqui.
 *
 * ## De onde sai o corte do `5`
 *
 * Do Decreto 8.264/2014, art. 3º, §2º: os tributos de importação entram na
 * informação "na hipótese de produtos cujos insumos ou componentes sejam
 * oriundos de operações de comércio exterior e representem percentual **superior
 * a vinte por cento** do preço de venda". As faixas dos códigos de origem
 * respondem a esse limite sem ambiguidade em todos os casos menos um: `3`
 * (40% a 70%) e `8` (acima de 70%) estão seguramente acima dos 20%; `5` (até
 * 40%) pode estar dos dois lados, e a origem não diz de qual. Ele fica de fora
 * porque o cadastro afirma "nacional" e o gatilho do decreto é afirmativo —
 * mesmo critério conservador com que `aliquotaInterestadual` trata origem
 * ausente ou desconhecida.
 */
const ORIGENS_IMPORTADAS_IBPT = new Set(["1", "2", "3", "6", "7", "8"]);

/** `products.origem_mercadoria` → usa a coluna federal de importado? Ver `ORIGENS_IMPORTADAS_IBPT`. */
export function origemMercadoriaImportadaParaIbpt(origemMercadoria: string | null | undefined): boolean {
  return ORIGENS_IMPORTADAS_IBPT.has((origemMercadoria ?? "").trim());
}

/**
 * Os três percentuais que o Decreto 8.264/2014, art. 2º, manda apurar
 * **segregados por ente tributante** — federal, estadual e municipal.
 *
 * A federal é uma escolha entre as duas colunas do arquivo, decidida pela
 * origem da mercadoria; as outras duas valem para os dois casos (o arquivo do
 * IBPT tem uma coluna `estadual` e uma `municipal`, sem desdobramento por
 * origem).
 */
export function percentuaisTributosAproximados(
  rule: IbptRateRow,
  origemMercadoria: string | null | undefined,
): { federal: number; estadual: number; municipal: number } {
  return {
    federal: origemMercadoriaImportadaParaIbpt(origemMercadoria)
      ? rule.aliquotaImportadoFederal
      : rule.aliquotaNacionalFederal,
    estadual: rule.aliquotaEstadual,
    municipal: rule.aliquotaMunicipal,
  };
}
