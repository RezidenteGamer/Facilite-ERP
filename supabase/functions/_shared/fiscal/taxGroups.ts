/**
 * Grupo tributário — o perfil de tributação que fica atrelado ao produto.
 *
 * Correção de 19/08/2026 à etapa 7 (Tributações). A etapa 7 guardava CST e
 * alíquota em `tax_rules`, junto do CFOP, como se todos dependessem só da
 * forma da operação. CFOP depende (venda interna ≠ interestadual, independente
 * do produto); CST/CSOSN e alíquota **não** — dois produtos na mesma operação
 * podem ter tributação diferente (substituição tributária, isento,
 * monofásico, alíquota diferente).
 *
 * O padrão que os ERPs brasileiros de referência usam, e que este projeto
 * seguiu em vez de inventar um desenho próprio: um **grupo tributário** — um
 * perfil nomeado e reutilizável, criado uma vez ("Tributado padrão 18%",
 * "Isento", "Substituição tributária") e atrelado a N produtos. A operação
 * decide o CFOP (`resolveTaxRule`, em `taxRules.ts`); o produto, via seu
 * grupo, decide CST e alíquota.
 */

/** Linha de `tax_groups`, já em camelCase (mesmo formato que o motor genérico expõe). */
export type TaxGroup = {
  id: string;
  code: string;
  name: string;
  /** Aplica-se quando quem emite é Regime Normal (CRT 3). */
  cstIcms: string | null;
  /** Aplica-se quando quem emite é Simples Nacional (CRT 1 ou 2). */
  csosn: string | null;
  aliquotaIcms: number | null;
  cstPis: string | null;
  aliquotaPis: number | null;
  cstCofins: string | null;
  aliquotaCofins: number | null;
  cstIbsCbs: string | null;
  cclasstrib: string | null;
};

/**
 * Qual dos dois códigos de situação tributária do ICMS vale para esta emissão.
 *
 * CST e CSOSN não coexistem na mesma operação: quem é Simples Nacional
 * (CRT 1 ou 2) usa CSOSN, quem é Regime Normal (CRT 3) usa CST. O grupo guarda
 * os dois porque o mesmo cadastro de produto pode ser usado por filiais em
 * regimes diferentes — quem escolhe é o `regime` de quem está emitindo, não o
 * cadastro do produto.
 *
 * Cai no outro código quando o esperado não está preenchido, em vez de
 * devolver nada: um grupo cadastrado só com CSOSN ainda descreve a tributação
 * do produto, e emitir com o código que existe é melhor do que recusar a nota
 * por causa da coluna vazia. Devolve `null` só quando o grupo não tem nenhum
 * dos dois — aí quem chama recusa a emissão com mensagem própria.
 */
export function resolveIcmsSituacaoTributaria(group: TaxGroup, regime: string): string | null {
  return regime === "3" ? (group.cstIcms ?? group.csosn) : (group.csosn ?? group.cstIcms);
}

/**
 * Linha crua de `tax_groups` → `TaxGroup`.
 *
 * Mora no núcleo desde A1 (01/09/2026) porque as duas bordas leem a mesma
 * tabela: a Edge Function `fiscal-emit`, para montar a nota, e o front, para o
 * lookup de "Grupo tributário" no cadastro de Produtos. Duas cópias desta
 * conversão significariam que um campo novo em `tax_groups` poderia chegar à
 * tela sem chegar à nota — que é exatamente o tipo de divergência silenciosa
 * que o núcleo compartilhado existe para impedir.
 */
export function toTaxGroup(row: {
  id: string;
  code: string;
  name: string;
  cst_icms: string | null;
  csosn: string | null;
  aliquota_icms: number | null;
  cst_pis: string | null;
  aliquota_pis: number | null;
  cst_cofins: string | null;
  aliquota_cofins: number | null;
  cst_ibs_cbs: string | null;
  cclasstrib: string | null;
}): TaxGroup {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    cstIcms: row.cst_icms,
    csosn: row.csosn,
    aliquotaIcms: row.aliquota_icms,
    cstPis: row.cst_pis,
    aliquotaPis: row.aliquota_pis,
    cstCofins: row.cst_cofins,
    aliquotaCofins: row.aliquota_cofins,
    cstIbsCbs: row.cst_ibs_cbs,
    cclasstrib: row.cclasstrib,
  };
}

/** As colunas de `tax_groups` que `toTaxGroup` precisa — para quem monta o `select`. */
export const TAX_GROUP_COLUMNS =
  "id, code, name, cst_icms, csosn, aliquota_icms, cst_pis, aliquota_pis, cst_cofins, aliquota_cofins, cst_ibs_cbs, cclasstrib";
